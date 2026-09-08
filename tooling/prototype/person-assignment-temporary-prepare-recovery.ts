import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTemporaryAssignmentFixture } from './person-assignment-temporary-fixture.js';
import { prepareTemporaryRecovery } from './person-assignment-temporary-recovery-support.js';
import { temporaryDatabaseIdentity } from './person-assignment-temporary-fixture-guard.js';

assert.ok(process.env['DATABASE_URL'],'C04_MANAGED_DATABASE_REQUIRED');
assert.equal(process.argv.length,2,'C04_PREPARE_RECOVERY_ARGUMENT_INVALID');
const runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;await mkdir(directory,{recursive:false});
const handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:6,application_name:'hdi-pv006-c04-prepare-recovery'});
try {
  assert.equal((await temporaryDatabaseIdentity(handle.database)).database,'hdi_prototype','C04_RECOVERY_RETAINED_REQUIRED');
  const f=await createTemporaryAssignmentFixture(handle.database,runId);
  const receipt=await prepareTemporaryRecovery(handle.database,f,runId);
  await writeFile(`${directory}/recovery.json`,JSON.stringify(receipt,null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-04',runId,status:'PASS',mode:'PREPARE_RECOVERY',creates:receipt.creates.length,
    declaredReads:receipt.declaredReads.length,assessments:receipt.assessments.length,receipt:`${directory}/recovery.json`}));
}finally{await handle.close();}
