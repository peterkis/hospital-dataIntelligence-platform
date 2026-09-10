import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createEngagementPolicyApplication } from '../../apps/governance-api/src/composition/create-engagement-policy-application.js';
import type {
  EngagementCategoryCode,
  EngagementOverlapDecision,
  EngagementOverlapRuleVersion,
  EngagementTypeVersion,
} from '../../apps/governance-api/src/modules/person-master/index.js';
import { personContext } from './person-subject-fixture.js';
import { ENGAGEMENT_FIXTURE, seedEngagementScope } from './person-engagement-fixture.js';

export const ENGAGEMENT_POLICY_FIXTURE = {
  ...ENGAGEMENT_FIXTURE,
  classification: 'SYNTHETIC / NON_PRODUCTION',
  policyBoundary: 'TEST POLICY ONLY - NOT HOSPITAL HR POLICY',
  policyOwnerId: '76040000-0000-7000-8000-000000000002',
} as const;

export const engagementPolicyContext = (requestId: string) =>
  personContext(requestId, ENGAGEMENT_POLICY_FIXTURE.policyOwnerId);

export async function seedEngagementPolicyPermissions(database: Kysely<DB>): Promise<void> {
  await seedEngagementScope(database);
  await database.transaction().execute(async (tx) => {
    await tx.insertInto('platform.security_principal').values({
      security_principal_id: ENGAGEMENT_POLICY_FIXTURE.policyOwnerId,
      principal_code: 'SYNTHETIC-NON-PRODUCTION-ENGAGEMENT-POLICY-OWNER',
      principal_kind: 'PERSON', status: 'ACTIVE',
    }).onConflict((conflict) => conflict.column('security_principal_id').doNothing()).execute();
    for (const permissionCode of [
      'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ',
      'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE',
      'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ',
      'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE',
    ] as const) {
      const prior = await tx.selectFrom('access_control.object_permission_grant')
        .select('object_permission_grant_id')
        .where('governance_object_id', '=', ENGAGEMENT_POLICY_FIXTURE.objectId)
        .where('security_principal_id', '=', ENGAGEMENT_POLICY_FIXTURE.policyOwnerId)
        .where('permission_code', '=', permissionCode).executeTakeFirst();
      if (!prior) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: ENGAGEMENT_POLICY_FIXTURE.objectId,
        security_principal_id: ENGAGEMENT_POLICY_FIXTURE.policyOwnerId,
        permission_code: permissionCode, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: ENGAGEMENT_POLICY_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION PV-006-B-02 policy boundary',
        valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
}

export async function seedSyntheticEngagementPolicy(database: Kysely<DB>): Promise<{
  readonly types: ReadonlyMap<string, readonly EngagementTypeVersion[]>;
  readonly rules: ReadonlyMap<string, readonly EngagementOverlapRuleVersion[]>;
}> {
  await seedEngagementPolicyPermissions(database);
  const typeSpecs: readonly [string, EngagementCategoryCode, string, string | null][] = [
    ['PERMANENT_EMPLOYEE', 'LABOR_OR_HR', 'SYNTHETIC PERMANENT EMPLOYEE', null],
    ['CONTRACT_EMPLOYEE', 'LABOR_OR_HR', 'SYNTHETIC CONTRACT EMPLOYEE', null],
    ['REEMPLOYED_PERSONNEL', 'LABOR_OR_HR', 'SYNTHETIC REEMPLOYED PERSONNEL', null],
    ['DISPATCHED_PERSONNEL', 'DISPATCH_OR_SERVICE', 'SYNTHETIC DISPATCHED PERSONNEL', null],
    ['EXTERNAL_EXPERT', 'EXTERNAL_PROFESSIONAL', 'SYNTHETIC EXTERNAL EXPERT', null],
    ['CONSULTATION_EXPERT', 'EXTERNAL_PROFESSIONAL', 'SYNTHETIC CONSULTATION EXPERT', null],
    ['VISITING_TRAINEE', 'TRAINING_OR_LEARNING', 'SYNTHETIC VISITING TRAINEE', null],
    ['RESIDENT_TRAINEE', 'TRAINING_OR_LEARNING', 'SYNTHETIC RESIDENT TRAINEE', '2030-01-01T00:00:00'],
    ['INTERN', 'TRAINING_OR_LEARNING', 'SYNTHETIC INTERN', null],
  ];
  const types = new Map<string, readonly EngagementTypeVersion[]>();
  for (const [typeCode, categoryCode, displayName, businessValidTo] of typeSpecs) {
    const requestId = `PV006-B02-TYPE-${typeCode}-V1`;
    const application = createEngagementPolicyApplication(database, engagementPolicyContext(requestId));
    let history = await application.listEngagementTypeVersions({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId, typeCode,
    });
    if (history.length === 0) {
      await application.appendEngagementTypeVersion({
        governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId, typeCode,
        expectedCurrentVersionId: null, categoryCode, displayName,
        businessValidFrom: '2020-01-01T00:00:00', businessValidTo,
      });
      history = await application.listEngagementTypeVersions({
        governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId, typeCode,
      });
    }
    types.set(typeCode, history);
  }

  let residentHistory = types.get('RESIDENT_TRAINEE')!;
  if (residentHistory.length === 1) {
    const application = createEngagementPolicyApplication(database,
      engagementPolicyContext('PV006-B02-TYPE-RESIDENT-TRAINEE-V2'));
    await application.appendEngagementTypeVersion({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
      typeCode: 'RESIDENT_TRAINEE',
      expectedCurrentVersionId: residentHistory[0]!.engagementTypeVersionId,
      categoryCode: 'TRAINING_OR_LEARNING',
      displayName: 'SYNTHETIC RESIDENT TRAINEE FUTURE DEFINITION',
      businessValidFrom: '2030-01-01T00:00:00', businessValidTo: null,
    });
    residentHistory = await application.listEngagementTypeVersions({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId, typeCode: 'RESIDENT_TRAINEE',
    });
    types.set('RESIDENT_TRAINEE', residentHistory);
  }

  const ruleSpecs: readonly [string, string, EngagementOverlapDecision][] = [
    ['CONTRACT_EMPLOYEE', 'CONTRACT_EMPLOYEE', 'ALLOW'],
    ['CONTRACT_EMPLOYEE', 'PERMANENT_EMPLOYEE', 'FORBID'],
    ['CONTRACT_EMPLOYEE', 'CONSULTATION_EXPERT', 'REVIEW_REQUIRED'],
    ['EXTERNAL_EXPERT', 'VISITING_TRAINEE', 'ALLOW'],
  ];
  const rules = new Map<string, readonly EngagementOverlapRuleVersion[]>();
  for (const [leftEngagementTypeCode, rightEngagementTypeCode, decision] of ruleSpecs) {
    const pair = [leftEngagementTypeCode, rightEngagementTypeCode].sort().join('/');
    const requestId = `PV006-B02-RULE-${pair.replace('/', '-')}-V1`;
    const application = createEngagementPolicyApplication(database, engagementPolicyContext(requestId));
    let history = await application.listEngagementOverlapRuleVersions({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
      leftEngagementTypeCode, rightEngagementTypeCode,
    });
    if (history.length === 0) {
      await application.appendEngagementOverlapRuleVersion({
        governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
        leftEngagementTypeCode, rightEngagementTypeCode,
        expectedCurrentVersionId: null, decision,
        businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
      });
      history = await application.listEngagementOverlapRuleVersions({
        governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
        leftEngagementTypeCode, rightEngagementTypeCode,
      });
    }
    rules.set(pair, history);
  }

  const historyPair = 'EXTERNAL_EXPERT/VISITING_TRAINEE';
  let historyRule = rules.get(historyPair)!;
  if (historyRule.length === 1) {
    const application = createEngagementPolicyApplication(database,
      engagementPolicyContext('PV006-B02-RULE-EXTERNAL-EXPERT-VISITING-TRAINEE-V2'));
    await application.appendEngagementOverlapRuleVersion({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
      leftEngagementTypeCode: 'VISITING_TRAINEE',
      rightEngagementTypeCode: 'EXTERNAL_EXPERT',
      expectedCurrentVersionId: historyRule[0]!.engagementOverlapRuleVersionId,
      decision: 'FORBID', businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
    });
    historyRule = await application.listEngagementOverlapRuleVersions({
      governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
      leftEngagementTypeCode: 'EXTERNAL_EXPERT', rightEngagementTypeCode: 'VISITING_TRAINEE',
    });
    rules.set(historyPair, historyRule);
  }
  return { types, rules };
}
