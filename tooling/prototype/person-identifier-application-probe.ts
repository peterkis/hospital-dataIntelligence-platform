import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createIdentifierApplication } from '../../apps/governance-api/src/composition/create-person-identifier-application.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAuditModule } from '../../apps/governance-api/src/modules/audit/index.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import type { PersonIdentifierVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { PERSON_FIXTURE, personContext } from './person-subject-fixture.js';
import { IDENTIFIER_FIXTURE, identifierContext, identifierCreation, seedIdentifierScope } from './person-identifier-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_IDENTIFIER_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const checks: Record<string, boolean> = {};
const path = process.env['PERSON_IDENTIFIER_PERSISTENCE_FILE'];
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], application_name: 'hdi-identifier-application-probe', max: 8 });
const server = Fastify({ logger: false });
server.addHook('onClose', async () => handle.close());
type Receipt = { reference: { governanceObjectId: string; personIdentifierId: string }; versions: readonly PersonIdentifierVersion[]; first: PersonIdentifierVersion; databaseStartedAt: string };
try {
  await server.ready();
  if (process.argv.includes('--recover')) {
    assert.ok(path, 'PERSISTENCE_FILE_REQUIRED');
    const receipt: Receipt = JSON.parse(await readFile(path, 'utf8'));
    const app = createIdentifierApplication(handle.database, identifierContext());
    const versions = await app.listPersonIdentifierVersions(receipt.reference);
    assert.deepEqual(versions, receipt.versions);
    assert.deepEqual(await app.findPersonIdentifierAsOf({ ...receipt.reference, businessAt: '2024-06-01T00:00:00', recordAsOf: receipt.first.recordedFrom }), receipt.first);
    const rel = await app.getPersonIdentifier(receipt.reference);
    const found = await app.findPersonByIdentifier({ governanceObjectId: rel.governanceObjectId, identifierSystem: rel.identifierSystem,
      identifierValue: rel.identifierValue, businessAt: '2024-06-01T00:00:00', recordAsOf: receipt.first.recordedFrom });
    assert.equal(found?.personId, receipt.first.personId);
    const restart = await sql<{ started: string }>`select (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
    assert.notEqual(restart.rows[0]?.started, receipt.databaseStartedAt, 'ACTUAL_DATABASE_RESTART_REQUIRED');
    checks['restartPersistenceObserved'] = true;
    checks['exactLookupAfterRestart'] = true;
  } else {
    await exercise();
  }
} finally { await server.close(); }
checks['fastifyClosed'] = true; checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-A-02A', classification: IDENTIFIER_FIXTURE.classification, timeZone: IDENTIFIER_FIXTURE.timeZone,
  status: 'PASSED', mode: process.argv.includes('--recover') ? 'RECOVERY' : 'APPLICATION',
  syntheticPersons: 6, syntheticIdentifiers: process.argv.includes('--recover') ? 0 : 16, identifierSystems: 2,
  realStaffIdentifiers: 0, realNationalIds: 0, realPassports: 0, realHR: 0, realHIS: 0, realEMR: 0, checks }));

async function exercise() {
  const persons = await seedIdentifierScope(handle.database);
  const beforePersons = await handle.database.selectFrom('person_master.person_subject').selectAll().orderBy('person_id').execute();
  const runId = randomUUID();
  const app = createIdentifierApplication(handle.database, identifierContext());
  const commands = persons.flatMap((person, index) => IDENTIFIER_FIXTURE.systems.map((system, systemIndex) =>
    identifierCreation(systemIndex === 0 ? person : persons[(index + 1) % persons.length]!, runId, index, system)));
  const created: PersonIdentifierVersion[] = [];
  for (const command of commands) created.push(await createIdentifierApplication(handle.database, identifierContext()).registerPersonIdentifier(command));
  const first = created[0]!; const command = commands[0]!;
  const reference = { governanceObjectId: PERSON_FIXTURE.objectId, personIdentifierId: first.personIdentifierId };
  assert.match(first.personIdentifierId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/u);
  assert.notEqual(first.personIdentifierId, first.personId);
  assert.equal(first.assertionStatus, 'ASSERTED'); assert.equal(first.versionNo, '1');
  checks['identifierRegistered'] = true; checks['identifierStableIdCreated'] = true;

  const retryContext = identifierContext(); const retryApp = createIdentifierApplication(handle.database, retryContext);
  const exactVariants = [`${command.identifierValue}-a/0`, `${command.identifierValue}-A/0`, `${command.identifierValue}-a0`];
  const repeatCommand = { ...command, identifierValue: exactVariants[0]! };
  const simultaneousRetries = await Promise.all([retryApp.registerPersonIdentifier(repeatCommand), retryApp.registerPersonIdentifier(repeatCommand)]);
  assert.deepEqual(simultaneousRetries[0], simultaneousRetries[1]);
  const registered = simultaneousRetries[0]!;
  for (const changed of [{ ...repeatCommand, identifierValue: exactVariants[1]! }, { ...repeatCommand, personId: persons[1]! },
    { ...repeatCommand, identifierSystem: IDENTIFIER_FIXTURE.systems[1] }, { ...repeatCommand, businessValidFrom: '2021-01-01T00:00:00' }]) {
    await assert.rejects(retryApp.registerPersonIdentifier(changed), /PERSON_IDENTIFIER_OPERATION_CONFLICT/u);
  }
  await assert.rejects(app.registerPersonIdentifier(repeatCommand), /PERSON_IDENTIFIER_ALREADY_REGISTERED/u);
  for (const value of exactVariants.slice(1)) await createIdentifierApplication(handle.database, identifierContext()).registerPersonIdentifier({ ...command, identifierValue: value });
  const retained = await app.getPersonIdentifier({ governanceObjectId: PERSON_FIXTURE.objectId, personIdentifierId: registered.personIdentifierId });
  assert.ok(retained.identifierValue === exactVariants[0], 'CANONICAL_VALUE_UNCHANGED');
  checks['sameOperationIdempotent'] = true; checks['sameRequestChangedCommandBlocked'] = true;
  checks['sameSystemValueSamePersonDuplicateBlocked'] = true; checks['noGlobalNormalization'] = true;
  checks['sameValueDifferentSystemAllowed'] = created[0]!.personIdentifierId !== created[1]!.personIdentifierId;
  assert.equal((await app.listPersonIdentifiers({ governanceObjectId: PERSON_FIXTURE.objectId, personId: persons[0]! }))
    .filter((row) => row.identifierValue.includes(runId)).length, 5);
  checks['multipleIdentifiersPerPersonAllowed'] = true;

  const collisionContext = identifierContext();
  await assert.rejects(createIdentifierApplication(handle.database, collisionContext).registerPersonIdentifier({ ...command, personId: persons[1]! }), /PERSON_IDENTIFIER_COLLISION/u);
  const events = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: collisionContext.requestId, limit: 10 });
  assert.equal(events.filter((event) => event.action === 'PERSON_IDENTIFIER_COLLISION_REJECTED').length, 1);
  checks['sameSystemValueDifferentPersonCollisionBlocked'] = true;
  const contestCommand = identifierCreation(persons[2]!, runId, 90);
  const contest = await Promise.allSettled(persons.slice(2, 4).map((personId) => createIdentifierApplication(handle.database, identifierContext())
    .registerPersonIdentifier({ ...contestCommand, personId })));
  assert.equal(contest.filter((result) => result.status === 'fulfilled').length, 1);
  const failed = contest.filter((result) => result.status === 'rejected');
  assert.equal(failed.length, 1); assert.equal(failed[0]!.reason.message, 'PERSON_IDENTIFIER_COLLISION');
  const rows = await handle.database.selectFrom('person_master.person_identifier').select('person_identifier_id')
    .where('identifier_system', '=', contestCommand.identifierSystem).where('identifier_value', '=', contestCommand.identifierValue).execute();
  assert.equal(rows.length, 1); checks['identifierConcurrencySafe'] = true;

  const unknown = identifierCreation(randomUUID(), runId, 91);
  await assert.rejects(app.registerPersonIdentifier(unknown), /PERSON_NOT_FOUND/u);
  await assert.rejects(app.registerPersonIdentifier({ ...command, governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId }), /PERSON_GOVERNANCE_SCOPE_INVALID/u);
  for (const actorId of [PROTOTYPE_FIXTURE.serviceConsumerPrincipalId, PERSON_FIXTURE.inactiveActorId]) {
    const deniedContext = identifierContext(randomUUID(), actorId);
    await assert.rejects(createIdentifierApplication(handle.database, deniedContext).registerPersonIdentifier(command), /PERSON_HUMAN_ACTOR_REQUIRED/u);
    const denied = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: deniedContext.requestId, limit: 10 });
    assert.equal(denied.filter((event) => event.action === 'PERSON_IDENTIFIER_ACCESS_DENIED').length, 1);
  }
  const coreOnly = createIdentifierApplication(handle.database, identifierContext(randomUUID(), PERSON_FIXTURE.ownerId));
  await assert.rejects(coreOnly.registerPersonIdentifier(command), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(coreOnly.getPersonIdentifier(reference), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createPersonApplication(handle.database, identifierContext()).getPersonSubject({ governanceObjectId: PERSON_FIXTURE.objectId, personId: persons[0]! }), /OBJECT_PERMISSION_FORBIDDEN/u);
  checks['authorizationSeparated'] = true; checks['humanActorRequired'] = true;

  const change = { ...reference, assertionStatus: 'ASSERTED' as const, businessValidFrom: '2024-01-01T00:00:00', businessValidTo: '2025-01-01T00:00:00' };
  const changeApp = createIdentifierApplication(handle.database, identifierContext());
  const v2 = await changeApp.createPersonIdentifierVersion(change);
  assert.deepEqual(await changeApp.createPersonIdentifierVersion(change), v2);
  await assert.rejects(changeApp.createPersonIdentifierVersion({ ...change, assertionStatus: 'RETRACTED' }), /PERSON_IDENTIFIER_OPERATION_CONFLICT/u);
  const v3 = await createIdentifierApplication(handle.database, identifierContext()).createPersonIdentifierVersion({ ...change, assertionStatus: 'RETRACTED' });
  assert.deepEqual((await app.listPersonIdentifierVersions(reference))[0], first);
  const timeQuery = { ...reference, businessAt: '2024-06-01T00:00:00', recordAsOf: v2.recordedFrom };
  assert.deepEqual(await app.findPersonIdentifierAsOf(timeQuery), v2);
  assert.deepEqual(await app.findPersonIdentifierAsOf({ ...timeQuery, recordAsOf: first.recordedFrom }), first);
  assert.equal(await app.findPersonIdentifierAsOf({ ...timeQuery, recordAsOf: v3.recordedFrom }), null);
  for (const businessAt of ['2023-12-31T23:59:59', '2025-01-01T00:00:00']) {
    assert.deepEqual(await app.findPersonIdentifierAsOf({ ...timeQuery, businessAt, recordAsOf: v3.recordedFrom }), first);
  }
  const exact = { governanceObjectId: command.governanceObjectId, identifierSystem: command.identifierSystem, identifierValue: command.identifierValue,
    businessAt: timeQuery.businessAt, recordAsOf: first.recordedFrom };
  assert.deepEqual(await app.findPersonByIdentifier(exact), first);
  assert.equal(await app.findPersonByIdentifier({ ...exact, recordAsOf: v3.recordedFrom }), null);
  const unknownContext = identifierContext();
  assert.equal(await createIdentifierApplication(handle.database, unknownContext).findPersonByIdentifier({ ...exact, identifierValue: unknown.identifierValue }), null);
  const missingEvents = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: unknownContext.requestId, limit: 10 });
  assert.equal(missingEvents[0]?.payload['result'], 'NOT_FOUND');
  assert.equal(await app.findPersonByIdentifier({ ...exact, identifierValue: command.identifierValue.toLowerCase() }), null);
  assert.equal((await app.findPersonByIdentifier({ ...exact, identifierSystem: IDENTIFIER_FIXTURE.systems[1], recordAsOf: created[1]!.recordedFrom }))?.personIdentifierId, created[1]!.personIdentifierId);
  assert.notEqual(created[1]!.personId, first.personId);
  await assert.rejects(createIdentifierApplication(handle.database, identifierContext()).registerPersonIdentifier({ ...command, personId: persons[1]! }), /PERSON_IDENTIFIER_COLLISION/u);
  checks['exactLookupWorks'] = true; checks['businessTimeLookupWorks'] = true; checks['recordTimeLookupWorks'] = true;
  checks['retractionPreservesHistory'] = true; checks['retractedIdentifierNeverReassigned'] = true;
  const concurrentVersions = await Promise.all([0, 1].map(() => createIdentifierApplication(handle.database, identifierContext())
    .createPersonIdentifierVersion({ ...change, businessValidFrom: '2030-01-01T00:00:00', businessValidTo: null })));
  assert.deepEqual(concurrentVersions.map((v) => v.versionNo).sort(), ['4', '5']);
  const versions = await app.listPersonIdentifierVersions(reference);
  assert.ok(versions.slice(1).every((v, i) => v.recordedFrom > versions[i]!.recordedFrom));
  checks['identifierVersionImmutable'] = true; checks['identifierVersionMonotonic'] = true;

  for (const faultIndex of [0, 1]) {
    const faultContext = identifierContext();
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN', faultIndex);
    try {
      await assert.rejects(createIdentifierApplication(handle.database, faultContext).registerPersonIdentifier(identifierCreation(persons[0]!, runId, 100 + faultIndex)), /PERSON_IDENTIFIER_OPERATION_FAILED/u);
    } finally { configureControlledPublicationFault(null); }
    const residual = await handle.database.selectFrom('person_master.person_identifier').select('person_identifier_id').where('creation_request_id', '=', faultContext.requestId).execute();
    const falseAudit = await createAuditModule(handle.database, personContext()).query({ governanceObjectId: PERSON_FIXTURE.objectId, requestId: faultContext.requestId, limit: 10 });
    assert.equal(residual.length, 0); assert.equal(falseAudit.length, 0);
  }
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try { await assert.rejects(createIdentifierApplication(handle.database, identifierContext()).createPersonIdentifierVersion(change), /PERSON_IDENTIFIER_OPERATION_FAILED/u); }
  finally { configureControlledPublicationFault(null); }
  assert.deepEqual(await app.listPersonIdentifierVersions(reference), versions);
  checks['identifierFirstVersionAtomic'] = true; checks['auditFailureRollsBack'] = true;
  const allAudit = await handle.database.selectFrom('audit.audit_event').select(['event_payload', 'after_hash'])
    .where('action', 'like', 'PERSON_IDENTIFIER_%').execute();
  const auditText = JSON.stringify(allAudit);
  assert.ok(!/identifierValue|normalizedIdentifierValue|identifierValueHash|rawIdentifier|SYN-PN-|SYN-LPN-/u.test(auditText), 'RAW_IDENTIFIER_AUDIT_ABSENT');
  assert.ok(allAudit.every((row) => row.after_hash === null));
  assert.equal(await createAuditModule(handle.database, personContext()).verifyChain(PERSON_FIXTURE.objectId), true);
  checks['rawIdentifierAuditAbsent'] = true;
  assert.deepEqual(await handle.database.selectFrom('person_master.person_subject').selectAll().orderBy('person_id').execute(), beforePersons);
  checks['identifierNeverAutoCreatesPerson'] = true; checks['identifierNeverAutoMergesPerson'] = true; checks['identifierNeverReplacesPersonId'] = true;
  assert.deepEqual(Object.keys(app).sort(), ['registerPersonIdentifier', 'createPersonIdentifierVersion', 'getPersonIdentifier',
    'listPersonIdentifiers', 'listPersonIdentifierVersions', 'findPersonIdentifierAsOf', 'findPersonByIdentifier'].sort());
  checks['physicalDeleteAbsent'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.person_identifier i where not exists
    (select 1 from person_master.person_identifier_version v where v.person_identifier_id=i.person_identifier_id and v.version_no=1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0'); checks['orphanIdentifiersZero'] = true;
  if (path) {
    const start = await sql<{ started: string }>`select (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started`.execute(handle.database);
    const receipt: Receipt = { reference, versions, first, databaseStartedAt: start.rows[0]!.started };
    await writeFile(path, JSON.stringify(receipt, null, 2));
  }
}
