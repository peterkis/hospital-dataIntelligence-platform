import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {readReceipt,inspect,migrate,migrationFiles} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
const files=migrationFiles();assert.equal(files.length,58,'This repair deploys only the reviewed 0058 chain');
const receipt=readReceipt(),before=await inspect(receipt);
assert.ok([57,58].includes(before.ledger.length));
const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables),after=await migrate(receipt,files);
assert.equal(after.ledger.length,58);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,before.ledger.length),before.ledger);assert.equal(predecessorDigest(receipt,tables),digest);
// Existing service grants must survive the signature change without re-granting.
const owner=openCampus(await ownerServiceConnection(),organizationKeys(receipt));let app;
try{
 app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,{owner,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});const base=`http://127.0.0.1:${app.server.address().port}/api/vnext/campuses/list`;
 const query=async body=>{const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 assert.deepEqual(await query({asOf:'2025-01-01T00:00:00',limit:1}),[]);
 const current=await query({limit:100});assert.ok(current.length>0);assert.ok(current.every(r=>r.head!=='0'));
 assert.equal(predecessorDigest(receipt,tables),digest);
 mkdirSync('.runtime/vnext/p1-02',{recursive:true});const path='.runtime/vnext/p1-02/list-fix-deployment-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({status:'PASS',method:'REAL_HTTP_READ_ONLY',databaseOid:receipt.oid,previousPrefix:before.ledger.length,currentPrefix:58,businessDataUnchanged:true,existingServiceGrantPreserved:true,historicalListEmpty:true,currentRows:current.length},null,2));console.log(JSON.stringify({status:'PASS',evidence:path}));
}finally{await app?.close();await owner.close();}
