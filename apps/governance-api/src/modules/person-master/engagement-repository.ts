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
import {
  canonicalizeEngagementTypePair,
  type EngagementCategoryCode,
  type EngagementOverlapDecision,
} from './engagement-policy-contracts.js';

type EngagementRow = Selectable<DB['person_master.engagement']>;
type VersionRow = Selectable<DB['person_master.engagement_version']>;
type ClassificationRow = Selectable<DB['person_master.engagement_classification']>;
type TypeDefinitionRow = Selectable<DB['person_master.engagement_type']>;
type TypeVersionRow = Selectable<DB['person_master.engagement_type_version']>;
type OverlapFailureCode = 'ENGAGEMENT_OVERLAP_RULE_MISSING' |
  'ENGAGEMENT_OVERLAP_FORBIDDEN' | 'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED';
type CommandResult = { readonly ok: true; readonly version: EngagementVersion } |
  { readonly ok: false; readonly code: 'ENGAGEMENT_STALE_VERSION' | OverlapFailureCode };

interface FrozenClassification {
  readonly row: ClassificationRow;
  readonly definition: TypeDefinitionRow;
  readonly version: TypeVersionRow;
}

interface OverlappingEngagement {
  readonly engagement_id: string;
  readonly business_valid_from: string;
  readonly business_valid_to: string | null;
  readonly type_code: string;
}

interface ApplicableRule {
  readonly engagement_overlap_rule_id: string;
  readonly engagement_overlap_rule_version_id: string;
  readonly version_no: string;
  readonly decision: EngagementOverlapDecision;
  readonly recorded_from: string;
}

interface OverlapEvaluation {
  readonly otherEngagementId: string;
  readonly otherTypeCode: string;
  readonly leftTypeCode: string;
  readonly rightTypeCode: string;
  readonly overlapFrom: string;
  readonly overlapTo: string | null;
  readonly evaluationRecordedAt: string;
  readonly rule: ApplicableRule | null;
  readonly code: OverlapFailureCode | null;
}

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

  async function classification(engagementId: string): Promise<FrozenClassification> {
    const row = await database.selectFrom('person_master.engagement_classification as classification')
      .innerJoin('person_master.engagement_type as definition',
        'definition.engagement_type_id', 'classification.engagement_type_id')
      .innerJoin('person_master.engagement_type_version as version',
        'version.engagement_type_version_id', 'classification.engagement_type_version_id')
      .selectAll('classification').selectAll('definition').selectAll('version')
      .where('classification.engagement_id', '=', engagementId).executeTakeFirstOrThrow();
    return { row: row as ClassificationRow, definition: row as TypeDefinitionRow,
      version: row as TypeVersionRow };
  }

  async function classificationAsOf(
    engagementId: string, recordAsOf: string,
  ): Promise<FrozenClassification | null> {
    const row = await database.selectFrom('person_master.engagement_classification as classification')
      .innerJoin('person_master.engagement_type as definition',
        'definition.engagement_type_id', 'classification.engagement_type_id')
      .innerJoin('person_master.engagement_type_version as version',
        'version.engagement_type_version_id', 'classification.engagement_type_version_id')
      .selectAll('classification').selectAll('definition').selectAll('version')
      .where('classification.engagement_id', '=', engagementId)
      .where('classification.classified_at', '<=', recordAsOf)
      .where('version.recorded_from', '<=', recordAsOf).executeTakeFirst();
    return row ? { row: row as ClassificationRow, definition: row as TypeDefinitionRow,
      version: row as TypeVersionRow } : null;
  }

  async function record(objectId: string, engagementId: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null) {
    await audit.append({ governanceObjectId: objectId, aggregateType: 'PERSON_ENGAGEMENT',
      aggregateId: engagementId, aggregateVersionId: versionId, eventType, payload, afterHash: null,
      authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }

  async function lockPerson(objectId: string, personId: string) {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`person-engagement-overlap:${objectId}:${personId}`}, 0
    ))`.execute(database);
  }

  async function lockPolicyRead(objectId: string) {
    await sql`select pg_advisory_xact_lock_shared(hashtextextended(
      ${`person-engagement-policy:${objectId}`}, 0
    ))`.execute(database);
  }

  async function evaluationRecordTime(): Promise<string> {
    const result = await sql<{ recorded_at: string }>`
      select platform.local_now() as recorded_at
    `.execute(database);
    return result.rows[0]!.recorded_at;
  }

  async function resolveTypeVersion(
    objectId: string, typeCode: string, businessValidFrom: string, businessValidTo: string | null,
    evaluationRecordedAt: string,
  ): Promise<{ readonly definition: TypeDefinitionRow; readonly version: TypeVersionRow }> {
    const result = await sql<TypeDefinitionRow & TypeVersionRow>`
      select definition.*, version.*
      from person_master.engagement_type as definition
      join person_master.engagement_type_version as version
        on version.engagement_type_id = definition.engagement_type_id
      where definition.governance_object_id = ${objectId}::uuid
        and definition.type_code = ${typeCode}
        and version.recorded_from <= ${evaluationRecordedAt}::timestamp
        and version.business_valid_from <= ${businessValidFrom}::timestamp
        and (
          version.business_valid_to is null
          or (${businessValidTo}::timestamp is not null
            and version.business_valid_to >= ${businessValidTo}::timestamp)
        )
      order by version.version_no desc
      limit 1
    `.execute(database);
    const row = result.rows[0];
    if (!row) throw new Error('ENGAGEMENT_TYPE_VERSION_NOT_FOUND');
    return { definition: row, version: row };
  }

  async function evaluateOverlaps(
    objectId: string, personId: string, typeCode: string,
    businessValidFrom: string, businessValidTo: string | null, excludedEngagementId: string | null,
    evaluationRecordedAt: string,
  ): Promise<readonly OverlapEvaluation[]> {
    const overlapping = await sql<OverlappingEngagement>`
      select relation.engagement_id, current_version.business_valid_from,
        current_version.business_valid_to, definition.type_code
      from person_master.engagement as relation
      join lateral (
        select version.business_valid_from, version.business_valid_to, version.business_period
        from person_master.engagement_version as version
        where version.engagement_id = relation.engagement_id
        order by version.version_no desc
        limit 1
      ) as current_version on true
      join person_master.engagement_classification as classification
        on classification.engagement_id = relation.engagement_id
      join person_master.engagement_type as definition
        on definition.engagement_type_id = classification.engagement_type_id
      where relation.governance_object_id = ${objectId}::uuid
        and relation.person_id = ${personId}::uuid
        and (${excludedEngagementId}::uuid is null or relation.engagement_id <> ${excludedEngagementId}::uuid)
        and current_version.business_period && tsrange(
          ${businessValidFrom}::timestamp, ${businessValidTo}::timestamp, '[)'
        )
      order by relation.engagement_id
    `.execute(database);
    const evaluations: OverlapEvaluation[] = [];
    for (const other of overlapping.rows) {
      const [leftTypeCode, rightTypeCode] = canonicalizeEngagementTypePair(typeCode, other.type_code);
      const overlapFrom = businessValidFrom >= other.business_valid_from
        ? businessValidFrom : other.business_valid_from;
      const overlapTo = minimumEnd(businessValidTo, other.business_valid_to);
      const rule = await applicableRule(objectId, leftTypeCode, rightTypeCode,
        overlapFrom, overlapTo, evaluationRecordedAt);
      const code = rule === null ? 'ENGAGEMENT_OVERLAP_RULE_MISSING'
        : rule.decision === 'FORBID' ? 'ENGAGEMENT_OVERLAP_FORBIDDEN'
          : rule.decision === 'REVIEW_REQUIRED' ? 'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED' : null;
      evaluations.push({ otherEngagementId: other.engagement_id, otherTypeCode: other.type_code,
        leftTypeCode, rightTypeCode, overlapFrom, overlapTo, evaluationRecordedAt, rule, code });
    }
    return evaluations;
  }

  async function applicableRule(
    objectId: string, leftTypeCode: string, rightTypeCode: string,
    overlapFrom: string, overlapTo: string | null, evaluationRecordedAt: string,
  ): Promise<ApplicableRule | null> {
    const result = await sql<ApplicableRule>`
      select rule.engagement_overlap_rule_id, version.engagement_overlap_rule_version_id,
        version.version_no::text, version.decision, version.recorded_from
      from person_master.engagement_overlap_rule as rule
      join person_master.engagement_overlap_rule_version as version
        on version.engagement_overlap_rule_id = rule.engagement_overlap_rule_id
      where rule.governance_object_id = ${objectId}::uuid
        and rule.left_type_code = ${leftTypeCode}
        and rule.right_type_code = ${rightTypeCode}
        and version.recorded_from <= ${evaluationRecordedAt}::timestamp
        and version.business_valid_from <= ${overlapFrom}::timestamp
        and (
          version.business_valid_to is null
          or (${overlapTo}::timestamp is not null and version.business_valid_to >= ${overlapTo}::timestamp)
        )
      order by version.version_no desc
      limit 1
    `.execute(database);
    return result.rows[0] ?? null;
  }

  async function recordOverlapRejection(
    objectId: string, personId: string, candidateEngagementId: string | null,
    candidateTypeCode: string, evaluation: OverlapEvaluation,
  ) {
    const engagementId = candidateEngagementId ?? evaluation.otherEngagementId;
    await record(objectId, engagementId, 'PERSON_ENGAGEMENT_OVERLAP_REJECTED', {
      engagementId, candidateEngagementId,
      otherEngagementId: evaluation.otherEngagementId, personId,
      candidateTypeCode, otherTypeCode: evaluation.otherTypeCode,
      leftEngagementTypeCode: evaluation.leftTypeCode,
      rightEngagementTypeCode: evaluation.rightTypeCode,
      ruleDecision: evaluation.rule?.decision ?? 'MISSING',
      ruleVersionId: evaluation.rule?.engagement_overlap_rule_version_id ?? null,
      ruleVersionNo: evaluation.rule?.version_no ?? null,
      ruleRecordedFrom: evaluation.rule?.recorded_from ?? null,
      evaluationRecordedAt: evaluation.evaluationRecordedAt,
      result: 'REJECTED', reason: evaluation.code,
    });
  }

  async function recordAllowedEvaluations(
    objectId: string, engagementId: string, personId: string,
    candidateTypeCode: string, evaluations: readonly OverlapEvaluation[], evaluationRecordedAt: string,
  ) {
    if (evaluations.length === 0) {
      await record(objectId, engagementId, 'PERSON_ENGAGEMENT_OVERLAP_EVALUATED', {
        engagementId, personId, candidateTypeCode, ruleDecision: null,
        ruleVersionId: null, evaluationRecordedAt, result: 'NO_TEMPORAL_OVERLAP',
      });
      return;
    }
    for (const evaluation of evaluations) {
      await record(objectId, engagementId, 'PERSON_ENGAGEMENT_OVERLAP_EVALUATED', {
        engagementId, otherEngagementId: evaluation.otherEngagementId, personId,
        candidateTypeCode, otherTypeCode: evaluation.otherTypeCode,
        leftEngagementTypeCode: evaluation.leftTypeCode,
        rightEngagementTypeCode: evaluation.rightTypeCode,
        ruleDecision: evaluation.rule!.decision,
        ruleVersionId: evaluation.rule!.engagement_overlap_rule_version_id,
        ruleVersionNo: evaluation.rule!.version_no, result: 'ALLOWED',
        ruleRecordedFrom: evaluation.rule!.recorded_from,
        evaluationRecordedAt: evaluation.evaluationRecordedAt,
      });
    }
  }

  return {
    async createEngagement(command) {
      validateEngagementCreation(command);
      await authorize(command.governanceObjectId, 'WRITE');
      await sql`select pg_advisory_xact_lock(hashtextextended(
        ${`person-engagement-create:${command.governanceObjectId}:${context.requestId}`}, 0
      ))`.execute(database);
      const operationHash = canonicalSha256({ kind: 'CREATE_ENGAGEMENT', personId: command.personId,
        engagementTypeCode: command.engagementTypeCode, relationBasis: command.relationBasis,
        businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo });
      const legacyOperationHash = canonicalSha256({ kind: 'CREATE_ENGAGEMENT', personId: command.personId,
        relationBasis: command.relationBasis, businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo });
      const priorRequest = await database.selectFrom('person_master.engagement').selectAll()
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('creation_request_id', '=', context.requestId).executeTakeFirst();
      if (priorRequest) {
        const first = await database.selectFrom('person_master.engagement_version').selectAll()
          .where('engagement_id', '=', priorRequest.engagement_id).where('version_no', '=', '1')
          .executeTakeFirstOrThrow();
        const frozen = await classification(priorRequest.engagement_id);
        const validHash = first.operation_hash.equals(operationHash) ||
          (first.operation_hash.equals(legacyOperationHash) &&
            frozen.definition.type_code === command.engagementTypeCode);
        if (priorRequest.created_by !== context.actorPrincipalId || priorRequest.person_id !== command.personId ||
          !validHash || frozen.definition.type_code !== command.engagementTypeCode) {
          throw new Error('ENGAGEMENT_OPERATION_CONFLICT');
        }
        return { ok: true, version: toVersion(first, frozen) };
      }
      await requirePerson(command.governanceObjectId, command.personId);
      await lockPerson(command.governanceObjectId, command.personId);
      await lockPolicyRead(command.governanceObjectId);
      const evaluationRecordedAt = await evaluationRecordTime();
      const type = await resolveTypeVersion(command.governanceObjectId, command.engagementTypeCode,
        command.businessValidFrom, command.businessValidTo, evaluationRecordedAt);
      const evaluations = await evaluateOverlaps(command.governanceObjectId, command.personId,
        command.engagementTypeCode, command.businessValidFrom, command.businessValidTo, null,
        evaluationRecordedAt);
      const rejection = evaluations.find((evaluation) => evaluation.code !== null);
      if (rejection) {
        await recordOverlapRejection(command.governanceObjectId, command.personId,
          null, command.engagementTypeCode, rejection);
        return { ok: false, code: rejection.code! };
      }
      const row = await database.insertInto('person_master.engagement').values({
        governance_object_id: command.governanceObjectId, person_id: command.personId,
        creation_request_id: context.requestId, created_by: context.actorPrincipalId,
      }).returningAll().executeTakeFirstOrThrow();
      const classificationRow = await database.insertInto('person_master.engagement_classification').values({
        engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
        person_id: row.person_id, engagement_type_id: type.definition.engagement_type_id,
        engagement_type_version_id: type.version.engagement_type_version_id,
        classified_by: context.actorPrincipalId, request_id: context.requestId,
      }).returningAll().executeTakeFirstOrThrow();
      const version = await database.insertInto('person_master.engagement_version').values({
        engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
        person_id: row.person_id, version_no: '1', supersedes_engagement_version_id: null,
        revision_reason_code: null, business_valid_from: command.businessValidFrom,
        business_valid_to: command.businessValidTo, created_by: context.actorPrincipalId,
        request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      const frozen: FrozenClassification = {
        row: classificationRow, definition: type.definition, version: type.version,
      };
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_CREATED', {
        engagementId: row.engagement_id, engagementVersionId: version.engagement_version_id,
        personId: row.person_id, engagementTypeCode: type.definition.type_code,
        engagementTypeVersionId: type.version.engagement_type_version_id,
        versionNo: version.version_no, result: 'CREATED',
      }, version.engagement_version_id);
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_CLASSIFIED', {
        engagementId: row.engagement_id, personId: row.person_id,
        engagementTypeCode: type.definition.type_code,
        engagementCategoryCode: type.version.category_code,
        engagementTypeVersionId: type.version.engagement_type_version_id,
        engagementTypeVersionNo: type.version.version_no, result: 'FROZEN',
      }, version.engagement_version_id);
      await recordAllowedEvaluations(row.governance_object_id, row.engagement_id, row.person_id,
        type.definition.type_code, evaluations, evaluationRecordedAt);
      return { ok: true, version: toVersion(version, frozen) };
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
      const frozen = await classification(row.engagement_id);
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || retry.revision_reason_code !== command.reasonCode ||
          !retry.operation_hash.equals(operationHash)) throw new Error('ENGAGEMENT_OPERATION_CONFLICT');
        return { ok: true, version: toVersion(retry, frozen) };
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
      await lockPerson(row.governance_object_id, row.person_id);
      await lockPolicyRead(row.governance_object_id);
      const evaluationRecordedAt = await evaluationRecordTime();
      const evaluations = await evaluateOverlaps(row.governance_object_id, row.person_id,
        frozen.definition.type_code, command.businessValidFrom, command.businessValidTo,
        row.engagement_id, evaluationRecordedAt);
      const rejection = evaluations.find((evaluation) => evaluation.code !== null);
      if (rejection) {
        await recordOverlapRejection(row.governance_object_id, row.person_id,
          row.engagement_id, frozen.definition.type_code, rejection);
        return { ok: false, code: rejection.code! };
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
        engagementTypeCode: frozen.definition.type_code,
        engagementTypeVersionId: frozen.version.engagement_type_version_id,
        reasonCode: version.revision_reason_code, versionNo: version.version_no, result: 'REVISED',
      }, version.engagement_version_id);
      await recordAllowedEvaluations(row.governance_object_id, row.engagement_id, row.person_id,
        frozen.definition.type_code, evaluations, evaluationRecordedAt);
      return { ok: true, version: toVersion(version, frozen) };
    },

    async getEngagement(query) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId']);
      await authorize(query.governanceObjectId, 'READ');
      const row = await relation(query);
      const frozen = await classification(row.engagement_id);
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_READ', {
        engagementId: row.engagement_id, queryKind: 'RELATION', result: 'FOUND',
      });
      return toEngagement(row, frozen);
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
      const frozen = await classification(row.engagement_id);
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, engagementVersionId: query.engagementVersionId,
        queryKind: 'VERSION', result: 'FOUND',
      });
      return toVersion(row, frozen);
    },

    async listEngagementVersions(query) {
      assertClosedObject(query, ['governanceObjectId', 'engagementId']);
      await authorize(query.governanceObjectId, 'READ');
      await relation(query);
      const frozen = await classification(query.engagementId);
      const rows = await database.selectFrom('person_master.engagement_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('engagement_id', '=', query.engagementId).orderBy('version_no').execute();
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, queryKind: 'HISTORY', count: rows.length,
      });
      return rows.map((row) => toVersion(row, frozen));
    },

    async listPersonEngagements(query) {
      assertClosedObject(query, ['governanceObjectId', 'personId']);
      assertEngagementUuid(query.personId, 'ENGAGEMENT_PERSON_INVALID');
      await authorize(query.governanceObjectId, 'READ');
      await requirePerson(query.governanceObjectId, query.personId);
      const rows = await database.selectFrom('person_master.engagement').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('person_id', '=', query.personId).orderBy('created_at').orderBy('engagement_id').execute();
      const values = await Promise.all(rows.map(async (row) => toEngagement(row,
        await classification(row.engagement_id))));
      await record(query.governanceObjectId, query.personId, 'PERSON_ENGAGEMENT_READ', {
        personId: query.personId, queryKind: 'PERSON_RELATIONS', count: rows.length,
      });
      return values;
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
      const frozen = row ? await classificationAsOf(query.engagementId, query.recordAsOf) : null;
      await record(query.governanceObjectId, query.engagementId, 'PERSON_ENGAGEMENT_READ', {
        engagementId: query.engagementId, queryKind: 'AS_OF', result: row ? 'FOUND' : 'NOT_FOUND',
      });
      return row ? toVersion(row, frozen) : null;
    },
  };
}

function minimumEnd(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left <= right ? left : right;
}

function classificationFields(frozen: FrozenClassification | null) {
  return { engagementTypeCode: frozen?.definition.type_code ?? null,
    engagementCategoryCode: (frozen?.version.category_code as EngagementCategoryCode | undefined) ?? null,
    engagementTypeVersionId: frozen?.version.engagement_type_version_id ?? null,
    engagementTypeVersionNo: frozen?.version.version_no ?? null,
    classificationRecordedAt: frozen?.row.classified_at ?? null };
}

function toEngagement(row: EngagementRow, frozen: FrozenClassification): Engagement {
  return { engagementId: row.engagement_id, governanceObjectId: row.governance_object_id,
    personId: row.person_id, ...classificationFields(frozen) as {
      engagementTypeCode: string; engagementCategoryCode: EngagementCategoryCode;
      engagementTypeVersionId: string; engagementTypeVersionNo: string;
      classificationRecordedAt: string;
    }, createdAt: row.created_at };
}

function toVersion(row: VersionRow, frozen: FrozenClassification | null): EngagementVersion {
  return { engagementId: row.engagement_id, engagementVersionId: row.engagement_version_id,
    governanceObjectId: row.governance_object_id, personId: row.person_id,
    ...classificationFields(frozen), versionNo: row.version_no,
    supersedesEngagementVersionId: row.supersedes_engagement_version_id,
    reasonCode: row.revision_reason_code as EngagementVersion['reasonCode'],
    businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to,
    recordedFrom: row.recorded_from };
}
