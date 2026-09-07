import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentFixture, assignmentScope, departmentScope, Jan, Jul, Dec } from './person-assignment-fixture.js';
import { runAssignmentSemanticSqlProbe, assignmentSemanticSqlObservations } from './person-assignment-semantics-sql-probe.js';
import { runAssignmentSemanticBehavior } from './person-assignment-semantics-behavior-probe.js';
import { runAssignmentSemanticConcurrency } from './person-assignment-semantics-concurrency-probe.js';
import { runAssignmentSemanticAccess } from './person-assignment-semantics-access-probe.js';
import { assignmentSemanticDatabaseIdentity, assignmentSemanticRecoveryFingerprint } from './person-assignment-semantics-recovery-support.js';

assert.ok(process.env['DATABASE_URL'], 'MANAGED_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const runId = randomUUID(), directory = `.runtime/pv006-c02/${runId}`;
await mkdir(directory, { recursive: true });
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 12,
  application_name: 'hdi-pv006-c02-application' });
let failure: unknown;
let recovery: Awaited<ReturnType<typeof runAssignmentSemanticBehavior>> | undefined;
const cases: { ids: string[]; name: string; status: string; evidence?:unknown }[] = [];
async function check(ids:string[],name:string,work:()=>Promise<unknown>) {
  console.log(JSON.stringify({caseStarted:ids,name}));
  try {const evidence=await work();cases.push({ids,name,status:'PASS',evidence});}
  catch(error){cases.push({ids,name,status:'FAILED'});throw error;}
}
try {
  assert.ok(process.argv.slice(2).length===0 || (process.argv.length===3 && process.argv[2]==='--sql-probe'), 'C02_APPLICATION_MODE_INVALID');
  const endpoint = new URL(process.env['DATABASE_URL']!);
  assert.equal(endpoint.hostname, '127.0.0.1', 'C02_LOCAL_ENDPOINT_REQUIRED');
  assert.equal(endpoint.port, '55434', 'C02_LOCAL_ENDPOINT_REQUIRED');
  const identity = await assignmentSemanticDatabaseIdentity(handle.database);
  assert.match(identity.database, /^(hdi_prototype|pv006_c0(?:2|301)_[a-f0-9]{32})$/u);
  assert.equal(identity.role, 'hdi_prototype');
  assert.equal(identity.migrations, 35);
  // Dynamic import makes the original missing capability an actual retained RED.
  const { createAssignmentSemanticsApplication } = await import('../../apps/governance-api/src/composition/create-assignment-semantics-application.js');
  const f = await createAssignmentFixture(handle.database, runId);
  await handle.database.transaction().execute(async tx => {
    for (const permission of ['PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
      'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_WRITE'])
      await tx.insertInto('access_control.object_permission_grant').values({ ...{
        governance_object_id: assignmentScope.governanceObjectId, security_principal_id: f.actor,
        permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1', granted_by: f.actor,
        reason: 'SYNTHETIC C02 TEST POLICY ONLY', valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null,
      } }).execute();
  });
  const app = (requestId: string = randomUUID(),actor=f.actor) => createAssignmentSemanticsApplication(handle.database, f.context(actor, requestId));
  for (const [dimension, codes] of [['PURPOSE', ['ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING']],
    ['MODE', ['PRIMARY_AFFILIATION','STANDING_CONCURRENT']]] as const) {
    for (const code of codes) {
      const found = await app().findAssignmentSemanticTermAsOf({ ...assignmentScope, dimension, code, recordAsOf: await f.now() });
      if (!found) await app().registerAssignmentSemanticTerm({ ...assignmentScope, dimension, code, label: `SYNTHETIC ${code}`,
        definitionState: 'ENABLED', businessValidFrom: Jan, businessValidTo: null });
    }
  }
  const d1 = await f.createDepartment('C02-A'), d2 = await f.createDepartment('C02-B');
  const e = await f.createEngagement();
  const command = { ...assignmentScope, engagementId: e.engagementId, relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT' as const,
    placement: { scope: 'DEPARTMENT' as const, departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: d1.departmentId },
    businessValidFrom: Jul, businessValidTo: Dec,
    purposeCode: 'ORGANIZATIONAL_AFFILIATION' as const, modeCode: 'PRIMARY_AFFILIATION' as const };
  if (process.argv.includes('--sql-probe')) {
    await runAssignmentSemanticSqlProbe(handle.database,f,app,(engagementId,changes={})=>({...command,engagementId,...changes}),check);
  } else {
  await app().createClassifiedAssignment(command);
  await app().createClassifiedAssignment({ ...command, purposeCode: 'CLINICAL_PRACTICE' });
  await assert.rejects(app().createClassifiedAssignment({ ...command, placement: { ...command.placement, departmentId: d2.departmentId } }),
    { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
  cases.push({ ids: ['PA-01','PA-02'], name: 'independent purposes and same-bucket collision across departments', status: 'PASS' });
  const adoptionEngagement=await f.createEngagement();
  const {purposeCode,modeCode,...rawCommand}=command;
  const rawRequest=randomUUID();
  const raw=await f.app(rawRequest).createAssignment({...rawCommand,engagementId:adoptionEngagement.engagementId});
  const oldR=await f.now();
  const adopted=await app().adoptAssignmentSemantics({...assignmentScope,assignmentId:raw.assignmentId,
    expectedCurrentVersionId:raw.assignmentVersionId,purposeCode,modeCode});
  assert.notEqual(adopted.coreVersion.assignmentVersionId,raw.assignmentVersionId);
  assert.equal(adopted.coreVersion.reasonCode,'SEMANTIC_ADOPTION');
  assert.equal((await app().getAssignmentSemanticsAsOf({...assignmentScope,assignmentId:raw.assignmentId,businessAt:Jul,recordAsOf:oldR})).semantics.classification,'UNCLASSIFIED');
  assert.equal((await app().getAssignmentSemanticsAsOf({...assignmentScope,assignmentId:raw.assignmentId,businessAt:Jul,recordAsOf:await f.now()})).semantics.classification,'CLASSIFIED');
  assert.deepEqual(await f.app(rawRequest).createAssignment({...rawCommand,engagementId:adoptionEngagement.engagementId}),raw);
  await assert.rejects(f.app().reviseAssignment({...assignmentScope,assignmentId:raw.assignmentId,
    expectedCurrentVersionId:adopted.coreVersion.assignmentVersionId,businessValidFrom:Jul,businessValidTo:Dec,reasonCode:'VALIDITY_CORRECTION'}),
  {message:'ASSIGNMENT_SEMANTIC_REVISION_REQUIRED'});
  cases.push({ids:['HV-02','HV-07','HV-08','UK-06'],name:'adoption creates a new version without rewriting old knowledge or blocking old successful replay',status:'PASS'});
  const primaryR=await f.now();
  const corrected=await app().correctAssignmentSemantics({...assignmentScope,assignmentId:raw.assignmentId,
    expectedCurrentVersionId:adopted.coreVersion.assignmentVersionId,purposeCode,modeCode:'STANDING_CONCURRENT',reasonCode:'MODE_CORRECTION'});
  assert.equal(corrected.coreVersion.reasonCode,'SEMANTIC_CORRECTION');
  assert.equal(corrected.coreVersion.businessValidFrom,adopted.coreVersion.businessValidFrom);
  assert.equal(corrected.coreVersion.businessValidTo,adopted.coreVersion.businessValidTo);
  const query={...assignmentScope,engagementId:adoptionEngagement.engagementId,purposeCode,
    scopeCode:'HOSPITAL_DEPARTMENT_PLACEMENTS' as const,businessAt:Jul};
  assert.equal((await app().resolvePrimaryAffiliation({...query,recordAsOf:primaryR})).resolution,'UNIQUE');
  assert.equal((await app().resolvePrimaryAffiliation({...query,recordAsOf:await f.now()})).resolution,'NONE');
  const replacement=await app().createClassifiedAssignment({...command,engagementId:adoptionEngagement.engagementId});
  await assert.rejects(app().correctAssignmentSemantics({...assignmentScope,assignmentId:raw.assignmentId,
    expectedCurrentVersionId:corrected.coreVersion.assignmentVersionId,purposeCode,modeCode,reasonCode:'MODE_CORRECTION'}),
    {message:'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT'});
  const beforeShortening=await f.now();
  const shortened=await app().reviseClassifiedAssignmentPeriod({...assignmentScope,assignmentId:replacement.coreVersion.assignmentId,
    expectedCurrentVersionId:replacement.coreVersion.assignmentVersionId,businessValidFrom:Jul,businessValidTo:'2026-08-01T00:00:00',reasonCode:'VALIDITY_CORRECTION'});
  assert.equal(shortened.semantics.mode.code,modeCode);
  assert.equal((await app().resolvePrimaryAffiliation({...query,businessAt:'2026-09-01T00:00:00',recordAsOf:beforeShortening})).resolution,'UNIQUE');
  assert.equal((await app().resolvePrimaryAffiliation({...query,businessAt:'2026-09-01T00:00:00',recordAsOf:await f.now()})).resolution,'NONE');
  cases.push({ids:['HV-04','HV-09','PA-09','PA-10','PA-11'],name:'whole-period semantic correction and latest complete period govern historical primary resolution',status:'PASS'});
  recovery = await runAssignmentSemanticBehavior(handle.database,f,app,(engagementId,changes={})=>({...command,engagementId,...changes}),check);
  await runAssignmentSemanticConcurrency(handle.database,f,app,(engagementId,changes={})=>({...command,engagementId,...changes}),check);
  await runAssignmentSemanticAccess(handle.database,f,app,(engagementId,changes={})=>({...command,engagementId,...changes}),check);
  const versionIds = [recovery.rawVersion.assignmentVersionId,recovery.adopted.coreVersion.assignmentVersionId,recovery.frozen.coreVersion.assignmentVersionId];
  const requestIds = [recovery.successfulRequest];
  await writeFile(`${directory}/recovery.json`, JSON.stringify({task:'PV-006-C-02',mode:'RECOVERY',runId,identity,recovery,
    versionIds,requestIds,fingerprint:await assignmentSemanticRecoveryFingerprint(handle.database,versionIds,requestIds)},null,2),{flag:'wx'});
  }
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  await handle.close();
  const result = { task: 'PV-006-C-02', runId, status: failure ? 'FAILED' : 'PASSED', cases, recovery,sqlObservations:assignmentSemanticSqlObservations,
    argv: process.argv.slice(1), cwd: process.cwd(), poolClosed: true,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : null };
  await writeFile(`${directory}/application.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: result.task, runId, status: result.status,
    passedChecks: cases.filter(item=>item.status==='PASS').length, failedChecks: cases.filter(item=>item.status==='FAILED').length,
    poolClosed: result.poolClosed, error: result.error, evidenceDirectory: directory }));
}
