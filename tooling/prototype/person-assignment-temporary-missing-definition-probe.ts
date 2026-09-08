import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { temporaryRequestCounts } from './person-assignment-temporary-test-support.js';
import { Jul,Aug,Dec,departmentScope } from './person-assignment-fixture.js';

assert.ok(process.env['DATABASE_URL'],'C04_MANAGED_DATABASE_REQUIRED');
const handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:4,application_name:'hdi-pv006-c04-missing-definition'});
const runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;
await mkdir(directory,{recursive:false});
try {
  const ownership=await requireTemporaryFixtureTarget(handle.database,'SHARED_DEFINITION_MUTATION');
  assert.equal((await handle.database.selectFrom('person_master.assignment_semantic_term').select('term_id').where('code','=','SECONDMENT').execute()).length,0);
  const f=await createAssignmentClosureFixture(handle.database,runId);
  await f.grant(f.actor,['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE']);
  const e=await f.createEngagement(),source=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId,{businessValidTo:Dec}))).coreVersion;
  const target=await f.createDepartment('C04-MISSING-MODE'),root=randomUUID();
  await assert.rejects(createTemporaryAssignmentApplication(handle.database,f.context(f.actor,root)).createSourceLinkedTemporaryAssignment({...f.scope,
    sourceAssignmentId:source.assignmentId,expectedSourceVersionId:source.assignmentVersionId,businessValidFrom:Jul,businessValidTo:Aug,
    targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:target.departmentId},reasonCode:'TEMPORARY_SECONDMENT_PLACEMENT'}),
    {message:'ASSIGNMENT_TERM_NOT_APPLICABLE'});
  const counts=await temporaryRequestCounts(handle.database,root);assert.equal(counts.stable,0);assert.equal(counts.outcomes,1);
  await writeFile(`${directory}/missing-definition.json`,JSON.stringify({task:'PV-006-C-04',runId,ids:['DW-09'],status:'PASS',ownership,
    root,counts,sourceVersionId:source.assignmentVersionId,cwd:process.cwd(),argv:process.argv.slice(1)},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-04',runId,status:'PASS',missingSecondmentRejected:true,directory}));
} finally {await handle.close();}
