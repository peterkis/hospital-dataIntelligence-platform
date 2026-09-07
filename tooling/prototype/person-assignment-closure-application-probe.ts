import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { departmentScope, Jan, Aug } from './person-assignment-fixture.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { runAssignmentClosureHistory } from './person-assignment-closure-history-probe.js';
import { runAssignmentClosureBehavior } from './person-assignment-closure-behavior-probe.js';
import { runAssignmentClosureAccess } from './person-assignment-closure-access-probe.js';
import { runAssignmentClosureConcurrency } from './person-assignment-closure-concurrency-probe.js';
import { runAssignmentClosureSql } from './person-assignment-closure-sql-probe.js';
import { prepareAssignmentClosureRecovery } from './person-assignment-closure-recovery-support.js';
import { runAssignmentClosureOracle } from './person-assignment-closure-oracle.js';

assert.ok(process.env['DATABASE_URL'],'MANAGED_DATABASE_REQUIRED');
const endpoint = new URL(process.env['DATABASE_URL']);
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'55434');
process.env['NODE_ENV']='test';
const runId=randomUUID(), directory=`.runtime/pv006-c0301/${runId}`;
await mkdir(directory,{recursive:true});
console.log(JSON.stringify({task:'PV-006-C-03-01',runId,mode:process.argv[2]??'VALIDATE',directory}));
const handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:12,application_name:'hdi-pv006-c0301-application'});
const cases:{ids:string[];name:string;status:string;evidence?:unknown}[]=[];
let failure:unknown;
async function check(ids:string[],name:string,work:()=>Promise<unknown>) {
  console.log(JSON.stringify({caseStarted:ids,name}));
  try {cases.push({ids,name,status:'PASS',evidence:await work()});}
  catch(error) {cases.push({ids,name,status:'FAILED'});throw error;}
  finally {await writeFile(`${directory}/case-${String(cases.length).padStart(2,'0')}.json`,JSON.stringify(cases.at(-1),null,2),{flag:'wx'});}
}
try {
  assert.ok(process.argv.length === 2 || (process.argv.length === 3 && ['--sql-probe', '--concurrency-probe'].includes(process.argv[2]!)), 'C0301_APPLICATION_MODE_INVALID');
  const f=await createAssignmentClosureFixture(handle.database,runId);
  const assignmentScope=f.scope;
  if (!process.argv[2]) {
  await check(['TM-01','DE-04','DE-05','PR-08','PR-09'],
    'An accepted placement can end after its department is inactive without new admission evidence',async()=> {
      const d=await f.createDepartment('C0301-INACTIVE'), e=await f.createEngagement();
      const command={...assignmentScope,engagementId:e.engagementId,relationBasis:'CONFIRMED_DISTINCT_PLACEMENT' as const,
        placement:{scope:'DEPARTMENT' as const,departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:d.departmentId},
        businessValidFrom:Jan,businessValidTo:null};
      const source=await f.app().createAssignment(command);
      await f.reviseDepartment(d.departmentId,'SUSPENDED');
      await assert.rejects(f.app().reviseAssignment({...assignmentScope,assignmentId:source.assignmentId,
        expectedCurrentVersionId:source.assignmentVersionId,businessValidFrom:Jan,businessValidTo:Aug,reasonCode:'VALIDITY_CORRECTION'}),
        {message:'ASSIGNMENT_PLACEMENT_NOT_ACTIVE'});
      // The first retained RED reaches the missing END capability after real owner invalidation.
      const {createAssignmentClosureApplication}=await import('../../apps/governance-api/src/composition/create-assignment-closure-application.js');
      const closed=await createAssignmentClosureApplication(handle.database,f.context()).endAssignment({...assignmentScope,
        assignmentId:source.assignmentId,expectedCurrentVersionId:source.assignmentVersionId,endedAt:Aug,reasonCode:'PLACEMENT_ENDED'});
      assert.equal(closed.recordKind,'CLOSURE');assert.equal(closed.assignmentId,source.assignmentId);
      assert.equal(closed.supersedesAssignmentVersionId,source.assignmentVersionId);
      assert.equal(closed.versionNo,'2');assert.equal(closed.businessValidTo,Aug);
      assert.equal('acceptanceEvidence' in closed,false);
      assert.equal(closed.closureEvidence.proofKind,'NON_EXPANSIVE_CLOSURE');
      assert.equal(closed.closureEvidence.sourceAcceptanceVersionId,source.assignmentVersionId);
      assert.equal(closed.closureEvidence.sourceAcceptanceDependencyFingerprint,source.acceptanceEvidence.dependencyFingerprint);
      assert.deepEqual(await f.app().getAssignmentVersion({...assignmentScope,assignmentId:source.assignmentId,assignmentVersionId:source.assignmentVersionId}),source);
      return {sourceVersionId:source.assignmentVersionId,closureVersionId:closed.assignmentVersionId};
    });
  await runAssignmentClosureHistory(f,check);
  await runAssignmentClosureBehavior(handle.database,f,check);
  await runAssignmentClosureAccess(handle.database,f,check);
  }
  if (process.argv[2] !== '--concurrency-probe') await runAssignmentClosureSql(handle.database,f,check);
  if (process.argv[2] !== '--sql-probe') await runAssignmentClosureConcurrency(handle.database,f,check);
  if (!process.argv[2]) {
    await runAssignmentClosureOracle(f, check);
    const recovery = await prepareAssignmentClosureRecovery(handle.database, f, runId);
    await writeFile(`${directory}/recovery.json`, JSON.stringify(recovery, null, 2), { flag: 'wx' });
  }
} catch(error) {failure=error;process.exitCode=1;}
finally {
  await handle.close();
  const error=failure instanceof Error?failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu,'[DATABASE_URL]'):null;
  await writeFile(`${directory}/application.json`,JSON.stringify({task:'PV-006-C-03-01',runId,cases,error,
    status:failure?'FAILED':'PASS',argv:process.argv.slice(1),cwd:process.cwd(),poolClosed:true},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-03-01',runId,status:failure?'FAILED':'PASS',cases:cases.length,error,poolClosed:true,directory}));
}
