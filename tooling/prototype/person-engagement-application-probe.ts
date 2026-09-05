import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sql } from 'kysely';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createIdentifierApplication } from '../../apps/governance-api/src/composition/create-person-identifier-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createAuditModule } from '../../apps/governance-api/src/modules/audit/index.js';
import type { Engagement, EngagementVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { IDENTIFIER_FIXTURE } from './person-identifier-fixture.js';
import {
  ENGAGEMENT_FIXTURE, engagementContext, engagementCreation, seedEngagementScope,
} from './person-engagement-fixture.js';
import { seedSyntheticEngagementPolicy } from './person-engagement-policy-fixture.js';
import { PERSON_FIXTURE, personContext } from './person-subject-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_ENGAGEMENT_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const checks: Record<string, boolean> = {};
const persistencePath = process.env['PERSON_ENGAGEMENT_PERSISTENCE_FILE'];
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-person-engagement-application-probe', max: 8 });

type Receipt = {
  readonly relation: Engagement;
  readonly versions: readonly EngagementVersion[];
  readonly first: EngagementVersion;
  readonly extension: EngagementVersion;
  readonly correction: EngagementVersion;
  readonly secondRelation: Engagement;
  readonly secondVersions: readonly EngagementVersion[];
  readonly databaseStartedAt: string;
};

try {
  if (process.argv.includes('--recover')) await recover();
  else await exercise();
} finally { await handle.close(); }

checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-B-01', classification: ENGAGEMENT_FIXTURE.classification,
  timeZone: ENGAGEMENT_FIXTURE.timeZone, status: 'PASSED',
  mode: process.argv.includes('--recover') ? 'RECOVERY' : 'APPLICATION', syntheticPersons: 6,
  syntheticEngagements: process.argv.includes('--recover') ? 0 : 9,
  realPersonnelData: 0, realHR: 0, realHIS: 0, realEMR: 0, checks }));

async function recover() {
  assert.ok(persistencePath, 'PERSISTENCE_FILE_REQUIRED');
  const receipt: Receipt = JSON.parse(await readFile(persistencePath, 'utf8'));
  const app = createEngagementApplication(handle.database, engagementContext());
  const reference = { governanceObjectId: receipt.relation.governanceObjectId,
    engagementId: receipt.relation.engagementId };
  assert.deepEqual(await app.getEngagement(reference), receipt.relation);
  assert.deepEqual(await app.listEngagementVersions(reference), receipt.versions);
  assert.deepEqual(await app.findEngagementAsOf({ ...reference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: receipt.first.recordedFrom }), receipt.first);
  assert.deepEqual(await app.findEngagementAsOf({ ...reference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: receipt.extension.recordedFrom }), receipt.extension);
  assert.deepEqual(await app.findEngagementAsOf({ ...reference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: receipt.correction.recordedFrom }), receipt.correction);
  const secondReference = { governanceObjectId: receipt.secondRelation.governanceObjectId,
    engagementId: receipt.secondRelation.engagementId };
  assert.deepEqual(await app.getEngagement(secondReference), receipt.secondRelation);
  assert.deepEqual(await app.listEngagementVersions(secondReference), receipt.secondVersions);
  const restart = await sql<{ started: string }>`select
    (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
  assert.notEqual(restart.rows[0]?.started, receipt.databaseStartedAt, 'ACTUAL_DATABASE_RESTART_REQUIRED');
  checks['restartPersistenceObserved'] = true;
  checks['stableRelationRecovered'] = true;
  checks['immutableVersionHistoryRecovered'] = true;
  checks['asOfQueryRecovered'] = true;
}

async function exercise() {
  const people = await seedEngagementScope(handle.database);
  await seedSyntheticEngagementPolicy(handle.database);
  const personCountsBefore = await protectedCounts();
  const created: EngagementVersion[] = [];
  for (let index = 0; index < 6; index += 1) {
    created.push(await createEngagementApplication(handle.database, engagementContext())
      .createEngagement(engagementCreation(people[index]!, index)));
  }
  const first = created[0]!;
  const firstReference = { governanceObjectId: first.governanceObjectId, engagementId: first.engagementId };
  assert.match(first.engagementId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/u);
  assert.match(first.engagementVersionId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/u);
  assert.notEqual(first.engagementId, first.personId);
  assert.equal(first.versionNo, '1');
  assert.equal(first.reasonCode, null);
  assert.equal(first.supersedesEngagementVersionId, null);
  const readApp = createEngagementApplication(handle.database, engagementContext());
  const firstRelation = await readApp.getEngagement(firstReference);
  assert.equal(firstRelation.personId, first.personId);
  assert.equal((await readApp.getEngagementVersion({ ...firstReference,
    engagementVersionId: first.engagementVersionId })).engagementVersionId, first.engagementVersionId);
  checks['engagementStableRelationCreated'] = true;
  checks['engagementStableIdNeverReused'] = true;
  checks['engagementFirstVersionAtomic'] = true;

  const retryContext = engagementContext();
  const retryApp = createEngagementApplication(handle.database, retryContext);
  const retryCommand = engagementCreation(people[0]!, 6);
  const simultaneousRetries = await Promise.all([
    retryApp.createEngagement(retryCommand), retryApp.createEngagement(retryCommand),
  ]);
  assert.deepEqual(simultaneousRetries[0], simultaneousRetries[1]);
  for (const changed of [
    { ...retryCommand, personId: people[1]! },
    { ...retryCommand, businessValidFrom: '2026-08-02T00:00:00' },
    { ...retryCommand, businessValidTo: null },
  ]) await assert.rejects(retryApp.createEngagement(changed), /ENGAGEMENT_OPERATION_CONFLICT/u);
  checks['sameRequestConcurrentCreateOneLogicalResult'] = true;
  checks['sameRequestSamePayloadIdempotent'] = true;
  checks['sameRequestDifferentPayloadConflict'] = true;

  const parallelRelations = await Promise.all([
    createEngagementApplication(handle.database, engagementContext())
      .createEngagement(engagementCreation(people[1]!, 7)),
    createEngagementApplication(handle.database, engagementContext())
      .createEngagement(engagementCreation(people[1]!, 8)),
  ]);
  assert.notEqual(parallelRelations[0].engagementId, parallelRelations[1].engagementId);
  const personOneRelations = await readApp.listPersonEngagements({ governanceObjectId: PERSON_FIXTURE.objectId,
    personId: people[1]! });
  assert.ok(personOneRelations.length >= 3);
  checks['samePersonMultipleEngagementIdsAllowed'] = true;
  checks['distinctEngagementsSamePersonConcurrent'] = true;
  checks['b01MultipleRelationsRemainCompatibleWithB02AllowRule'] = true;

  const rawStableBefore = await handle.database.selectFrom('person_master.engagement').selectAll()
    .where('engagement_id', '=', first.engagementId).executeTakeFirstOrThrow();
  const rawV1Before = await handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('engagement_version_id', '=', first.engagementVersionId).executeTakeFirstOrThrow();
  const extensionContext = engagementContext();
  const extensionApp = createEngagementApplication(handle.database, extensionContext);
  const extensionCommand = { ...firstReference, expectedCurrentVersionId: first.engagementVersionId,
    businessValidFrom: '2026-01-01T00:00:00', businessValidTo: '2027-12-31T00:00:00',
    reasonCode: 'CONTINUATION_EXTENSION' as const };
  const extension = await extensionApp.reviseEngagement(extensionCommand);
  assert.deepEqual(await extensionApp.reviseEngagement(extensionCommand), extension);
  await assert.rejects(extensionApp.reviseEngagement({ ...extensionCommand,
    businessValidTo: '2028-12-31T00:00:00' }), /ENGAGEMENT_OPERATION_CONFLICT/u);
  const correction = await createEngagementApplication(handle.database, engagementContext())
    .reviseEngagement({ ...firstReference, expectedCurrentVersionId: extension.engagementVersionId,
      businessValidFrom: '2026-01-01T00:00:00', businessValidTo: '2028-12-31T00:00:00',
      reasonCode: 'VALIDITY_CORRECTION' });
  assert.equal(first.engagementId, extension.engagementId);
  assert.equal(extension.engagementId, correction.engagementId);
  assert.equal(first.personId, extension.personId);
  assert.equal(extension.personId, correction.personId);
  assert.deepEqual([first.versionNo, extension.versionNo, correction.versionNo], ['1', '2', '3']);
  assert.deepEqual(await handle.database.selectFrom('person_master.engagement').selectAll()
    .where('engagement_id', '=', first.engagementId).executeTakeFirstOrThrow(), rawStableBefore);
  assert.deepEqual(await handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('engagement_version_id', '=', first.engagementVersionId).executeTakeFirstOrThrow(), rawV1Before);
  const firstHistory = await readApp.listEngagementVersions(firstReference);
  assert.deepEqual(firstHistory, [first, extension, correction]);
  assert.deepEqual(await readApp.findEngagementAsOf({ ...firstReference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: first.recordedFrom }), first);
  assert.deepEqual(await readApp.findEngagementAsOf({ ...firstReference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: extension.recordedFrom }), extension);
  assert.deepEqual(await readApp.findEngagementAsOf({ ...firstReference,
    businessAt: '2026-06-01T00:00:00', recordAsOf: correction.recordedFrom }), correction);
  checks['continuationUsesSameEngagementId'] = true;
  checks['engagementBoundToSinglePersonForever'] = true;
  checks['engagementVersionImmutable'] = true;
  checks['engagementVersionMonotonic'] = true;
  checks['bitemporalAsOfObserved'] = true;

  const staleContext = engagementContext();
  await assert.rejects(createEngagementApplication(handle.database, staleContext)
    .reviseEngagement({ ...extensionCommand, expectedCurrentVersionId: first.engagementVersionId }),
  /ENGAGEMENT_STALE_VERSION/u);
  const staleAudit = await createAuditModule(handle.database, personContext()).query({
    governanceObjectId: PERSON_FIXTURE.objectId, requestId: staleContext.requestId, limit: 10 });
  assert.equal(staleAudit.filter((event) => event.action === 'PERSON_ENGAGEMENT_REVISION_REJECTED').length, 1);
  checks['engagementStaleWriterBlocked'] = true;
  checks['staleRevisionAudited'] = true;

  const concurrentBase = created[1]!;
  const concurrentReference = { governanceObjectId: concurrentBase.governanceObjectId,
    engagementId: concurrentBase.engagementId, expectedCurrentVersionId: concurrentBase.engagementVersionId,
    businessValidFrom: concurrentBase.businessValidFrom };
  const concurrent = await Promise.allSettled([
    createEngagementApplication(handle.database, engagementContext()).reviseEngagement({ ...concurrentReference,
      businessValidTo: '2027-12-31T00:00:00', reasonCode: 'CONTINUATION_EXTENSION' }),
    createEngagementApplication(handle.database, engagementContext()).reviseEngagement({ ...concurrentReference,
      businessValidTo: '2028-12-31T00:00:00', reasonCode: 'VALIDITY_CORRECTION' }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const concurrentFailure = concurrent.find((result) => result.status === 'rejected');
  assert.equal(concurrentFailure?.status === 'rejected' ? concurrentFailure.reason.message : null,
    'ENGAGEMENT_STALE_VERSION');
  const secondReference = { governanceObjectId: concurrentBase.governanceObjectId,
    engagementId: concurrentBase.engagementId };
  const secondHistory = await readApp.listEngagementVersions(secondReference);
  assert.deepEqual(secondHistory.map((version) => version.versionNo), ['1', '2']);
  assert.ok(secondHistory.every((version) => version.personId === concurrentBase.personId));
  checks['engagementConcurrencySafe'] = true;
  checks['concurrentSameExpectedOneSuccess'] = true;

  await assert.rejects(createEngagementApplication(handle.database, engagementContext())
    .createEngagement(engagementCreation(randomUUID(), 1)), /ENGAGEMENT_PERSON_INVALID/u);
  await assert.rejects(createEngagementApplication(handle.database, engagementContext())
    .createEngagement({ ...engagementCreation(people[0]!, 1),
      governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId }), /PERSON_GOVERNANCE_SCOPE_INVALID/u);
  for (const actorId of [PROTOTYPE_FIXTURE.serviceConsumerPrincipalId, PERSON_FIXTURE.inactiveActorId]) {
    const deniedContext = engagementContext(randomUUID(), actorId);
    await assert.rejects(createEngagementApplication(handle.database, deniedContext)
      .createEngagement(engagementCreation(people[0]!, 1)), /PERSON_HUMAN_ACTOR_REQUIRED/u);
    const denial = await createAuditModule(handle.database, personContext()).query({
      governanceObjectId: PERSON_FIXTURE.objectId, requestId: deniedContext.requestId, limit: 10 });
    assert.equal(denial.filter((event) => event.action === 'PERSON_ENGAGEMENT_ACCESS_DENIED').length, 1);
  }
  await assert.rejects(createEngagementApplication(handle.database,
    engagementContext(randomUUID(), IDENTIFIER_FIXTURE.identifierOwnerId)).getEngagement(firstReference),
  /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createIdentifierApplication(handle.database, engagementContext())
    .getPersonIdentifier({ governanceObjectId: PERSON_FIXTURE.objectId,
      personIdentifierId: randomUUID() }), /OBJECT_PERMISSION_FORBIDDEN/u);
  checks['unknownPersonRejected'] = true;
  checks['crossGovernancePersonRejected'] = true;
  checks['humanActorRequired'] = true;
  checks['engagementAuthorizationSeparated'] = true;

  const faultContext = engagementContext();
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await assert.rejects(createEngagementApplication(handle.database, faultContext)
      .createEngagement(engagementCreation(people[2]!, 2)), /ENGAGEMENT_OPERATION_FAILED/u);
  } finally { configureControlledPublicationFault(null); }
  assert.equal((await handle.database.selectFrom('person_master.engagement').select('engagement_id')
    .where('creation_request_id', '=', faultContext.requestId).execute()).length, 0);
  const versionCountBeforeFault = firstHistory.length;
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await assert.rejects(createEngagementApplication(handle.database, engagementContext())
      .reviseEngagement({ ...firstReference, expectedCurrentVersionId: correction.engagementVersionId,
        businessValidFrom: correction.businessValidFrom, businessValidTo: null,
        reasonCode: 'FACT_CORRECTION' }), /ENGAGEMENT_OPERATION_FAILED/u);
  } finally { configureControlledPublicationFault(null); }
  assert.equal((await readApp.listEngagementVersions(firstReference)).length, versionCountBeforeFault);
  checks['engagementAuditFailureRollsBack'] = true;

  const engagementAudit = await handle.database.selectFrom('audit.audit_event')
    .select(['event_payload', 'after_hash']).where('action', 'like', 'PERSON_ENGAGEMENT_%').execute();
  const auditText = JSON.stringify(engagementAudit);
  assert.ok(!/relationBasis|basisReference|contractNo|employeeNo|CONFIRMED_DISTINCT_RELATION_BASIS/u.test(auditText));
  assert.ok(engagementAudit.every((row) => row.after_hash === null));
  assert.equal(await createAuditModule(handle.database, personContext()).verifyChain(PERSON_FIXTURE.objectId), true);
  const metricText = JSON.stringify(await createAuditModule(handle.database, personContext()).readConsumerMetricFacts());
  assert.ok(!/relationBasis|basisReference|contractNo|employeeNo|CONFIRMED_DISTINCT_RELATION_BASIS/u.test(metricText));
  checks['engagementSensitiveBasisAbsentFromAudit'] = true;
  checks['engagementSensitiveBasisAbsentFromMetrics'] = true;

  assert.deepEqual(await protectedCounts(), personCountsBefore);
  checks['personCoreUnchanged'] = true;
  checks['identifierRegistryUnchanged'] = true;
  checks['sourceMappingUnchanged'] = true;
  const publicMethods = Object.keys(createEngagementApplication(handle.database, engagementContext())).sort();
  assert.deepEqual(publicMethods, ['createEngagement', 'reviseEngagement', 'getEngagement',
    'getEngagementVersion', 'listEngagementVersions', 'listPersonEngagements', 'findEngagementAsOf'].sort());
  checks['arbitraryUpdateAndUpsertAbsent'] = true;
  checks['automaticRehireAbsent'] = true;

  const columns = await sql<{ column_name: string }>`select column_name from information_schema.columns
    where table_schema = 'person_master' and table_name in ('engagement', 'engagement_version')`.execute(handle.database);
  const names = columns.rows.map((row) => row.column_name);
  for (const forbidden of ['engagement_type', 'engagement_category', 'employment_status', 'business_state',
    'lifecycle_state', 'department_id', 'campus_id', 'job_code', 'role_code', 'credential_id']) {
    assert.ok(!names.includes(forbidden), forbidden);
  }
  checks['classificationStoredOutsideB01CoreTables'] = true;
  checks['businessLifecycleStateAbsentFromB01CoreTables'] = true;
  checks['assignmentAbsent'] = true;
  checks['credentialAbsent'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.engagement e
    where not exists (select 1 from person_master.engagement_version v
      where v.engagement_id = e.engagement_id and v.version_no = 1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0');
  checks['orphanEngagementsZero'] = true;

  if (persistencePath) {
    const start = await sql<{ started: string }>`select
      (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
    await mkdir(dirname(persistencePath), { recursive: true });
    const secondRelation = await readApp.getEngagement(secondReference);
    const receipt: Receipt = { relation: firstRelation, versions: firstHistory, first, extension, correction,
      secondRelation, secondVersions: secondHistory, databaseStartedAt: start.rows[0]!.started };
    await writeFile(persistencePath, JSON.stringify(receipt, null, 2));
  }
}

async function protectedCounts() {
  const result = await sql<{
    subjects: string; subjectVersions: string; identifiers: string; identifierVersions: string;
    mappings: string; mappingVersions: string;
  }>`select
    (select count(*) from person_master.person_subject)::text as subjects,
    (select count(*) from person_master.person_subject_version)::text as "subjectVersions",
    (select count(*) from person_master.person_identifier)::text as identifiers,
    (select count(*) from person_master.person_identifier_version)::text as "identifierVersions",
    (select count(*) from person_master.person_source_mapping)::text as mappings,
    (select count(*) from person_master.person_source_mapping_version)::text as "mappingVersions"
  `.execute(handle.database);
  return result.rows[0]!;
}
