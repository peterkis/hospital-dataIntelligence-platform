import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import type { AuditEventService } from '../audit/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { assignmentPeriodCovered, type AssignmentPlacement } from './assignment-contracts.js';
import type { AssignmentCoreModule, AssignmentDependencies, TemporaryAdmissionPreparation, TemporaryAdmissionWriter } from './assignment-repository.js';
import { assignmentAdmissionSemanticExact, assignmentSemanticCandidates, createAssignmentSemanticStore } from './assignment-semantic-store.js';
import { ASSIGNMENT_PURPOSES } from './assignment-semantics-contracts.js';
import { evaluateAssignmentPrimary } from './assignment-semantics-policy.js';
import { temporalKey } from './engagement-rule-segments.js';
import { readTemporarySourceLink } from './assignment-temporary-evidence.js';
import { assessTemporaryDependencies, TEMPORARY_DEPENDENCY_REJECTIONS, temporaryOverlaps } from './assignment-temporary-assessment.js';
import { ASSIGNMENT_TEMPORARY_POLICY, ASSIGNMENT_TEMPORARY_POLICY_DIGEST, validateTemporaryAssignmentCreate,
  type CreateSourceLinkedTemporaryAssignment, type TemporaryAssignmentApplication, type TemporaryAssignmentReference,
  type TemporaryAssignmentResult, type TemporaryCandidateEvidence, type TemporarySourceWindowEvidence } from './assignment-temporary-contracts.js';

type Outcome = { readonly ok: true; readonly value: TemporaryAssignmentResult } | { readonly ok: false; readonly code: string };
export interface TemporaryAssignmentModule extends Omit<TemporaryAssignmentApplication, 'createSourceLinkedTemporaryAssignment'> {
  createSourceLinkedTemporaryAssignment(command: CreateSourceLinkedTemporaryAssignment): Promise<Outcome>;
}
/** Single Person-owner transaction. It never invokes END or another root application. */
export function createTemporaryAssignmentModule(database: Transaction<DB>, context: RequestContext,
  audit: AuditEventService, dependencies: AssignmentDependencies,
  core: Pick<AssignmentCoreModule, 'readAssignmentVersionSnapshot' | 'getAssignmentDeclaredPeriodAsOf' | 'getAssignmentSemanticsAsOf'>,
  admission: TemporaryAdmissionWriter): TemporaryAssignmentModule {
  async function authorize(governanceObjectId: string) {
    await dependencies.authorize(governanceObjectId, 'READ');
    await dependencies.authorizeSemantics(governanceObjectId, 'READ');
  }
  function reference(query: TemporaryAssignmentReference, extra: readonly string[] = []) {
    assertClosedObject(query, ['governanceObjectId', 'targetAssignmentId', ...extra]);
    assertPersonUuid(query.governanceObjectId); assertPersonUuid(query.targetAssignmentId);
  }
  async function receipt(query: TemporaryAssignmentReference): Promise<TemporaryAssignmentResult> {
    const sourceLink = await readTemporarySourceLink(database, query.governanceObjectId, query.targetAssignmentId);
    const targetAdmission = await core.readAssignmentVersionSnapshot({ governanceObjectId: query.governanceObjectId,
      assignmentId: query.targetAssignmentId, assignmentVersionId: sourceLink.targetAdmissionVersionId });
    const targetSemantics = await assignmentAdmissionSemanticExact(database, sourceLink.targetAdmissionVersionId);
    if (targetAdmission.recordKind === 'CLOSURE' || targetSemantics.classification !== 'CLASSIFIED'
      || targetSemantics.mode.code !== 'SECONDMENT' || targetSemantics.semanticOperationKind !== 'TEMPORARY_CREATE')
      throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
    return { semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_RESULT', targetAssignmentId: query.targetAssignmentId,
      targetAdmissionVersionId: sourceLink.targetAdmissionVersionId, targetAdmission, targetSemantics, sourceLink };
  }
  async function reject(command: CreateSourceLinkedTemporaryAssignment, operationHash: Buffer, code: string): Promise<Outcome> {
    await database.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: command.governanceObjectId,
      request_id: context.requestId, created_by: context.actorPrincipalId, operation_type: 'TEMPORARY_CREATE', operation_hash: operationHash,
      assignment_version_id: null, rejection_code: code }).execute();
    await audit.append({ governanceObjectId: command.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: command.sourceAssignmentId,
      eventType: 'PERSON_ASSIGNMENT_TEMPORARY_REJECTED', payload: { operation: 'TEMPORARY_CREATE', code, sourceAssignmentId: command.sourceAssignmentId,
        result: 'REJECTED', sourceMutation: 'NONE' }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
    return { ok: false, code };
  }
  return {
    async createSourceLinkedTemporaryAssignment(command) {
      validateTemporaryAssignmentCreate(command);
      const governanceObjectId = command.governanceObjectId;
      await authorize(governanceObjectId);
      await dependencies.authorizeTemporaryCreate(governanceObjectId);
      await dependencies.authorize(governanceObjectId, 'WRITE');
      await dependencies.authorizeSemantics(governanceObjectId, 'WRITE');
      await dependencies.authorizeDependencies(governanceObjectId, command.targetPlacement);
      // Stable source placement is immutable; read it for CURRENT source-scope
      // permission before replay. No head/dependency-validity check precedes replay.
      const sourceIdentity = await database.selectFrom('person_master.assignment').selectAll()
        .where('governance_object_id', '=', governanceObjectId).where('assignment_id', '=', command.sourceAssignmentId).executeTakeFirst();
      if (sourceIdentity) await dependencies.authorizeDependencies(governanceObjectId, { scope: 'DEPARTMENT',
        departmentGovernanceObjectId: sourceIdentity.department_governance_object_id, departmentId: sourceIdentity.department_id });
      const operationHash = canonicalSha256({ command: { ...command, businessValidFrom: temporalKey(command.businessValidFrom),
        businessValidTo: temporalKey(command.businessValidTo) }, operation: 'TEMPORARY_CREATE', actor: context.actorPrincipalId });
      await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${governanceObjectId}:${context.requestId}`},0))`.execute(database);
      const repeated = await database.selectFrom('person_master.assignment_command_outcome').selectAll()
        .where('governance_object_id', '=', governanceObjectId).where('request_id', '=', context.requestId).executeTakeFirst();
      if (repeated) {
        if (repeated.operation_type !== 'TEMPORARY_CREATE' || !repeated.operation_hash.equals(operationHash))
          throw new Error('ASSIGNMENT_OPERATION_CONFLICT');
        if (repeated.rejection_code !== null) return { ok: false, code: repeated.rejection_code };
        const link = await database.selectFrom('person_master.assignment_temporary_source').select('target_assignment_id')
          .where('target_admission_version_id', '=', repeated.assignment_version_id!).executeTakeFirstOrThrow();
        return { ok: true, value: await receipt({ governanceObjectId, targetAssignmentId: link.target_assignment_id }) };
      }
      if (!sourceIdentity) return reject(command, operationHash, 'ASSIGNMENT_NOT_FOUND');
      const source = await database.selectFrom('person_master.assignment').selectAll()
        .where('governance_object_id', '=', governanceObjectId).where('assignment_id', '=', command.sourceAssignmentId).forUpdate().executeTakeFirstOrThrow();
      const prior = await database.selectFrom('person_master.assignment_version').selectAll()
        .where('assignment_id', '=', source.assignment_id).orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
      if (prior.assignment_version_id !== command.expectedSourceVersionId) return reject(command, operationHash, 'ASSIGNMENT_STALE_VERSION');
      if (prior.evidence_kind === 'CLOSURE') return reject(command, operationHash, 'ASSIGNMENT_ALREADY_CLOSED');
      if (await database.selectFrom('person_master.assignment_temporary_source').select('target_assignment_id')
        .where('target_assignment_id', '=', source.assignment_id).executeTakeFirst())
        return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SOURCE_CHAIN_NOT_SUPPORTED');
      const sourceSemantics = await assignmentAdmissionSemanticExact(database, prior.assignment_version_id);
      if (sourceSemantics.classification !== 'CLASSIFIED' || sourceSemantics.mode.code !== 'PRIMARY_AFFILIATION')
        return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SOURCE_PRIMARY_REQUIRED');
      const purposeCode = ASSIGNMENT_PURPOSES.find(code => code === sourceSemantics.purpose.code);
      if (!purposeCode || prior.dependency_fingerprint === null) throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
      if (source.department_id === command.targetPlacement.departmentId) return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SAME_DEPARTMENT');
      if (!assignmentPeriodCovered(prior.business_valid_from, prior.business_valid_to, command.businessValidFrom, command.businessValidTo))
        return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SOURCE_PERIOD_NOT_COVERED');
      const sourcePlacement: AssignmentPlacement = { scope: 'DEPARTMENT', departmentGovernanceObjectId: source.department_governance_object_id,
        departmentId: source.department_id };
      let prepared: TemporaryAdmissionPreparation;
      let sourceWindow: TemporarySourceWindowEvidence;
      let candidateEvidence: TemporaryCandidateEvidence;
      try {
        await dependencies.pinClassifiedEngagement({ governanceObjectId, engagementId: source.engagement_id });
        const placements = [sourcePlacement, command.targetPlacement].sort((a, b) => a.departmentId.localeCompare(b.departmentId));
        for (const placement of placements) await dependencies.pinDepartment(placement);
        await createAssignmentSemanticStore(database, context).pinDefinitions(governanceObjectId, { purposeCode, modeCode: 'SECONDMENT' });
        const recordAsOf = (await sql<{ now: string }>`select platform.local_now() as now`.execute(database)).rows[0]!.now;
        const candidates = await assignmentSemanticCandidates(database, governanceObjectId, source.engagement_id, recordAsOf, source.assignment_id);
        const primary = evaluateAssignmentPrimary({ ...command, purposeCode, modeCode: 'PRIMARY_AFFILIATION' }, candidates);
        if (primary.result !== 'SATISFIED') return reject(command, operationHash, primary.result);
        if (candidates.some(candidate => candidate.purposeCode === purposeCode && candidate.modeCode === 'SECONDMENT'
          && temporaryOverlaps(command.businessValidFrom, command.businessValidTo, candidate)))
          return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT');
        prepared = await admission.prepareTemporaryAdmission({ governanceObjectId, engagementId: source.engagement_id,
          placement: command.targetPlacement, relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', businessValidFrom: command.businessValidFrom,
          businessValidTo: command.businessValidTo, purposeCode, recordAsOf });
        const sourceDepartment = await dependencies.department.getDepartmentPlacementReferenceAsOf({
          departmentGovernanceObjectId: sourcePlacement.departmentGovernanceObjectId, departmentId: sourcePlacement.departmentId, recordAsOf });
        if (sourceDepartment.businessStatus !== 'ACTIVE') return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_NOT_ACTIVE');
        if (!assignmentPeriodCovered(sourceDepartment.businessValidFrom, sourceDepartment.businessValidTo, command.businessValidFrom, command.businessValidTo))
          return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_PERIOD_NOT_COVERED');
        sourceWindow = { semanticRole: 'TEMPORARY_SOURCE_WINDOW_VALIDATION', requestedFrom: command.businessValidFrom,
          requestedTo: command.businessValidTo, recordAsOf, sourceDepartment,
          targetAdmissionDependencyFingerprint: prepared.evidence.dependencyFingerprint, constraintResult: 'SATISFIED' };
        candidateEvidence = { scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', purposeCode,
          businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo, recordAsOf, candidates, result: 'SATISFIED' };
        if (Buffer.byteLength(JSON.stringify([sourceWindow, candidateEvidence, candidateEvidence]), 'utf8') > 65536)
          return reject(command, operationHash, 'ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT');
      } catch (error) {
        if (!(error instanceof Error) || !TEMPORARY_DEPENDENCY_REJECTIONS.has(error.message)) throw error;
        return reject(command, operationHash, error.message);
      }
      // Every domain refusal above precedes business inserts. After this point any
      // failure rolls back the root transaction; no catch can commit a partial child.
      const header = await database.insertInto('person_master.assignment_temporary_source').values({
        governance_object_id: governanceObjectId, person_id: source.person_id, engagement_id: source.engagement_id,
        source_assignment_id: source.assignment_id, source_assignment_version_id: prior.assignment_version_id,
        source_department_id: source.department_id, source_department_governance_object_id: source.department_governance_object_id,
        target_department_id: command.targetPlacement.departmentId, target_department_governance_object_id: command.targetPlacement.departmentGovernanceObjectId,
        preserved_purpose_code: purposeCode, temporary_mode_code: 'SECONDMENT', source_semantic_version_id: prior.assignment_version_id,
        source_semantic_fingerprint: Buffer.from(sourceSemantics.semanticFingerprint, 'hex'),
        source_acceptance_dependency_fingerprint: prior.dependency_fingerprint,
        source_declared_from: prior.business_valid_from, source_declared_to: prior.business_valid_to,
        temporary_from: command.businessValidFrom, temporary_to: command.businessValidTo,
        source_department_version_id: sourceWindow.sourceDepartment.departmentVersionId,
        evaluation_record_as_of: prepared.evidence.evaluationRecordAsOf,
        source_window_validation_evidence: sql`${JSON.stringify(sourceWindow)}::jsonb`,
        source_primary_evaluation_evidence: sql`${JSON.stringify(candidateEvidence)}::jsonb`,
        temporary_overlap_evaluation_evidence: sql`${JSON.stringify(candidateEvidence)}::jsonb`,
        target_admission_dependency_fingerprint: Buffer.from(prepared.evidence.dependencyFingerprint, 'hex'),
        policy_code: ASSIGNMENT_TEMPORARY_POLICY.policyCode, policy_version: 1, policy_digest: Buffer.from(ASSIGNMENT_TEMPORARY_POLICY_DIGEST, 'hex'),
        request_id: context.requestId, created_by: context.actorPrincipalId, operation_hash: operationHash, reason_code: command.reasonCode,
      }).returningAll().executeTakeFirstOrThrow();
      hitControlledPublicationFault('ASSIGNMENT_TEMPORARY_SOURCE_LINK_WRITTEN');
      await admission.appendTemporaryAdmission(header, prepared);
      const value = await receipt({ governanceObjectId, targetAssignmentId: header.target_assignment_id });
      await audit.append({ governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: value.targetAssignmentId,
        aggregateVersionId: value.targetAdmissionVersionId, eventType: 'PERSON_ASSIGNMENT_TEMPORARY_CREATED', payload: {
          sourceAssignmentId: source.assignment_id, sourceAssignmentVersionId: prior.assignment_version_id,
          targetAssignmentId: value.targetAssignmentId, targetAdmissionVersionId: value.targetAdmissionVersionId,
          sourceDepartmentId: source.department_id, targetDepartmentId: command.targetPlacement.departmentId,
          purposeCode, modeCode: 'SECONDMENT', temporaryFrom: header.temporary_from, temporaryTo: header.temporary_to,
          sourceMutation: 'NONE', sourceVersionAfterCreation: prior.assignment_version_id,
          sourceLinkFingerprint: value.sourceLink.sourceLinkFingerprint, policyCode: header.policy_code,
          policyVersion: 1, policyDigest: ASSIGNMENT_TEMPORARY_POLICY_DIGEST, reasonCode: command.reasonCode,
        }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
      hitControlledPublicationFault('ASSIGNMENT_TEMPORARY_AUDIT_WRITTEN');
      await sql`set constraints all immediate`.execute(database);
      return { ok: true, value };
    },
    async getTemporaryAssignment(query) {
      reference(query); await authorize(query.governanceObjectId); return receipt(query);
    },
    async getTemporaryAssignmentAsOf(query) {
      reference(query, ['businessAt', 'recordAsOf']); temporalKey(query.businessAt); temporalKey(query.recordAsOf);
      await authorize(query.governanceObjectId);
      const sourceLink = await readTemporarySourceLink(database, query.governanceObjectId, query.targetAssignmentId);
      if (temporalKey(query.recordAsOf) < temporalKey(sourceLink.recordedFrom)) throw new Error('ASSIGNMENT_NOT_KNOWN_AS_OF');
      const coreQuery = { governanceObjectId: query.governanceObjectId, assignmentId: query.targetAssignmentId,
        businessAt: query.businessAt, recordAsOf: query.recordAsOf };
      const declaration = await core.getAssignmentDeclaredPeriodAsOf(coreQuery);
      const selected = await core.getAssignmentSemanticsAsOf(coreQuery);
      return { semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_DECLARATION', declaration,
        selectedVersion: selected.coreVersion, semantics: selected.semantics, sourceLink };
    },
    async assessTemporaryAssignmentDependencies(query) {
      reference(query, ['assignmentVersionId', 'recordAsOf']); assertPersonUuid(query.assignmentVersionId); temporalKey(query.recordAsOf);
      await authorize(query.governanceObjectId);
      return assessTemporaryDependencies(database, dependencies, core, query);
    },
  };
}
