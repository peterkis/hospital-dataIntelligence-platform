import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,inspect,root,resolveTarget} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';

const owned=createTemporary('P0-07');let owner;
try{
 await migrate(owned.receipt);await seed(owned.receipt);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 if(types.status!==0)throw new Error('P0_07_CODEGEN_VERIFY_FAILED');
 owner=await createValidationOwnerSession(owned.receipt);
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.dry-run.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-07-DRY-RUN'},stdio:'inherit',windowsHide:true});
 const observation=await inspect(owned.receipt);
 console.log(JSON.stringify({gate:'P0-07',exit:run.status,migrations:observation.ledger.length,receipt:owned.receiptPath}));
 process.exitCode=run.status??1;
}catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
