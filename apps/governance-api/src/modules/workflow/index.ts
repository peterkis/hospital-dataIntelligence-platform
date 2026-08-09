import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';

export const WORKFLOW_MODULE_ID = 'workflow' as const;
const PHASE_01_TEMPLATE_VERSION_ID = '00000000-0000-7000-8000-000000000002';

export interface ApprovedPublicationDecision {
  readonly changeRequestId: string;
  readonly approvalActionId: string;
  readonly decisionHash: Buffer;
}

export type WorkflowStageType =
  | 'CAMPUS_PRE_CONFIRMATION'
  | 'PROFESSIONAL_REVIEW'
  | 'DOMAIN_SEMANTIC_CONFIRMATION'
  | 'OWNER_FINAL_APPROVAL'
  | 'CONTRACT_FINAL_APPROVAL';

export interface ChangeRequestView {
  readonly changeRequestId: string;
  readonly governanceObjectId: string;
  readonly stableEntityId: string;
  readonly entityVersionId: string;
  readonly changeKind: string;
  readonly riskClassification: 'NORMAL' | 'HIGH' | 'PURE_SCHEMA_UPGRADE' | 'RECOVERY';
  readonly approvalTemplateVersionId: string;
  readonly submittedContentHash: Buffer;
  readonly submittedBy: string;
  readonly changeReason: string;
  readonly frozenEvidence: Readonly<Record<string, unknown>>;
  readonly requestStatus: string;
  readonly requiredStageCount: number;
  readonly nextActionSequence: string;
}

export interface ExpectedApprovalStage {
  readonly changeRequest: ChangeRequestView;
  readonly stageSequence: string;
  readonly stageType: WorkflowStageType;
  readonly permissionCode: string;
  readonly campusScopeRequired: boolean;
}

export interface WorkflowModule {
  submitChange(command: {
    readonly governanceObjectId: string;
    readonly governedEntityType: 'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE';
    readonly stableEntityId: string;
    readonly entityVersionId: string;
    readonly changeKind:
      | 'INITIAL_PUBLICATION'
      | 'VERSION_CHANGE'
      | 'RETROACTIVE_CORRECTION'
      | 'CAMPUS_DIFFERENCE_PRICE'
      | 'PROJECTION_SCHEMA_UPGRADE'
      | 'RECOVERY_PUBLICATION';
    readonly riskClassification: 'NORMAL' | 'HIGH' | 'PURE_SCHEMA_UPGRADE' | 'RECOVERY';
    readonly submittedContentHash: Buffer;
    readonly changeReason: string;
    readonly frozenEvidence: Readonly<Record<string, unknown>>;
  }): Promise<ChangeRequestView>;
  getChangeRequest(changeRequestId: string): Promise<ChangeRequestView | null>;
  getExpectedStage(changeRequestId: string): Promise<ExpectedApprovalStage>;
  actOnChange(command: {
    readonly changeRequestId: string;
    readonly stageType: WorkflowStageType;
    readonly actionResult: 'APPROVED' | 'REJECTED';
    readonly reason: string;
    readonly seenContentHash: Buffer;
  }): Promise<ChangeRequestView>;
  withdrawChange(command: {
    readonly changeRequestId: string;
    readonly reason: string;
  }): Promise<ChangeRequestView>;
  listActions(changeRequestId: string): Promise<readonly {
    readonly approvalActionId: string;
    readonly actionSequence: string;
    readonly stageType: string;
    readonly actorPrincipalId: string;
    readonly actionResult: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[]>;
  approveInitialPublication(command: {
    readonly governanceObjectId: string;
    readonly stableEntityId: string;
    readonly entityVersionId: string;
    readonly submittedContentHash: Buffer;
    readonly changeReason: string;
  }): Promise<ApprovedPublicationDecision>;
}

export function createWorkflowModule(
  database: Kysely<DB>,
  context: RequestContext,
): WorkflowModule {
  return {
    async submitChange(command) {
      const templateVersionId = templateVersionFor(
        command.governedEntityType,
        command.changeKind,
        command.riskClassification,
      );
      const template = await sql<{
        readonly approval_template_version_id: string;
        readonly stage_count: number;
      }>`
        select version.approval_template_version_id,
               count(stage.stage_sequence)::integer as stage_count
        from workflow.approval_template_version version
        join workflow.approval_template_stage stage
          on stage.approval_template_version_id = version.approval_template_version_id
        where version.approval_template_version_id = ${templateVersionId}::uuid
          and version.governance_status = 'PUBLISHED'
        group by version.approval_template_version_id
      `.execute(database);
      const frozen = template.rows[0];
      if (!frozen) throw new Error('APPROVAL_TEMPLATE_VERSION_NOT_FOUND');
      const result = await sql<{ readonly change_request_id: string }>`
        insert into workflow.change_request (
          governance_object_id, stable_entity_id, entity_version_id, change_kind,
          approval_template_version_id, submitted_content_hash, submitted_by,
          change_reason, request_status, decided_at, risk_classification,
          frozen_evidence, required_stage_count, next_action_sequence
        ) values (
          ${command.governanceObjectId}::uuid,
          ${command.stableEntityId}::uuid,
          ${command.entityVersionId}::uuid,
          ${command.changeKind},
          ${templateVersionId}::uuid,
          ${command.submittedContentHash},
          ${context.actorPrincipalId}::uuid,
          ${command.changeReason},
          'SUBMITTED', null,
          ${command.riskClassification},
          ${JSON.stringify(command.frozenEvidence)}::jsonb,
          ${frozen.stage_count}, 1
        ) returning change_request_id
      `.execute(database);
      const id = result.rows[0]?.change_request_id;
      if (!id) throw new Error('CHANGE_REQUEST_CREATE_FAILED');
      return getChangeRequestOrThrow(database, id);
    },

    getChangeRequest(changeRequestId) {
      return getChangeRequest(database, changeRequestId);
    },

    async getExpectedStage(changeRequestId) {
      const changeRequest = await getChangeRequestOrThrow(database, changeRequestId);
      if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(changeRequest.requestStatus)) {
        throw new Error('APPROVAL_REQUEST_TERMINAL');
      }
      const result = await sql<{
        readonly stage_sequence: string;
        readonly stage_type: WorkflowStageType;
        readonly permission_code: string;
        readonly campus_scope_required: boolean;
      }>`
        select stage_sequence::text, stage_type, permission_code, campus_scope_required
        from workflow.approval_template_stage
        where approval_template_version_id = ${changeRequest.approvalTemplateVersionId}::uuid
          and stage_sequence = ${changeRequest.nextActionSequence}::bigint
      `.execute(database);
      const stage = result.rows[0];
      if (!stage) throw new Error('APPROVAL_STAGE_NOT_FOUND');
      return {
        changeRequest,
        stageSequence: stage.stage_sequence,
        stageType: stage.stage_type,
        permissionCode: stage.permission_code,
        campusScopeRequired: stage.campus_scope_required,
      };
    },

    async actOnChange(command) {
      const expected = await lockExpectedStage(database, command.changeRequestId);
      if (expected.stageType !== command.stageType) throw new Error('APPROVAL_STAGE_ORDER_CONFLICT');
      if (!expected.changeRequest.submittedContentHash.equals(command.seenContentHash)) {
        throw new Error('APPROVAL_CONTENT_DRIFT');
      }
      const template = await database
        .selectFrom('workflow.approval_template_version')
        .select('submitter_may_approve')
        .where(
          'approval_template_version_id',
          '=',
          expected.changeRequest.approvalTemplateVersionId,
        )
        .executeTakeFirstOrThrow();
      if (
        (command.stageType === 'OWNER_FINAL_APPROVAL' ||
          command.stageType === 'CONTRACT_FINAL_APPROVAL') &&
        expected.changeRequest.submittedBy === context.actorPrincipalId &&
        !template.submitter_may_approve
      ) {
        throw new Error('APPROVAL_DUTY_SEPARATION_CONFLICT');
      }
      await database
        .insertInto('workflow.approval_action')
        .values({
          change_request_id: command.changeRequestId,
          action_sequence: expected.stageSequence,
          stage_type: command.stageType,
          actor_principal_id: context.actorPrincipalId,
          action_result: command.actionResult,
          reason: command.reason,
          seen_content_hash: command.seenContentHash,
          occurred_at: context.occurredAt,
        })
        .execute();
      hitControlledPublicationFault('WORKFLOW_DECISION_WRITTEN');
      const isFinal = Number(expected.stageSequence) === expected.changeRequest.requiredStageCount;
      const requestStatus =
        command.actionResult === 'REJECTED'
          ? 'REJECTED'
          : isFinal
            ? 'APPROVED'
            : Number(expected.stageSequence) + 1 === expected.changeRequest.requiredStageCount
              ? 'AWAITING_FINAL'
              : 'UNDER_REVIEW';
      await sql`
        update workflow.change_request
        set request_status = ${requestStatus},
            next_action_sequence = next_action_sequence + 1,
            decided_at = case when ${requestStatus} in ('APPROVED', 'REJECTED')
                              then ${context.occurredAt}::timestamp else null end
        where change_request_id = ${command.changeRequestId}::uuid
          and next_action_sequence = ${expected.stageSequence}::bigint
      `.execute(database);
      return getChangeRequestOrThrow(database, command.changeRequestId);
    },

    async withdrawChange(command) {
      const current = await getChangeRequestOrThrow(database, command.changeRequestId);
      if (current.submittedBy !== context.actorPrincipalId) {
        throw new Error('CHANGE_WITHDRAW_SUBMITTER_ONLY');
      }
      if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(current.requestStatus)) {
        throw new Error('APPROVAL_REQUEST_TERMINAL');
      }
      await database
        .insertInto('workflow.approval_action')
        .values({
          change_request_id: command.changeRequestId,
          action_sequence: current.nextActionSequence,
          stage_type: 'WITHDRAWAL',
          actor_principal_id: context.actorPrincipalId,
          action_result: 'WITHDRAWN',
          reason: command.reason,
          seen_content_hash: current.submittedContentHash,
          occurred_at: context.occurredAt,
        })
        .execute();
      await sql`
        update workflow.change_request
        set request_status = 'WITHDRAWN', decided_at = ${context.occurredAt}::timestamp,
            next_action_sequence = next_action_sequence + 1
        where change_request_id = ${command.changeRequestId}::uuid
      `.execute(database);
      return getChangeRequestOrThrow(database, command.changeRequestId);
    },

    async listActions(changeRequestId) {
      const result = await sql<{
        readonly approval_action_id: string;
        readonly action_sequence: string;
        readonly stage_type: string;
        readonly actor_principal_id: string;
        readonly action_result: string;
        readonly reason: string;
        readonly occurred_at: string;
      }>`
        select approval_action_id, action_sequence::text, stage_type, actor_principal_id,
               action_result, reason, occurred_at
        from workflow.approval_action
        where change_request_id = ${changeRequestId}::uuid
        order by action_sequence
      `.execute(database);
      return result.rows.map((row) => ({
        approvalActionId: row.approval_action_id,
        actionSequence: row.action_sequence,
        stageType: row.stage_type,
        actorPrincipalId: row.actor_principal_id,
        actionResult: row.action_result,
        reason: row.reason,
        occurredAt: row.occurred_at,
      }));
    },

    async approveInitialPublication(command) {
      const template = await database
        .selectFrom('workflow.approval_template_version')
        .select(['approval_template_version_id', 'submitter_may_approve', 'content_hash'])
        .where('approval_template_version_id', '=', PHASE_01_TEMPLATE_VERSION_ID)
        .where('governance_status', '=', 'PUBLISHED')
        .executeTakeFirst();
      if (!template) throw new Error('APPROVAL_TEMPLATE_VERSION_NOT_FOUND');
      if (!template.submitter_may_approve) throw new Error('APPROVAL_DUTY_SEPARATION_CONFLICT');

      const request = await database
        .insertInto('workflow.change_request')
        .values({
          governance_object_id: command.governanceObjectId,
          stable_entity_id: command.stableEntityId,
          entity_version_id: command.entityVersionId,
          change_kind: 'INITIAL_PUBLICATION',
          approval_template_version_id: template.approval_template_version_id,
          submitted_content_hash: command.submittedContentHash,
          submitted_by: context.actorPrincipalId,
          change_reason: command.changeReason,
          request_status: 'SUBMITTED',
          decided_at: null,
        })
        .returning('change_request_id')
        .executeTakeFirstOrThrow();
      const action = await database
        .insertInto('workflow.approval_action')
        .values({
          change_request_id: request.change_request_id,
          action_sequence: '1',
          stage_type: 'OWNER_FINAL_APPROVAL',
          actor_principal_id: context.actorPrincipalId,
          action_result: 'APPROVED',
          reason: command.changeReason,
          seen_content_hash: command.submittedContentHash,
          occurred_at: context.occurredAt,
        })
        .returning('approval_action_id')
        .executeTakeFirstOrThrow();
      const updated = await database
        .updateTable('workflow.change_request')
        .set({ request_status: 'APPROVED', decided_at: context.occurredAt })
        .where('change_request_id', '=', request.change_request_id)
        .where('request_status', '=', 'SUBMITTED')
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n) throw new Error('APPROVAL_STATE_CONFLICT');

      const decisionHash = canonicalSha256({
        actionSequence: '1',
        actorPrincipalId: context.actorPrincipalId,
        approvalActionId: action.approval_action_id,
        changeRequestId: request.change_request_id,
        decision: 'APPROVED',
        entityVersionId: command.entityVersionId,
        occurredAt: context.occurredAt,
        submittedContentHash: command.submittedContentHash.toString('hex'),
        templateContentHash: template.content_hash.toString('hex'),
        templateVersionId: template.approval_template_version_id,
      });
      return {
        changeRequestId: request.change_request_id,
        approvalActionId: action.approval_action_id,
        decisionHash,
      };
    },
  };
}

function templateVersionFor(
  governedEntityType: 'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE',
  changeKind: string,
  riskClassification: string,
): string {
  if (changeKind === 'PROJECTION_SCHEMA_UPGRADE' && riskClassification === 'PURE_SCHEMA_UPGRADE') {
    return '00000000-0000-7000-8000-000000000041';
  }
  if (changeKind === 'CAMPUS_DIFFERENCE_PRICE') {
    return '00000000-0000-7000-8000-000000000031';
  }
  if (
    governedEntityType === 'PRICE_LIST_RELEASE' &&
    (riskClassification === 'RECOVERY' || changeKind === 'RECOVERY_PUBLICATION')
  ) {
    return '00000000-0000-7000-8000-000000000051';
  }
  if (
    governedEntityType === 'PRICE_LIST_RELEASE' &&
    (riskClassification === 'HIGH' ||
      changeKind === 'RETROACTIVE_CORRECTION')
  ) {
    return '00000000-0000-7000-8000-000000000021';
  }
  return '00000000-0000-7000-8000-000000000011';
}

async function getChangeRequest(
  database: Kysely<DB>,
  changeRequestId: string,
): Promise<ChangeRequestView | null> {
  const result = await sql<{
    readonly change_request_id: string;
    readonly governance_object_id: string;
    readonly stable_entity_id: string;
    readonly entity_version_id: string;
    readonly change_kind: string;
    readonly risk_classification: ChangeRequestView['riskClassification'];
    readonly approval_template_version_id: string;
    readonly submitted_content_hash: Buffer;
    readonly submitted_by: string;
    readonly change_reason: string;
    readonly frozen_evidence: Readonly<Record<string, unknown>>;
    readonly request_status: string;
    readonly required_stage_count: number;
    readonly next_action_sequence: string;
  }>`
    select change_request_id, governance_object_id, stable_entity_id, entity_version_id,
           change_kind, risk_classification, approval_template_version_id,
           submitted_content_hash, submitted_by, change_reason, frozen_evidence, request_status,
           required_stage_count, next_action_sequence::text
    from workflow.change_request
    where change_request_id = ${changeRequestId}::uuid
  `.execute(database);
  const row = result.rows[0];
  return row
    ? {
        changeRequestId: row.change_request_id,
        governanceObjectId: row.governance_object_id,
        stableEntityId: row.stable_entity_id,
        entityVersionId: row.entity_version_id,
        changeKind: row.change_kind,
        riskClassification: row.risk_classification,
        approvalTemplateVersionId: row.approval_template_version_id,
        submittedContentHash: row.submitted_content_hash,
        submittedBy: row.submitted_by,
        changeReason: row.change_reason,
        frozenEvidence: row.frozen_evidence,
        requestStatus: row.request_status,
        requiredStageCount: row.required_stage_count,
        nextActionSequence: row.next_action_sequence,
      }
    : null;
}

async function getChangeRequestOrThrow(
  database: Kysely<DB>,
  changeRequestId: string,
): Promise<ChangeRequestView> {
  const request = await getChangeRequest(database, changeRequestId);
  if (!request) throw new Error('CHANGE_REQUEST_NOT_FOUND');
  return request;
}

async function lockExpectedStage(
  database: Kysely<DB>,
  changeRequestId: string,
): Promise<ExpectedApprovalStage> {
  const result = await sql<{
    readonly change_request_id: string;
    readonly governance_object_id: string;
    readonly stable_entity_id: string;
    readonly entity_version_id: string;
    readonly change_kind: string;
    readonly risk_classification: ChangeRequestView['riskClassification'];
    readonly approval_template_version_id: string;
    readonly submitted_content_hash: Buffer;
    readonly submitted_by: string;
    readonly change_reason: string;
    readonly frozen_evidence: Readonly<Record<string, unknown>>;
    readonly request_status: string;
    readonly required_stage_count: number;
    readonly next_action_sequence: string;
    readonly stage_sequence: string;
    readonly stage_type: WorkflowStageType;
    readonly permission_code: string;
    readonly campus_scope_required: boolean;
  }>`
    select request.change_request_id, request.governance_object_id,
           request.stable_entity_id, request.entity_version_id, request.change_kind,
           request.risk_classification, request.approval_template_version_id,
           request.submitted_content_hash, request.submitted_by, request.change_reason,
           request.frozen_evidence,
           request.request_status,
           request.required_stage_count, request.next_action_sequence::text,
           stage.stage_sequence::text, stage.stage_type, stage.permission_code,
           stage.campus_scope_required
    from workflow.change_request request
    join workflow.approval_template_stage stage
      on stage.approval_template_version_id = request.approval_template_version_id
     and stage.stage_sequence = request.next_action_sequence
    where request.change_request_id = ${changeRequestId}::uuid
    for update of request
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new Error('APPROVAL_STAGE_NOT_FOUND');
  if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(row.request_status)) {
    throw new Error('APPROVAL_REQUEST_TERMINAL');
  }
  return {
    changeRequest: {
      changeRequestId: row.change_request_id,
      governanceObjectId: row.governance_object_id,
      stableEntityId: row.stable_entity_id,
      entityVersionId: row.entity_version_id,
      changeKind: row.change_kind,
      riskClassification: row.risk_classification,
      approvalTemplateVersionId: row.approval_template_version_id,
      submittedContentHash: row.submitted_content_hash,
      submittedBy: row.submitted_by,
      changeReason: row.change_reason,
      frozenEvidence: row.frozen_evidence,
      requestStatus: row.request_status,
      requiredStageCount: row.required_stage_count,
      nextActionSequence: row.next_action_sequence,
    },
    stageSequence: row.stage_sequence,
    stageType: row.stage_type,
    permissionCode: row.permission_code,
    campusScopeRequired: row.campus_scope_required,
  };
}
