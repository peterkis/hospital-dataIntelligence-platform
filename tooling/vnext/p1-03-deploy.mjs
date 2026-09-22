import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readReceipt,inspect,migrationFiles,checkPrefix} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createCampusClient} from '../../packages/generated-api-client/src/index.ts';
const receipt=readReceipt(),before=await inspect(receipt),files=migrationFiles();assert.equal(files.length,61);assert.equal(checkPrefix(files,before.ledger),61);
const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables);
const owner=openCampus(await ownerServiceConnection());let app;
try{
 // A reference-only composition proves reads do not receive mutation capabilities or keys.
 app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,{references:owner.references,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});
 const client=createCampusClient(`http://127.0.0.1:${app.server.address().port}`,'maker');
 const list=await client.list({limit:100});assert.equal(list.response.status,200);assert.ok(list.data.length>0);
 const references=list.data.filter(v=>v.facts?.campusName.startsWith('DEMO')).map(v=>({owner:'organization-master/campus',id:v.id}));assert.ok(references.length>0);
 const resolved=await client.resolveCampusReference({references});assert.equal(resolved.response.status,200);assert.equal(resolved.data.items.length,references.length);
 const pins=resolved.data.items.map(i=>i.profileVersion).filter(Boolean);assert.equal(pins.length,references.length);
 const pinned=await client.pinCampusVersion({references:pins,asOf:resolved.data.asOf});assert.equal(pinned.response.status,200);assert.equal(pinned.data.items.length,pins.length);
 const coverage=await client.readCampusReferenceCoverage({references,validFrom:'2026-01-01T00:00:00',validTo:null});assert.equal(coverage.response.status,200);assert.equal(coverage.data.items.length,references.length);
 assert.ok(coverage.data.items.every(i=>i.operatingPermission==='NOT_EVALUABLE'));
 const duplicate=await client.resolveCampusReference({references:[references[0],references[0]]});assert.equal(duplicate.response.status,409);assert.equal(duplicate.error.code,'CAMPUS_REFERENCE_CONFLICT');
 const after=await inspect(receipt);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger,before.ledger);assert.equal(predecessorDigest(receipt,tables),digest);
 mkdirSync('.runtime/vnext/p1-03',{recursive:true});const path=`.runtime/vnext/p1-03/deployment-${Date.now()}.json`;
 writeFileSync(path,JSON.stringify({status:'PASS',method:'REAL_HTTP_READ_ONLY_GENERATED_CLIENT',databaseOid:receipt.oid,migrations:after.ledger.length,businessAndAuthorityDataUnchanged:true,rows:references.length,duplicate:'CAMPUS_REFERENCE_CONFLICT',DDL:'NOT_APPLICABLE',UI:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',gate:'P1-03-PERSISTENT-HTTP',evidence:path}));
}finally{await app?.close();await owner.close();}
