import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';

export const EMERGENCY_CONTROL_MODULE_ID = 'emergency-control' as const;

export interface EmergencySuspensionResult {
  readonly suspensionEventId: string;
  readonly impactCaseId: string;
  readonly eventSequence: string;
}

export interface EmergencyControlModule {
  getImpactCaseContext(impactCaseId: string): Promise<{
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }>;
  isPriceReleaseSuspended(command: {
    readonly priceListReleaseId: string;
    readonly campusId: string;
    readonly serviceOccurredAt: string;
    readonly recordAsOf: string;
  }): Promise<boolean>;
  suspendPriceRelease(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
    readonly scopeLevel: 'HOSPITAL' | 'CAMPUS';
    readonly campusId: string | null;
    readonly effectiveFrom: string;
    readonly reason: string;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<EmergencySuspensionResult>;
  approvePostIncidentReview(command: {
    readonly impactCaseId: string;
    readonly reason: string;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  prepareRecoveryLink(command: {
    readonly impactCaseId: string;
  }): Promise<{ readonly suspendedPriceListReleaseId: string }>;
  confirmRecoveryPublication(command: {
    readonly impactCaseId: string;
    readonly recoveryReleaseId: string;
    readonly reason: string;
  }): Promise<void>;
  getRecoveryReleaseId(impactCaseId: string): Promise<string | null>;
  closeImpactCase(command: {
    readonly impactCaseId: string;
    readonly reason: string;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly consumerReceiptConfirmed: boolean;
  }): Promise<void>;
}

export function createEmergencyControlModule(
  database: Kysely<DB>,
  context: RequestContext,
): EmergencyControlModule {
  return {
    async getImpactCaseContext(impactCaseId) {
      const result = await sql<{
        readonly governance_object_id: string;
        readonly price_list_id: string;
        readonly price_list_release_id: string;
      }>`
        select event.governance_object_id, event.price_list_id, event.price_list_release_id
        from emergency_control.impact_case impact
        join emergency_control.suspension_event event
          on event.suspension_event_id = impact.suspension_event_id
        where impact.impact_case_id = ${impactCaseId}::uuid
      `.execute(database);
      const row = result.rows[0];
      if (!row) throw new Error('IMPACT_CASE_NOT_FOUND');
      return {
        governanceObjectId: row.governance_object_id,
        priceListId: row.price_list_id,
        priceListReleaseId: row.price_list_release_id,
      };
    },

    async isPriceReleaseSuspended(command) {
      const result = await sql<{ readonly suspended: boolean }>`
        select exists (
          select 1 from emergency_control.suspension_event event
          where event.price_list_release_id = ${command.priceListReleaseId}::uuid
            and event.effective_from <= ${command.serviceOccurredAt}::timestamp
            and event.recorded_at <= ${command.recordAsOf}::timestamp
            and (
              event.scope_level = 'HOSPITAL'
              or (event.scope_level = 'CAMPUS' and event.campus_id = ${command.campusId}::uuid)
            )
        ) as suspended
      `.execute(database);
      return result.rows[0]?.suspended ?? false;
    },

    async suspendPriceRelease(command) {
      parseLocalDateTime(command.effectiveFrom);
      if (command.scopeLevel === 'HOSPITAL' ? command.campusId !== null : !command.campusId) {
        throw new Error('EMERGENCY_SUSPENSION_SCOPE_INVALID');
      }
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.governanceObjectId}, 53))`.execute(
        database,
      );
      const duplicate = await sql<{ readonly found: boolean }>`
        select exists (
          select 1 from emergency_control.suspension_event
          where price_list_release_id = ${command.priceListReleaseId}::uuid
            and scope_level = ${command.scopeLevel}
            and campus_id is not distinct from ${command.campusId}::uuid
        ) as found
      `.execute(database);
      if (duplicate.rows[0]?.found) throw new Error('PRICE_RELEASE_ALREADY_SUSPENDED');
      const next = await sql<{ readonly event_sequence: string }>`
        select (coalesce(max(event_sequence), 0) + 1)::text as event_sequence
        from emergency_control.suspension_event
        where governance_object_id = ${command.governanceObjectId}::uuid
      `.execute(database);
      const eventSequence = next.rows[0]?.event_sequence ?? '1';
      const event = await sql<{ readonly suspension_event_id: string }>`
        insert into emergency_control.suspension_event (
          governance_object_id, price_list_id, price_list_release_id, event_sequence,
          scope_level, campus_id, effective_from, reason, evidence,
          actor_principal_id, recorded_at, request_id, correlation_id
        ) values (
          ${command.governanceObjectId}::uuid, ${command.priceListId}::uuid,
          ${command.priceListReleaseId}::uuid, ${eventSequence}::bigint,
          ${command.scopeLevel}, ${command.campusId}::uuid, ${command.effectiveFrom}::timestamp,
          ${command.reason}, ${JSON.stringify(command.evidence)}::jsonb,
          ${context.actorPrincipalId}::uuid, ${context.occurredAt}::timestamp,
          ${context.requestId}, ${context.correlationId}
        ) returning suspension_event_id
      `.execute(database);
      const suspensionEventId = event.rows[0]?.suspension_event_id;
      if (!suspensionEventId) throw new Error('SUSPENSION_EVENT_CREATE_FAILED');
      const impact = await sql<{ readonly impact_case_id: string }>`
        insert into emergency_control.impact_case (
          suspension_event_id, priority, case_status, emergency_actor_principal_id,
          recovery_release_id, created_at, closed_at
        ) values (
          ${suspensionEventId}::uuid, 'CRITICAL', 'OPEN',
          ${context.actorPrincipalId}::uuid, null, ${context.occurredAt}::timestamp, null
        ) returning impact_case_id
      `.execute(database);
      const impactCaseId = impact.rows[0]?.impact_case_id;
      if (!impactCaseId) throw new Error('IMPACT_CASE_CREATE_FAILED');
      return { suspensionEventId, impactCaseId, eventSequence };
    },

    async approvePostIncidentReview(command) {
      const impact = await lockImpactCase(database, command.impactCaseId);
      if (impact.emergency_actor_principal_id === context.actorPrincipalId) {
        throw new Error('EMERGENCY_ACTOR_REVIEW_CONFLICT');
      }
      if (impact.case_status !== 'OPEN') throw new Error('IMPACT_CASE_STATE_CONFLICT');
      const sequence = await nextImpactActionSequence(database, command.impactCaseId);
      await appendImpactAction(database, context, command.impactCaseId, sequence,
        'POST_INCIDENT_REVIEW_APPROVED', command.reason, command.evidence);
      await sql`
        update emergency_control.impact_case set case_status = 'UNDER_REVIEW'
        where impact_case_id = ${command.impactCaseId}::uuid and case_status = 'OPEN'
      `.execute(database);
    },

    async prepareRecoveryLink(command) {
      const impact = await lockImpactCase(database, command.impactCaseId);
      if (impact.case_status !== 'UNDER_REVIEW') throw new Error('IMPACT_REVIEW_REQUIRED');
      const source = await sql<{ readonly price_list_release_id: string }>`
        select event.price_list_release_id
        from emergency_control.impact_case impact
        join emergency_control.suspension_event event
          on event.suspension_event_id = impact.suspension_event_id
        where impact.impact_case_id = ${command.impactCaseId}::uuid
      `.execute(database);
      const suspendedPriceListReleaseId = source.rows[0]?.price_list_release_id;
      if (!suspendedPriceListReleaseId) throw new Error('SUSPENDED_PRICE_RELEASE_MISSING');
      return { suspendedPriceListReleaseId };
    },

    async confirmRecoveryPublication(command) {
      const impact = await lockImpactCase(database, command.impactCaseId);
      if (impact.case_status !== 'UNDER_REVIEW') throw new Error('IMPACT_REVIEW_REQUIRED');
      const sequence = await nextImpactActionSequence(database, command.impactCaseId);
      await appendImpactAction(database, context, command.impactCaseId, sequence,
        'RECOVERY_LINKED', command.reason, { recoveryReleaseId: command.recoveryReleaseId });
      await sql`
        update emergency_control.impact_case
        set case_status = 'RECOVERY_PUBLISHED', recovery_release_id = ${command.recoveryReleaseId}::uuid
        where impact_case_id = ${command.impactCaseId}::uuid and case_status = 'UNDER_REVIEW'
      `.execute(database);
    },

    async getRecoveryReleaseId(impactCaseId) {
      const impact = await lockImpactCase(database, impactCaseId);
      return impact.recovery_release_id;
    },

    async closeImpactCase(command) {
      const impact = await lockImpactCase(database, command.impactCaseId);
      if (impact.emergency_actor_principal_id === context.actorPrincipalId) {
        throw new Error('EMERGENCY_ACTOR_CLOSURE_CONFLICT');
      }
      if (impact.case_status !== 'RECOVERY_PUBLISHED' || !impact.recovery_release_id) {
        throw new Error('IMPACT_RECOVERY_PUBLICATION_REQUIRED');
      }
      if (!command.consumerReceiptConfirmed) throw new Error('RECOVERY_CONSUMER_RECEIPT_REQUIRED');
      const sequence = await nextImpactActionSequence(database, command.impactCaseId);
      await appendImpactAction(database, context, command.impactCaseId, sequence,
        'CLOSURE_CONFIRMED', command.reason, command.evidence);
      await sql`
        update emergency_control.impact_case
        set case_status = 'CLOSED', closed_at = ${context.occurredAt}::timestamp
        where impact_case_id = ${command.impactCaseId}::uuid
          and case_status = 'RECOVERY_PUBLISHED'
      `.execute(database);
    },
  };
}

interface LockedImpactCase {
  readonly emergency_actor_principal_id: string;
  readonly case_status: string;
  readonly recovery_release_id: string | null;
}

async function lockImpactCase(database: Kysely<DB>, impactCaseId: string): Promise<LockedImpactCase> {
  const result = await sql<LockedImpactCase>`
    select emergency_actor_principal_id, case_status, recovery_release_id
    from emergency_control.impact_case
    where impact_case_id = ${impactCaseId}::uuid for update
  `.execute(database);
  const impact = result.rows[0];
  if (!impact) throw new Error('IMPACT_CASE_NOT_FOUND');
  return impact;
}

async function nextImpactActionSequence(database: Kysely<DB>, impactCaseId: string): Promise<string> {
  const result = await sql<{ readonly next_sequence: string }>`
    select (coalesce(max(action_sequence), 0) + 1)::text as next_sequence
    from emergency_control.impact_case_action
    where impact_case_id = ${impactCaseId}::uuid
  `.execute(database);
  return result.rows[0]?.next_sequence ?? '1';
}

async function appendImpactAction(
  database: Kysely<DB>,
  context: RequestContext,
  impactCaseId: string,
  sequence: string,
  actionType: string,
  reason: string,
  evidence: Readonly<Record<string, unknown>>,
): Promise<void> {
  await sql`
    insert into emergency_control.impact_case_action (
      impact_case_id, action_sequence, action_type, actor_principal_id,
      reason, evidence, occurred_at
    ) values (
      ${impactCaseId}::uuid, ${sequence}::bigint, ${actionType},
      ${context.actorPrincipalId}::uuid, ${reason}, ${JSON.stringify(evidence)}::jsonb,
      ${context.occurredAt}::timestamp
    )
  `.execute(database);
}
