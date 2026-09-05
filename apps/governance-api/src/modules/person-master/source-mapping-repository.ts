import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { AuthorizationModule, ObjectPermissionCode } from '../authorization/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import {
  validateSourceMappingCorrection, validateSourceMappingRegistration, validateSourceMappingRetraction,
  validateSourceMappingTimes, validateSourceRecordIdentity,
  type CorrectPersonSourceMapping, type PersonSourceMapping, type PersonSourceMappingApplication,
  type PersonSourceMappingReference, type PersonSourceMappingVersion, type RegisterPersonSourceMapping,
  type RetractPersonSourceMapping, type SourceMappingTimes,
} from './source-mapping-contracts.js';

type MappingRow = Selectable<DB['person_master.person_source_mapping']>;
type VersionRow = Selectable<DB['person_master.person_source_mapping_version']>;
type CommandResult = { readonly ok: true; readonly version: PersonSourceMappingVersion } |
  { readonly ok: false; readonly code: 'SOURCE_MAPPING_ALREADY_EXISTS' | 'SOURCE_MAPPING_STALE_VERSION' };

export interface PersonSourceMappingModule extends Omit<PersonSourceMappingApplication,
  'registerPersonSourceMapping' | 'correctPersonSourceMapping' | 'retractPersonSourceMapping'> {
  registerPersonSourceMapping(command: RegisterPersonSourceMapping): Promise<CommandResult>;
  correctPersonSourceMapping(command: CorrectPersonSourceMapping): Promise<CommandResult>;
  retractPersonSourceMapping(command: RetractPersonSourceMapping): Promise<CommandResult>;
}

export function createPersonSourceMappingModule(
  database: Transaction<DB>, context: RequestContext, audit: AuditEventService,
  authorization: AuthorizationModule,
  requireScope: (objectId: string, operation: 'READ' | 'WRITE' | 'CORRECT') => Promise<void>,
): PersonSourceMappingModule {
  parseLocalDateTime(context.occurredAt);
  assertPersonUuid(context.actorPrincipalId);
  for (const id of [context.requestId, context.correlationId]) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)) {
      throw new Error('SOURCE_MAPPING_CONTEXT_INVALID');
    }
  }

  async function authorize(objectId: string, operation: 'READ' | 'WRITE' | 'CORRECT') {
    assertPersonUuid(objectId);
    await requireScope(objectId, operation);
    const permission: ObjectPermissionCode = operation === 'READ' ? 'PERSON_MASTER_SOURCE_MAPPING_READ'
      : operation === 'WRITE' ? 'PERSON_MASTER_SOURCE_MAPPING_WRITE' : 'PERSON_MASTER_SOURCE_MAPPING_CORRECT';
    await authorization.requireObjectPermission({ governanceObjectId: objectId, permissionCode: permission });
  }

  async function requirePerson(objectId: string, personId: string) {
    assertPersonUuid(personId);
    const row = await database.selectFrom('person_master.person_subject').select('person_id')
      .where('governance_object_id', '=', objectId).where('person_id', '=', personId).executeTakeFirst();
    if (!row) throw new Error('SOURCE_MAPPING_TARGET_PERSON_INVALID');
  }

  async function mapping(query: PersonSourceMappingReference, lock = false) {
    assertMappingId(query.personSourceMappingId);
    let select = database.selectFrom('person_master.person_source_mapping').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('person_source_mapping_id', '=', query.personSourceMappingId);
    if (lock) select = select.forUpdate();
    const row = await select.executeTakeFirst();
    if (!row) throw new Error('SOURCE_MAPPING_NOT_FOUND');
    return row;
  }

  async function latest(mappingId: string): Promise<VersionRow> {
    return database.selectFrom('person_master.person_source_mapping_version').selectAll()
      .where('person_source_mapping_id', '=', mappingId).orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
  }

  async function repeated(mappingId: string): Promise<VersionRow | undefined> {
    return database.selectFrom('person_master.person_source_mapping_version').selectAll()
      .where('person_source_mapping_id', '=', mappingId).where('request_id', '=', context.requestId)
      .executeTakeFirst();
  }

  async function record(objectId: string, mappingId: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null) {
    await audit.append({ governanceObjectId: objectId, aggregateType: 'PERSON_SOURCE_MAPPING',
      aggregateId: mappingId, aggregateVersionId: versionId, eventType, payload, afterHash: null,
      authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }

  async function effective(query: PersonSourceMappingReference & SourceMappingTimes): Promise<PersonSourceMappingVersion | null> {
    const row = await database.selectFrom('person_master.person_source_mapping_version').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('person_source_mapping_id', '=', query.personSourceMappingId)
      .where('recorded_from', '<=', query.recordAsOf)
      .where('business_valid_from', '<=', query.businessAt)
      .where((eb) => eb.or([eb('business_valid_to', 'is', null), eb('business_valid_to', '>', query.businessAt)]))
      .orderBy('version_no', 'desc').executeTakeFirst();
    return row?.mapping_status === 'MAPPED' ? toVersion(row) : null;
  }

  return {
    async registerPersonSourceMapping(command) {
      validateSourceMappingRegistration(command);
      assertPersonUuid(command.personId);
      await authorize(command.governanceObjectId, 'WRITE');
      await sql`select pg_advisory_xact_lock(hashtextextended(${`person-source-mapping-create:${command.governanceObjectId}:${context.requestId}`}, 0))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'REGISTER', personId: command.personId,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo });
      const priorRequest = await database.selectFrom('person_master.person_source_mapping').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('creation_request_id', '=', context.requestId).executeTakeFirst();
      if (priorRequest) {
        const first = await database.selectFrom('person_master.person_source_mapping_version').selectAll()
          .where('person_source_mapping_id', '=', priorRequest.person_source_mapping_id)
          .where('version_no', '=', '1').executeTakeFirstOrThrow();
        if (priorRequest.created_by !== context.actorPrincipalId || priorRequest.source_system !== command.sourceSystem ||
          priorRequest.source_entity !== command.sourceEntity || priorRequest.source_record_key !== command.sourceRecordKey ||
          first.person_id !== command.personId || !first.operation_hash.equals(operationHash)) {
          throw new Error('SOURCE_MAPPING_OPERATION_CONFLICT');
        }
        return { ok: true, version: toVersion(first) };
      }
      const existing = await database.selectFrom('person_master.person_source_mapping').select('person_source_mapping_id')
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('source_system', '=', command.sourceSystem).where('source_entity', '=', command.sourceEntity)
        .where('source_record_key', '=', command.sourceRecordKey).executeTakeFirst();
      if (existing) {
        await record(command.governanceObjectId, existing.person_source_mapping_id,
          'PERSON_SOURCE_MAPPING_REGISTRATION_REJECTED', { personSourceMappingId: existing.person_source_mapping_id,
            personId: command.personId, result: 'REJECTED', reason: 'SOURCE_MAPPING_ALREADY_EXISTS' });
        return { ok: false, code: 'SOURCE_MAPPING_ALREADY_EXISTS' };
      }
      await requirePerson(command.governanceObjectId, command.personId);
      const row = await database.insertInto('person_master.person_source_mapping').values({
        governance_object_id: command.governanceObjectId, source_system: command.sourceSystem,
        source_entity: command.sourceEntity, source_record_key: command.sourceRecordKey,
        creation_request_id: context.requestId, created_by: context.actorPrincipalId,
      }).onConflict((conflict) => conflict.constraint('person_source_mapping_exact_unique').doNothing())
        .returningAll().executeTakeFirst();
      if (!row) {
        const winner = await database.selectFrom('person_master.person_source_mapping').select('person_source_mapping_id')
          .where('governance_object_id', '=', command.governanceObjectId)
          .where('source_system', '=', command.sourceSystem).where('source_entity', '=', command.sourceEntity)
          .where('source_record_key', '=', command.sourceRecordKey).executeTakeFirstOrThrow();
        await record(command.governanceObjectId, winner.person_source_mapping_id,
          'PERSON_SOURCE_MAPPING_REGISTRATION_REJECTED', { personSourceMappingId: winner.person_source_mapping_id,
            personId: command.personId, result: 'REJECTED', reason: 'SOURCE_MAPPING_ALREADY_EXISTS' });
        return { ok: false, code: 'SOURCE_MAPPING_ALREADY_EXISTS' };
      }
      const version = await database.insertInto('person_master.person_source_mapping_version').values({
        person_source_mapping_id: row.person_source_mapping_id, governance_object_id: row.governance_object_id,
        person_id: command.personId, version_no: '1', mapping_status: 'MAPPED', change_kind: 'REGISTERED',
        supersedes_mapping_version_id: null, reason_code: null, business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId,
        request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(command.governanceObjectId, row.person_source_mapping_id, 'PERSON_SOURCE_MAPPING_REGISTERED', {
        personSourceMappingId: row.person_source_mapping_id, personSourceMappingVersionId: version.person_source_mapping_version_id,
        personId: version.person_id, versionNo: version.version_no, result: 'REGISTERED',
      }, version.person_source_mapping_version_id);
      return { ok: true, version: toVersion(version) };
    },

    async correctPersonSourceMapping(command) {
      validateSourceMappingCorrection(command);
      assertMappingId(command.personSourceMappingId);
      assertExpectedVersionId(command.expectedCurrentVersionId);
      assertPersonUuid(command.correctedPersonId);
      await authorize(command.governanceObjectId, 'CORRECT');
      const row = await mapping(command, true);
      const operationHash = canonicalSha256({ kind: 'CORRECT', expectedCurrentVersionId: command.expectedCurrentVersionId,
        correctedPersonId: command.correctedPersonId, businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo, reasonCode: command.reasonCode });
      const retry = await repeated(row.person_source_mapping_id);
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || retry.change_kind !== 'CORRECTED' ||
          !retry.operation_hash.equals(operationHash)) throw new Error('SOURCE_MAPPING_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(retry) };
      }
      const previous = await latest(row.person_source_mapping_id);
      if (previous.person_source_mapping_version_id !== command.expectedCurrentVersionId) {
        await record(command.governanceObjectId, row.person_source_mapping_id,
          'PERSON_SOURCE_MAPPING_CORRECTION_REJECTED', { personSourceMappingId: row.person_source_mapping_id,
            expectedCurrentVersionId: command.expectedCurrentVersionId,
            actualCurrentVersionId: previous.person_source_mapping_version_id,
            result: 'REJECTED', reason: 'SOURCE_MAPPING_STALE_VERSION' });
        return { ok: false, code: 'SOURCE_MAPPING_STALE_VERSION' };
      }
      await requirePerson(command.governanceObjectId, command.correctedPersonId);
      const version = await database.insertInto('person_master.person_source_mapping_version').values({
        person_source_mapping_id: row.person_source_mapping_id, governance_object_id: row.governance_object_id,
        person_id: command.correctedPersonId, version_no: (BigInt(previous.version_no) + 1n).toString(),
        mapping_status: 'MAPPED', change_kind: 'CORRECTED',
        supersedes_mapping_version_id: previous.person_source_mapping_version_id, reason_code: command.reasonCode,
        business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
        created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(command.governanceObjectId, row.person_source_mapping_id, 'PERSON_SOURCE_MAPPING_CORRECTED', {
        personSourceMappingId: row.person_source_mapping_id,
        personSourceMappingVersionId: version.person_source_mapping_version_id,
        supersedesMappingVersionId: previous.person_source_mapping_version_id,
        fromPersonId: previous.person_id, toPersonId: version.person_id, reasonCode: version.reason_code,
        versionNo: version.version_no, result: 'CORRECTED',
      }, version.person_source_mapping_version_id);
      return { ok: true, version: toVersion(version) };
    },

    async retractPersonSourceMapping(command) {
      validateSourceMappingRetraction(command);
      assertMappingId(command.personSourceMappingId);
      assertExpectedVersionId(command.expectedCurrentVersionId);
      await authorize(command.governanceObjectId, 'CORRECT');
      const row = await mapping(command, true);
      const operationHash = canonicalSha256({ kind: 'RETRACT', expectedCurrentVersionId: command.expectedCurrentVersionId,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo,
        reasonCode: command.reasonCode });
      const retry = await repeated(row.person_source_mapping_id);
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || retry.change_kind !== 'RETRACTED' ||
          !retry.operation_hash.equals(operationHash)) throw new Error('SOURCE_MAPPING_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(retry) };
      }
      const previous = await latest(row.person_source_mapping_id);
      if (previous.person_source_mapping_version_id !== command.expectedCurrentVersionId) {
        await record(command.governanceObjectId, row.person_source_mapping_id,
          'PERSON_SOURCE_MAPPING_CORRECTION_REJECTED', { personSourceMappingId: row.person_source_mapping_id,
            expectedCurrentVersionId: command.expectedCurrentVersionId,
            actualCurrentVersionId: previous.person_source_mapping_version_id,
            result: 'REJECTED', reason: 'SOURCE_MAPPING_STALE_VERSION' });
        return { ok: false, code: 'SOURCE_MAPPING_STALE_VERSION' };
      }
      const version = await database.insertInto('person_master.person_source_mapping_version').values({
        person_source_mapping_id: row.person_source_mapping_id, governance_object_id: row.governance_object_id,
        person_id: previous.person_id, version_no: (BigInt(previous.version_no) + 1n).toString(),
        mapping_status: 'RETRACTED', change_kind: 'RETRACTED',
        supersedes_mapping_version_id: previous.person_source_mapping_version_id, reason_code: command.reasonCode,
        business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
        created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(command.governanceObjectId, row.person_source_mapping_id, 'PERSON_SOURCE_MAPPING_RETRACTED', {
        personSourceMappingId: row.person_source_mapping_id,
        personSourceMappingVersionId: version.person_source_mapping_version_id,
        supersedesMappingVersionId: previous.person_source_mapping_version_id,
        personId: version.person_id, reasonCode: version.reason_code,
        versionNo: version.version_no, result: 'RETRACTED',
      }, version.person_source_mapping_version_id);
      return { ok: true, version: toVersion(version) };
    },

    async getPersonSourceMapping(query) {
      assertClosedObject(query, ['governanceObjectId', 'personSourceMappingId']);
      await authorize(query.governanceObjectId, 'READ');
      const row = await mapping(query);
      await record(query.governanceObjectId, row.person_source_mapping_id, 'PERSON_SOURCE_MAPPING_READ', {
        personSourceMappingId: row.person_source_mapping_id, queryKind: 'MAPPING', result: 'FOUND',
      });
      return toMapping(row);
    },

    async getPersonSourceMappingVersion(query) {
      assertClosedObject(query, ['governanceObjectId', 'personSourceMappingId', 'personSourceMappingVersionId']);
      assertMappingId(query.personSourceMappingVersionId);
      await authorize(query.governanceObjectId, 'READ');
      await mapping(query);
      const row = await database.selectFrom('person_master.person_source_mapping_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('person_source_mapping_id', '=', query.personSourceMappingId)
        .where('person_source_mapping_version_id', '=', query.personSourceMappingVersionId).executeTakeFirst();
      if (!row) throw new Error('SOURCE_MAPPING_VERSION_NOT_FOUND');
      await record(query.governanceObjectId, query.personSourceMappingId, 'PERSON_SOURCE_MAPPING_READ', {
        personSourceMappingId: query.personSourceMappingId,
        personSourceMappingVersionId: query.personSourceMappingVersionId, queryKind: 'VERSION', result: 'FOUND',
      });
      return toVersion(row);
    },

    async listPersonSourceMappingVersions(query) {
      assertClosedObject(query, ['governanceObjectId', 'personSourceMappingId']);
      await authorize(query.governanceObjectId, 'READ');
      await mapping(query);
      const rows = await database.selectFrom('person_master.person_source_mapping_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('person_source_mapping_id', '=', query.personSourceMappingId)
        .orderBy('version_no').execute();
      await record(query.governanceObjectId, query.personSourceMappingId, 'PERSON_SOURCE_MAPPING_READ', {
        personSourceMappingId: query.personSourceMappingId, queryKind: 'HISTORY', count: rows.length,
      });
      return rows.map(toVersion);
    },

    async findPersonSourceMappingAsOf(query) {
      assertClosedObject(query, ['governanceObjectId', 'personSourceMappingId', 'businessAt', 'recordAsOf']);
      validateSourceMappingTimes(query);
      await authorize(query.governanceObjectId, 'READ');
      await mapping(query);
      const result = await effective(query);
      await record(query.governanceObjectId, query.personSourceMappingId, 'PERSON_SOURCE_MAPPING_READ', {
        personSourceMappingId: query.personSourceMappingId, queryKind: 'AS_OF',
        result: result ? 'FOUND' : 'NOT_FOUND',
      });
      return result;
    },

    async findPersonBySourceRecord(query) {
      assertClosedObject(query, ['governanceObjectId', 'sourceSystem', 'sourceEntity', 'sourceRecordKey',
        'businessAt', 'recordAsOf']);
      validateSourceRecordIdentity(query);
      validateSourceMappingTimes(query);
      await authorize(query.governanceObjectId, 'READ');
      const row = await database.selectFrom('person_master.person_source_mapping').select('person_source_mapping_id')
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('source_system', '=', query.sourceSystem).where('source_entity', '=', query.sourceEntity)
        .where('source_record_key', '=', query.sourceRecordKey).executeTakeFirst();
      const result = row ? await effective({ governanceObjectId: query.governanceObjectId,
        personSourceMappingId: row.person_source_mapping_id, businessAt: query.businessAt,
        recordAsOf: query.recordAsOf }) : null;
      await record(query.governanceObjectId, row?.person_source_mapping_id ?? query.governanceObjectId,
        'PERSON_SOURCE_MAPPING_LOOKUP', { queryKind: 'EXACT_SOURCE_RECORD', result: result ? 'FOUND' : 'NOT_FOUND' });
      return result;
    },
  };
}

function assertMappingId(value: unknown): asserts value is string {
  try { assertPersonUuid(value); }
  catch { throw new Error('SOURCE_MAPPING_ID_INVALID'); }
}

function assertExpectedVersionId(value: unknown): asserts value is string {
  try { assertPersonUuid(value); }
  catch { throw new Error('SOURCE_MAPPING_EXPECTED_VERSION_INVALID'); }
}

function toMapping(row: MappingRow): PersonSourceMapping {
  return { personSourceMappingId: row.person_source_mapping_id, governanceObjectId: row.governance_object_id,
    sourceSystem: row.source_system, sourceEntity: row.source_entity,
    sourceRecordKey: row.source_record_key, createdAt: row.created_at };
}

function toVersion(row: VersionRow): PersonSourceMappingVersion {
  return { personSourceMappingId: row.person_source_mapping_id,
    personSourceMappingVersionId: row.person_source_mapping_version_id,
    governanceObjectId: row.governance_object_id, personId: row.person_id, versionNo: row.version_no,
    mappingStatus: row.mapping_status as PersonSourceMappingVersion['mappingStatus'],
    changeKind: row.change_kind as PersonSourceMappingVersion['changeKind'],
    supersedesMappingVersionId: row.supersedes_mapping_version_id,
    reasonCode: row.reason_code as PersonSourceMappingVersion['reasonCode'],
    businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to,
    recordedFrom: row.recorded_from };
}
