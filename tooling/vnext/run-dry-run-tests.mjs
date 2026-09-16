import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,inspect,root,resolveTarget,readReceipt,peer,quote} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';

const args=process.argv.slice(2);
if(args.length){
 if(args.length!==3||args[0]!=='--dispose')throw new Error('CLOSED_COMMAND_REQUIRED');
 const receipt=readReceipt(args[1]);
 const owner={receipt:JSON.parse(readFileSync(args[2],'utf8')),receiptPath:args[2]};
 if(receipt.taskId!=='P0-07'||receipt.purpose!=='TEMPORARY_VALIDATION'||owner.receipt.databaseOid!==receipt.oid||owner.receipt.databaseRequestId!==receipt.requestId||owner.receipt.taskId!=='P0-07')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const actual=await inspect(receipt);
 const sessions=peer('postgres',`SELECT count(*) FROM pg_stat_activity WHERE datname=${quote(receipt.name)};`);
 console.log(JSON.stringify({recovery:'P0-07',identity:actual.identity,sessions}));
 dropTemporary(receipt);dropValidationOwnerSession(owner);
 console.log('OWNED_P0_07_DATABASE_AND_OWNER_DISPOSED');
 process.exit(0);
}
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
