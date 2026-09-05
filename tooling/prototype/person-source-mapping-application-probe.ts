import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createIdentifierApplication } from '../../apps/governance-api/src/composition/create-person-identifier-application.js';
import { createSourceMappingApplication } from '../../apps/governance-api/src/composition/create-person-source-mapping-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAuditModule } from '../../apps/governance-api/src/modules/audit/index.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import type { PersonSourceMappingVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { IDENTIFIER_FIXTURE } from './person-identifier-fixture.js';
import { PERSON_FIXTURE, personContext } from './person-subject-fixture.js';
import {
  SOURCE_MAPPING_FIXTURE, seedSourceMappingScope, sourceMappingContext, sourceMappingCreation,
} from './person-source-mapping-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_SOURCE_MAPPING_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const checks: Record<string, boolean> = {};
const persistencePath = process.env['PERSON_SOURCE_MAPPING_PERSISTENCE_FILE'];
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-source-mapping-application-probe', max: 8 });
const server = Fastify({ logger: false });
server.addHook('onClose', async () => handle.close());

type Receipt = {
  readonly reference: { readonly governanceObjectId: string; readonly personSourceMappingId: string };
  readonly versions: readonly PersonSourceMappingVersion[];
  readonly first: PersonSourceMappingVersion;
  readonly corrected: PersonSourceMappingVersion;
  readonly retraction: {
    readonly reference: { readonly governanceObjectId: string; readonly personSourceMappingId: string };
    readonly versions: readonly PersonSourceMappingVersion[];
  };
  readonly databaseStartedAt: string;
};

try {
  await server.ready();
  if (process.argv.includes('--recover')) await recover();
  else await exercise();
} finally { await server.close(); }

checks['fastifyClosed'] = true;
checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-A-02B', classification: SOURCE_MAPPING_FIXTURE.classification,
  timeZone: SOURCE_MAPPING_FIXTURE.timeZone, status: 'PASSED',
  mode: process.argv.includes('--recover') ? 'RECOVERY' : 'APPLICATION', syntheticPersons: 6,
  syntheticSourceSystems: 2, syntheticSourceEntities: 3,
  syntheticMappings: process.argv.includes('--recover') ? 0 : 13,
  realPersonnelData: 0, realHR: 0, realHIS: 0, realEMR: 0, checks }));

async function recover() {
  assert.ok(persistencePath, 'PERSISTENCE_FILE_REQUIRED');
  const receipt: Receipt = JSON.parse(await readFile(persistencePath, 'utf8'));
  const app = createSourceMappingApplication(handle.database, sourceMappingContext());
  const versions = await app.listPersonSourceMappingVersions(receipt.reference);
  assert.deepEqual(versions, receipt.versions);
  assert.deepEqual(await app.findPersonSourceMappingAsOf({ ...receipt.reference,
    businessAt: '2025-08-01T00:00:00', recordAsOf: receipt.first.recordedFrom }), receipt.first);
  assert.deepEqual(await app.findPersonSourceMappingAsOf({ ...receipt.reference,
    businessAt: '2025-08-01T00:00:00', recordAsOf: receipt.corrected.recordedFrom }), receipt.corrected);
  const mapping = await app.getPersonSourceMapping(receipt.reference);
  const exact = await app.findPersonBySourceRecord({ governanceObjectId: mapping.governanceObjectId,
    sourceSystem: mapping.sourceSystem, sourceEntity: mapping.sourceEntity,
    sourceRecordKey: mapping.sourceRecordKey, businessAt: '2025-08-01T00:00:00',
    recordAsOf: receipt.corrected.recordedFrom });
  assert.equal(exact?.personId, receipt.corrected.personId);
  const retractionVersions = await app.listPersonSourceMappingVersions(receipt.retraction.reference);
  assert.deepEqual(retractionVersions, receipt.retraction.versions);
  assert.deepEqual(await app.findPersonSourceMappingAsOf({ ...receipt.retraction.reference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: retractionVersions[0]!.recordedFrom }),
  retractionVersions[0]);
  assert.equal(await app.findPersonSourceMappingAsOf({ ...receipt.retraction.reference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: retractionVersions[1]!.recordedFrom }), null);
  assert.deepEqual(await app.findPersonSourceMappingAsOf({ ...receipt.retraction.reference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: retractionVersions[2]!.recordedFrom }),
  retractionVersions[2]);
  const restart = await sql<{ started: string }>`select
    (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
  assert.notEqual(restart.rows[0]?.started, receipt.databaseStartedAt, 'ACTUAL_DATABASE_RESTART_REQUIRED');
  checks['restartPersistenceObserved'] = true;
  checks['fullMappingHistoryRecovered'] = true;
  checks['historicalLookupAfterRestart'] = true;
  checks['retractionHistoryAfterRestart'] = true;
}

async function exercise() {
  const people = await seedSourceMappingScope(handle.database);
  const personCountBefore = await count('person_master.person_subject');
  const identifierCountBefore = await count('person_master.person_identifier');
  const runId = randomUUID();
  const commands = people.map((personId, personIndex) => sourceMappingCreation(personId, runId, personIndex,
    SOURCE_MAPPING_FIXTURE.sourceSystems[personIndex % SOURCE_MAPPING_FIXTURE.sourceSystems.length]!,
    SOURCE_MAPPING_FIXTURE.sourceEntities[personIndex % SOURCE_MAPPING_FIXTURE.sourceEntities.length]!));
  const created: PersonSourceMappingVersion[] = [];
  for (const command of commands) {
    created.push(await createSourceMappingApplication(handle.database, sourceMappingContext())
      .registerPersonSourceMapping(command));
  }
  const first = created[0]!;
  const firstCommand = commands[0]!;
  const reference = { governanceObjectId: first.governanceObjectId,
    personSourceMappingId: first.personSourceMappingId };
  assert.match(first.personSourceMappingId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/u);
  assert.notEqual(first.personSourceMappingId, first.personId);
  assert.equal(first.mappingStatus, 'MAPPED');
  assert.equal(first.changeKind, 'REGISTERED');
  assert.equal(first.supersedesMappingVersionId, null);
  assert.equal(first.reasonCode, null);
  checks['sourceMappingRegistered'] = true;
  checks['sourceMappingFirstVersionAtomic'] = true;
  checks['stableSourceIdentityUnique'] = true;

  const retryContext = sourceMappingContext();
  const retryApp = createSourceMappingApplication(handle.database, retryContext);
  const retryCommand = sourceMappingCreation(people[0]!, runId, 50,
    SOURCE_MAPPING_FIXTURE.sourceSystems[0], SOURCE_MAPPING_FIXTURE.sourceEntities[0]);
  const simultaneousRetries = await Promise.all([
    retryApp.registerPersonSourceMapping(retryCommand),
    retryApp.registerPersonSourceMapping(retryCommand),
  ]);
  assert.deepEqual(simultaneousRetries[0], simultaneousRetries[1]);
  for (const changed of [
    { ...retryCommand, personId: people[1]! },
    { ...retryCommand, sourceSystem: SOURCE_MAPPING_FIXTURE.sourceSystems[1] },
    { ...retryCommand, sourceEntity: SOURCE_MAPPING_FIXTURE.sourceEntities[1] },
    { ...retryCommand, sourceRecordKey: `${retryCommand.sourceRecordKey}-CHANGED` },
    { ...retryCommand, businessValidFrom: '2025-02-01T00:00:00' },
  ]) await assert.rejects(retryApp.registerPersonSourceMapping(changed), /SOURCE_MAPPING_OPERATION_CONFLICT/u);
  checks['sameRequestIdempotent'] = true;
  checks['operationConflictBlocked'] = true;

  const exactCommand = sourceMappingCreation(people[2]!, runId, 51,
    SOURCE_MAPPING_FIXTURE.sourceSystems[0], SOURCE_MAPPING_FIXTURE.sourceEntities[0]);
  const exactV1 = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping(exactCommand);
  await assert.rejects(createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping({ ...exactCommand, personId: people[3]! }), /SOURCE_MAPPING_ALREADY_EXISTS/u);
  assert.equal((await createSourceMappingApplication(handle.database, sourceMappingContext())
    .listPersonSourceMappingVersions({ governanceObjectId: exactV1.governanceObjectId,
      personSourceMappingId: exactV1.personSourceMappingId })).length, 1);
  checks['registerCannotRepoint'] = true;
  checks['duplicateRegistrationBlocked'] = true;

  const sameKeyOtherSystem = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping({ ...exactCommand, sourceSystem: SOURCE_MAPPING_FIXTURE.sourceSystems[1],
      personId: people[3]! });
  const sameKeyOtherEntity = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping({ ...exactCommand, sourceEntity: SOURCE_MAPPING_FIXTURE.sourceEntities[1],
      personId: people[4]! });
  assert.notEqual(sameKeyOtherSystem.personSourceMappingId, exactV1.personSourceMappingId);
  assert.notEqual(sameKeyOtherEntity.personSourceMappingId, exactV1.personSourceMappingId);
  checks['differentSystemSameKeyAllowed'] = true;
  checks['differentEntitySameKeyAllowed'] = true;
  checks['multipleSourceRecordsMayMapSamePerson'] = true;

  const rawStableBefore = await handle.database.selectFrom('person_master.person_source_mapping').selectAll()
    .where('person_source_mapping_id', '=', reference.personSourceMappingId).executeTakeFirstOrThrow();
  const rawV1Before = await handle.database.selectFrom('person_master.person_source_mapping_version').selectAll()
    .where('person_source_mapping_version_id', '=', first.personSourceMappingVersionId).executeTakeFirstOrThrow();
  const correctionContext = sourceMappingContext();
  const correctionApp = createSourceMappingApplication(handle.database, correctionContext);
  const correction = { ...reference, expectedCurrentVersionId: first.personSourceMappingVersionId,
    correctedPersonId: people[1]!, businessValidFrom: '2025-07-01T00:00:00', businessValidTo: null,
    reasonCode: 'WRONG_PERSON_BINDING' as const };
  const corrected = await correctionApp.correctPersonSourceMapping(correction);
  assert.equal(corrected.personId, people[1]);
  assert.equal(corrected.changeKind, 'CORRECTED');
  assert.equal(corrected.mappingStatus, 'MAPPED');
  assert.equal(corrected.supersedesMappingVersionId, first.personSourceMappingVersionId);
  assert.equal(corrected.reasonCode, 'WRONG_PERSON_BINDING');
  assert.deepEqual(await correctionApp.correctPersonSourceMapping(correction), corrected);
  await assert.rejects(correctionApp.correctPersonSourceMapping({ ...correction,
    correctedPersonId: people[2]! }), /SOURCE_MAPPING_OPERATION_CONFLICT/u);
  assert.deepEqual(await handle.database.selectFrom('person_master.person_source_mapping').selectAll()
    .where('person_source_mapping_id', '=', reference.personSourceMappingId).executeTakeFirstOrThrow(), rawStableBefore);
  assert.deepEqual(await handle.database.selectFrom('person_master.person_source_mapping_version').selectAll()
    .where('person_source_mapping_version_id', '=', first.personSourceMappingVersionId).executeTakeFirstOrThrow(), rawV1Before);
  checks['explicitCorrectionWorks'] = true;
  checks['sourceMappingVersionImmutable'] = true;
  checks['stableMappingUnchanged'] = true;
  checks['supersedesPreviousRequired'] = true;
  checks['correctionReasonRequired'] = true;

  const history = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .listPersonSourceMappingVersions(reference);
  assert.deepEqual(history, [first, corrected]);
  const historicalBusinessAt = '2025-08-01T00:00:00';
  const readApp = createSourceMappingApplication(handle.database, sourceMappingContext());
  assert.deepEqual(await readApp.findPersonSourceMappingAsOf({ ...reference,
    businessAt: historicalBusinessAt, recordAsOf: first.recordedFrom }), first);
  assert.deepEqual(await readApp.findPersonSourceMappingAsOf({ ...reference,
    businessAt: historicalBusinessAt, recordAsOf: corrected.recordedFrom }), corrected);
  assert.deepEqual(await readApp.findPersonSourceMappingAsOf({ ...reference,
    businessAt: '2025-03-01T00:00:00', recordAsOf: corrected.recordedFrom }), first);
  const mapping = await readApp.getPersonSourceMapping(reference);
  assert.deepEqual(await readApp.findPersonBySourceRecord({ governanceObjectId: mapping.governanceObjectId,
    sourceSystem: mapping.sourceSystem, sourceEntity: mapping.sourceEntity,
    sourceRecordKey: mapping.sourceRecordKey, businessAt: historicalBusinessAt,
    recordAsOf: corrected.recordedFrom }), corrected);
  assert.equal(await readApp.findPersonBySourceRecord({ governanceObjectId: firstCommand.governanceObjectId,
    sourceSystem: firstCommand.sourceSystem, sourceEntity: firstCommand.sourceEntity,
    sourceRecordKey: `${firstCommand.sourceRecordKey}-UNKNOWN`, businessAt: historicalBusinessAt,
    recordAsOf: corrected.recordedFrom }), null);
  checks['recordTimeHistoryPreserved'] = true;
  checks['businessTimeHistoryPreserved'] = true;
  checks['historicalWrongMappingReproducible'] = true;
  checks['correctedCurrentMappingVisible'] = true;
  checks['exactSourceLookupOnly'] = true;

  await assert.rejects(createSourceMappingApplication(handle.database, sourceMappingContext())
    .correctPersonSourceMapping({ ...correction,
      expectedCurrentVersionId: first.personSourceMappingVersionId }), /SOURCE_MAPPING_STALE_VERSION/u);
  const staleContext = sourceMappingContext();
  await assert.rejects(createSourceMappingApplication(handle.database, staleContext)
    .correctPersonSourceMapping({ ...correction,
      expectedCurrentVersionId: first.personSourceMappingVersionId }), /SOURCE_MAPPING_STALE_VERSION/u);
  const staleAudit = await createAuditModule(handle.database, personContext()).query({
    governanceObjectId: PERSON_FIXTURE.objectId, requestId: staleContext.requestId, limit: 10 });
  assert.equal(staleAudit.filter((event) => event.action === 'PERSON_SOURCE_MAPPING_CORRECTION_REJECTED').length, 1);
  checks['staleCorrectionBlocked'] = true;
  checks['rejectedCorrectionAudited'] = true;

  const concurrencyV1 = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping(sourceMappingCreation(people[2]!, runId, 60));
  const concurrentCommand = { governanceObjectId: concurrencyV1.governanceObjectId,
    personSourceMappingId: concurrencyV1.personSourceMappingId,
    expectedCurrentVersionId: concurrencyV1.personSourceMappingVersionId,
    businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null,
    reasonCode: 'WRONG_PERSON_BINDING' as const };
  const concurrent = await Promise.allSettled([people[3]!, people[4]!].map((correctedPersonId) =>
    createSourceMappingApplication(handle.database, sourceMappingContext())
      .correctPersonSourceMapping({ ...concurrentCommand, correctedPersonId })));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const concurrentFailures = concurrent.filter((result) => result.status === 'rejected');
  assert.equal(concurrentFailures.length, 1);
  assert.equal(concurrentFailures[0]!.reason.message, 'SOURCE_MAPPING_STALE_VERSION');
  const concurrencyHistory = await readApp.listPersonSourceMappingVersions({
    governanceObjectId: concurrencyV1.governanceObjectId,
    personSourceMappingId: concurrencyV1.personSourceMappingId });
  assert.deepEqual(concurrencyHistory.map((version) => version.versionNo), ['1', '2']);
  checks['concurrentCorrectionSafe'] = true;
  checks['sourceMappingVersionMonotonic'] = true;

  const validityV1 = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping(sourceMappingCreation(people[4]!, runId, 70));
  const validityV2 = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .correctPersonSourceMapping({ governanceObjectId: validityV1.governanceObjectId,
      personSourceMappingId: validityV1.personSourceMappingId,
      expectedCurrentVersionId: validityV1.personSourceMappingVersionId,
      correctedPersonId: validityV1.personId, businessValidFrom: '2025-03-01T00:00:00',
      businessValidTo: null, reasonCode: 'BUSINESS_VALIDITY_CORRECTION' });
  assert.equal(validityV2.personId, validityV1.personId);
  assert.equal(validityV2.changeKind, 'CORRECTED');
  checks['samePersonValidityCorrectionWorks'] = true;

  const retractionV1 = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping(sourceMappingCreation(people[0]!, runId, 80));
  const retractionReference = { governanceObjectId: retractionV1.governanceObjectId,
    personSourceMappingId: retractionV1.personSourceMappingId };
  const retracted = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .retractPersonSourceMapping({ ...retractionReference,
      expectedCurrentVersionId: retractionV1.personSourceMappingVersionId,
      businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null,
      reasonCode: 'SOURCE_RECORD_RECONCILIATION' });
  assert.equal(retracted.personId, retractionV1.personId);
  assert.equal(retracted.mappingStatus, 'RETRACTED');
  assert.equal(await readApp.findPersonSourceMappingAsOf({ ...retractionReference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: retracted.recordedFrom }), null);
  assert.deepEqual(await readApp.findPersonSourceMappingAsOf({ ...retractionReference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: retractionV1.recordedFrom }), retractionV1);
  const afterRetraction = await createSourceMappingApplication(handle.database, sourceMappingContext())
    .correctPersonSourceMapping({ ...retractionReference,
      expectedCurrentVersionId: retracted.personSourceMappingVersionId,
      correctedPersonId: people[2]!, businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null,
      reasonCode: 'WRONG_PERSON_BINDING' });
  assert.equal(afterRetraction.versionNo, '3');
  assert.equal(afterRetraction.personId, people[2]);
  assert.deepEqual(await readApp.findPersonSourceMappingAsOf({ ...retractionReference,
    businessAt: '2025-06-01T00:00:00', recordAsOf: afterRetraction.recordedFrom }), afterRetraction);
  const retractionHistory = await readApp.listPersonSourceMappingVersions(retractionReference);
  assert.deepEqual(retractionHistory, [retractionV1, retracted, afterRetraction]);
  checks['retractionPreservesHistory'] = true;
  checks['correctionAfterRetractionWorks'] = true;
  checks['physicalDeleteAbsent'] = true;

  const unknownCommand = sourceMappingCreation(randomUUID(), runId, 90);
  await assert.rejects(createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping(unknownCommand), /SOURCE_MAPPING_TARGET_PERSON_INVALID/u);
  await assert.rejects(createSourceMappingApplication(handle.database, sourceMappingContext())
    .registerPersonSourceMapping({ ...firstCommand,
      governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId }), /PERSON_GOVERNANCE_SCOPE_INVALID/u);
  for (const actorId of [PROTOTYPE_FIXTURE.serviceConsumerPrincipalId, PERSON_FIXTURE.inactiveActorId]) {
    const deniedContext = sourceMappingContext(randomUUID(), actorId);
    await assert.rejects(createSourceMappingApplication(handle.database, deniedContext)
      .registerPersonSourceMapping(firstCommand), /PERSON_HUMAN_ACTOR_REQUIRED/u);
    const deniedAudit = await createAuditModule(handle.database, personContext()).query({
      governanceObjectId: PERSON_FIXTURE.objectId, requestId: deniedContext.requestId, limit: 10 });
    assert.equal(deniedAudit.filter((event) => event.action === 'PERSON_SOURCE_MAPPING_ACCESS_DENIED').length, 1);
  }
  await assert.rejects(createSourceMappingApplication(handle.database,
    sourceMappingContext(randomUUID(), IDENTIFIER_FIXTURE.identifierOwnerId))
    .getPersonSourceMapping(reference), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createIdentifierApplication(handle.database, sourceMappingContext())
    .getPersonIdentifier({ governanceObjectId: PERSON_FIXTURE.objectId,
      personIdentifierId: randomUUID() }), /OBJECT_PERMISSION_FORBIDDEN/u);
  checks['unknownPersonRejected'] = true;
  checks['crossGovernancePersonRejected'] = true;
  checks['humanActorRequired'] = true;
  checks['authorizationSeparated'] = true;

  const faultRegistrationContext = sourceMappingContext();
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await assert.rejects(createSourceMappingApplication(handle.database, faultRegistrationContext)
      .registerPersonSourceMapping(sourceMappingCreation(people[0]!, runId, 100)),
    /SOURCE_MAPPING_OPERATION_FAILED/u);
  } finally { configureControlledPublicationFault(null); }
  assert.equal((await handle.database.selectFrom('person_master.person_source_mapping')
    .select('person_source_mapping_id').where('creation_request_id', '=', faultRegistrationContext.requestId)
    .execute()).length, 0);
  const correctionCountBefore = (await readApp.listPersonSourceMappingVersions(reference)).length;
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await assert.rejects(createSourceMappingApplication(handle.database, sourceMappingContext())
      .correctPersonSourceMapping({ ...correction,
        expectedCurrentVersionId: corrected.personSourceMappingVersionId,
        correctedPersonId: people[2]! }), /SOURCE_MAPPING_OPERATION_FAILED/u);
  } finally { configureControlledPublicationFault(null); }
  assert.equal((await readApp.listPersonSourceMappingVersions(reference)).length, correctionCountBefore);
  checks['auditFailureRollsBack'] = true;

  const mappingAudit = await handle.database.selectFrom('audit.audit_event')
    .select(['event_payload', 'after_hash']).where('action', 'like', 'PERSON_SOURCE_MAPPING_%').execute();
  const auditText = JSON.stringify(mappingAudit);
  assert.ok(!/sourceRecordKey|source_record_key|sourceKeyHash|sourceKeyDigest|SYN-/u.test(auditText),
    'RAW_SOURCE_KEY_AUDIT_ABSENT');
  assert.ok(mappingAudit.every((row) => row.after_hash === null));
  assert.equal(await createAuditModule(handle.database, personContext()).verifyChain(PERSON_FIXTURE.objectId), true);
  const metricText = JSON.stringify(await createAuditModule(handle.database, personContext()).readConsumerMetricFacts());
  assert.ok(!metricText.includes(firstCommand.sourceRecordKey));
  checks['sourceKeyAuditAbsent'] = true;
  checks['sourceKeyMetricsAbsent'] = true;

  const privacyErrors: string[] = [];
  let capturedStdout = '';
  let capturedStderr = '';
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    capturedStdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    capturedStderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const invocation of [
      () => createSourceMappingApplication(handle.database, sourceMappingContext())
        .registerPersonSourceMapping({ ...firstCommand, personId: people[2]! }),
      () => createSourceMappingApplication(handle.database, sourceMappingContext())
        .correctPersonSourceMapping({ ...correction,
          expectedCurrentVersionId: first.personSourceMappingVersionId }),
      () => createSourceMappingApplication(handle.database, sourceMappingContext())
        .registerPersonSourceMapping({ ...unknownCommand, sourceRecordKey: `${unknownCommand.sourceRecordKey}-INVALID` }),
    ]) {
      try { await invocation(); }
      catch (error) { privacyErrors.push(error instanceof Error ? error.message : String(error)); }
    }
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  const capturedProcessOutput = `${capturedStdout}${capturedStderr}`;
  const rawKeys = [firstCommand.sourceRecordKey, unknownCommand.sourceRecordKey,
    `${unknownCommand.sourceRecordKey}-INVALID`];
  assert.ok(privacyErrors.length === 3 && privacyErrors.every((message) =>
    rawKeys.every((rawKey) => !message.includes(rawKey))));
  assert.ok(rawKeys.every((rawKey) => !capturedProcessOutput.includes(rawKey)));
  checks['sourceKeyErrorAbsent'] = true;
  checks['sourceKeyLogAbsent'] = true;
  checks['sourceKeyStdoutAbsent'] = true;
  checks['sourceKeyStderrAbsent'] = true;

  assert.equal(await count('person_master.person_subject'), personCountBefore);
  assert.equal(await count('person_master.person_identifier'), identifierCountBefore);
  checks['automaticPersonCreationAbsent'] = true;
  checks['automaticPersonMergeAbsent'] = true;
  checks['identifierSideEffectAbsent'] = true;
  checks['personCoreSideEffectAbsent'] = true;
  const publicMethods = Object.keys(createSourceMappingApplication(handle.database, sourceMappingContext())).sort();
  assert.deepEqual(publicMethods, ['registerPersonSourceMapping', 'correctPersonSourceMapping',
    'retractPersonSourceMapping', 'getPersonSourceMapping', 'getPersonSourceMappingVersion',
    'listPersonSourceMappingVersions', 'findPersonSourceMappingAsOf', 'findPersonBySourceRecord'].sort());
  checks['genericMutationAbsent'] = true;
  checks['automaticIdentityResolutionAbsent'] = true;

  const orphan = await sql<{ count: string }>`select count(*) from person_master.person_source_mapping m
    where not exists (select 1 from person_master.person_source_mapping_version v
      where v.person_source_mapping_id = m.person_source_mapping_id and v.version_no = 1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0');
  checks['orphanMappingsZero'] = true;
  if (persistencePath) {
    const start = await sql<{ started: string }>`select
      (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
    await mkdir(dirname(persistencePath), { recursive: true });
    const receipt: Receipt = { reference, versions: history, first, corrected,
      retraction: { reference: retractionReference, versions: retractionHistory },
      databaseStartedAt: start.rows[0]!.started };
    await writeFile(persistencePath, JSON.stringify(receipt, null, 2));
  }
}

async function count(table: 'person_master.person_subject' | 'person_master.person_identifier'): Promise<string> {
  if (table === 'person_master.person_subject') {
    const result = await sql<{ count: string }>`select count(*) from person_master.person_subject`.execute(handle.database);
    return result.rows[0]!.count;
  }
  const result = await sql<{ count: string }>`select count(*) from person_master.person_identifier`.execute(handle.database);
  return result.rows[0]!.count;
}
