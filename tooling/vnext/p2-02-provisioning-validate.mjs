import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,resolveTarget,root} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {grantOrganization} from './p1-02-validate.mjs';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P2-02');let owner,fixture;
try {
 await migrate(owned.receipt);await seed(owned.receipt);
 owner=await createValidationOwnerSession(owned.receipt,{roleFamily:'owner'});
 grantDepartment(owned.receipt,owner.receipt.role);grantOrganization(owned.receipt,owner.receipt.role);
 fixture=resolve(root,'.runtime/vnext/fresh',owned.receipt.name+'-persistent-config');
 mkdirSync(fixture,{recursive:true});
 writeFileSync(resolve(fixture,'creation.json'),JSON.stringify(owned.receipt),{flag:'wx'});
 writeFileSync(resolve(fixture,'owner-service.json'),JSON.stringify(owner.receipt),{flag:'wx'});
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p2-02-provisioning.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_PERSISTENT_FIXTURE_DIR:fixture,VNEXT_CONNECTION_STEP:'P2-02-PROVISIONING'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P2-02-PROVISIONING',exit:run.status,receipt:owned.receiptPath}));
}catch(error){owner??=error.ownerSession;throw error;}
finally{
 try{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
 finally{if(fixture)rmSync(resolve(fixture,'keys.secret.json'),{force:true});}
}
