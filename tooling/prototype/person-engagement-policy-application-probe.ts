import assert from 'node:assert/strict';
import { createEngagementPolicyApplication } from '../../apps/governance-api/src/composition/create-engagement-policy-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import {
  ENGAGEMENT_POLICY_FIXTURE,
  engagementPolicyContext,
  seedEngagementPolicyPermissions,
  seedSyntheticEngagementPolicy,
} from './person-engagement-policy-fixture.js';

const handle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-pv006-b02-policy-application-probe',
  max: 4,
});

try {
  await seedEngagementPolicyPermissions(handle.database);
  const application = createEngagementPolicyApplication(handle.database,
    engagementPolicyContext('PV006-B02-TYPE-PERMANENT-EMPLOYEE-V1'));
  const version = await application.appendEngagementTypeVersion({
    governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
    typeCode: 'PERMANENT_EMPLOYEE', expectedCurrentVersionId: null,
    categoryCode: 'LABOR_OR_HR', displayName: 'SYNTHETIC PERMANENT EMPLOYEE',
    businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
  });
  assert.equal(version.typeCode, 'PERMANENT_EMPLOYEE');
  assert.equal(version.versionNo, '1');
  assert.deepEqual(await application.listEngagementTypeVersions({
    governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
    typeCode: 'PERMANENT_EMPLOYEE',
  }), [version]);
  const policy = await seedSyntheticEngagementPolicy(handle.database);
  assert.equal(policy.types.size, 9);
  assert.deepEqual(new Set([...policy.types.values()].map((history) => history[0]!.categoryCode)),
    new Set(['LABOR_OR_HR', 'DISPATCH_OR_SERVICE', 'EXTERNAL_PROFESSIONAL', 'TRAINING_OR_LEARNING']));
  assert.equal(policy.types.get('RESIDENT_TRAINEE')?.length, 2);
  assert.equal(policy.rules.get('CONTRACT_EMPLOYEE/CONTRACT_EMPLOYEE')?.[0]?.decision, 'ALLOW');
  assert.equal(policy.rules.get('CONTRACT_EMPLOYEE/PERMANENT_EMPLOYEE')?.[0]?.decision, 'FORBID');
  assert.equal(policy.rules.get('CONSULTATION_EXPERT/CONTRACT_EMPLOYEE')?.[0]?.decision, 'REVIEW_REQUIRED');
  assert.equal(policy.rules.has('INTERN/REEMPLOYED_PERSONNEL'), false);
  const recordedHistory = policy.rules.get('EXTERNAL_EXPERT/VISITING_TRAINEE')!;
  assert.equal(recordedHistory.length, 2);
  const reader = createEngagementPolicyApplication(handle.database,
    engagementPolicyContext('PV006-B02-RULE-AS-OF'));
  const oldRule = await reader.findEngagementOverlapRuleAsOf({
    governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
    leftEngagementTypeCode: 'VISITING_TRAINEE', rightEngagementTypeCode: 'EXTERNAL_EXPERT',
    businessAt: '2026-06-01T00:00:00', recordAsOf: recordedHistory[0]!.recordedFrom,
  });
  const currentRule = await reader.findEngagementOverlapRuleAsOf({
    governanceObjectId: ENGAGEMENT_POLICY_FIXTURE.objectId,
    leftEngagementTypeCode: 'EXTERNAL_EXPERT', rightEngagementTypeCode: 'VISITING_TRAINEE',
    businessAt: '2026-06-01T00:00:00', recordAsOf: recordedHistory[1]!.recordedFrom,
  });
  assert.equal(oldRule?.decision, 'ALLOW');
  assert.equal(currentRule?.decision, 'FORBID');
  assert.equal(oldRule?.engagementOverlapRuleId, currentRule?.engagementOverlapRuleId);
  process.stdout.write(`${JSON.stringify({ status: 'PASSED', typeDefinitions: policy.types.size,
    categories: 4, representativeRuleDecisions: 3, missingRulePairs: 1,
    versionedRuleHistory: recordedHistory.length, typeVersion: version.versionNo })}\n`);
} finally {
  await handle.close();
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
