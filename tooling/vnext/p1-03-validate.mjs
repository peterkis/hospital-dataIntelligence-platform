import {readFileSync} from 'node:fs';
import {verifyCampusBoundaries} from './p1-03-boundaries.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
assert.equal(migrationFiles().length,61,'P1-03 adds no DDL');
console.log(JSON.stringify(verifyCampusBoundaries(JSON.parse(readFileSync('tooling/vnext/p1-03-call-sites.json','utf8')).runtimeEntries)));
const owned=createTemporary('P1-03');let owner;
try{
 await migrate(owned.receipt);await seed(owned.receipt);
 owner=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p1-03-db.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P1-03'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P1-03',exit:run.status,receipt:owned.receiptPath,migrations:(await inspect(owned.receipt)).ledger.length}));
}catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
