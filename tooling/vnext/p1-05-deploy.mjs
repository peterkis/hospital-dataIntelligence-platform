import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readReceipt,inspect,migrate,migrationFiles,checkPrefix,peer,identitySQL,root} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationImport} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {organizationBundleFixture} from './organization-bundle-fixture.ts';
import {organizationBundleHttpSmoke,rejectThirdRelationOverHttp} from './organization-bundle-http-smoke.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const receipt=readReceipt(),before=await inspect(receipt),files=migrationFiles();assert.equal(files.length,69);const prefix=checkPrefix(files,before.ledger);assert.ok(prefix>=64&&prefix<=69);
const directory='.runtime/vnext/p1-05';mkdirSync(directory,{recursive:true});const run=directory+'/deployment-'+Date.now();
const tables=predecessorTables(before.tables),addedColumns=prefix<65?{'governance_catalog.import_contract':['bundle_org']}:{},digest=predecessorDigest(receipt,tables,addedColumns);
const keyDigest=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),originalKeyDigest=keyDigest();
const rowHashes=()=>Object.fromEntries(tables.map(table=>[table,JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(encode(sha256(convert_to((to_jsonb(o)${(addedColumns[table]??[]).map(column=>`-'${column}'`).join('')})::text,'UTF8')),'hex')),'[]')::text FROM ${table} o`))]));
const oldRows=rowHashes();writeFileSync(run+'.before.json',JSON.stringify({identity:before.identity,ledger:before.ledger,dataDigest:digest,keyDigest:originalKeyDigest},null,2),{flag:'wx'});
const after=await migrate(receipt,files);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(receipt,tables,addedColumns),digest);assert.equal(keyDigest(),originalKeyDigest);
writeFileSync(run+'.migration.json',JSON.stringify({status:'PASS',oid:after.identity.oid,prefix:after.ledger.length,oldRowsUnchanged:true,ledger:after.ledger},null,2),{flag:'wx'});
const connection=await ownerServiceConnection(),ownership=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
assert.match(ownership.role,/^hdi_owner_[a-f0-9]{16}$/);assert.match(String(ownership.roleOid),/^[0-9]+$/);assert.equal(new URL(connection).username,ownership.role);assert.equal(ownership.database,receipt.name);assert.equal(ownership.databaseOid,receipt.oid);assert.equal(ownership.databaseRequestId,receipt.requestId);
const functions=['bundle_register(text,jsonb)','bundle_read(text,uuid,uuid)','bundle_artifact(text,uuid,uuid,uuid)','bundle_control_state(text,uuid,uuid)','bundle_control(text,text)','bundle_authorize(text,uuid,uuid,text)','bundle_plan_request(text,uuid,uuid,uuid)','bundle_materialize_pair(text)','bundle_bind_child(text)','bundle_committed_facts(text,uuid,uuid,uuid)'];
peer(receipt.name,identitySQL(receipt)+` BEGIN; DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname='${ownership.role}') IS DISTINCT FROM '${ownership.roleOid}' THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$; GRANT EXECUTE ON FUNCTION ${functions.map(name=>'organization_master.'+name).join(',')} TO ${ownership.role}; COMMIT;`);
const provider=organizationKeys(receipt),catalog=await openCatalog(connection,provider),owner=openOrganizationImport(connection,provider);let fixture;
const domainTables=['organization_master.subject','organization_master.version','organization_master.identifier','organization_master.license','organization_master.license_version','organization_master.verification','organization_master.campus','organization_master.campus_event','organization_master.campus_version','organization_master.campus_code','organization_master.campus_operation','organization_master.operating_object','organization_master.operating_version','organization_master.operating_access','organization_master.access','organization_master.bundle_child','governance_catalog.apply_commit'];
const counts=()=>JSON.parse(peer(receipt.name,`SELECT jsonb_build_array(${domainTables.map(table=>`(SELECT count(*) FROM ${table})`).join(',')})`));
try{
 // Reuse the already adopted P1-04 service catalog so prior relations do not become stale as a fixture side effect.
 fixture=await organizationBundleFixture(receipt,connection,provider,catalog,true);
 const countBefore=counts(),smoke=await organizationBundleHttpSmoke(owner,fixture,event=>appendFileSync(run+'.events.jsonl',JSON.stringify(event)+'\n'));
 const countAfter=counts();assert.equal(countAfter[0],countBefore[0]+1);assert.equal(countAfter[6],countBefore[6]+3);
 const rejected=await rejectThirdRelationOverHttp(owner,fixture);assert.deepEqual(counts(),countAfter);appendFileSync(run+'.events.jsonl',JSON.stringify({rejected,domainAndConvertedGrantCountsUnchanged:true})+'\n');
 const retained=rowHashes();for(const table of tables){const existing=new Set(retained[table]);assert.ok(oldRows[table].every(hash=>existing.has(hash)),'Previous rows changed: '+table);}
 assert.equal(keyDigest(),originalKeyDigest);const final=await inspect(receipt);assert.equal(final.identity.oid,before.identity.oid);assert.deepEqual(final.ledger,after.ledger);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify','.runtime/vnext/creation.json'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 writeFileSync(run+'.result.json',JSON.stringify({status:'PASS',databaseOid:final.identity.oid,previousPrefix:prefix,currentPrefix:final.ledger.length,priorRowsAndAuthorityPreserved:true,subjectCountAdded:1,campusCountAdded:3,applied:smoke,rejected,zeroPartialDomainWrites:true,UI:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN',FULL:'BLOCKED_DEPENDENCY',fileAdapter:'READY_STRICT_ORG_BUNDLE_CORE_ONLY'},null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',gate:'P1-05-PERSISTENT-HTTP',evidence:run+'.result.json'}));
}finally{await owner.close();await fixture?.close();await catalog.close();}
