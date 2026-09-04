import { createGovernanceApiClient, type GovernanceApiOperations } from './index.js';

type Operation = GovernanceApiOperations['changePhase01ConsumerSubscriptionLifecycle'];
type RequestBody = Operation['requestBody']['content']['application/json'];
type ResponseBody = Operation['responses'][200]['content']['application/json'];

export function compileConsumerLifecycle(client: ReturnType<typeof createGovernanceApiClient>,
  subscriptionId: string, governanceObjectId: string, csrfToken: string) {
  const arbitraryStatus: string = 'ACTIVE';
  // @ts-expect-error arbitrary strings must not satisfy the closed lifecycle union
  const arbitrary: RequestBody = { governanceObjectId, targetStatus: arbitraryStatus };
  const suspended: RequestBody = { governanceObjectId, targetStatus: 'SUSPENDED', reason: '合成维护窗口' };
  const resumed: RequestBody = { governanceObjectId, targetStatus: 'ACTIVE' };
  const revoked: RequestBody = { governanceObjectId, targetStatus: 'REVOKED' };
  const archived: RequestBody = { governanceObjectId, targetStatus: 'ARCHIVED' };
  // @ts-expect-error DRAFT has no lifecycle business meaning
  const draft: RequestBody = { governanceObjectId, targetStatus: 'DRAFT' };
  // @ts-expect-error lifecycle command cannot modify projection support
  const projection: RequestBody = { governanceObjectId, targetStatus: 'ACTIVE', projectionType: 'hdi.department-master' };
  // @ts-expect-error unsupported response lifecycle values are rejected
  const invalidResponse: ResponseBody = { subscriptionId, lifecycleStatus: 'INACTIVE', lifecycleChangedAt: '2026-09-04T12:00:00' };
  const response: ResponseBody = { subscriptionId, lifecycleStatus: 'SUSPENDED', lifecycleChangedAt: '2026-09-04T12:00:00' };
  void [arbitrary, resumed, revoked, archived, draft, projection, response, invalidResponse];
  return client.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions', {
    params: { path: { subscriptionId }, header: { 'x-csrf-token': csrfToken } }, body: suspended,
  });
}
