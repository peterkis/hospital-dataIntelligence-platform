import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  createScopedModules,
  type ScopedModules,
} from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import {
  createDepartmentGovernanceApplication,
  createDepartmentQueryService,
  departmentDtoLocalDateTime,
  DepartmentContractError,
} from '../../apps/governance-api/src/modules/department-master/index.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createCampusReferenceReader } from '../../apps/governance-api/src/platform/campus/campus-reference-reader.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import {
  createTransactionRunner,
  type RequestContext,
} from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

process.env['NODE_ENV'] = 'test';

const DEPARTMENT_OBJECT = '74000000-0000-7000-8000-000000000001';
const OTHER_GOVERNANCE_OBJECT = '74100000-0000-7000-8000-000000000001';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const noPublishOwnerId = randomUUID();
const handle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
  max: 2,
  application_name: 'hdi-department-application-probe',
});
const database = handle.database;
const transactionRunner = createTransactionRunner<ScopedModules>(database, (transaction, context) =>
  createScopedModules(transaction, context, database),
);
const workflowApplication = createWorkflowApplication(transactionRunner);
const queryService = createDepartmentQueryService(database, createCampusReferenceReader(database));
const checks: Record<string, boolean> = {};

try {
  await installSyntheticAuthorizationFixtures();

  const success = await createAndSubmit('SUCCESS');
  const stewardReviewDenied = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.actorPrincipalId, 'SUCCESS', 'STEWARD-REVIEW').execute({
      commandName: 'ReviewDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: success.governanceRequestId,
      departmentId: success.departmentId,
      departmentVersionId: success.departmentVersionId,
      seenContentHash: success.contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC STEWARD REVIEW DENIAL',
    }),
  );
  checks['stewardCannotReview'] = stewardReviewDenied === 'DEPARTMENT_PERMISSION_DENIED';
  const reviewed = await reviewApproved(success, 'SUCCESS');
  assert.equal(reviewed.status, 'AWAITING_FINAL');
  const stewardApprovalDenied = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.actorPrincipalId, 'SUCCESS', 'STEWARD-APPROVE').execute({
      commandName: 'ApproveDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: success.governanceRequestId,
      departmentId: success.departmentId,
      departmentVersionId: success.departmentVersionId,
      seenContentHash: success.contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC STEWARD OWNER DENIAL',
    }),
  );
  checks['stewardCannotApprove'] = stewardApprovalDenied === 'DEPARTMENT_PERMISSION_DENIED';
  const stewardPublishDenied = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.actorPrincipalId, 'SUCCESS', 'STEWARD-PUBLISH').execute({
      commandName: 'PublishDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: success.governanceRequestId,
      departmentId: success.departmentId,
      departmentVersionId: success.departmentVersionId,
      approvedContentHash: success.contentHash,
    }),
  );
  checks['stewardCannotPublish'] = stewardPublishDenied === 'DEPARTMENT_PERMISSION_DENIED';
  const reviewerApprovalDenied = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'SUCCESS', 'REVIEWER-APPROVE').execute(
      {
        commandName: 'ApproveDepartment',
        governanceObjectId: DEPARTMENT_OBJECT,
        governanceRequestId: success.governanceRequestId,
        departmentId: success.departmentId,
        departmentVersionId: success.departmentVersionId,
        seenContentHash: success.contentHash,
        decision: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC REVIEWER OWNER DENIAL',
      },
    ),
  );
  checks['reviewerCannotOwnerApprove'] = reviewerApprovalDenied === 'DEPARTMENT_PERMISSION_DENIED';
  const published = await scopedApplication(
    PROTOTYPE_FIXTURE.approverPrincipalId,
    'SUCCESS',
    'APPROVE',
  ).execute({
    commandName: 'ApproveDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: success.governanceRequestId,
    departmentId: success.departmentId,
    departmentVersionId: success.departmentVersionId,
    seenContentHash: success.contentHash,
    decision: 'APPROVED',
    reason: 'PROTOTYPE SYNTHETIC OWNER FINAL APPROVAL',
  });
  assert.equal(published.status, 'PUBLISHED');

  const beforeConfirmation = await artifactCounts(success);
  const publishedDto = await scopedApplication(
    PROTOTYPE_FIXTURE.actorPrincipalId,
    'SUCCESS',
    'READ',
  ).getPublishedDepartment({
    governanceObjectId: DEPARTMENT_OBJECT,
    departmentId: success.departmentId,
  });
  const confirmation = await scopedApplication(
    PROTOTYPE_FIXTURE.approverPrincipalId,
    'SUCCESS',
    'PUBLISH-CONFIRM',
  ).execute({
    commandName: 'PublishDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: success.governanceRequestId,
    departmentId: success.departmentId,
    departmentVersionId: success.departmentVersionId,
    approvedContentHash: success.contentHash,
  });
  const repeatedConfirmation = await scopedApplication(
    PROTOTYPE_FIXTURE.approverPrincipalId,
    'SUCCESS',
    'PUBLISH-CONFIRM-REPEAT',
  ).execute({
    commandName: 'PublishDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: success.governanceRequestId,
    departmentId: success.departmentId,
    departmentVersionId: success.departmentVersionId,
    approvedContentHash: success.contentHash,
  });
  const afterConfirmation = await artifactCounts(success);
  checks['completeSuccessChain'] =
    published.status === 'PUBLISHED' &&
    confirmation.status === 'PUBLISHED' &&
    repeatedConfirmation.status === 'PUBLISHED';
  checks['publishedReadModelQueryable'] =
    publishedDto.departmentId === success.departmentId &&
    publishedDto.contentHash === success.contentHash;
  checks['applicationTimeHasNoZone'] = !/[Zz]|[+-]\d{2}:\d{2}$/u.test(publishedDto.publishedAt);
  checks['publishConfirmationIdempotent'] = sameCounts(beforeConfirmation, afterConfirmation);
  checks['successArtifactsExactlyOnce'] =
    beforeConfirmation.releaseCount === 1 &&
    beforeConfirmation.projectionCount === 1 &&
    beforeConfirmation.publishedAuditCount === 1;
  checks['successProjectionHashMatches'] =
    beforeConfirmation.versionHash === success.contentHash &&
    beforeConfirmation.projectionHash === success.contentHash &&
    beforeConfirmation.workflowHash === success.contentHash;
  checks['auditOrder'] = await hasExpectedAuditOrder(success, 'SUCCESS');
  checks['stableIdentityUnique'] = (await countDepartmentsByCode(success.departmentCode)) === 1;
  checks['workflowApproved'] = (await workflowStatus(success.governanceRequestId)) === 'APPROVED';
  checks['versionPublished'] = (await versionStatus(success.departmentVersionId)) === 'PUBLISHED';

  const missingPublish = await createAndSubmit('NO-PUBLISH');
  await reviewApproved(missingPublish, 'NO-PUBLISH');
  const missingPublishError = await expectDepartmentError(
    scopedApplication(noPublishOwnerId, 'NO-PUBLISH', 'APPROVE').execute({
      commandName: 'ApproveDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: missingPublish.governanceRequestId,
      departmentId: missingPublish.departmentId,
      departmentVersionId: missingPublish.departmentVersionId,
      seenContentHash: missingPublish.contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC APPROVE WITHOUT PUBLISH',
    }),
  );
  checks['missingPublishPermissionDenied'] = missingPublishError === 'DEPARTMENT_PERMISSION_DENIED';
  checks['missingPublishRollsBackApproval'] = await finalApprovalRolledBack(missingPublish);

  const releaseFailure = await createReviewed('RELEASE-FAIL');
  configureControlledPublicationFault('RELEASE_ENVELOPE_WRITTEN');
  try {
    await approveExpectedFailure(releaseFailure, 'RELEASE-FAIL');
  } finally {
    configureControlledPublicationFault(null);
  }
  checks['releaseFailureRollsBackAll'] = await finalApprovalRolledBack(releaseFailure);

  const projectionFailure = await createReviewed('PROJECTION-FAIL');
  configureControlledPublicationFault('DOMAIN_CANDIDATE_CONFIRMED');
  try {
    await approveExpectedFailure(projectionFailure, 'PROJECTION-FAIL');
  } finally {
    configureControlledPublicationFault(null);
  }
  checks['projectionFailureRollsBackAll'] = await finalApprovalRolledBack(projectionFailure);

  const auditFailure = await createReviewed('AUDIT-FAIL');
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN', 2);
  try {
    await approveExpectedFailure(auditFailure, 'AUDIT-FAIL');
  } finally {
    configureControlledPublicationFault(null);
  }
  checks['auditFailureRollsBackAll'] = await finalApprovalRolledBack(auditFailure);

  const drift = await createAndSubmit('DRIFT');
  await transactionRunner.run(
    context(PROTOTYPE_FIXTURE.actorPrincipalId, 'DRIFT', 'MUTATE'),
    async (modules) => {
      const current = await modules.departmentMaster.getDepartmentVersion({
        governanceObjectId: DEPARTMENT_OBJECT,
        departmentId: drift.departmentId,
        departmentVersionId: drift.departmentVersionId,
      });
      await modules.departmentMaster.updateDepartmentDraft({
        ...current,
        governanceObjectId: DEPARTMENT_OBJECT,
        departmentId: drift.departmentId,
        departmentVersionId: drift.departmentVersionId,
        standardName: `${current.standardName}-DRIFT`,
        actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId,
      });
    },
  );
  const driftError = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'DRIFT', 'REVIEW').execute({
      commandName: 'ReviewDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: drift.governanceRequestId,
      departmentId: drift.departmentId,
      departmentVersionId: drift.departmentVersionId,
      seenContentHash: drift.contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC STALE REVIEW',
    }),
  );
  checks['contentDriftRejected'] =
    driftError === 'DEPARTMENT_CONTENT_CHANGED' &&
    (await workflowStatus(drift.governanceRequestId)) === 'SUBMITTED' &&
    (await artifactCounts(drift)).releaseCount === 0;

  const directApproval = await createAndSubmit('DIRECT-APPROVAL');
  const directApprovalError = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.approverPrincipalId, 'DIRECT-APPROVAL', 'APPROVE').execute({
      commandName: 'ApproveDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: directApproval.governanceRequestId,
      departmentId: directApproval.departmentId,
      departmentVersionId: directApproval.departmentVersionId,
      seenContentHash: directApproval.contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC DIRECT OWNER APPROVAL',
    }),
  );
  checks['ownerCannotSkipProfessionalReview'] =
    directApprovalError === 'DEPARTMENT_STATUS_INVALID' &&
    (await finalApprovalRolledBack(directApproval, 'SUBMITTED'));

  const rejected = await createReviewed('REJECTED');
  const rejectedResult = await scopedApplication(
    PROTOTYPE_FIXTURE.approverPrincipalId,
    'REJECTED',
    'APPROVE',
  ).execute({
    commandName: 'ApproveDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: rejected.governanceRequestId,
    departmentId: rejected.departmentId,
    departmentVersionId: rejected.departmentVersionId,
    seenContentHash: rejected.contentHash,
    decision: 'REJECTED',
    reason: 'PROTOTYPE SYNTHETIC OWNER REJECTION',
  });
  const rejectedCounts = await artifactCounts(rejected);
  checks['ownerRejectionLeavesDraft'] =
    rejectedResult.status === 'REJECTED' &&
    (await workflowStatus(rejected.governanceRequestId)) === 'REJECTED' &&
    (await versionStatus(rejected.departmentVersionId)) === 'DRAFT' &&
    rejectedCounts.releaseCount === 0 &&
    rejectedCounts.projectionCount === 0 &&
    rejectedCounts.publishedAuditCount === 0;

  const reviewRejected = await createAndSubmit('REVIEW-REJECTED');
  const reviewRejectedResult = await scopedApplication(
    PROTOTYPE_FIXTURE.reviewerPrincipalId,
    'REVIEW-REJECTED',
    'REVIEW',
  ).execute({
    commandName: 'ReviewDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: reviewRejected.governanceRequestId,
    departmentId: reviewRejected.departmentId,
    departmentVersionId: reviewRejected.departmentVersionId,
    seenContentHash: reviewRejected.contentHash,
    decision: 'REJECTED',
    reason: 'PROTOTYPE SYNTHETIC PROFESSIONAL REJECTION',
  });
  const reviewRejectedCounts = await artifactCounts(reviewRejected);
  checks['professionalRejectionLeavesDraft'] =
    reviewRejectedResult.status === 'REJECTED' &&
    (await workflowStatus(reviewRejected.governanceRequestId)) === 'REJECTED' &&
    (await versionStatus(reviewRejected.departmentVersionId)) === 'DRAFT' &&
    reviewRejectedCounts.releaseCount === 0 &&
    reviewRejectedCounts.projectionCount === 0 &&
    reviewRejectedCounts.publishedAuditCount === 0;

  const mappingDepartment = await createAndSubmit('MAPPING', false);
  const mapping = await transactionRunner.run(
    context(PROTOTYPE_FIXTURE.actorPrincipalId, 'MAPPING', 'ADD'),
    (modules) =>
      modules.departmentMaster.addSourceMapping({
        governanceObjectId: DEPARTMENT_OBJECT,
        departmentId: mappingDepartment.departmentId,
        sourceSystem: 'HIS',
        sourceDepartmentCode: `PV005A4-${suffix}`,
        sourceDepartmentName: 'PROTOTYPE SYNTHETIC DEPARTMENT',
        matchMethod: 'MANUAL',
      }),
  );
  const mappingBefore = { ...mapping };
  const wrongObjectError = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'MAPPING', 'WRONG-OBJECT').execute({
      commandName: 'ConfirmSourceMapping',
      governanceObjectId: OTHER_GOVERNANCE_OBJECT,
      departmentId: mappingDepartment.departmentId,
      mappingId: mapping.id,
    }),
  );
  const mappingAfterWrongObject = await database
    .selectFrom('department_master.department_source_mapping')
    .select('mapping_status')
    .where('department_mapping_id', '=', mapping.id)
    .executeTakeFirstOrThrow();
  checks['wrongGovernanceObjectCannotConfirm'] =
    wrongObjectError === 'DEPARTMENT_NOT_FOUND' &&
    mappingAfterWrongObject.mapping_status === 'PENDING';
  await scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'MAPPING', 'CONFIRM').execute({
    commandName: 'ConfirmSourceMapping',
    governanceObjectId: DEPARTMENT_OBJECT,
    departmentId: mappingDepartment.departmentId,
    mappingId: mapping.id,
  });
  const mappingAfter = await database
    .selectFrom('department_master.department_source_mapping')
    .selectAll()
    .where('department_mapping_id', '=', mapping.id)
    .executeTakeFirstOrThrow();
  checks['confirmMappingUsesReview'] = mappingAfter.mapping_status === 'CONFIRMED';
  checks['confirmMappingAudited'] =
    (await countDepartmentAudit(mapping.id, 'DEPARTMENT_SOURCE_MAPPING_CONFIRMED')) === 1;
  checks['confirmMappingDoesNotRewriteBinding'] =
    mappingAfter.source_system === mappingBefore.sourceSystem &&
    mappingAfter.source_department_code === mappingBefore.sourceDepartmentCode &&
    mappingAfter.source_department_name === mappingBefore.sourceDepartmentName &&
    mappingAfter.department_id === mappingBefore.departmentId &&
    mappingAfter.match_method === mappingBefore.matchMethod;
  const repeatedMappingError = await expectDepartmentError(
    scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'MAPPING', 'CONFIRM-REPEAT').execute({
      commandName: 'ConfirmSourceMapping',
      governanceObjectId: DEPARTMENT_OBJECT,
      departmentId: mappingDepartment.departmentId,
      mappingId: mapping.id,
    }),
  );
  checks['mappingTerminalStateRejected'] = repeatedMappingError === 'DEPARTMENT_STATUS_INVALID';

  const rollbackMapping = await transactionRunner.run(
    context(PROTOTYPE_FIXTURE.actorPrincipalId, 'MAPPING', 'ADD-AUDIT-FAIL'),
    (modules) =>
      modules.departmentMaster.addSourceMapping({
        governanceObjectId: DEPARTMENT_OBJECT,
        departmentId: mappingDepartment.departmentId,
        sourceSystem: 'HIS',
        sourceDepartmentCode: `PV005A4-AUDIT-${suffix}`,
        sourceDepartmentName: 'PROTOTYPE SYNTHETIC AUDIT FAILURE MAPPING',
        matchMethod: 'MANUAL',
      }),
  );
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    const mappingAuditFailure = await expectAnyError(
      scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'MAPPING', 'AUDIT-FAIL').execute({
        commandName: 'ConfirmSourceMapping',
        governanceObjectId: DEPARTMENT_OBJECT,
        departmentId: mappingDepartment.departmentId,
        mappingId: rollbackMapping.id,
      }),
    );
    const rollbackMappingStatus = await database
      .selectFrom('department_master.department_source_mapping')
      .select('mapping_status')
      .where('department_mapping_id', '=', rollbackMapping.id)
      .executeTakeFirstOrThrow();
    checks['confirmMappingAuditFailureRollsBack'] =
      mappingAuditFailure &&
      rollbackMappingStatus.mapping_status === 'PENDING' &&
      (await countDepartmentAudit(
        rollbackMapping.id,
        'DEPARTMENT_SOURCE_MAPPING_CONFIRMED',
      )) === 0;
  } finally {
    configureControlledPublicationFault(null);
  }

  const bypassError = await expectDepartmentError(
    scopedApplication(noPublishOwnerId, 'NO-BYPASS', 'CREATE').execute(createCommand('NO-BYPASS')),
  );
  checks['noGlobalDepartmentAdminBypass'] = bypassError === 'DEPARTMENT_PERMISSION_DENIED';

  const prematurePublish = await createAndSubmit('PREMATURE-PUBLISH');
  const prematurePublishError = await expectDepartmentError(
    scopedApplication(
      PROTOTYPE_FIXTURE.approverPrincipalId,
      'PREMATURE-PUBLISH',
      'PUBLISH',
    ).execute({
      commandName: 'PublishDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: prematurePublish.governanceRequestId,
      departmentId: prematurePublish.departmentId,
      departmentVersionId: prematurePublish.departmentVersionId,
      approvedContentHash: prematurePublish.contentHash,
    }),
  );
  checks['publishBeforeApprovalRejected'] =
    prematurePublishError === 'DEPARTMENT_APPROVAL_REQUIRED';

  const migrationCount = Number(
    (
      await database
        .selectFrom('platform.schema_migration')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow()
    ).count,
  );
  const forbiddenTypes = await sql<{ readonly count: string }>`
    select count(*)::text as count
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_type data_type on data_type.oid = attribute.atttypid
    where namespace.nspname not in ('pg_catalog', 'information_schema')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and data_type.typname in ('timestamptz', 'timetz', 'tstzrange', 'tstzmultirange')
  `.execute(database);
  const forbiddenTimezoneTypeCount = Number(forbiddenTypes.rows[0]?.count ?? '-1');
  checks['migrationCountIs16'] = migrationCount === 16;
  checks['forbiddenTimezoneTypeCountIs0'] = forbiddenTimezoneTypeCount === 0;

  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error(
      `DEPARTMENT_APPLICATION_PROBE_FAILED:${JSON.stringify({
        checks,
        successArtifactCounts: beforeConfirmation,
      })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASSED',
      scenario: 'PV-005-A.4-R1',
      migrationCount,
      forbiddenTimezoneTypeCount,
      successArtifactCounts: beforeConfirmation,
      checks,
    })}\n`,
  );
} finally {
  configureControlledPublicationFault(null);
  await handle.close();
}

function scopedApplication(actorPrincipalId: string, scenario: string, action: string) {
  return createDepartmentGovernanceApplication({
    context: context(actorPrincipalId, scenario, action),
    transactionRunner,
    workflowApplication,
    queryService,
  });
}

function context(actorPrincipalId: string, scenario: string, action: string): RequestContext {
  return {
    actorPrincipalId,
    requestId: `PV005A4-${suffix}-${scenario}-${action}`,
    correlationId: `PV005A4-${suffix}-${scenario}`,
    occurredAt: '2026-09-03T22:00:00',
  };
}

function createCommand(scenario: string) {
  return {
    commandName: 'CreateDepartmentDraft' as const,
    governanceObjectId: DEPARTMENT_OBJECT,
    departmentCode: `PV005A4-${scenario}-${suffix}`,
    content: {
      standardName: `PROTOTYPE SYNTHETIC ${scenario} DEPARTMENT ${suffix}`,
      shortName: `SYN-${scenario}`,
      departmentType: 'CLINICAL' as const,
      subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE' as const,
      lifecycleStatus: 'ACTIVE' as const,
      businessValidFrom: departmentDtoLocalDateTime('2026-09-01T00:00:00'),
      businessValidTo: null,
      campusIds: [PROTOTYPE_FIXTURE.campusId],
    },
  };
}

async function createAndSubmit(scenario: string, submit = true) {
  const command = createCommand(scenario);
  const draft = await scopedApplication(
    PROTOTYPE_FIXTURE.actorPrincipalId,
    scenario,
    'CREATE',
  ).execute(command);
  assert.equal(draft.status, 'DRAFT');
  if (!submit) {
    return {
      ...draft,
      governanceRequestId: '',
      departmentCode: command.departmentCode,
    };
  }
  const submitted = await scopedApplication(
    PROTOTYPE_FIXTURE.actorPrincipalId,
    scenario,
    'SUBMIT',
  ).execute({
    commandName: 'SubmitDepartmentGovernance',
    governanceObjectId: DEPARTMENT_OBJECT,
    departmentId: draft.departmentId,
    departmentVersionId: draft.departmentVersionId,
    expectedContentHash: draft.contentHash,
    changeReason: `PROTOTYPE SYNTHETIC ${scenario} CHANGE`,
  });
  assert.equal(submitted.status, 'SUBMITTED');
  assert.ok(submitted.governanceRequestId);
  return {
    ...submitted,
    governanceRequestId: submitted.governanceRequestId,
    departmentCode: command.departmentCode,
  };
}

async function reviewApproved(
  candidate: Awaited<ReturnType<typeof createAndSubmit>>,
  scenario: string,
) {
  return scopedApplication(PROTOTYPE_FIXTURE.reviewerPrincipalId, scenario, 'REVIEW').execute({
    commandName: 'ReviewDepartment',
    governanceObjectId: DEPARTMENT_OBJECT,
    governanceRequestId: candidate.governanceRequestId,
    departmentId: candidate.departmentId,
    departmentVersionId: candidate.departmentVersionId,
    seenContentHash: candidate.contentHash,
    decision: 'APPROVED',
    reason: `PROTOTYPE SYNTHETIC ${scenario} PROFESSIONAL REVIEW`,
  });
}

async function createReviewed(scenario: string) {
  const candidate = await createAndSubmit(scenario);
  const result = await reviewApproved(candidate, scenario);
  assert.equal(result.status, 'AWAITING_FINAL');
  return candidate;
}

async function approveExpectedFailure(
  candidate: Awaited<ReturnType<typeof createAndSubmit>>,
  scenario: string,
): Promise<void> {
  let failed = false;
  try {
    await scopedApplication(PROTOTYPE_FIXTURE.approverPrincipalId, scenario, 'APPROVE').execute({
      commandName: 'ApproveDepartment',
      governanceObjectId: DEPARTMENT_OBJECT,
      governanceRequestId: candidate.governanceRequestId,
      departmentId: candidate.departmentId,
      departmentVersionId: candidate.departmentVersionId,
      seenContentHash: candidate.contentHash,
      decision: 'APPROVED',
      reason: `PROTOTYPE SYNTHETIC ${scenario} OWNER APPROVAL`,
    });
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
}

async function artifactCounts(candidate: {
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly governanceRequestId: string;
}) {
  const version = await database
    .selectFrom('department_master.department_version')
    .select(['governance_status', 'content_hash'])
    .where('department_version_id', '=', candidate.departmentVersionId)
    .executeTakeFirstOrThrow();
  const workflow = await database
    .selectFrom('workflow.change_request')
    .select('submitted_content_hash')
    .where('change_request_id', '=', candidate.governanceRequestId)
    .executeTakeFirstOrThrow();
  const projection = await database
    .selectFrom('department_master.department_published_projection')
    .select('content_hash')
    .where('department_version_id', '=', candidate.departmentVersionId)
    .executeTakeFirst();
  return {
    releaseCount: Number(
      (
        await database
          .selectFrom('release_distribution.release_member_department')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('department_version_id', '=', candidate.departmentVersionId)
          .executeTakeFirstOrThrow()
      ).count,
    ),
    projectionCount: Number(
      (
        await database
          .selectFrom('department_master.department_published_projection')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('department_version_id', '=', candidate.departmentVersionId)
          .executeTakeFirstOrThrow()
      ).count,
    ),
    publishedAuditCount: Number(
      (
        await database
          .selectFrom('audit.audit_event')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('stable_entity_id', '=', candidate.departmentVersionId)
          .where('action', '=', 'DEPARTMENT_PUBLISHED')
          .executeTakeFirstOrThrow()
      ).count,
    ),
    versionHash: version.content_hash.toString('hex'),
    projectionHash: projection?.content_hash.toString('hex') ?? null,
    workflowHash: workflow.submitted_content_hash.toString('hex'),
  };
}

async function finalApprovalRolledBack(
  candidate: Awaited<ReturnType<typeof createAndSubmit>>,
  expectedWorkflowStatus = 'AWAITING_FINAL',
): Promise<boolean> {
  const counts = await artifactCounts(candidate);
  const finalActions = Number(
    (
      await database
        .selectFrom('workflow.approval_action')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('change_request_id', '=', candidate.governanceRequestId)
        .where('stage_type', '=', 'OWNER_FINAL_APPROVAL')
        .executeTakeFirstOrThrow()
    ).count,
  );
  const approvedAudits = Number(
    (
      await database
        .selectFrom('audit.audit_event')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('stable_entity_id', '=', candidate.departmentVersionId)
        .where('action', '=', 'DEPARTMENT_APPROVED')
        .executeTakeFirstOrThrow()
    ).count,
  );
  return (
    (await workflowStatus(candidate.governanceRequestId)) === expectedWorkflowStatus &&
    finalActions === 0 &&
    approvedAudits === 0 &&
    (await versionStatus(candidate.departmentVersionId)) === 'DRAFT' &&
    counts.releaseCount === 0 &&
    counts.projectionCount === 0 &&
    counts.publishedAuditCount === 0
  );
}

async function hasExpectedAuditOrder(
  candidate: Awaited<ReturnType<typeof createAndSubmit>>,
  scenario: string,
): Promise<boolean> {
  const required = [
    'DEPARTMENT_CREATED',
    'DEPARTMENT_VERSION_CREATED',
    'DEPARTMENT_SUBMITTED',
    'DEPARTMENT_REVIEWED',
    'DEPARTMENT_APPROVED',
    'DEPARTMENT_PUBLISHED',
  ];
  const rows = await database
    .selectFrom('audit.audit_event')
    .select('action')
    .where('correlation_id', '=', `PV005A4-${suffix}-${scenario}`)
    .where('action', 'in', required)
    .orderBy('audit_sequence')
    .execute();
  return JSON.stringify(rows.map((row) => row.action)) === JSON.stringify(required);
}

async function expectDepartmentError(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof DepartmentContractError) return error.code;
    throw error;
  }
}

async function expectAnyError(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
}

async function countDepartmentAudit(aggregateId: string, action: string): Promise<number> {
  return Number(
    (
      await database
        .selectFrom('audit.audit_event')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('stable_entity_id', '=', aggregateId)
        .where('action', '=', action)
        .executeTakeFirstOrThrow()
    ).count,
  );
}

async function workflowStatus(changeRequestId: string): Promise<string> {
  return (
    await database
      .selectFrom('workflow.change_request')
      .select('request_status')
      .where('change_request_id', '=', changeRequestId)
      .executeTakeFirstOrThrow()
  ).request_status;
}

async function versionStatus(departmentVersionId: string): Promise<string> {
  return (
    await database
      .selectFrom('department_master.department_version')
      .select('governance_status')
      .where('department_version_id', '=', departmentVersionId)
      .executeTakeFirstOrThrow()
  ).governance_status;
}

async function countDepartmentsByCode(departmentCode: string): Promise<number> {
  return Number(
    (
      await database
        .selectFrom('department_master.department')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('department_code', '=', departmentCode)
        .executeTakeFirstOrThrow()
    ).count,
  );
}

function sameCounts(
  left: Awaited<ReturnType<typeof artifactCounts>>,
  right: Awaited<ReturnType<typeof artifactCounts>>,
): boolean {
  return (
    left.releaseCount === right.releaseCount &&
    left.projectionCount === right.projectionCount &&
    left.publishedAuditCount === right.publishedAuditCount
  );
}

async function installSyntheticAuthorizationFixtures(): Promise<void> {
  await database
    .insertInto('platform.security_principal')
    .values({
      security_principal_id: noPublishOwnerId,
      principal_code: `PV005A4-SYNTHETIC-NO-PUBLISH-${suffix}`,
      principal_kind: 'PERSON',
      status: 'ACTIVE',
    })
    .execute();
  await database
    .insertInto('access_control.object_permission_grant')
    .values({
      governance_object_id: DEPARTMENT_OBJECT,
      security_principal_id: noPublishOwnerId,
      permission_code: 'DEPARTMENT_MASTER_APPROVE',
      grant_effect: 'ALLOW',
      valid_from: '2026-01-01T00:00:00',
      valid_to: null,
      grant_sequence: 1,
      granted_by: PROTOTYPE_FIXTURE.actorPrincipalId,
      reason: 'PROTOTYPE SYNTHETIC APPROVE WITHOUT PUBLISH',
      scope_level: 'HOSPITAL',
      campus_id: null,
    })
    .execute();
  await database
    .insertInto('access_control.object_permission_grant')
    .values({
      governance_object_id: OTHER_GOVERNANCE_OBJECT,
      security_principal_id: PROTOTYPE_FIXTURE.reviewerPrincipalId,
      permission_code: 'DEPARTMENT_MASTER_REVIEW',
      grant_effect: 'ALLOW',
      valid_from: '2026-01-01T00:00:00',
      valid_to: null,
      grant_sequence: Number.parseInt(suffix.slice(0, 6), 16) + 2,
      granted_by: PROTOTYPE_FIXTURE.actorPrincipalId,
      reason: 'PROTOTYPE SYNTHETIC CROSS-OBJECT AUTHORIZATION PROBE',
      scope_level: 'HOSPITAL',
      campus_id: null,
    })
    .execute();
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
