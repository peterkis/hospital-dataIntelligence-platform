import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { AuthorizationModule, ObjectPermissionCode } from '../authorization/index.js';
import {
  canonicalizeEngagementTypePair,
  validateAppendEngagementOverlapRuleVersion,
  validateAppendEngagementTypeVersion,
  validateEngagementOverlapRuleAsOfQuery,
  validateEngagementOverlapRuleHistoryQuery,
  validateEngagementTypeHistoryQuery,
  type AppendEngagementOverlapRuleVersion,
  type AppendEngagementTypeVersion,
  type EngagementOverlapRuleAsOfQuery,
  type EngagementOverlapRuleHistoryQuery,
  type EngagementOverlapRuleVersion,
  type EngagementPolicyApplication,
  type EngagementTypeHistoryQuery,
  type EngagementTypeVersion,
} from './engagement-policy-contracts.js';
import { assertPersonUuid } from './contracts.js';

type TypeDefinitionRow = Selectable<DB['person_master.engagement_type']>;
type TypeVersionRow = Selectable<DB['person_master.engagement_type_version']>;
type RuleDefinitionRow = Selectable<DB['person_master.engagement_overlap_rule']>;
type RuleVersionRow = Selectable<DB['person_master.engagement_overlap_rule_version']>;
type PolicyCommandResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly code: 'ENGAGEMENT_POLICY_STALE_VERSION' };

export interface EngagementPolicyModule extends Omit<EngagementPolicyApplication,
  'appendEngagementTypeVersion' | 'appendEngagementOverlapRuleVersion'> {
  appendEngagementTypeVersion(
    command: AppendEngagementTypeVersion,
  ): Promise<PolicyCommandResult<EngagementTypeVersion>>;
  appendEngagementOverlapRuleVersion(
    command: AppendEngagementOverlapRuleVersion,
  ): Promise<PolicyCommandResult<EngagementOverlapRuleVersion>>;
}

export function createEngagementPolicyModule(
  database: Transaction<DB>,
  context: RequestContext,
  audit: AuditEventService,
  authorization: AuthorizationModule,
  requireScope: (
    objectId: string,
    operation: 'CLASSIFICATION_READ' | 'CLASSIFICATION_WRITE' | 'OVERLAP_RULE_READ' | 'OVERLAP_RULE_WRITE',
  ) => Promise<void>,
): EngagementPolicyModule {
  validateContext(context);

  async function authorize(
    objectId: string,
    operation: 'CLASSIFICATION_READ' | 'CLASSIFICATION_WRITE' | 'OVERLAP_RULE_READ' | 'OVERLAP_RULE_WRITE',
  ) {
    await requireScope(objectId, operation);
    const permissionByOperation: Readonly<Record<typeof operation, ObjectPermissionCode>> = {
      CLASSIFICATION_READ: 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ',
      CLASSIFICATION_WRITE: 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE',
      OVERLAP_RULE_READ: 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ',
      OVERLAP_RULE_WRITE: 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE',
    };
    await authorization.requireObjectPermission({
      governanceObjectId: objectId,
      permissionCode: permissionByOperation[operation],
    });
  }

  async function record(
    objectId: string,
    aggregateType: 'PERSON_ENGAGEMENT_TYPE' | 'PERSON_ENGAGEMENT_OVERLAP_RULE',
    aggregateId: string,
    eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>,
    versionId: string,
  ) {
    await audit.append({ governanceObjectId: objectId, aggregateType, aggregateId,
      aggregateVersionId: versionId, eventType, payload, afterHash: null,
      authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }

  return {
    async appendEngagementTypeVersion(command) {
      validateAppendEngagementTypeVersion(command);
      await authorize(command.governanceObjectId, 'CLASSIFICATION_WRITE');
      await sql`select pg_advisory_xact_lock(hashtextextended(
        ${`person-engagement-policy:${command.governanceObjectId}`}, 0
      ))`.execute(database);
      await sql`select pg_advisory_xact_lock(hashtextextended(
        ${`person-engagement-type:${command.governanceObjectId}:${command.typeCode}`}, 0
      ))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'APPEND_ENGAGEMENT_TYPE_VERSION',
        typeCode: command.typeCode, expectedCurrentVersionId: command.expectedCurrentVersionId,
        categoryCode: command.categoryCode, displayName: command.displayName,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo });
      let definition = await database.selectFrom('person_master.engagement_type').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('type_code', '=', command.typeCode).forUpdate().executeTakeFirst();
      if (!definition) {
        if (command.expectedCurrentVersionId !== null) {
          return { ok: false, code: 'ENGAGEMENT_POLICY_STALE_VERSION' };
        }
        definition = await database.insertInto('person_master.engagement_type').values({
          governance_object_id: command.governanceObjectId, type_code: command.typeCode,
          creation_request_id: context.requestId, created_by: context.actorPrincipalId,
        }).returningAll().executeTakeFirstOrThrow();
        const version = await insertTypeVersion(definition, null, command, operationHash);
        await record(command.governanceObjectId, 'PERSON_ENGAGEMENT_TYPE',
          definition.engagement_type_id, 'ENGAGEMENT_TYPE_VERSION_CREATED', {
            typeCode: definition.type_code, categoryCode: version.category_code,
            versionNo: version.version_no, result: 'CREATED',
          }, version.engagement_type_version_id);
        return { ok: true, value: toTypeVersion(definition, version) };
      }

      const retry = await database.selectFrom('person_master.engagement_type_version').selectAll()
        .where('engagement_type_id', '=', definition.engagement_type_id)
        .where('request_id', '=', context.requestId).executeTakeFirst();
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || !retry.operation_hash.equals(operationHash)) {
          throw new Error('ENGAGEMENT_POLICY_OPERATION_CONFLICT');
        }
        return { ok: true, value: toTypeVersion(definition, retry) };
      }
      if (command.expectedCurrentVersionId === null) {
        throw new Error('ENGAGEMENT_POLICY_OPERATION_CONFLICT');
      }
      const previous = await latestTypeVersion(definition.engagement_type_id);
      if (previous.engagement_type_version_id !== command.expectedCurrentVersionId) {
        return { ok: false, code: 'ENGAGEMENT_POLICY_STALE_VERSION' };
      }
      const version = await insertTypeVersion(definition, previous, command, operationHash);
      await record(command.governanceObjectId, 'PERSON_ENGAGEMENT_TYPE',
        definition.engagement_type_id, 'ENGAGEMENT_TYPE_VERSION_CREATED', {
          typeCode: definition.type_code, categoryCode: version.category_code,
          versionNo: version.version_no, result: 'APPENDED',
        }, version.engagement_type_version_id);
      return { ok: true, value: toTypeVersion(definition, version) };
    },

    async listEngagementTypeVersions(query) {
      validateEngagementTypeHistoryQuery(query);
      await authorize(query.governanceObjectId, 'CLASSIFICATION_READ');
      const rows = await typeHistory(query);
      return rows.map(({ definition, version }) => toTypeVersion(definition, version));
    },

    async appendEngagementOverlapRuleVersion(command) {
      validateAppendEngagementOverlapRuleVersion(command);
      await authorize(command.governanceObjectId, 'OVERLAP_RULE_WRITE');
      const [leftTypeCode, rightTypeCode] = canonicalizeEngagementTypePair(
        command.leftEngagementTypeCode, command.rightEngagementTypeCode,
      );
      await requireType(command.governanceObjectId, leftTypeCode);
      await requireType(command.governanceObjectId, rightTypeCode);
      await sql`select pg_advisory_xact_lock(hashtextextended(
        ${`person-engagement-policy:${command.governanceObjectId}`}, 0
      ))`.execute(database);
      await sql`select pg_advisory_xact_lock(hashtextextended(
        ${`person-engagement-overlap-rule:${command.governanceObjectId}:${leftTypeCode}:${rightTypeCode}`}, 0
      ))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'APPEND_ENGAGEMENT_OVERLAP_RULE_VERSION',
        leftTypeCode, rightTypeCode, expectedCurrentVersionId: command.expectedCurrentVersionId,
        decision: command.decision, businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo });
      let definition = await database.selectFrom('person_master.engagement_overlap_rule').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('left_type_code', '=', leftTypeCode).where('right_type_code', '=', rightTypeCode)
        .forUpdate().executeTakeFirst();
      if (!definition) {
        if (command.expectedCurrentVersionId !== null) {
          return { ok: false, code: 'ENGAGEMENT_POLICY_STALE_VERSION' };
        }
        definition = await database.insertInto('person_master.engagement_overlap_rule').values({
          governance_object_id: command.governanceObjectId, left_type_code: leftTypeCode,
          right_type_code: rightTypeCode, creation_request_id: context.requestId,
          created_by: context.actorPrincipalId,
        }).returningAll().executeTakeFirstOrThrow();
        const version = await insertRuleVersion(definition, null, command, operationHash);
        await record(command.governanceObjectId, 'PERSON_ENGAGEMENT_OVERLAP_RULE',
          definition.engagement_overlap_rule_id, 'ENGAGEMENT_OVERLAP_RULE_VERSION_CREATED', {
            leftEngagementTypeCode: leftTypeCode, rightEngagementTypeCode: rightTypeCode,
            decision: version.decision, versionNo: version.version_no, result: 'CREATED',
          }, version.engagement_overlap_rule_version_id);
        return { ok: true, value: toRuleVersion(definition, version) };
      }

      const retry = await database.selectFrom('person_master.engagement_overlap_rule_version').selectAll()
        .where('engagement_overlap_rule_id', '=', definition.engagement_overlap_rule_id)
        .where('request_id', '=', context.requestId).executeTakeFirst();
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || !retry.operation_hash.equals(operationHash)) {
          throw new Error('ENGAGEMENT_POLICY_OPERATION_CONFLICT');
        }
        return { ok: true, value: toRuleVersion(definition, retry) };
      }
      if (command.expectedCurrentVersionId === null) {
        throw new Error('ENGAGEMENT_POLICY_OPERATION_CONFLICT');
      }
      const previous = await latestRuleVersion(definition.engagement_overlap_rule_id);
      if (previous.engagement_overlap_rule_version_id !== command.expectedCurrentVersionId) {
        return { ok: false, code: 'ENGAGEMENT_POLICY_STALE_VERSION' };
      }
      const version = await insertRuleVersion(definition, previous, command, operationHash);
      await record(command.governanceObjectId, 'PERSON_ENGAGEMENT_OVERLAP_RULE',
        definition.engagement_overlap_rule_id, 'ENGAGEMENT_OVERLAP_RULE_VERSION_CREATED', {
          leftEngagementTypeCode: leftTypeCode, rightEngagementTypeCode: rightTypeCode,
          decision: version.decision, versionNo: version.version_no, result: 'APPENDED',
        }, version.engagement_overlap_rule_version_id);
      return { ok: true, value: toRuleVersion(definition, version) };
    },

    async listEngagementOverlapRuleVersions(query) {
      validateEngagementOverlapRuleHistoryQuery(query);
      await authorize(query.governanceObjectId, 'OVERLAP_RULE_READ');
      const rows = await ruleHistory(query);
      return rows.map(({ definition, version }) => toRuleVersion(definition, version));
    },

    async findEngagementOverlapRuleAsOf(query) {
      validateEngagementOverlapRuleAsOfQuery(query);
      await authorize(query.governanceObjectId, 'OVERLAP_RULE_READ');
      const [leftTypeCode, rightTypeCode] = canonicalizeEngagementTypePair(
        query.leftEngagementTypeCode, query.rightEngagementTypeCode,
      );
      const row = await database.selectFrom('person_master.engagement_overlap_rule as rule')
        .innerJoin('person_master.engagement_overlap_rule_version as version',
          'version.engagement_overlap_rule_id', 'rule.engagement_overlap_rule_id')
        .selectAll('rule').selectAll('version')
        .where('rule.governance_object_id', '=', query.governanceObjectId)
        .where('rule.left_type_code', '=', leftTypeCode)
        .where('rule.right_type_code', '=', rightTypeCode)
        .where('version.recorded_from', '<=', query.recordAsOf)
        .where('version.business_valid_from', '<=', query.businessAt)
        .where((eb) => eb.or([
          eb('version.business_valid_to', 'is', null),
          eb('version.business_valid_to', '>', query.businessAt),
        ])).orderBy('version.version_no', 'desc').executeTakeFirst();
      if (!row) return null;
      return toRuleVersion(row, row);
    },
  };

  async function insertTypeVersion(
    definition: TypeDefinitionRow,
    previous: TypeVersionRow | null,
    command: AppendEngagementTypeVersion,
    operationHash: Buffer,
  ) {
    return database.insertInto('person_master.engagement_type_version').values({
      engagement_type_id: definition.engagement_type_id,
      governance_object_id: definition.governance_object_id,
      version_no: previous ? (BigInt(previous.version_no) + 1n).toString() : '1',
      supersedes_engagement_type_version_id: previous?.engagement_type_version_id ?? null,
      category_code: command.categoryCode, display_name: command.displayName,
      business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
      created_by: context.actorPrincipalId, request_id: context.requestId,
      operation_hash: operationHash,
    }).returningAll().executeTakeFirstOrThrow();
  }

  async function insertRuleVersion(
    definition: RuleDefinitionRow,
    previous: RuleVersionRow | null,
    command: AppendEngagementOverlapRuleVersion,
    operationHash: Buffer,
  ) {
    return database.insertInto('person_master.engagement_overlap_rule_version').values({
      engagement_overlap_rule_id: definition.engagement_overlap_rule_id,
      governance_object_id: definition.governance_object_id,
      version_no: previous ? (BigInt(previous.version_no) + 1n).toString() : '1',
      supersedes_engagement_overlap_rule_version_id:
        previous?.engagement_overlap_rule_version_id ?? null,
      decision: command.decision, business_valid_from: command.businessValidFrom,
      business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId,
      request_id: context.requestId, operation_hash: operationHash,
    }).returningAll().executeTakeFirstOrThrow();
  }

  async function latestTypeVersion(engagementTypeId: string) {
    return database.selectFrom('person_master.engagement_type_version').selectAll()
      .where('engagement_type_id', '=', engagementTypeId).orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
  }

  async function latestRuleVersion(engagementOverlapRuleId: string) {
    return database.selectFrom('person_master.engagement_overlap_rule_version').selectAll()
      .where('engagement_overlap_rule_id', '=', engagementOverlapRuleId).orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
  }

  async function requireType(governanceObjectId: string, typeCode: string) {
    const definition = await database.selectFrom('person_master.engagement_type')
      .select('engagement_type_id').where('governance_object_id', '=', governanceObjectId)
      .where('type_code', '=', typeCode).executeTakeFirst();
    if (!definition) throw new Error('ENGAGEMENT_TYPE_NOT_FOUND');
  }

  async function typeHistory(query: EngagementTypeHistoryQuery) {
    return database.selectFrom('person_master.engagement_type as definition')
      .innerJoin('person_master.engagement_type_version as version',
        'version.engagement_type_id', 'definition.engagement_type_id')
      .selectAll('definition').selectAll('version')
      .where('definition.governance_object_id', '=', query.governanceObjectId)
      .where('definition.type_code', '=', query.typeCode)
      .orderBy('version.version_no').execute().then((rows) => rows.map((row) => ({
        definition: row as TypeDefinitionRow, version: row as TypeVersionRow,
      })));
  }

  async function ruleHistory(query: EngagementOverlapRuleHistoryQuery) {
    const [leftTypeCode, rightTypeCode] = canonicalizeEngagementTypePair(
      query.leftEngagementTypeCode, query.rightEngagementTypeCode,
    );
    return database.selectFrom('person_master.engagement_overlap_rule as definition')
      .innerJoin('person_master.engagement_overlap_rule_version as version',
        'version.engagement_overlap_rule_id', 'definition.engagement_overlap_rule_id')
      .selectAll('definition').selectAll('version')
      .where('definition.governance_object_id', '=', query.governanceObjectId)
      .where('definition.left_type_code', '=', leftTypeCode)
      .where('definition.right_type_code', '=', rightTypeCode)
      .orderBy('version.version_no').execute().then((rows) => rows.map((row) => ({
        definition: row as RuleDefinitionRow, version: row as RuleVersionRow,
      })));
  }
}

function toTypeVersion(definition: TypeDefinitionRow, version: TypeVersionRow): EngagementTypeVersion {
  return { engagementTypeId: definition.engagement_type_id,
    engagementTypeVersionId: version.engagement_type_version_id,
    governanceObjectId: definition.governance_object_id, typeCode: definition.type_code,
    versionNo: version.version_no,
    supersedesEngagementTypeVersionId: version.supersedes_engagement_type_version_id,
    categoryCode: version.category_code as EngagementTypeVersion['categoryCode'],
    displayName: version.display_name, businessValidFrom: version.business_valid_from,
    businessValidTo: version.business_valid_to, recordedFrom: version.recorded_from };
}

function toRuleVersion(definition: RuleDefinitionRow, version: RuleVersionRow): EngagementOverlapRuleVersion {
  return { engagementOverlapRuleId: definition.engagement_overlap_rule_id,
    engagementOverlapRuleVersionId: version.engagement_overlap_rule_version_id,
    governanceObjectId: definition.governance_object_id,
    leftEngagementTypeCode: definition.left_type_code,
    rightEngagementTypeCode: definition.right_type_code, versionNo: version.version_no,
    supersedesEngagementOverlapRuleVersionId:
      version.supersedes_engagement_overlap_rule_version_id,
    decision: version.decision as EngagementOverlapRuleVersion['decision'],
    businessValidFrom: version.business_valid_from, businessValidTo: version.business_valid_to,
    recordedFrom: version.recorded_from };
}

function validateContext(context: RequestContext) {
  parseLocalDateTime(context.occurredAt);
  assertPersonUuid(context.actorPrincipalId);
  for (const id of [context.requestId, context.correlationId]) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)) {
      throw new Error('ENGAGEMENT_CONTEXT_INVALID');
    }
  }
}
