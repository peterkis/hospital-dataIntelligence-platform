import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { DepartmentPlacementReferenceReader } from '../department-master/index.js';
import type { EngagementEffectivePeriodReader } from './engagement-effective-period-contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import {
  ASSIGNMENT_POLICY, assignmentEngagementConstraint, assignmentPeriodCovered,
  validateAssignmentCreate, validateAssignmentRevise,
  type Assignment, type AssignmentCoreApplication, type AssignmentDependencyEvidence,
  type AssignmentPlacement, type AssignmentReference, type AssignmentVersion, type AssignmentVersionReference,
  type CreateAssignment, type ReviseAssignment,
} from './assignment-contracts.js';

type VersionRow = Selectable<DB['person_master.assignment_version']>;
type StableRow = Selectable<DB['person_master.assignment']>;
type Result = { readonly ok: true; readonly value: AssignmentVersion } | { readonly ok: false; readonly code: string };
export interface AssignmentCoreModule extends Omit<AssignmentCoreApplication, 'createAssignment' | 'reviseAssignment'> {
  createAssignment(command: CreateAssignment): Promise<Result>;
  reviseAssignment(command: ReviseAssignment): Promise<Result>;
}
export interface AssignmentDependencies {
  readonly engagement: EngagementEffectivePeriodReader;
  readonly department: DepartmentPlacementReferenceReader;
  pinEngagement(query: { governanceObjectId: string; engagementId: string }): Promise<void>;
  pinDepartment(query: { departmentGovernanceObjectId: string; departmentId: string }): Promise<void>;
  authorize(governanceObjectId: string, operation: 'READ' | 'WRITE'): Promise<void>;
  authorizeDependencies(governanceObjectId: string, placement: AssignmentPlacement): Promise<void>;
}

const TERMINAL = new Set([
  'ASSIGNMENT_STALE_VERSION', 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED',
  'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED', 'ASSIGNMENT_DEPENDENCY_UNKNOWN',
  'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT', 'ASSIGNMENT_PLACEMENT_NOT_FOUND',
  'ASSIGNMENT_PLACEMENT_UNPUBLISHED', 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
  'ASSIGNMENT_PLACEMENT_NOT_ACTIVE', 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
  'ENGAGEMENT_NOT_FOUND', 'ENGAGEMENT_NOT_KNOWN_AS_OF',
]);

export function createAssignmentCoreModule(database: Transaction<DB>, context: RequestContext,
  audit: AuditEventService, dependencies: AssignmentDependencies): AssignmentCoreModule {
  const clock = async () => (await sql<{ now: string }>`select platform.local_now() as now`.execute(database)).rows[0]!.now;
  async function event(governanceObjectId: string, aggregateId: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null) {
    await audit.append({ governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId,
      aggregateVersionId: versionId, eventType, payload, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }
  function validateReference(query: AssignmentReference, extra: readonly string[] = []) {
    assertClosedObject(query, ['governanceObjectId', 'assignmentId', ...extra]);
    assertPersonUuid(query.governanceObjectId); assertPersonUuid(query.assignmentId);
  }
  async function stable(query: AssignmentReference, lock = false): Promise<StableRow> {
    let select = database.selectFrom('person_master.assignment').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', query.assignmentId);
    if (lock) select = select.forUpdate();
    const row = await select.executeTakeFirst();
    if (!row) throw new Error('ASSIGNMENT_NOT_FOUND');
    return row;
  }
  const placement = (r: StableRow): AssignmentPlacement => ({ scope: 'DEPARTMENT',
    departmentGovernanceObjectId: r.department_governance_object_id, departmentId: r.department_id });
  async function exact(query: AssignmentVersionReference): Promise<VersionRow> {
    assertPersonUuid(query.assignmentVersionId);
    const row = await database.selectFrom('person_master.assignment_version').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', query.assignmentId)
      .where('assignment_version_id', '=', query.assignmentVersionId).executeTakeFirst();
    if (!row) throw new Error('ASSIGNMENT_VERSION_NOT_FOUND');
    return row;
  }
  async function result(r: VersionRow): Promise<AssignmentVersion> {
    const relation = await stable({ governanceObjectId: r.governance_object_id, assignmentId: r.assignment_id });
    const segments = await database.selectFrom('person_master.assignment_validation_segment').selectAll()
      .where('assignment_version_id', '=', r.assignment_version_id).orderBy('segment_no').limit(129).execute();
    if (!segments.length || segments.length > 128) throw new Error('ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT');
    return {
      governanceObjectId: r.governance_object_id, assignmentId: r.assignment_id, assignmentVersionId: r.assignment_version_id,
      versionNo: r.version_no, supersedesAssignmentVersionId: r.supersedes_assignment_version_id,
      reasonCode: r.reason_code as ReviseAssignment['reasonCode'] | null,
      businessValidFrom: r.business_valid_from, businessValidTo: r.business_valid_to, recordedFrom: r.recorded_from,
      acceptanceEvidence: {
        validationPolicyCode: ASSIGNMENT_POLICY, evaluationRecordAsOf: r.evaluation_record_as_of,
        dependencyFingerprint: r.dependency_fingerprint.toString('hex'),
        engagement: { semanticRole: 'EFFECTIVE_ENGAGEMENT_PERIOD_CONTEXT', governanceObjectId: r.governance_object_id,
          engagementId: r.engagement_id, personId: relation.person_id,
          requestedFrom: r.business_valid_from, requestedTo: r.business_valid_to, recordAsOf: r.evaluation_record_as_of,
          authorityEngagementVersionId: r.authority_engagement_version_id, authorityVersionNo: r.authority_engagement_version_no,
          authorityRecordedFrom: r.authority_engagement_recorded_from, authoritativeBusinessValidFrom: r.authority_engagement_valid_from,
          authoritativeBusinessValidTo: r.authority_engagement_valid_to, recordVisibleLifecycleSequence: r.record_visible_lifecycle_sequence,
          classification: r.classification_type_version_id === null ? null : {
            engagementTypeVersionId: r.classification_type_version_id, engagementTypeVersionNo: r.classification_type_version_no!,
            engagementTypeCode: r.classification_type_code!,
            engagementCategoryCode: r.classification_category_code as NonNullable<AssignmentDependencyEvidence['engagement']['classification']>['engagementCategoryCode'],
            classifiedAt: r.classified_at!,
          },
          stateSegments: segments.map(s => ({ from: s.business_valid_from, to: s.business_valid_to, businessState: 'ACTIVE',
            lastApplicableLifecycleEventId: s.last_applicable_lifecycle_event_id, lifecycleSequence: s.lifecycle_sequence })),
        },
        department: { semanticRole: 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE',
          departmentGovernanceObjectId: relation.department_governance_object_id, departmentId: r.department_id,
          recordAsOf: r.evaluation_record_as_of, departmentVersionId: r.department_version_id, versionNo: r.department_version_no,
          contentHash: r.department_content_hash.toString('hex'), recordedFrom: r.department_recorded_from,
          recordedTo: r.department_recorded_to, releaseId: r.department_release_id,
          publicationProjectionId: r.department_publication_projection_id, publishedAt: r.department_published_at,
          businessStatus: r.department_business_status, businessValidFrom: r.department_valid_from, businessValidTo: r.department_valid_to },
      },
    };
  }
  async function observe(governanceObjectId: string, engagementId: string, target: AssignmentPlacement,
    from: string, to: string | null, recordAsOf: string): Promise<AssignmentDependencyEvidence> {
    const engagement = await dependencies.engagement.getEngagementEffectivePeriodAsOf({ governanceObjectId, engagementId,
      requestedFrom: from, requestedTo: to, recordAsOf });
    const department = await dependencies.department.getDepartmentPlacementReferenceAsOf({
      departmentGovernanceObjectId: target.departmentGovernanceObjectId, departmentId: target.departmentId, recordAsOf });
    const evidence = { validationPolicyCode: ASSIGNMENT_POLICY, evaluationRecordAsOf: recordAsOf, engagement, department };
    if (Buffer.byteLength(JSON.stringify(evidence)) > 65536) throw new Error('ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT');
    return { ...evidence, dependencyFingerprint: fingerprint(evidence) };
  }
  function constraint(e: AssignmentDependencyEvidence): string | null {
    const engagementReason = assignmentEngagementConstraint(e.engagement);
    if (engagementReason) return engagementReason;
    if (e.department.businessStatus !== 'ACTIVE') return 'ASSIGNMENT_PLACEMENT_NOT_ACTIVE';
    if (!assignmentPeriodCovered(e.department.businessValidFrom, e.department.businessValidTo,
      e.engagement.requestedFrom, e.engagement.requestedTo)) return 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED';
    return null;
  }
  async function replay(governanceObjectId: string, operationHash: Buffer): Promise<Result | null> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${governanceObjectId}:${context.requestId}`},0))`.execute(database);
    const prior = await database.selectFrom('person_master.assignment_command_outcome').selectAll()
      .where('governance_object_id', '=', governanceObjectId).where('request_id', '=', context.requestId).executeTakeFirst();
    if (!prior) return null;
    if (!prior.operation_hash.equals(operationHash)) throw new Error('ASSIGNMENT_OPERATION_CONFLICT');
    if (prior.rejection_code !== null) return { ok: false, code: prior.rejection_code };
    const row = await database.selectFrom('person_master.assignment_version').selectAll()
      .where('assignment_version_id', '=', prior.assignment_version_id!).executeTakeFirstOrThrow();
    return { ok: true, value: await result(row) };
  }
  async function reject(governanceObjectId: string, operation: 'CREATE' | 'REVISE', operationHash: Buffer, code: string): Promise<Result> {
    await database.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: governanceObjectId,
      request_id: context.requestId, created_by: context.actorPrincipalId, operation_type: operation,
      operation_hash: operationHash, assignment_version_id: null, rejection_code: code }).execute();
    await event(governanceObjectId, governanceObjectId, 'PERSON_ASSIGNMENT_REJECTED', { operation, code, result: 'REJECTED' });
    return { ok: false, code };
  }
  async function save(relation: StableRow, command: { businessValidFrom: string; businessValidTo: string | null },
    prior: VersionRow | null, reasonCode: ReviseAssignment['reasonCode'] | null,
    evidence: AssignmentDependencyEvidence, operationHash: Buffer): Promise<Result> {
    const e = evidence.engagement, d = evidence.department, c = e.classification;
    const row = await database.insertInto('person_master.assignment_version').values({
      assignment_id: relation.assignment_id, governance_object_id: relation.governance_object_id,
      engagement_id: relation.engagement_id, department_id: relation.department_id,
      version_no: String(BigInt(prior?.version_no ?? '0') + 1n), supersedes_assignment_version_id: prior?.assignment_version_id ?? null,
      reason_code: reasonCode, business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo,
      recorded_from: await clock(), created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
      validation_policy_code: ASSIGNMENT_POLICY, evaluation_record_as_of: evidence.evaluationRecordAsOf,
      authority_engagement_version_id: e.authorityEngagementVersionId, authority_engagement_version_no: e.authorityVersionNo,
      authority_engagement_recorded_from: e.authorityRecordedFrom, authority_engagement_valid_from: e.authoritativeBusinessValidFrom,
      authority_engagement_valid_to: e.authoritativeBusinessValidTo, record_visible_lifecycle_sequence: e.recordVisibleLifecycleSequence,
      classification_type_version_id: c?.engagementTypeVersionId ?? null, classification_type_version_no: c?.engagementTypeVersionNo ?? null,
      classification_type_code: c?.engagementTypeCode ?? null, classification_category_code: c?.engagementCategoryCode ?? null,
      classified_at: c?.classifiedAt ?? null, department_version_id: d.departmentVersionId, department_version_no: d.versionNo,
      department_content_hash: Buffer.from(d.contentHash, 'hex'), department_recorded_from: d.recordedFrom,
      department_recorded_to: d.recordedTo, department_release_id: d.releaseId, department_publication_projection_id: d.publicationProjectionId,
      department_published_at: d.publishedAt, department_business_status: d.businessStatus,
      department_valid_from: d.businessValidFrom, department_valid_to: d.businessValidTo,
      dependency_fingerprint: Buffer.from(evidence.dependencyFingerprint, 'hex'),
    }).returningAll().executeTakeFirstOrThrow();
    await database.insertInto('person_master.assignment_validation_segment').values(e.stateSegments.map((s, i) => ({
      assignment_version_id: row.assignment_version_id, engagement_id: relation.engagement_id, segment_no: i + 1,
      business_valid_from: s.from, business_valid_to: s.to, business_state: s.businessState,
      last_applicable_lifecycle_event_id: s.lastApplicableLifecycleEventId, lifecycle_sequence: s.lifecycleSequence,
    }))).execute();
    await database.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: relation.governance_object_id,
      request_id: context.requestId, created_by: context.actorPrincipalId, operation_type: prior ? 'REVISE' : 'CREATE',
      operation_hash: operationHash, assignment_version_id: row.assignment_version_id, rejection_code: null }).execute();
    await event(relation.governance_object_id, relation.assignment_id, prior ? 'PERSON_ASSIGNMENT_VERSION_CREATED' : 'PERSON_ASSIGNMENT_CREATED',
      { versionNo: row.version_no, validationPolicyCode: ASSIGNMENT_POLICY, dependencyFingerprint: evidence.dependencyFingerprint,
        evaluationRecordAsOf: evidence.evaluationRecordAsOf, result: 'ACCEPTED_CORE_FACT' }, row.assignment_version_id);
    return { ok: true, value: await result(row) };
  }
  async function mutation(command: CreateAssignment | ReviseAssignment, operation: 'CREATE' | 'REVISE'): Promise<Result> {
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('ASSIGNMENT_INPUT_INVALID');
    const create = 'placement' in command;
    if ((operation === 'CREATE') !== create) throw new Error('ASSIGNMENT_INPUT_INVALID');
    if (create) validateAssignmentCreate(command); else validateAssignmentRevise(command);
    await dependencies.authorize(command.governanceObjectId, 'WRITE');
    let relation: StableRow | null = create ? null : await stable(command);
    const target = create ? command.placement : placement(relation!);
    await dependencies.authorizeDependencies(command.governanceObjectId, target);
    const operationHash = canonicalSha256({ command: normalizeTimes(command), operation, actor: context.actorPrincipalId });
    const repeated = await replay(command.governanceObjectId, operationHash);
    if (repeated) return repeated;
    if (!create) relation = await stable(command, true);
    let prior: VersionRow | null = null;
    if (!create) {
      prior = await database.selectFrom('person_master.assignment_version').selectAll()
        .where('assignment_id', '=', command.assignmentId).orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
      if (prior.assignment_version_id !== command.expectedCurrentVersionId)
        return reject(command.governanceObjectId, operation, operationHash, 'ASSIGNMENT_STALE_VERSION');
    }
    const engagementId = create ? command.engagementId : relation!.engagement_id;
    let evidence: AssignmentDependencyEvidence;
    // Only bounded dependency errors become replayable refusals, before any Assignment business insert.
    try {
      await dependencies.pinEngagement({ governanceObjectId: command.governanceObjectId, engagementId });
      await dependencies.pinDepartment({ departmentGovernanceObjectId: target.departmentGovernanceObjectId, departmentId: target.departmentId });
      evidence = await observe(command.governanceObjectId, engagementId, target,
        command.businessValidFrom, command.businessValidTo, await clock());
      const reason = constraint(evidence);
      if (reason) return reject(command.governanceObjectId, operation, operationHash, reason);
    } catch (error) {
      if (!(error instanceof Error) || !TERMINAL.has(error.message)) throw error;
      return reject(command.governanceObjectId, operation, operationHash, error.message);
    }
    if (create) relation = await database.insertInto('person_master.assignment').values({
      governance_object_id: command.governanceObjectId, engagement_id: command.engagementId, person_id: evidence.engagement.personId,
      department_governance_object_id: target.departmentGovernanceObjectId, department_id: target.departmentId,
      placement_scope: 'DEPARTMENT', relation_basis: command.relationBasis,
      creation_request_id: context.requestId, created_by: context.actorPrincipalId,
    }).returningAll().executeTakeFirstOrThrow();
    return save(relation!, command, prior, create ? null : command.reasonCode, evidence, operationHash);
  }
  return {
    createAssignment: command => mutation(command, 'CREATE'),
    reviseAssignment: command => mutation(command, 'REVISE'),
    async getAssignment(query): Promise<Assignment> {
      validateReference(query); await dependencies.authorize(query.governanceObjectId, 'READ');
      const row = await stable(query);
      await event(query.governanceObjectId, query.assignmentId, 'PERSON_ASSIGNMENT_READ', { view: 'IDENTITY' });
      return { ...query, engagementId: row.engagement_id, personId: row.person_id, placement: placement(row),
        relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', createdAt: row.created_at };
    },
    async getAssignmentVersion(query) {
      validateReference(query, ['assignmentVersionId']); await dependencies.authorize(query.governanceObjectId, 'READ');
      const value = await result(await exact(query));
      await event(query.governanceObjectId, query.assignmentId, 'PERSON_ASSIGNMENT_READ', { view: 'EXACT_VERSION' }, query.assignmentVersionId);
      return value;
    },
    async listAssignmentVersions(query) {
      validateReference(query, ['afterVersionNo', 'limit']);
      if (!/^(0|[1-9]\d{0,17})$/u.test(query.afterVersionNo) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 32)
        throw new Error('ASSIGNMENT_PAGINATION_INVALID');
      await dependencies.authorize(query.governanceObjectId, 'READ'); await stable(query);
      const rows = await database.selectFrom('person_master.assignment_version').selectAll()
        .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', query.assignmentId)
        .where('version_no', '>', query.afterVersionNo).orderBy('version_no').limit(query.limit).execute();
      const values: AssignmentVersion[] = [];
      for (const row of rows) values.push(await result(row));
      await event(query.governanceObjectId, query.assignmentId, 'PERSON_ASSIGNMENT_READ', { view: 'VERSIONS', count: values.length });
      return values;
    },
    async assessAssignmentDependencies(query) {
      validateReference(query, ['assignmentVersionId', 'recordAsOf']); temporalKey(query.recordAsOf);
      await dependencies.authorize(query.governanceObjectId, 'READ');
      const row = await exact(query), relation = await stable(query);
      await dependencies.authorizeDependencies(query.governanceObjectId, placement(relation));
      if (temporalKey(query.recordAsOf) < temporalKey(row.recorded_from)) throw new Error('ASSIGNMENT_NOT_KNOWN_AS_OF');
      const baseline = await result(row);
      const latest = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
        .where('assignment_id', '=', query.assignmentId).where('recorded_from', '<=', query.recordAsOf)
        .orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
      let observed: AssignmentDependencyEvidence | null = null, reason: string | null = null;
      try {
        observed = await observe(query.governanceObjectId, relation.engagement_id, placement(relation),
          row.business_valid_from, row.business_valid_to, query.recordAsOf);
        reason = constraint(observed);
      } catch (error) {
        if (!(error instanceof Error) || !TERMINAL.has(error.message)) throw error;
        reason = error.message;
      }
      const value = { evaluatedAssignmentVersionId: query.assignmentVersionId, assessedRecordAsOf: query.recordAsOf,
        isLatestAssignmentVersionAsOf: latest.assignment_version_id === query.assignmentVersionId,
        baselineEvidence: baseline.acceptanceEvidence, observedEvidence: observed, reasons: reason ? [reason] : [],
        referenceComparison: observed === null ? 'NOT_COMPARABLE' as const :
          observed.dependencyFingerprint === baseline.acceptanceEvidence.dependencyFingerprint ? 'UNCHANGED' as const : 'CHANGED' as const,
        constraintResult: observed === null ? 'UNKNOWN' as const : reason === null ? 'SATISFIED' as const :
          reason === 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' as const : 'NOT_SATISFIED' as const };
      return value;
    },
  };
}

function normalizeTimes(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value)) return temporalKey(value);
  if (Array.isArray(value)) return value.map(normalizeTimes);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalizeTimes(v)]));
  return value;
}
function fingerprint(e: Omit<AssignmentDependencyEvidence, 'dependencyFingerprint'>): string {
  const { recordAsOf: ignoredEngagementClock, ...engagement } = e.engagement;
  const { recordAsOf: ignoredDepartmentClock, recordedTo: ignoredClosingMetadata, ...department } = e.department;
  void ignoredEngagementClock; void ignoredDepartmentClock; void ignoredClosingMetadata;
  return canonicalSha256(normalizeTimes({ policy: e.validationPolicyCode, engagement, department })).toString('hex');
}
