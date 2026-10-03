import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,readReceipt,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import assert from 'node:assert/strict';
import {validateLifecycleUpgrade} from './p2-08-upgrade.mjs';

const args=process.argv.slice(2);
if(args[0]==='--dispose-owned'){if(args.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');const prior=readReceipt(args[1]);if(prior.taskId!=='P2-08')throw new Error('DISPOSAL_NOT_AUTHORIZED');dropTemporary(prior);process.exit(0);}
if(args.some(arg=>!['--generate','--upgrade'].includes(arg))||new Set(args).size!==args.length)throw new Error('CLOSED_COMMAND_REQUIRED');
if(args.includes('--upgrade'))await validateLifecycleUpgrade();
const owned=createTemporary('P2-08');let session;
try{
 await migrate(owned.receipt);await seed(owned.receipt);session=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,session.receipt.role);grantOrganization(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p2-08-db.config.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P2-08'},stdio:'inherit',windowsHide:true});process.exitCode=run.status??1;
}catch(error){session??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
