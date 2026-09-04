import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAuditModule } from '../../apps/governance-api/src/modules/audit/index.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { personContext, personCreation, seedPersonScope, PERSON_FIXTURE } from './person-subject-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_PROBE_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], application_name: 'hdi-person-application-probe', max: 6 });
const server = Fastify();
let databasePoolClosed = false;
server.addHook('onClose', async () => { await handle.close(); databasePoolClosed = true; });
const checks: Record<string, boolean> = {};
const runId = randomUUID();
let persisted: { personId: string; versions: unknown; subject: unknown; auditCount: number } | undefined;
try {
  await server.ready();
  await seedPersonScope(handle.database);
  const createContext = personContext(`${runId}-CREATE`);
  const app = createPersonApplication(handle.database, createContext);
  const created = await app.createPersonSubject(personCreation);
  assert.equal(created.versionNo, '1');
  assert.match(created.personId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/u);
  assert.notEqual(created.personId, createContext.actorPrincipalId);
  checks['personStableIdentityCreated'] = true;
  const read = await app.getPersonSubject({ governanceObjectId: personCreation.governanceObjectId, personId: created.personId });
  assert.equal(read.subject.personId, created.personId);
  assert.deepEqual(read.latestVersion, created);
  const retries = await Promise.all([app.createPersonSubject(personCreation), app.createPersonSubject(personCreation)]);
  assert.deepEqual(retries, [created, created]);
  await assert.rejects(app.createPersonSubject({ ...personCreation, facts: { canonicalName: 'SYNTHETIC DIFFERENT SUBJECT' } }), /PERSON_OPERATION_CONFLICT/u);
  checks['sameCreateOperationIdempotent'] = true;
  checks['incompatibleRetryFailsClosed'] = true;
  const correction = createPersonApplication(handle.database, personContext());
  const correctionCommand = {
    governanceObjectId: personCreation.governanceObjectId, personId: created.personId,
    facts: { canonicalName: 'SYNTHETIC 更正姓名' },
    businessValidFrom: personCreation.businessValidFrom, businessValidTo: null,
  };
  const next = await correction.createPersonSubjectVersion(correctionCommand);
  assert.deepEqual(await correction.createPersonSubjectVersion(correctionCommand), next);
  assert.equal(next.personId, created.personId);
  assert.equal(next.versionNo, '2');
  assert.deepEqual(await app.getPersonSubjectVersion({ governanceObjectId: personCreation.governanceObjectId, personId: created.personId, personVersionId: created.personVersionId }), created);
  checks['versionHistoryImmutable'] = true;
  const atFirst = await app.findPersonSubjectAsOf({ governanceObjectId: personCreation.governanceObjectId, personId: created.personId,
    businessAt: '2024-01-01T00:00:00', recordAsOf: created.recordedFrom });
  assert.deepEqual(atFirst, created);
  const reference = { governanceObjectId: PERSON_FIXTURE.objectId, personId: created.personId };
  assert.deepEqual(await app.findPersonSubjectAsOf({ ...reference, businessAt: '2024-01-01T00:00:00', recordAsOf: next.recordedFrom }), next);
  assert.equal(await app.findPersonSubjectAsOf({ ...reference, businessAt: '2019-12-31T23:59:59', recordAsOf: next.recordedFrom }), null);
  checks['bitemporalReadObserved'] = true;

  const concurrent = await Promise.all(['A', 'B'].map((label) => createPersonApplication(handle.database, personContext())
    .createPersonSubjectVersion({ ...correctionCommand, facts: { canonicalName: `SYNTHETIC CONCURRENT ${label}` } })));
  assert.deepEqual(concurrent.map((version) => version.versionNo).sort(), ['3', '4']);
  assert.ok(concurrent.every((version) => version.personId === created.personId));
  assert.deepEqual((await app.listPersonSubjectVersions(reference)).map((version) => version.versionNo), ['1', '2', '3', '4']);
  checks['concurrentVersioningSafe'] = true;
  checks['versionNumbersMonotonic'] = true;

  const similar = await createPersonApplication(handle.database, personContext()).createPersonSubject(personCreation);
  assert.notEqual(similar.personId, created.personId);
  const cohort = [created, similar];
  for (const label of ['OPTIONAL-DATE', 'UNICODE-𠮷', 'FUTURE-VALID', 'BOUNDED-VALID']) {
    cohort.push(await createPersonApplication(handle.database, personContext()).createPersonSubject({ ...personCreation,
      facts: { canonicalName: `SYNTHETIC ${label}` },
      businessValidFrom: label === 'FUTURE-VALID' ? '2030-01-01T00:00:00' : personCreation.businessValidFrom,
      businessValidTo: label === 'BOUNDED-VALID' ? '2025-01-01T00:00:00' : null,
    }));
  }
  assert.equal(new Set(cohort.map((person) => person.personId)).size, 6);
  checks['similarFactsNotAutomaticallyMerged'] = true;
  const future = cohort[4]!;
  assert.equal(await app.findPersonSubjectAsOf({ governanceObjectId: PERSON_FIXTURE.objectId, personId: future.personId,
    businessAt: '2029-12-31T23:59:59', recordAsOf: future.recordedFrom }), null);
  const bounded = cohort[5]!;
  assert.equal(await app.findPersonSubjectAsOf({ governanceObjectId: PERSON_FIXTURE.objectId, personId: bounded.personId,
    businessAt: '2025-01-01T00:00:00', recordAsOf: bounded.recordedFrom }), null);
  checks['businessPeriodHalfOpen'] = true;
  const partial = cohort[2]!;
  const scopedCorrection = await createPersonApplication(handle.database, personContext()).createPersonSubjectVersion({
    governanceObjectId: PERSON_FIXTURE.objectId, personId: partial.personId, facts: { canonicalName: 'SYNTHETIC BOUNDED CORRECTION' },
    businessValidFrom: '2024-01-01T00:00:00', businessValidTo: '2025-01-01T00:00:00',
  });
  const partialQuery = { governanceObjectId: PERSON_FIXTURE.objectId, personId: partial.personId, recordAsOf: scopedCorrection.recordedFrom };
  assert.deepEqual(await app.findPersonSubjectAsOf({ ...partialQuery, businessAt: '2023-12-31T23:59:59' }), partial);
  assert.deepEqual(await app.findPersonSubjectAsOf({ ...partialQuery, businessAt: '2024-01-01T00:00:00' }), scopedCorrection);
  assert.deepEqual(await app.findPersonSubjectAsOf({ ...partialQuery, businessAt: '2025-01-01T00:00:00' }), partial);
  assert.deepEqual(await app.findPersonSubjectAsOf({ ...partialQuery, recordAsOf: partial.recordedFrom, businessAt: '2024-01-01T00:00:00' }), partial);
  checks['correctionPreservesUncoveredBusinessPeriods'] = true;
  for (const businessValidFrom of ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00+08:00', '2025-02-29T00:00:00']) {
    await assert.rejects(correction.createPersonSubjectVersion({ ...correctionCommand, businessValidFrom }), /LOCAL_DATETIME_INVALID/u);
  }
  await assert.rejects(correction.createPersonSubjectVersion({ ...correctionCommand,
    businessValidFrom: '2024-01-01T00:00:00', businessValidTo: '2024-01-01T00:00:00.000000' }), /PERSON_BUSINESS_TIME_INVALID/u);
  checks['localTimeInputFailsClosed'] = true;

  for (const subjectEligibility of ['PATIENT', 'FAMILY', 'VENDOR_CONTACT', 'VISITOR', 'SERVICE_ACCOUNT', 'MACHINE', 'BOT']) {
    const invalid = { ...personCreation, subjectEligibility };
    // Deliberately exercise runtime rejection beyond the literal TypeScript contract.
    await assert.rejects(app.createPersonSubject(invalid as typeof personCreation), /PERSON_SUBJECT_SCOPE_INVALID/u);
  }
  const serviceRequest = personContext(`${runId}-SERVICE-DENIED`, PROTOTYPE_FIXTURE.serviceConsumerPrincipalId);
  const scopeRequest = personContext(`${runId}-SCOPE-DENIED`);
  const inactiveRequest = personContext(`${runId}-INACTIVE-DENIED`, PERSON_FIXTURE.inactiveActorId);
  await assert.rejects(createPersonApplication(handle.database, serviceRequest)
    .createPersonSubject(personCreation), /PERSON_HUMAN_ACTOR_REQUIRED/u);
  await assert.rejects(createPersonApplication(handle.database, inactiveRequest)
    .createPersonSubject(personCreation), /PERSON_HUMAN_ACTOR_REQUIRED/u);
  await assert.rejects(createPersonApplication(handle.database, personContext(randomUUID(), PROTOTYPE_FIXTURE.actorPrincipalId))
    .createPersonSubject(personCreation), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createPersonApplication(handle.database, scopeRequest).getPersonSubject({ ...reference, governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId }), /PERSON_GOVERNANCE_SCOPE_INVALID/u);
  for (const deniedRequest of [serviceRequest, scopeRequest, inactiveRequest]) {
    const events = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: deniedRequest.requestId, limit: 10 });
    assert.equal(events.filter((event) => event.action === 'PERSON_CORE_ACCESS_DENIED').length, 1, 'PERSON_DENIAL_AUDIT_REQUIRED');
    assert.equal(events[0]?.actorId, deniedRequest.actorPrincipalId);
  }
  checks['scopeAndActorDenialsAudited'] = true;
  checks['authorizationEnforced'] = true;
  checks['nonPersonnelSubjectsRejected'] = true;
  assert.deepEqual(Object.keys(app).sort(), ['createPersonSubject', 'createPersonSubjectVersion', 'findPersonSubjectAsOf',
    'getPersonSubject', 'getPersonSubjectVersion', 'listPersonSubjectVersions'].sort());
  checks['physicalDeleteAbsent'] = true;

  for (const faultAfterAudit of [0, 1]) {
    const faultRequest = `${runId}-FAULT-${faultAfterAudit}`;
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN', faultAfterAudit);
    try {
      await assert.rejects(createPersonApplication(handle.database, personContext(faultRequest)).createPersonSubject(personCreation), /CONTROLLED_PUBLICATION_FAULT/u);
    } finally { configureControlledPublicationFault(null); }
    const subjects = await handle.database.selectFrom('person_master.person_subject').select('person_id').where('creation_request_id', '=', faultRequest).execute();
    const audit = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: faultRequest, limit: 100 });
    assert.equal(subjects.length, 0); assert.equal(audit.length, 0);
  }
  checks['firstVersionCreatedAtomically'] = true;
  checks['faultRollbackLeavesNoOrphanOrAudit'] = true;
  const beforeFailure = await app.listPersonSubjectVersions(reference);
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await assert.rejects(createPersonApplication(handle.database, personContext()).createPersonSubjectVersion(correctionCommand), /CONTROLLED_PUBLICATION_FAULT/u);
  } finally { configureControlledPublicationFault(null); }
  assert.deepEqual(await app.listPersonSubjectVersions(reference), beforeFailure);
  checks['versionAuditAtomic'] = true;

  const audit = createAuditModule(handle.database, personContext());
  assert.equal(await audit.verifyChain(PERSON_FIXTURE.objectId), true);
  const createdAudit = await audit.query({ governanceObjectId: PERSON_FIXTURE.objectId, stableEntityId: created.personId, limit: 1000 });
  assert.equal(createdAudit.filter((event) => event.action === 'PERSON_SUBJECT_CREATED').length, 1);
  assert.equal(createdAudit.filter((event) => event.action === 'PERSON_SUBJECT_VERSION_CREATED').length, 4);
  assert.ok(createdAudit.some((event) => event.action === 'PERSON_SUBJECT_READ'));
  checks['auditPersisted'] = true;
  persisted = { personId: created.personId, versions: await app.listPersonSubjectVersions(reference), subject: (await app.getPersonSubject(reference)).subject,
    auditCount: createdAudit.filter((event) => event.action !== 'PERSON_SUBJECT_READ').length };
} finally { await server.close(); }

assert.ok(databasePoolClosed);
const reopened = createDatabase({ connectionString: process.env['DATABASE_URL'], application_name: 'hdi-person-restart-probe', max: 3 });
const restartedServer = Fastify();
let restartedPoolClosed = false;
restartedServer.addHook('onClose', async () => { await reopened.close(); restartedPoolClosed = true; });
try {
  await restartedServer.ready(); assert.ok(persisted);
  const app = createPersonApplication(reopened.database, personContext());
  const reference = { governanceObjectId: PERSON_FIXTURE.objectId, personId: persisted.personId };
  assert.deepEqual(await app.listPersonSubjectVersions(reference), persisted.versions);
  assert.deepEqual((await app.getPersonSubject(reference)).subject, persisted.subject);
  const audit = createAuditModule(reopened.database, personContext());
  assert.equal(await audit.verifyChain(PERSON_FIXTURE.objectId), true);
  const events = await audit.query({ governanceObjectId: PERSON_FIXTURE.objectId, stableEntityId: persisted.personId, limit: 1000 });
  assert.equal(events.filter((event) => event.action !== 'PERSON_SUBJECT_READ').length, persisted.auditCount);
  checks['restartPersistenceObserved'] = true;
  const sessions = await sql<{ count: string }>`select count(*) from pg_stat_activity where application_name = 'hdi-person-application-probe'`.execute(reopened.database);
  assert.equal(sessions.rows[0]?.count, '0');
} finally { await restartedServer.close(); }
checks['databasePoolClosed'] = databasePoolClosed && restartedPoolClosed;
checks['fastifyClosed'] = true;
assert.ok(Object.values(checks).every(Boolean));
const report = { task: 'PV-006-A-01', status: 'PASSED', classification: PERSON_FIXTURE.classification, timeZone: PERSON_FIXTURE.timeZone,
  syntheticPersons: 6, checks };
if (process.env['PERSON_PROBE_REPORT']) await writeFile(process.env['PERSON_PROBE_REPORT'], `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
