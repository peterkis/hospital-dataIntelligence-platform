import { createGovernanceApiClient, type GovernanceApiOperations } from './index.js';

type SubscriptionBody = GovernanceApiOperations['createPhase01ConsumerSubscription']['requestBody']['content']['application/json'];
type VersionBody = GovernanceApiOperations['createPhase01ConsumerSubscriptionVersion']['requestBody']['content']['application/json'];

// Compile only: no requests are executed or emitted in the client build.
export async function departmentConsumerContractCompileTest(
  client: ReturnType<typeof createGovernanceApiClient>,
  ids: { governanceObjectId: string; subscriptionId: string; servicePrincipalId: string },
  csrfToken: string,
) {
  const master = {
    subscriptionCode: 'SYNTHETIC-MASTER', servicePrincipalId: ids.servicePrincipalId,
    governanceObjectId: ids.governanceObjectId,
    projectionType: 'hdi.department-master', projectionSchemaVersion: '1',
  } satisfies SubscriptionBody;
  const hierarchy = {
    ...master, projectionType: 'hdi.department-hierarchy',
  } satisfies SubscriptionBody;
  for (const body of [master, hierarchy]) {
    await client.POST('/v1/phase-01/consumer-subscriptions', {
      params: { header: { 'x-csrf-token': csrfToken } }, body,
    });
  }
  for (const projectionType of ['hdi.department-master', 'hdi.department-hierarchy'] as const) {
    const body = {
      governanceObjectId: ids.governanceObjectId, projectionType, projectionSchemaVersion: '1',
    } satisfies VersionBody;
    await client.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions', {
      params: { path: { subscriptionId: ids.subscriptionId }, header: { 'x-csrf-token': csrfToken } }, body,
    });
  }
  // @ts-expect-error Department V1 cannot be combined with Price List V2.
  const invalidMaster: SubscriptionBody = { ...master, projectionSchemaVersion: '2' };
  // @ts-expect-error Hierarchy V1 cannot be combined with legacy Price List V0.
  const invalidHierarchy: VersionBody = { governanceObjectId: ids.governanceObjectId, projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '0' };
  return { invalidMaster, invalidHierarchy };
}
