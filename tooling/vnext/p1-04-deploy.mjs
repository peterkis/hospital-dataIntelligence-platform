import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readReceipt,inspect,migrate,migrationFiles,checkPrefix,peer,identitySQL,root} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {operatingScenario} from './operating-scenario.ts';
import {operatingHttpSmoke} from './operating-http-smoke.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const receipt=readReceipt(),before=await inspect(receipt),files=migrationFiles();assert.equal(files.length,64);assert.ok([61,63,64].includes(checkPrefix(files,before.ledger)));
const directory='.runtime/vnext/p1-04';mkdirSync(directory,{recursive:true});const run=directory+'/deployment-'+Date.now();
const tables=predecessorTables(before.tables),addedColumns=before.ledger.length<64?{'governance_catalog.import_contract':['manual_org03']}:{},digest=predecessorDigest(receipt,tables,addedColumns);
const keys=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),keyDigest=keys();
// Keep row hashes, never materialize old secrets or raw evidence in the deployment log.
const rowHashes=()=>Object.fromEntries(tables.map(table=>[table,JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(encode(sha256(convert_to((to_jsonb(o)${(addedColumns[table]??[]).map(column=>`-'${column}'`).join('')})::text,'UTF8')),'hex')),'[]')::text FROM ${table} o`))]));
const oldRows=rowHashes();
writeFileSync(run+'.before.json',JSON.stringify({identity:before.identity,ledger:before.ledger,dataDigest:digest,keyDigest},null,2),{flag:'wx'});
const after=await migrate(receipt,files);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,before.ledger.length),before.ledger);assert.equal(predecessorDigest(receipt,tables,addedColumns),digest);assert.equal(keys(),keyDigest);
writeFileSync(run+'.migration.json',JSON.stringify({status:'PASS',oid:after.identity.oid,prefix:after.ledger.length,oldRowsUnchanged:true,ledger:after.ledger},null,2),{flag:'wx'});
const connection=await ownerServiceConnection();
const ownership=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));assert.match(ownership.role,/^hdi_owner_[a-f0-9]{16}$/);assert.match(String(ownership.roleOid),/^[0-9]+$/);assert.equal(new URL(connection).username,ownership.role);assert.equal(ownership.database,receipt.name);assert.equal(ownership.databaseOid,receipt.oid);assert.equal(ownership.databaseRequestId,receipt.requestId);
peer(receipt.name,identitySQL(receipt)+` BEGIN; DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname='${ownership.role}') IS DISTINCT FROM '${ownership.roleOid}' THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$; GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),organization_master.operating_authorize(text,uuid,uuid,text),organization_master.operating_stage(text,jsonb,text,jsonb),organization_master.operating_input_read(text,uuid,text),organization_master.operating_plan(text,uuid,uuid),organization_master.operating_withdraw(text,uuid,uuid),organization_master.operating_snapshot(text,uuid,text),organization_master.operating_pair(text,uuid,uuid,text),organization_master.operating_primary_conflict(text,uuid,uuid,timestamp,timestamp),organization_master.operating_write(text,text) TO ${ownership.role}; COMMIT;`);
const provider=organizationKeys(receipt),catalog=await openCatalog(connection,provider);let scenario;
try{
 const countBefore=Number(peer(receipt.name,'SELECT count(*) FROM organization_master.subject'));
 scenario=await operatingScenario(receipt,connection,provider,catalog);
 const smoke=await operatingHttpSmoke(scenario,event=>appendFileSync(run+'.events.jsonl',JSON.stringify(event)+'\n'));
 assert.equal(Number(peer(receipt.name,'SELECT count(*) FROM organization_master.subject')),countBefore+1);
 const retained=rowHashes();for(const table of tables){const existing=new Set(retained[table]);assert.ok(oldRows[table].every(hash=>existing.has(hash)),'Previous rows changed: '+table);}
 assert.equal(keys(),keyDigest);const final=await inspect(receipt);assert.equal(final.identity.oid,before.identity.oid);assert.deepEqual(final.ledger,after.ledger);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify','.runtime/vnext/creation.json'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 writeFileSync(run+'.result.json',JSON.stringify({status:'PASS',...smoke,databaseOid:final.identity.oid,previousPrefix:before.ledger.length,currentPrefix:64,priorRowsAndAuthorityPreserved:true,subjectCountAdded:1,campusCountAdded:3,UI:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN',FULL:'BLOCKED_DEPENDENCY',fileAdapter:'NOT_READY'},null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',gate:'P1-04-PERSISTENT-HTTP',evidence:run+'.result.json'}));
}finally{await scenario?.close();await catalog.close();}
