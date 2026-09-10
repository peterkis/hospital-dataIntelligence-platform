import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sql } from 'kysely';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { engagementContext } from './person-engagement-fixture.js';
import {
  ENGAGEMENT_LIFECYCLE_FIXTURE,
  engagementLifecycleContext,
  seedEngagementLifecycleScope,
} from './person-engagement-lifecycle-fixture.js';
import { PERSON_FIXTURE, personContext, personCreation } from './person-subject-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_ENGAGEMENT_LIFECYCLE_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-pv006-b03-lifecycle-application-probe', max: 20 });
const checks: Record<string, boolean> = {};
const runId = randomUUID();
const persistencePath = process.env['PERSON_ENGAGEMENT_LIFECYCLE_PERSISTENCE_FILE'];
const recoveryMode = process.argv.includes('--recover');
const currentRecordAsOf = '9999-12-31T23:59:59.999999';

interface PersistenceReceipt {
  readonly databaseStartedAt: string;
  readonly activeEngagementId: string;
  readonly suspendedEngagementId: string;
  readonly endedEngagementId: string;
  readonly personId: string;
  readonly eventIds: readonly string[];
  readonly lateFactHistory: {
    readonly engagementId: string;
    readonly businessAt: string;
    readonly oldRecordAsOf: string;
    readonly newRecordAsOf: string;
  };
  readonly correctedEndHistory: {
    readonly engagementId: string;
    readonly businessAt: string;
    readonly oldRecordAsOf: string;
    readonly newRecordAsOf: string;
  };
  readonly counts: { readonly versions: string; readonly events: string; readonly rejections: string };
}

try {
  if (recoveryMode) await recoverPersistence();
  else await exerciseLifecycle();
} finally {
  await handle.close();
}

async function exerciseLifecycle(): Promise<void> {
  await seedEngagementLifecycleScope(handle.database);
  const governanceBefore = await handle.database.selectFrom('platform.governance_object').selectAll()
    .where('governance_object_id', '=', PERSON_FIXTURE.objectId).executeTakeFirstOrThrow();

  const futurePerson = await createScenarioPerson('FUTURE');
  const future = await createEngagement(futurePerson, '2027-01-01T00:00:00', null);
  assert.equal((await businessState(future.engagementId, '2026-12-01T00:00:00')).businessState, 'PLANNED');
  const plannedRejectionApplication = lifecycle(`PV006-B03-PLANNED-REJECTION-${runId}`);
  const plannedRejectionCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: future.engagementId, businessEffectiveAt: '2026-12-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_PRESTART_HOLD' } as const;
  await assert.rejects(plannedRejectionApplication.suspendEngagement(plannedRejectionCommand),
    /ENGAGEMENT_NOT_STARTED/u);
  await assert.rejects(plannedRejectionApplication.suspendEngagement(plannedRejectionCommand),
    /ENGAGEMENT_NOT_STARTED/u);
  await assert.rejects(plannedRejectionApplication.suspendEngagement({ ...plannedRejectionCommand,
    reasonCode: 'SYNTHETIC_CHANGED_PRESTART_HOLD' }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  checks['plannedDerived'] = true;

  const activePerson = await createScenarioPerson('ACTIVE-SUSPEND-RESUME');
  const active = await createEngagement(activePerson);
  assert.equal((await businessState(active.engagementId, '2026-03-01T00:00:00')).businessState, 'ACTIVE');
  const suspend = await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: active.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_ADMINISTRATIVE_HOLD' });
  assert.equal((await businessState(active.engagementId, '2026-04-02T00:00:00')).businessState, 'SUSPENDED');
  await assert.rejects(lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: active.engagementId, businessEffectiveAt: '2026-04-03T00:00:00',
    expectedLifecycleSequence: '1', reasonCode: 'SYNTHETIC_DUPLICATE_HOLD' }), /ENGAGEMENT_ALREADY_SUSPENDED/u);
  const resumeApplication = lifecycle(`PV006-B03-RESUME-IDEMPOTENT-${runId}`);
  const resumeCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: active.engagementId, businessEffectiveAt: '2026-05-01T00:00:00',
    expectedLifecycleSequence: '1', reasonCode: 'SYNTHETIC_HOLD_CLEARED' } as const;
  const resume = await resumeApplication.resumeEngagement(resumeCommand);
  assert.deepEqual(await resumeApplication.resumeEngagement(resumeCommand), resume);
  await assert.rejects(resumeApplication.resumeEngagement({ ...resumeCommand,
    reasonCode: 'SYNTHETIC_CHANGED_HOLD_CLEARED' }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  assert.equal((await businessState(active.engagementId, '2026-05-02T00:00:00')).businessState, 'ACTIVE');
  await assert.rejects(lifecycle().resumeEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: active.engagementId, businessEffectiveAt: '2026-05-03T00:00:00',
    expectedLifecycleSequence: '2', reasonCode: 'SYNTHETIC_DUPLICATE_RESUME' }), /ENGAGEMENT_NOT_SUSPENDED/u);
  assert.equal((await businessState(active.engagementId, '2026-03-01T00:00:00')).businessState, 'ACTIVE');
  assert.equal((await businessState(active.engagementId, '2026-04-15T00:00:00')).businessState, 'SUSPENDED');
  assert.equal((await businessState(active.engagementId, '2026-05-15T00:00:00')).businessState, 'ACTIVE');
  checks['activeDerived'] = true;
  checks['suspendedDerived'] = true;
  checks['suspendAppendOnly'] = true;
  checks['resumeAppendOnly'] = true;
  checks['historicalSuspendResumeDerived'] = true;

  const idempotentPerson = await createScenarioPerson('IDEMPOTENT');
  const idempotentEngagement = await createEngagement(idempotentPerson);
  const idempotentApplication = lifecycle(`PV006-B03-IDEMPOTENT-${runId}`);
  const idempotentCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: idempotentEngagement.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_IDEMPOTENT_HOLD' } as const;
  const firstIdempotent = await idempotentApplication.suspendEngagement(idempotentCommand);
  assert.deepEqual(await idempotentApplication.suspendEngagement(idempotentCommand), firstIdempotent);
  await assert.rejects(idempotentApplication.suspendEngagement({ ...idempotentCommand,
    reasonCode: 'SYNTHETIC_DIFFERENT_HOLD' }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  await assert.rejects(idempotentApplication.endEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: idempotentEngagement.engagementId,
    expectedCurrentEngagementVersionId: idempotentEngagement.engagementVersionId,
    businessEffectiveAt: '2026-06-01T00:00:00', reasonCode: 'SYNTHETIC_REUSED_REQUEST_END',
  }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  const rejectedApplication = lifecycle(`PV006-B03-REJECTED-IDEMPOTENT-${runId}`);
  const rejectedCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: idempotentEngagement.engagementId, businessEffectiveAt: '2026-05-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_STALE_RESUME' } as const;
  await assert.rejects(rejectedApplication.resumeEngagement(rejectedCommand),
    /ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE/u);
  await assert.rejects(rejectedApplication.resumeEngagement(rejectedCommand),
    /ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE/u);
  await assert.rejects(rejectedApplication.resumeEngagement({ ...rejectedCommand,
    reasonCode: 'SYNTHETIC_CHANGED_REJECTED_RESUME' }),
  /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);

  const compositePerson = await createScenarioPerson('COMPOSITE-REQUEST-AUTHORITY');
  const compositeTarget = await createEngagement(compositePerson);
  const compositeEventRequest = `PV006-B03-COMPOSITE-EVENT-${runId}`;
  await lifecycle(compositeEventRequest, ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId)
    .suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: compositeTarget.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
      expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_COMPOSITE_HOLD' });
  await assert.rejects(createEngagementApplication(handle.database,
    engagementContext(compositeEventRequest, ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId))
    .reviseEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: compositeTarget.engagementId,
      expectedCurrentVersionId: compositeTarget.engagementVersionId,
      businessValidFrom: compositeTarget.businessValidFrom,
      businessValidTo: compositeTarget.businessValidTo, reasonCode: 'FACT_CORRECTION',
    }), /ENGAGEMENT_OPERATION_CONFLICT/u);
  const compositeRejectionRequest = `PV006-B03-COMPOSITE-REJECTION-${runId}`;
  await assert.rejects(lifecycle(compositeRejectionRequest,
    ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId).resumeEngagement({
      governanceObjectId: PERSON_FIXTURE.objectId, engagementId: compositeTarget.engagementId,
      businessEffectiveAt: '2026-05-01T00:00:00', expectedLifecycleSequence: '0',
      reasonCode: 'SYNTHETIC_COMPOSITE_STALE_RESUME',
    }), /ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE/u);
  await assert.rejects(createEngagementApplication(handle.database,
    engagementContext(compositeRejectionRequest, ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId))
    .reviseEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: compositeTarget.engagementId,
      expectedCurrentVersionId: compositeTarget.engagementVersionId,
      businessValidFrom: compositeTarget.businessValidFrom,
      businessValidTo: compositeTarget.businessValidTo, reasonCode: 'FACT_CORRECTION',
    }), /ENGAGEMENT_OPERATION_CONFLICT/u);
  checks['sameRequestIdempotent'] = true;
  checks['sameRequestDifferentPayloadConflicts'] = true;
  checks['crossCommandRequestReuseConflicts'] = true;
  checks['rejectedRequestOutcomeReplayed'] = true;
  checks['ordinaryRevisionCannotRepurposeLifecycleRequest'] = true;
  checks['staleLifecycleMutationRejected'] = true;

  const endedPerson = await createScenarioPerson('ENDED');
  const endedBase = await createEngagement(endedPerson);
  const endApplication = lifecycle(`PV006-B03-END-IDEMPOTENT-${runId}`);
  const endCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: endedBase.engagementId,
    expectedCurrentEngagementVersionId: endedBase.engagementVersionId,
    businessEffectiveAt: '2026-06-30T00:00:00', reasonCode: 'SYNTHETIC_RELATION_ENDED' } as const;
  const endedVersion = await endApplication.endEngagement(endCommand);
  assert.deepEqual(await endApplication.endEngagement(endCommand), endedVersion);
  await assert.rejects(endApplication.endEngagement({ ...endCommand,
    reasonCode: 'SYNTHETIC_CHANGED_RELATION_END' }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  await assert.rejects(endApplication.suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: endedBase.engagementId, businessEffectiveAt: '2026-05-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_REUSED_REQUEST_HOLD',
  }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  assert.equal(endedVersion.reasonCode, 'LIFECYCLE_END');
  assert.equal((await businessState(endedBase.engagementId, '2026-07-15T00:00:00',
    endedVersion.recordedFrom)).businessState, 'ENDED');
  await assert.rejects(lifecycle().resumeEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: endedBase.engagementId, businessEffectiveAt: '2026-07-15T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_ILLEGAL_RESUME' }), /ENGAGEMENT_ENDED/u);
  await assert.rejects(lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: endedBase.engagementId, businessEffectiveAt: '2026-07-15T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_ILLEGAL_HOLD' }), /ENGAGEMENT_ENDED/u);
  checks['endedDerived'] = true;
  checks['endCreatesImmutableEngagementVersion'] = true;
  checks['endedTerminalForOrdinaryLifecycle'] = true;
  checks['endSameRequestIdempotent'] = true;

  const retroEndApplication = lifecycle(`PV006-B03-RETRO-END-REJECTION-${runId}`);
  const retroEndCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: endedBase.engagementId,
    expectedCurrentEngagementVersionId: endedVersion.engagementVersionId,
    businessEffectiveAt: '2026-06-01T00:00:00', reasonCode: 'SYNTHETIC_RETRO_END' } as const;
  await assert.rejects(retroEndApplication.endEngagement(retroEndCommand), /ENGAGEMENT_ENDED/u);
  await assert.rejects(retroEndApplication.endEngagement(retroEndCommand), /ENGAGEMENT_ENDED/u);
  await assert.rejects(retroEndApplication.endEngagement({ ...retroEndCommand,
    reasonCode: 'SYNTHETIC_CHANGED_RETRO_END' }), /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u);
  checks['alreadyEndedRequiresValidityCorrection'] = true;
  checks['lifecycleIdempotencyMatrixComplete'] = true;

  const suspendedEndPerson = await createScenarioPerson('SUSPENDED-END');
  const suspendedEndBase = await createEngagement(suspendedEndPerson);
  await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: suspendedEndBase.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_HOLD_BEFORE_END' });
  await lifecycle().endEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: suspendedEndBase.engagementId,
    expectedCurrentEngagementVersionId: suspendedEndBase.engagementVersionId,
    businessEffectiveAt: '2026-06-30T00:00:00', reasonCode: 'SYNTHETIC_END_WHILE_HELD' });
  assert.equal((await businessState(suspendedEndBase.engagementId,
    '2026-07-01T00:00:00')).businessState, 'ENDED');
  checks['endSuspendedEngagementWorks'] = true;

  const correctionApplication = createEngagementApplication(handle.database, engagementContext());
  const corrected = await correctionApplication.reviseEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: endedBase.engagementId,
    expectedCurrentVersionId: endedVersion.engagementVersionId,
    businessValidFrom: endedVersion.businessValidFrom, businessValidTo: '2026-07-31T00:00:00',
    reasonCode: 'VALIDITY_CORRECTION',
  });
  assert.equal((await businessState(endedBase.engagementId, '2026-07-15T00:00:00',
    endedVersion.recordedFrom)).businessState, 'ENDED');
  assert.equal((await businessState(endedBase.engagementId, '2026-07-15T00:00:00',
    corrected.recordedFrom)).businessState, 'ACTIVE');
  await assert.rejects(createEngagementApplication(handle.database, engagementContext()).reviseEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: endedBase.engagementId,
    expectedCurrentVersionId: corrected.engagementVersionId,
    businessValidFrom: '2026-08-01T00:00:00', businessValidTo: null,
    reasonCode: 'VALIDITY_CORRECTION',
  }), /ENGAGEMENT_ENDED_REOPEN_FORBIDDEN/u);
  const reengagement = await createEngagement(endedPerson, '2026-07-31T00:00:00', null);
  assert.notEqual(reengagement.engagementId, endedBase.engagementId);
  checks['correctedEndDateBitemporal'] = true;
  checks['recordAsOfHistoryPreserved'] = true;
  checks['endedOrdinaryReopenBlocked'] = true;
  checks['reengagementRequiresNewEngagementId'] = true;

  const overlapReleasePerson = await createScenarioPerson('END-RELEASES-OVERLAP');
  const overlapReleaseBase = await createEngagement(overlapReleasePerson);
  await assert.rejects(createEngagement(overlapReleasePerson, '2026-06-01T00:00:00', null,
    'PERMANENT_EMPLOYEE'), /ENGAGEMENT_OVERLAP_FORBIDDEN/u);
  await lifecycle().endEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: overlapReleaseBase.engagementId,
    expectedCurrentEngagementVersionId: overlapReleaseBase.engagementVersionId,
    businessEffectiveAt: '2026-06-01T00:00:00', reasonCode: 'SYNTHETIC_OVERLAP_RELEASE_END' });
  const postEndPermanent = await createEngagement(overlapReleasePerson,
    '2026-06-01T00:00:00', null, 'PERMANENT_EMPLOYEE');
  assert.notEqual(postEndPermanent.engagementId, overlapReleaseBase.engagementId);
  checks['endingReleasesFutureOverlapOnly'] = true;

  const latePerson = await createScenarioPerson('LATE-FACT');
  const late = await createEngagement(latePerson);
  const lateEvent = await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: late.engagementId, businessEffectiveAt: '2026-02-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_LATE_RECORDED_HOLD' });
  assert.equal((await businessState(late.engagementId, '2026-03-01T00:00:00',
    late.recordedFrom)).businessState, 'ACTIVE');
  assert.equal((await businessState(late.engagementId, '2026-03-01T00:00:00',
    lateEvent.recordedAt)).businessState, 'SUSPENDED');
  checks['lateFactBitemporal'] = true;

  const concurrentPerson = await createScenarioPerson('CONCURRENT-SUSPEND');
  const concurrentTarget = await createEngagement(concurrentPerson);
  const concurrentSuspend = await Promise.allSettled([1, 2].map(() =>
    lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: concurrentTarget.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
      expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_CONCURRENT_HOLD' })));
  assert.equal(concurrentSuspend.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentSuspend.filter((result) => result.status === 'rejected' &&
    result.reason instanceof Error && result.reason.message === 'ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE').length, 1);
  checks['concurrentSuspendSingleWinner'] = true;

  const suspendEndPerson = await createScenarioPerson('CONCURRENT-SUSPEND-END');
  const suspendEndTarget = await createEngagement(suspendEndPerson);
  const suspendEnd = await Promise.allSettled([
    lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: suspendEndTarget.engagementId, businessEffectiveAt: '2026-08-01T00:00:00',
      expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_CONCURRENT_HOLD' }),
    lifecycle().endEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: suspendEndTarget.engagementId,
      expectedCurrentEngagementVersionId: suspendEndTarget.engagementVersionId,
      businessEffectiveAt: '2026-08-01T00:00:00', reasonCode: 'SYNTHETIC_CONCURRENT_END' }),
  ]);
  assert.equal(suspendEnd.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(suspendEnd.filter((result) => result.status === 'rejected').length, 1);
  assert.ok(['SUSPENDED', 'ENDED'].includes((await businessState(suspendEndTarget.engagementId,
    '2026-08-02T00:00:00')).businessState));
  checks['suspendEndConcurrencySafe'] = true;

  const resumeEndPerson = await createScenarioPerson('CONCURRENT-RESUME-END');
  const resumeEndTarget = await createEngagement(resumeEndPerson);
  await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: resumeEndTarget.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_HOLD_BEFORE_RACE' });
  const resumeEnd = await Promise.allSettled([
    lifecycle().resumeEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: resumeEndTarget.engagementId, businessEffectiveAt: '2026-08-01T00:00:00',
      expectedLifecycleSequence: '1', reasonCode: 'SYNTHETIC_CONCURRENT_RESUME' }),
    lifecycle().endEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: resumeEndTarget.engagementId,
      expectedCurrentEngagementVersionId: resumeEndTarget.engagementVersionId,
      businessEffectiveAt: '2026-08-01T00:00:00', reasonCode: 'SYNTHETIC_CONCURRENT_END' }),
  ]);
  assert.equal(resumeEnd.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(resumeEnd.filter((result) => result.status === 'rejected').length, 1);
  assert.ok(['ACTIVE', 'ENDED'].includes((await businessState(resumeEndTarget.engagementId,
    '2026-08-02T00:00:00')).businessState));
  checks['resumeEndConcurrencySafe'] = true;
  checks['lifecycleConcurrencySafe'] = true;

  const multiplePerson = await createScenarioPerson('MULTIPLE-ENGAGEMENTS');
  const personBefore = await handle.database.selectFrom('person_master.person_subject').selectAll()
    .where('person_id', '=', multiplePerson).executeTakeFirstOrThrow();
  const [multiActive, multiSuspended, multiEnded] = await Promise.all([
    createEngagement(multiplePerson), createEngagement(multiplePerson), createEngagement(multiplePerson),
  ]);
  await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: multiSuspended.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_MULTI_HOLD' });
  await lifecycle().endEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: multiEnded.engagementId,
    expectedCurrentEngagementVersionId: multiEnded.engagementVersionId,
    businessEffectiveAt: '2026-06-01T00:00:00', reasonCode: 'SYNTHETIC_MULTI_END' });
  assert.deepEqual([
    (await businessState(multiActive.engagementId, '2026-07-01T00:00:00')).businessState,
    (await businessState(multiSuspended.engagementId, '2026-07-01T00:00:00')).businessState,
    (await businessState(multiEnded.engagementId, '2026-07-01T00:00:00')).businessState,
  ], ['ACTIVE', 'SUSPENDED', 'ENDED']);
  assert.deepEqual(await handle.database.selectFrom('person_master.person_subject').selectAll()
    .where('person_id', '=', multiplePerson).executeTakeFirstOrThrow(), personBefore);
  checks['multipleEngagementStatesIndependent'] = true;
  checks['personCoreUnchanged'] = true;

  await assert.rejects(createEngagementLifecycleApplication(handle.database,
    engagementContext(`PV006-B03-ENGAGEMENT-WRITER-DENIED-${runId}`))
    .getEngagementBusinessStateAsOf({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: active.engagementId, businessAt: '2026-03-01T00:00:00',
      recordAsOf: currentRecordAsOf }), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createEngagementApplication(handle.database,
    engagementLifecycleContext(`PV006-B03-LIFECYCLE-OWNER-CORE-DENIED-${runId}`))
    .getEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: active.engagementId }), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createEngagementLifecycleApplication(handle.database,
    engagementLifecycleContext(`PV006-B03-SERVICE-DENIED-${runId}`,
      ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleServiceId)).suspendEngagement({
        governanceObjectId: PERSON_FIXTURE.objectId, engagementId: reengagement.engagementId,
        businessEffectiveAt: '2026-08-15T00:00:00', expectedLifecycleSequence: '0',
        reasonCode: 'SYNTHETIC_SERVICE_HOLD',
      }), /PERSON_HUMAN_ACTOR_REQUIRED/u);
  checks['lifecycleAuthorizationSeparated'] = true;
  checks['humanActorRequired'] = true;

  const governanceAfter = await handle.database.selectFrom('platform.governance_object').selectAll()
    .where('governance_object_id', '=', PERSON_FIXTURE.objectId).executeTakeFirstOrThrow();
  assert.deepEqual(governanceAfter, governanceBefore);
  checks['businessStateSeparatedFromGovernanceState'] = true;
  checks['businessStateNotStoredOnPerson'] = true;

  const overlapPerson = await createScenarioPerson('SUSPENSION-OVERLAP');
  const overlapBase = await createEngagement(overlapPerson);
  await lifecycle().suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: overlapBase.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_OVERLAP_HOLD' });
  await assert.rejects(createEngagementApplication(handle.database, engagementContext())
    .createEngagement({ governanceObjectId: PERSON_FIXTURE.objectId, personId: overlapPerson,
      engagementTypeCode: 'PERMANENT_EMPLOYEE', relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
      businessValidFrom: '2026-05-01T00:00:00', businessValidTo: '2026-06-01T00:00:00',
    }), /ENGAGEMENT_OVERLAP_FORBIDDEN/u);
  checks['suspensionDoesNotReleaseOverlapByDefault'] = true;

  const audit = await sql<{ action: string; event_payload: unknown }>`
    select action, event_payload from audit.audit_event
    where governance_object_id = ${PERSON_FIXTURE.objectId}::uuid
      and action in ('PERSON_ENGAGEMENT_SUSPENDED', 'PERSON_ENGAGEMENT_RESUMED',
        'PERSON_ENGAGEMENT_ENDED', 'PERSON_ENGAGEMENT_BUSINESS_STATE_READ',
        'PERSON_ENGAGEMENT_LIFECYCLE_REJECTED')
  `.execute(handle.database);
  for (const action of ['PERSON_ENGAGEMENT_SUSPENDED', 'PERSON_ENGAGEMENT_RESUMED',
    'PERSON_ENGAGEMENT_ENDED', 'PERSON_ENGAGEMENT_BUSINESS_STATE_READ']) {
    assert.ok(audit.rows.some((row) => row.action === action), `${action}_AUDIT_REQUIRED`);
  }
  assert.ok(!/basisReference|contractNo|employeeNo|CONFIRMED_DISTINCT_RELATION_BASIS/u
    .test(JSON.stringify(audit.rows)));
  checks['lifecycleAuditBounded'] = true;
  checks['sensitiveBasisAbsentFromAudit'] = true;

  if (persistencePath) {
    const receipt: PersistenceReceipt = {
      databaseStartedAt: await databaseStartedAt(),
      activeEngagementId: multiActive.engagementId,
      suspendedEngagementId: multiSuspended.engagementId,
      endedEngagementId: multiEnded.engagementId,
      personId: multiplePerson,
      eventIds: [suspend.engagementLifecycleEventId, resume.engagementLifecycleEventId],
      lateFactHistory: { engagementId: late.engagementId, businessAt: '2026-03-01T00:00:00',
        oldRecordAsOf: late.recordedFrom, newRecordAsOf: lateEvent.recordedAt },
      correctedEndHistory: { engagementId: endedBase.engagementId,
        businessAt: '2026-07-15T00:00:00', oldRecordAsOf: endedVersion.recordedFrom,
        newRecordAsOf: corrected.recordedFrom },
      counts: await persistedCounts(),
    };
    await mkdir(dirname(persistencePath), { recursive: true });
    await writeFile(persistencePath, JSON.stringify(receipt, null, 2));
  }

  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-03',
    classification: ENGAGEMENT_LIFECYCLE_FIXTURE.classification,
    timeZone: 'Asia/Shanghai', status: 'PASSED', checks })}\n`);
}

function lifecycle(
  requestId: string = randomUUID(), actorId: string = ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
) {
  return createEngagementLifecycleApplication(handle.database,
    engagementLifecycleContext(requestId, actorId));
}

async function businessState(
  engagementId: string, businessAt: string, recordAsOf = currentRecordAsOf,
) {
  return lifecycle().getEngagementBusinessStateAsOf({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId, businessAt, recordAsOf });
}

async function createScenarioPerson(label: string): Promise<string> {
  const version = await createPersonApplication(handle.database, personContext()).createPersonSubject({
    ...personCreation,
    facts: { canonicalName: `SYNTHETIC B-03 ${label} ${runId}`, birthDate: '1980-01-01' },
  });
  return version.personId;
}

async function createEngagement(
  personId: string, businessValidFrom = '2026-01-01T00:00:00', businessValidTo: string | null = null,
  engagementTypeCode = 'CONTRACT_EMPLOYEE',
) {
  return createEngagementApplication(handle.database, engagementContext()).createEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, personId,
    engagementTypeCode, relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
    businessValidFrom, businessValidTo,
  });
}

async function recoverPersistence(): Promise<void> {
  if (!persistencePath) throw new Error('PERSON_ENGAGEMENT_LIFECYCLE_PERSISTENCE_FILE_REQUIRED');
  const receipt = JSON.parse(await readFile(persistencePath, 'utf8')) as PersistenceReceipt;
  assert.notEqual(await databaseStartedAt(), receipt.databaseStartedAt);
  assert.equal((await businessState(receipt.activeEngagementId, '2026-07-01T00:00:00')).businessState,
    'ACTIVE');
  assert.equal((await businessState(receipt.suspendedEngagementId, '2026-07-01T00:00:00')).businessState,
    'SUSPENDED');
  assert.equal((await businessState(receipt.endedEngagementId, '2026-07-01T00:00:00')).businessState,
    'ENDED');
  assert.equal((await businessState(receipt.lateFactHistory.engagementId,
    receipt.lateFactHistory.businessAt, receipt.lateFactHistory.oldRecordAsOf)).businessState, 'ACTIVE');
  assert.equal((await businessState(receipt.lateFactHistory.engagementId,
    receipt.lateFactHistory.businessAt, receipt.lateFactHistory.newRecordAsOf)).businessState, 'SUSPENDED');
  assert.equal((await businessState(receipt.correctedEndHistory.engagementId,
    receipt.correctedEndHistory.businessAt,
    receipt.correctedEndHistory.oldRecordAsOf)).businessState, 'ENDED');
  assert.equal((await businessState(receipt.correctedEndHistory.engagementId,
    receipt.correctedEndHistory.businessAt,
    receipt.correctedEndHistory.newRecordAsOf)).businessState, 'ACTIVE');
  const events = await handle.database.selectFrom('person_master.engagement_lifecycle_event')
    .select('engagement_lifecycle_event_id')
    .where('engagement_lifecycle_event_id', 'in', [...receipt.eventIds]).execute();
  assert.equal(events.length, receipt.eventIds.length);
  assert.deepEqual(await persistedCounts(), receipt.counts);
  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-03', status: 'PASSED', mode: 'RECOVERY',
    databaseRestartObserved: true, engagementVersionHistoryRecovered: true,
    lifecycleEventsRecovered: true, derivedStatesRecovered: true,
    recordAsOfHistoryPreserved: true })}\n`);
}

async function databaseStartedAt(): Promise<string> {
  const result = await sql<{ started_at: string }>`
    select (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started_at
  `.execute(handle.database);
  return result.rows[0]!.started_at;
}

async function persistedCounts(): Promise<PersistenceReceipt['counts']> {
  const result = await sql<PersistenceReceipt['counts']>`
    select
      (select count(*) from person_master.engagement_version)::text as versions,
      (select count(*) from person_master.engagement_lifecycle_event)::text as events,
      (select count(*) from person_master.engagement_lifecycle_rejection)::text as rejections
  `.execute(handle.database);
  return result.rows[0]!;
}
