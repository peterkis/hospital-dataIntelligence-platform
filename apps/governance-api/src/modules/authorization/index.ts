import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

export const AUTHORIZATION_MODULE_ID = 'authorization' as const;

export type ObjectPermissionCode =
  | 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'
  | 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE'
  | 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ'
  | 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE'
  | 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ'
  | 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE'
  | 'PERSON_MASTER_ENGAGEMENT_READ'
  | 'PERSON_MASTER_ENGAGEMENT_WRITE'
  | 'PERSON_MASTER_SOURCE_MAPPING_READ'
  | 'PERSON_MASTER_SOURCE_MAPPING_WRITE'
  | 'PERSON_MASTER_SOURCE_MAPPING_CORRECT'
  | 'PERSON_MASTER_IDENTIFIER_READ'
  | 'PERSON_MASTER_IDENTIFIER_WRITE'
  | 'PERSON_MASTER_CORE_READ'
  | 'PERSON_MASTER_CORE_WRITE'
  | 'CHARGE_CATALOG_DRAFT_READ'
  | 'CHARGE_CATALOG_DRAFT_WRITE'
  | 'CHARGE_CATALOG_PUBLISH'
  | 'PRICE_LIST_DRAFT_READ'
  | 'PRICE_LIST_DRAFT_WRITE'
  | 'PRICE_LIST_PUBLISH'
  | 'CHARGE_CATALOG_SUBMIT'
  | 'CHARGE_CATALOG_REVIEW'
  | 'CHARGE_CATALOG_APPROVE'
  | 'PRICE_LIST_SUBMIT'
  | 'PRICE_LIST_REVIEW'
  | 'PRICE_LIST_APPROVE'
  | 'DEPARTMENT_MASTER_DRAFT_READ'
  | 'DEPARTMENT_MASTER_DRAFT_WRITE'
  | 'DEPARTMENT_MASTER_SUBMIT'
  | 'DEPARTMENT_MASTER_REVIEW'
  | 'DEPARTMENT_MASTER_APPROVE'
  | 'DEPARTMENT_MASTER_PUBLISH'
  | 'DEPARTMENT_HIERARCHY_DRAFT_READ'
  | 'DEPARTMENT_HIERARCHY_DRAFT_WRITE'
  | 'DEPARTMENT_HIERARCHY_SUBMIT'
  | 'DEPARTMENT_HIERARCHY_REVIEW'
  | 'DEPARTMENT_HIERARCHY_APPROVE'
  | 'DEPARTMENT_HIERARCHY_PUBLISH'
  | 'CAMPUS_PRICE_CONFIRM'
  | 'SCHEMA_UPGRADE_SUBMIT'
  | 'SCHEMA_UPGRADE_APPROVE'
  | 'PRICE_RESOLVE'
  | 'CONSUMER_SUBSCRIPTION_MANAGE'
  | 'AUDIT_READ'
  | 'EMERGENCY_SUSPEND'
  | 'IMPACT_REVIEW'
  | 'RECOVERY_APPROVE';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly explanationCode: 'EXPLICIT_DENY' | 'MATCHING_ALLOW' | 'NO_MATCHING_GRANT';
}

export interface AuthorizationModule {
  requireObjectPermission(command: {
    readonly governanceObjectId: string;
    readonly permissionCode: ObjectPermissionCode;
    readonly campusId?: string | null;
  }): Promise<void>;
  evaluateObjectPermission(command: {
    readonly governanceObjectId: string;
    readonly permissionCode: ObjectPermissionCode;
    readonly campusId?: string | null;
  }): Promise<AuthorizationDecision>;
}

export function createAuthorizationModule(
  database: Kysely<DB>,
  context: RequestContext,
  decisionDatabase: Kysely<DB> = database,
): AuthorizationModule {
  const module: AuthorizationModule = {
    async evaluateObjectPermission(command) {
      const requestedScopeLevel = command.campusId ? 'CAMPUS' : 'HOSPITAL';
      const result = await sql<{ readonly has_deny: boolean; readonly has_allow: boolean }>`
        with applicable as (
          select distinct on (scope_level, campus_id)
            grant_effect, scope_level, campus_id
          from access_control.object_permission_grant
          where governance_object_id = ${command.governanceObjectId}::uuid
            and security_principal_id = ${context.actorPrincipalId}::uuid
            and permission_code = ${command.permissionCode}
            and valid_from <= ${context.occurredAt}::timestamp
            and (valid_to is null or valid_to > ${context.occurredAt}::timestamp)
            and (
              (${command.campusId ?? null}::uuid is null and scope_level = 'HOSPITAL')
              or (
                ${command.campusId ?? null}::uuid is not null
                and (
                  scope_level = 'HOSPITAL'
                  or (scope_level = 'CAMPUS' and campus_id = ${command.campusId ?? null}::uuid)
                )
              )
            )
          order by scope_level, campus_id, grant_sequence desc
        )
        select
          coalesce(bool_or(grant_effect = 'DENY'), false) as has_deny,
          coalesce(bool_or(grant_effect = 'ALLOW'), false) as has_allow
        from applicable
      `.execute(database);
      const row = result.rows[0] ?? { has_deny: false, has_allow: false };
      const decision: AuthorizationDecision = row.has_deny
        ? { allowed: false, explanationCode: 'EXPLICIT_DENY' }
        : row.has_allow
          ? { allowed: true, explanationCode: 'MATCHING_ALLOW' }
          : { allowed: false, explanationCode: 'NO_MATCHING_GRANT' };
      await sql`
        insert into access_control.authorization_decision (
          governance_object_id, security_principal_id, permission_code,
          requested_scope_level, requested_campus_id, decision, explanation_code,
          request_id, correlation_id, decided_at
        ) values (
          ${command.governanceObjectId}::uuid,
          ${context.actorPrincipalId}::uuid,
          ${command.permissionCode},
          ${requestedScopeLevel},
          ${command.campusId ?? null}::uuid,
          ${decision.allowed ? 'ALLOW' : 'DENY'},
          ${decision.explanationCode},
          ${context.requestId},
          ${context.correlationId},
          ${context.occurredAt}::timestamp
        )
      `.execute(decisionDatabase);
      return decision;
    },

    async requireObjectPermission(command) {
      const decision = await module.evaluateObjectPermission(command);
      if (!decision.allowed) throw new Error('OBJECT_PERMISSION_FORBIDDEN');
    },
  };
  return module;
}
