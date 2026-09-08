import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import type { AuditEventService } from '../audit/index.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { assignmentAdmissionSemanticExact, createAssignmentSemanticStore } from './assignment-semantic-store.js';
import { ASSIGNMENT_PURPOSES, ASSIGNMENT_MODES, type CreateClassifiedAssignment } from './assignment-semantics-contracts.js';
import type { EndAssignment } from './assignment-closure-contracts.js';
import type { AssignmentCoreModule, AssignmentDependencies } from './assignment-repository.js';
import { ASSIGNMENT_TRANSFER_POLICY, ASSIGNMENT_TRANSFER_POLICY_DIGEST, assignmentTransferChildRequests,
  assignmentTransferPeriodValid, validateAssignmentTransfer, type AssignmentTransferApplication, type AssignmentTransferResult,
  type TransferAssignment } from './assignment-transfer-contracts.js';

type Outcome = { ok: true; value: AssignmentTransferResult } | { ok: false; code: string };
export interface AssignmentTransferModule extends Omit<AssignmentTransferApplication, 'transferAssignment'> {
  transferAssignment(command: TransferAssignment): Promise<Outcome>;
}
const PIN_REJECTIONS = new Set(['ASSIGNMENT_PLACEMENT_NOT_FOUND', 'ASSIGNMENT_PLACEMENT_UNPUBLISHED',
  'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED', 'ASSIGNMENT_TERM_NOT_APPLICABLE', 'ENGAGEMENT_NOT_FOUND']);

/** Person-owner coordinator. All steps use the supplied transaction; no root application is called. */
export function createAssignmentTransferModule(database: Transaction<DB>, context: RequestContext,
  audit: AuditEventService, dependencies: AssignmentDependencies, core: AssignmentCoreModule,
  privateStep: (context: RequestContext) => AssignmentCoreModule): AssignmentTransferModule {
  async function authorize(governanceObjectId: string) {
    await dependencies.authorize(governanceObjectId, 'READ');
    await dependencies.authorizeSemantics(governanceObjectId, 'READ');
  }
  async function receipt(governanceObjectId: string, transferId: string): Promise<AssignmentTransferResult> {
    const t = await database.selectFrom('person_master.assignment_transfer').selectAll()
      .where('governance_object_id', '=', governanceObjectId).where('transfer_id', '=', transferId).executeTakeFirst();
    if (!t) throw new Error('ASSIGNMENT_TRANSFER_NOT_FOUND');
    if (t.policy_code !== ASSIGNMENT_TRANSFER_POLICY.policyCode || t.policy_version !== 1
      || t.policy_digest.toString('hex') !== ASSIGNMENT_TRANSFER_POLICY_DIGEST) throw new Error('ASSIGNMENT_TRANSFER_EVIDENCE_INVALID');
    const sourceClosure = await core.readAssignmentVersionSnapshot({ governanceObjectId, assignmentId: t.source_assignment_id,
      assignmentVersionId: t.source_closure_version_id });
    const targetAdmission = await core.readAssignmentVersionSnapshot({ governanceObjectId, assignmentId: t.target_assignment_id,
      assignmentVersionId: t.target_admission_version_id });
    const targetSemantics = await assignmentAdmissionSemanticExact(database, t.target_admission_version_id);
    if (sourceClosure.recordKind !== 'CLOSURE' || targetAdmission.recordKind === 'CLOSURE' || targetSemantics.classification !== 'CLASSIFIED')
      throw new Error('ASSIGNMENT_TRANSFER_EVIDENCE_INVALID');
    const value = {
      semanticRole: 'ATOMIC_ASSIGNMENT_TRANSFER_RESULT' as const, transferId: t.transfer_id, governanceObjectId,
      rootRequestId: t.root_request_id, sourceRequestId: t.source_request_id, targetRequestId: t.target_request_id,
      sourceAssignmentId: t.source_assignment_id, sourcePreviousVersionId: t.source_previous_version_id,
      sourceClosureVersionId: t.source_closure_version_id, sourceClosure,
      targetAssignmentId: t.target_assignment_id, targetAdmissionVersionId: t.target_admission_version_id, targetAdmission, targetSemantics,
      personId: t.person_id, engagementId: t.engagement_id, preservedPurposeCode: t.preserved_purpose_code, preservedModeCode: t.preserved_mode_code,
      effectiveAt: t.effective_at, sourceOriginalPeriod: { from: t.source_original_from, to: t.source_original_to },
      sourceClosedPeriod: { from: t.source_original_from, to: t.effective_at }, targetPeriod: { from: t.effective_at, to: t.source_original_to },
      transferRecordedFrom: t.recorded_from, ...ASSIGNMENT_TRANSFER_POLICY, policyDigest: ASSIGNMENT_TRANSFER_POLICY_DIGEST,
    };
    // The immutable mapping plus exact immutable evidence defines this deterministic receipt.
    return { ...value, transferEvidenceFingerprint: canonicalSha256(value).toString('hex') };
  }
  async function reject(command: TransferAssignment, hash: Buffer, code: string): Promise<Outcome> {
    await database.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: command.governanceObjectId,
      request_id: context.requestId, created_by: context.actorPrincipalId, operation_type: 'TRANSFER', operation_hash: hash,
      assignment_version_id: null, transfer_id: null, rejection_code: code }).execute();
    await audit.append({ governanceObjectId: command.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT',
      aggregateId: command.sourceAssignmentId, eventType: 'PERSON_ASSIGNMENT_REJECTED',
      payload: { operation: 'TRANSFER', result: 'REJECTED', sourceAssignmentId: command.sourceAssignmentId, code },
      afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
    return { ok: false, code };
  }
  return {
    async getAssignmentTransfer(query) {
      assertClosedObject(query, ['governanceObjectId', 'transferId']);
      assertPersonUuid(query.governanceObjectId); assertPersonUuid(query.transferId);
      await authorize(query.governanceObjectId);
      return receipt(query.governanceObjectId, query.transferId);
    },
    async transferAssignment(command) {
      validateAssignmentTransfer(command);
      const governanceObjectId = command.governanceObjectId;
      await authorize(governanceObjectId);
      await dependencies.authorize(governanceObjectId, 'END');
      await dependencies.authorize(governanceObjectId, 'WRITE');
      await dependencies.authorizeSemantics(governanceObjectId, 'WRITE');
      await dependencies.authorizeTransfer(governanceObjectId);
      await dependencies.authorizeDependencies(governanceObjectId, command.targetPlacement);
      const hash = canonicalSha256({ command: { ...command, effectiveAt: temporalKey(command.effectiveAt) }, operation: 'TRANSFER', actor: context.actorPrincipalId });
      await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${governanceObjectId}:${context.requestId}`},0))`.execute(database);
      const repeated = await database.selectFrom('person_master.assignment_command_outcome').selectAll()
        .where('governance_object_id', '=', governanceObjectId).where('request_id', '=', context.requestId).executeTakeFirst();
      if (repeated) {
        if (repeated.operation_type !== 'TRANSFER' || !repeated.operation_hash.equals(hash)) throw new Error('ASSIGNMENT_OPERATION_CONFLICT');
        if (repeated.rejection_code !== null) return { ok: false, code: repeated.rejection_code };
        if (!repeated.transfer_id) throw new Error('ASSIGNMENT_TRANSFER_EVIDENCE_INVALID');
        return { ok: true, value: await receipt(governanceObjectId, repeated.transfer_id) };
      }
      const source = await database.selectFrom('person_master.assignment').selectAll()
        .where('governance_object_id', '=', governanceObjectId).where('assignment_id', '=', command.sourceAssignmentId).forUpdate().executeTakeFirst();
      if (!source) throw new Error('ASSIGNMENT_NOT_FOUND');
      if (await database.selectFrom('person_master.assignment_temporary_source').select('target_assignment_id')
        .where('target_assignment_id', '=', source.assignment_id).executeTakeFirst())
        return reject(command, hash, 'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE');
      const prior = await database.selectFrom('person_master.assignment_version').selectAll()
        .where('assignment_id', '=', source.assignment_id).orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
      if (prior.evidence_kind === 'CLOSURE') return reject(command, hash, 'ASSIGNMENT_ALREADY_CLOSED');
      if (prior.assignment_version_id !== command.expectedSourceVersionId) return reject(command, hash, 'ASSIGNMENT_STALE_VERSION');
      const inherited = await assignmentAdmissionSemanticExact(database, prior.assignment_version_id);
      if (inherited.classification !== 'CLASSIFIED') return reject(command, hash, 'ASSIGNMENT_TRANSFER_SOURCE_UNCLASSIFIED');
      if (!assignmentTransferPeriodValid(prior.business_valid_from, prior.business_valid_to, command.effectiveAt))
        return reject(command, hash, 'ASSIGNMENT_TRANSFER_PERIOD_INVALID');
      if (source.department_id === command.targetPlacement.departmentId) return reject(command, hash, 'ASSIGNMENT_TRANSFER_SAME_DEPARTMENT');
      const purposeCode = ASSIGNMENT_PURPOSES.find(value => value === inherited.purpose.code);
      const modeCode = ASSIGNMENT_MODES.find(value => value === inherited.mode.code);
      if (!purposeCode || !modeCode) throw new Error('ASSIGNMENT_SEMANTIC_EVIDENCE_INVALID');
      const codes = { purposeCode, modeCode };
      // Acquire every required fence before the savepoint; rollback cannot release them.
      try {
        await dependencies.pinClassifiedEngagement({ governanceObjectId, engagementId: source.engagement_id });
        await dependencies.pinDepartment(command.targetPlacement);
        await createAssignmentSemanticStore(database, context).pinDefinitions(governanceObjectId, codes);
      } catch (error) {
        if (!(error instanceof Error) || !PIN_REJECTIONS.has(error.message)) throw error;
        return reject(command, hash, error.message);
      }
      const children = assignmentTransferChildRequests(governanceObjectId, context.requestId);
      const end: EndAssignment = { governanceObjectId, assignmentId: source.assignment_id, expectedCurrentVersionId: prior.assignment_version_id,
        endedAt: command.effectiveAt, reasonCode: 'ADMINISTRATIVE_CLOSURE' };
      const create: CreateClassifiedAssignment = { governanceObjectId, engagementId: source.engagement_id,
        relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', placement: command.targetPlacement,
        businessValidFrom: command.effectiveAt, businessValidTo: prior.business_valid_to, ...codes };
      const sourceHash = canonicalSha256({ command: { ...end, endedAt: temporalKey(end.endedAt) }, operation: 'END', actor: context.actorPrincipalId });
      const targetHash = canonicalSha256({ command: { ...create, businessValidFrom: temporalKey(create.businessValidFrom),
        businessValidTo: create.businessValidTo === null ? null : temporalKey(create.businessValidTo) }, operation: 'CLASSIFIED_CREATE', actor: context.actorPrincipalId });
      await sql`savepoint transfer_body`.execute(database);
      const transfer = await database.insertInto('person_master.assignment_transfer').values({
        governance_object_id: governanceObjectId, root_request_id: context.requestId, created_by: context.actorPrincipalId, operation_hash: hash,
        source_operation_hash: sourceHash, target_operation_hash: targetHash,
        source_assignment_id: source.assignment_id, source_previous_version_id: prior.assignment_version_id,
        person_id: source.person_id, engagement_id: source.engagement_id,
        source_department_governance_object_id: source.department_governance_object_id, source_department_id: source.department_id,
        target_department_governance_object_id: command.targetPlacement.departmentGovernanceObjectId, target_department_id: command.targetPlacement.departmentId,
        source_original_from: prior.business_valid_from, source_original_to: prior.business_valid_to, effective_at: command.effectiveAt,
        preserved_purpose_code: purposeCode, preserved_mode_code: modeCode, source_request_id: children.source, target_request_id: children.target,
        policy_code: ASSIGNMENT_TRANSFER_POLICY.policyCode, policy_version: 1, policy_digest: Buffer.from(ASSIGNMENT_TRANSFER_POLICY_DIGEST, 'hex'),
      }).returningAll().executeTakeFirstOrThrow();
      hitControlledPublicationFault('ASSIGNMENT_TRANSFER_HEADER_WRITTEN');
      const closed = await privateStep({ ...context, requestId: children.source }).endAssignment(end);
      if (!closed.ok) throw new Error('ASSIGNMENT_TRANSFER_SOURCE_CHANGED_UNDER_FENCE');
      hitControlledPublicationFault('ASSIGNMENT_TRANSFER_SOURCE_WRITTEN');
      const admitted = await privateStep({ ...context, requestId: children.target }).createClassifiedAssignment(create);
      if (!admitted.ok) {
        await sql`rollback to savepoint transfer_body`.execute(database);
        const residual = (await sql<{ count: number }>`select
          (select count(*) from person_master.assignment_version where assignment_version_id in
            (${transfer.source_closure_version_id}::uuid,${transfer.target_admission_version_id}::uuid)) +
          (select count(*) from person_master.assignment where assignment_id=${transfer.target_assignment_id}::uuid) +
          (select count(*) from person_master.assignment_transfer where transfer_id=${transfer.transfer_id}::uuid) +
          (select count(*) from person_master.assignment_command_outcome where governance_object_id=${governanceObjectId}::uuid
            and request_id in (${children.source},${children.target})) as count`.execute(database)).rows[0]!;
        if (Number(residual.count) !== 0) throw new Error('ASSIGNMENT_TRANSFER_ROLLBACK_INCOMPLETE');
        await sql`release savepoint transfer_body`.execute(database);
        return reject(command, hash, admitted.code);
      }
      await database.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: governanceObjectId,
        request_id: context.requestId, created_by: context.actorPrincipalId, operation_type: 'TRANSFER', operation_hash: hash,
        assignment_version_id: null, transfer_id: transfer.transfer_id, rejection_code: null }).execute();
      hitControlledPublicationFault('ASSIGNMENT_TRANSFER_OUTCOME_WRITTEN');
      const value = await receipt(governanceObjectId, transfer.transfer_id);
      await audit.append({ governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: transfer.transfer_id,
        eventType: 'PERSON_ASSIGNMENT_TRANSFERRED', payload: {
          transferId: value.transferId, sourceAssignmentId: value.sourceAssignmentId, sourcePreviousVersionId: value.sourcePreviousVersionId,
          sourceClosureVersionId: value.sourceClosureVersionId, targetAssignmentId: value.targetAssignmentId, targetAdmissionVersionId: value.targetAdmissionVersionId,
          sourceDepartmentId: source.department_id, targetDepartmentId: command.targetPlacement.departmentId, effectiveAt: value.effectiveAt,
          sourceDepartmentGovernanceObjectId: source.department_governance_object_id,
          targetDepartmentGovernanceObjectId: command.targetPlacement.departmentGovernanceObjectId,
          reasonCode: command.reasonCode, policyCode: value.policyCode, policyVersion: value.policyVersion,
          sourceClosureFingerprint: value.sourceClosure.closureEvidence.closureEvidenceFingerprint,
          targetDependencyFingerprint: value.targetAdmission.acceptanceEvidence.dependencyFingerprint,
          targetSemanticFingerprint: value.targetSemantics.semanticFingerprint,
          transferRecordedFrom: value.transferRecordedFrom, sourceRequestId: value.sourceRequestId, targetRequestId: value.targetRequestId,
          transferEvidenceFingerprint: value.transferEvidenceFingerprint, policyDigest: value.policyDigest,
        }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
      await sql`set constraints person_master.assignment_complete, person_master.assignment_version_complete,
        person_master.assignment_segment_complete, person_master.assignment_semantics_complete,
        person_master.assignment_closure_complete, person_master.assignment_outcome_complete,
        person_master.assignment_transfer_complete, person_master.assignment_transfer_outcome_complete immediate`.execute(database);
      await sql`release savepoint transfer_body`.execute(database);
      return { ok: true, value };
    },
  };
}
