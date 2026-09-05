import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { AuthorizationModule, ObjectPermissionCode } from '../authorization/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import {
  assertEngagementUuid, validateEngagementCreation, validateEngagementRevision, validateEngagementTimes,
  type CreateEngagement, type Engagement, type EngagementAsOfQuery, type EngagementCoreApplication,
  type EngagementReference, type EngagementVersion, type ReviseEngagement,
} from './engagement-contracts.js';

type EngagementRow = Selectable<DB['person_master.engagement']>;
type VersionRow = Selectable<DB['person_master.engagement_version']>;
type CommandResult = { readonly ok: true; readonly version: EngagementVersion } |
  { readonly ok: false; readonly code: 'ENGAGEMENT_STALE_VERSION' };

export interface EngagementCoreModule extends Omit<EngagementCoreApplication,
  'createEngagement' | 'reviseEngagement'> {
  createEngagement(command: CreateEngagement): Promise<CommandResult>;
  reviseEngagement(command: ReviseEngagement): Promise<CommandResult>;
}

export function createEngagementCoreModule(
  database: Transaction<DB>, context: RequestContext, audit: AuditEventService,
  authorization: AuthorizationModule,
  requireScope: (objectId: string, operation: 'READ' | 'WRITE') => Promise<void>,
): EngagementCoreModule {
  parseLocalDateTime(context.occurredAt);
  assertPersonUuid(context.actorPrincipalId);
  for (const id of [context.requestId, context.correlationId]) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)) {
      throw new Error('ENGAGEMENT_CONTEXT_INVALID');
    }
  }

  async function authorize(objectId: string, operation: 'READ' | 'WRITE') {
    assertEngagementUuid(objectId, 'ENGAGEMENT_SCOPE_INVALID');
    await requireScope(objectId, operation);
    const permission: ObjectPermissionCode = operation === 'READ'
      ? 'PERSON_MASTER_ENGAGEMENT_READ' : 'PERSON_MASTER_ENGAGEMENT_WRITE';
    await authorization.requireObjectPermission({ governanceObjectId: objectId, permissionCode: permission });
  }

  async function requirePerson(objectId: string, personId: string) {
    assertEngagementUuid(personId, 'ENGAGEMENT_PERSON_INVALID');
    const row = await database.selectFrom('person_master.person_subject').select('person_id')
      .where('governance_object_id', '=', objectId).where('person_id', '=', personId).executeTakeFirst();
    if (!row) throw new Error('ENGAGEMENT_PERSON_INVALID');
  }

  async function relation(query: EngagementReference, lock = false): Promise<EngagementRow> {
    assertEngagementUuid(query.engagementId, 'ENGAGEMENT_ID_INVALID');
    let select = database.selectFrom('person_master.engagement').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('engagement_id', '=', query.engagementId);
    if (lock) select = select.forUpdate();
    const row = await select.executeTakeFirst();
    if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
    return row;
  }

  async function latest(engagementId: string): Promise<VersionRow> {
    return database.selectFrom('person_master.engagement_version').selectAll()
      .where('engagement_id', '=', engagementId).orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
  }

  async function repeated(engagementId: string): Promise<VersionRow | undefined> {
    return database.selectFrom('person_master.engagement_version').selectAll()
      .where('engagement_id', '=', engagementId).where('request_id', '=', context.requestId)
      .executeTakeFirst();
  }

  async function record(objectId: string, engagementId: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null) {
    await audit.append({ governanceObjectId: objectId, aggregateType: 'PERSON_ENGAGEMENT',
      aggregateId: engagementId, aggregateVersionId: versionId, eventType, payload, afterHash: null,
      authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }

  return {
    async createEngagement(command) {
      validateEngagementCreation(command);
      await authorize(command.governanceObjectId, 'WRITE');
      await sql`select pg_advisory_xact_lock(hashtextextended(${`person-engagement-create:${command.governanceObjectId}:${context.requestId}`}, 0))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'CREATE_ENGAGEMENT', personId: command.personId,
        relationBasis: command.relationBasis, businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo });
      const priorRequest = await database.selectFrom('person_master.engagement').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('creation_request_id', '=', context.requestId).executeTakeFirst();
      if (priorRequest) {
        const first = await database.selectFrom('person_master.engagement_version').selectAll()
          .where('engagement_id', '=', priorRequest.engagement_id).where('version_no', '=', '1')
          .executeTakeFirstOrThrow();
        if (priorRequest.created_by !== context.actorPrincipalId || priorRequest.person_id !== command.personId ||
          !first.operation_hash.equals(operationHash)) throw new Error('ENGAGEMENT_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(first) };
      }
      await requirePerson(command.governanceObjectId, command.personId);
      const row = await database.insertInto('person_master.engagement').values({
        governance_object_id: command.governanceObjectId, person_id: command.personId,
        creation_request_id: context.requestId, created_by: context.actorPrincipalId,
      }).returningAll().executeTakeFirstOrThrow();
      const version = await database.insertInto('person_master.engagement_version').values({
        engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
        person_id: row.person_id, version_no: '1', supersedes_engagement_version_id: null,
        revision_reason_code: null, business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId,
        request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_CREATED', {
        engagementId: row.engagement_id, engagementVersionId: version.engagement_version_id,
        personId: row.person_id, versionNo: version.version_no, result: 'CREATED',
      }, version.engagement_version_id);
      return { ok: true, version: toVersion(version) };
    },

    async reviseEngagement(command) {
      validateEngagementRevision(command);
      await authorize(command.governanceObjectId, 'WRITE');
      const row = await relation(command, true);
      const operationHash = canonicalSha256({ kind: 'REVISE_ENGAGEMENT',
        expectedCurrentVersionId: command.expectedCurrentVersionId,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo,
        reasonCode: command.reasonCode });
      const retry = await repeated(row.engagement_id);
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || retry.revision_reason_code !== command.reasonCode ||
          !retry.operation_hash.equals(operationHash)) throw new Error('ENGAGEMENT_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(retry) };
      }
      const previous = await latest(row.engagement_id);
      if (previous.engagement_version_id !== command.expectedCurrentVersionId) {
        await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_REVISION_REJECTED', {
          engagementId: row.engagement_id, expectedCurrentVersionId: command.expectedCurrentVersionId,
          actualCurrentVersionId: previous.engagement_version_id,
          result: 'REJECTED', reason: 'ENGAGEMENT_STALE_VERSION',
        });
        return { ok: false, code: 'ENGAGEMENT_STALE_VERSION' };
      }
      const version = await database.insertInto('person_master.engagement_version').values({
        engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
        person_id: row.person_id, version_no: (BigInt(previous.version_no) + 1n).toString(),
        supersedes_engagement_version_id: previous.engagement_version_id,
        revision_reason_code: command.reasonCode, business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId,
        request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_VERSION_CREATED', {
        engagementId: row.engagement_id, engagementVersionId: version.engagement_version_id,
        supersedesEngagementVersionId: previous.engagement_version_id, personId: row.person_id,
        reasonCode: version.revision_reason_code, versionNo: version.version_no, result: 'REVISED',
      }, version.engagement_version_id);
      return { ok: true, version: toVersion(version) };
    },

    async getEngagement(query) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId']);
      await authorize(query.governanceObjectId, 'READ');
      const row = await relation(query);
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_READ', {
        engagementId: row.engagement_id, queryKind: 'RELATION', result: 'FOUND',
      });
      return toEngagement(row);
    },

    async getEngagementVersion(query) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId', 'engagementVersionId']);
      assertEngagementUuid(query.engagementVersionId, 'ENGAGEMENT_VERSION_ID_INVALID');
      await authorize(query.governanceObjectId, 'READ');
      await relation(query);
      const row = await database.selectFrom('person_master.engagement_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('engagement_id', '=', query.engagementId)
        .where('engagement_version_id', '=', query.engagementVersionId).executeTakeFirst();
      if (!row) throw new Error('ENGAGEMENT_VERSION_NOT_FOUND');
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, engagementVersionId: query.engagementVersionId,
        queryKind: 'VERSION', result: 'FOUND',
      });
      return toVersion(row);
    },

    async listEngagementVersions(query) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId']);
      await authorize(query.governanceObjectId, 'READ');
      await relation(query);
      const rows = await database.selectFrom('person_master.engagement_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('engagement_id', '=', query.engagementId).orderBy('version_no').execute();
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, queryKind: 'HISTORY', count: rows.length,
      });
      return rows.map(toVersion);
    },

    async listPersonEngagements(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId']);
      assertEngagementUuid(query.personId, 'ENGAGEMENT_PERSON_INVALID');
      await authorize(query.governanceObjectId, 'READ');
      await requirePerson(query.governanceObjectId, query.personId);
      const rows = await database.selectFrom('person_master.engagement').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('person_id', '=', query.personId).orderBy('created_at').orderBy('engagement_id').execute();
      await record(query.governanceObjectId, query.personId, 'PERSON_ENGAGEMENT_READ', {
        personId: query.personId, queryKind: 'PERSON_RELATIONS', count: rows.length,
      });
      return rows.map(toEngagement);
    },

    async findEngagementAsOf(query: EngagementAsOfQuery) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId', 'businessAt', 'recordAsOf']);
      validateEngagementTimes(query);
      await authorize(query.governanceObjectId, 'READ');
      await relation(query);
      const row = await database.selectFrom('person_master.engagement_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('engagement_id', '=', query.engagementId)
        .where('recorded_from', '<=', query.recordAsOf)
        .where('business_valid_from', '<=', query.businessAt)
        .where((eb) => eb.or([eb('business_valid_to', 'is', null), eb('business_valid_to', '>', query.businessAt)]))
        .orderBy('version_no', 'desc').executeTakeFirst();
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, queryKind: 'AS_OF', result: row ? 'FOUND' : 'NOT_FOUND',
      });
      return row ? toVersion(row) : null;
    },
  };
}

function toEngagement(row: EngagementRow): Engagement {
  return { engagementId: row.engagement_id, governanceObjectId: row.governance_object_id,
    personId: row.person_id, createdAt: row.created_at };
}

function toVersion(row: VersionRow): EngagementVersion {
  return { engagementId: row.engagement_id, engagementVersionId: row.engagement_version_id,
    governanceObjectId: row.governance_object_id, personId: row.person_id, versionNo: row.version_no,
    supersedesEngagementVersionId: row.supersedes_engagement_version_id,
    reasonCode: row.revision_reason_code as EngagementVersion['reasonCode'],
    businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to,
    recordedFrom: row.recorded_from };
}
