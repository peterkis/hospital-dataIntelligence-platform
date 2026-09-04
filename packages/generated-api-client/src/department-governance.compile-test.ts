import {
  createGovernanceApiClient,
  type GovernanceApiOperations,
  type GovernanceApiPaths,
} from './index.js';

// Typechecked only; never invoked, emitted in builds, or connected to a server.
export async function departmentGovernanceContractCompileTest(
  client: ReturnType<typeof createGovernanceApiClient>,
  input: {
    readonly list: GovernanceApiOperations['listPublishedDepartments']['parameters'];
    readonly draft: GovernanceApiOperations['createDepartmentDraft']['requestBody']['content']['application/json'];
    readonly draftParameters: GovernanceApiOperations['createDepartmentDraft']['parameters'];
    readonly submission: GovernanceApiOperations['submitDepartmentGovernance']['requestBody']['content']['application/json'];
    readonly submissionParameters: GovernanceApiOperations['submitDepartmentGovernance']['parameters'];
    readonly review: GovernanceApiOperations['reviewDepartmentGovernance']['requestBody']['content']['application/json'];
    readonly reviewParameters: GovernanceApiOperations['reviewDepartmentGovernance']['parameters'];
    readonly approval: GovernanceApiOperations['approveDepartmentGovernance']['requestBody']['content']['application/json'];
    readonly approvalParameters: GovernanceApiOperations['approveDepartmentGovernance']['parameters'];
    readonly detail: GovernanceApiOperations['getPublishedDepartment']['parameters'];
  },
): Promise<void> {
  const listPublishedDepartments = await client.GET('/v1/department-governance/departments', { params: input.list });
  const createDepartmentDraft = await client.POST('/v1/department-governance/department-drafts', {
    params: input.draftParameters, body: input.draft,
  });
  const submitDepartmentGovernance = await client.POST('/v1/department-governance/departments/{departmentId}/versions/{departmentVersionId}/submissions', {
    params: input.submissionParameters, body: input.submission,
  });
  const reviewDepartmentGovernance = await client.POST('/v1/department-governance/requests/{governanceRequestId}/reviews', {
    params: input.reviewParameters, body: input.review,
  });
  const approveDepartmentGovernance = await client.POST('/v1/department-governance/requests/{governanceRequestId}/approvals', {
    params: input.approvalParameters, body: input.approval,
  });
  const getPublishedDepartment = await client.GET('/v1/department-governance/departments/{departmentId}', { params: input.detail });

  listPublishedDepartments.data satisfies GovernanceApiOperations['listPublishedDepartments']['responses'][200]['content']['application/json'] | undefined;
  createDepartmentDraft.data satisfies GovernanceApiOperations['createDepartmentDraft']['responses'][201]['content']['application/json'] | undefined;
  submitDepartmentGovernance.data satisfies GovernanceApiOperations['submitDepartmentGovernance']['responses'][201]['content']['application/json'] | undefined;
  reviewDepartmentGovernance.data satisfies GovernanceApiOperations['reviewDepartmentGovernance']['responses'][200]['content']['application/json'] | undefined;
  approveDepartmentGovernance.data satisfies GovernanceApiOperations['approveDepartmentGovernance']['responses'][200]['content']['application/json'] | undefined;
  getPublishedDepartment.data satisfies GovernanceApiOperations['getPublishedDepartment']['responses'][200]['content']['application/json'] | undefined;

  // These paths must continue to reference the stable generated operation names.
  input.reviewParameters satisfies GovernanceApiPaths['/v1/department-governance/requests/{governanceRequestId}/reviews']['post']['parameters'];
  input.approvalParameters satisfies GovernanceApiPaths['/v1/department-governance/requests/{governanceRequestId}/approvals']['post']['parameters'];
}
