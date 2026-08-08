import type { Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

export const WORKFLOW_MODULE_ID = 'workflow' as const;
const PHASE_01_TEMPLATE_VERSION_ID = '00000000-0000-7000-8000-000000000002';

export interface ApprovedPublicationDecision {
  readonly changeRequestId: string;
  readonly approvalActionId: string;
  readonly decisionHash: Buffer;
}

export interface WorkflowModule {
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
