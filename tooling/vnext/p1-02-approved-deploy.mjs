import {provisionCampusAuthority} from './campus-authority.mjs';
import {randomUUID} from 'node:crypto';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {readReceipt,inspect,migrate,migrationFiles,peer,quote} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
const files=migrationFiles();assert.equal(files.length,60,'This repair deploys only the reviewed 0060 chain');
const receipt=readReceipt(),before=await inspect(receipt);
assert.ok([59,60].includes(before.ledger.length));
const tables=predecessorTables(before.tables).filter(t=>t!=='vnext_control.campus_write_authority'),digest=predecessorDigest(receipt,tables),after=await migrate(receipt,files);
assert.equal(after.ledger.length,60);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,before.ledger.length),before.ledger);assert.equal(predecessorDigest(receipt,tables),digest);
// Existing service grants must survive the signature change without re-granting.
const provider=organizationKeys(receipt);provisionCampusAuthority(receipt,provider);
const connection=await ownerServiceConnection(),pool=new Pool({connectionString:connection}),owner=openCampus(connection,provider),catalog=await openCatalog(connection,provider);let app;
try{
 app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,{owner,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});const base=`http://127.0.0.1:${app.server.address().port}/api/vnext/campuses/list`;
 const query=async body=>{const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 assert.deepEqual(await query({asOf:'2025-01-01T00:00:00',limit:1}),[]);
 const grants=await pool.query("SELECT has_function_privilege(current_user,'organization_master.campus_write_approved(text,text)','EXECUTE') AND has_function_privilege(current_user,'organization_master.withdraw_for(text,uuid,uuid,text)','EXECUTE') AS allowed");assert.equal(grants.rows[0].allowed,true);
 const current=await query({limit:100});assert.ok(current.length>0);assert.ok(current.every(r=>r.head!=='0'));
 for(const row of current){const r=await fetch(base.replace('/list','/query'),{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({id:row.id})});assert.equal(r.status,200);const view=await r.json();assert.equal(view.operatingPermission,'NOT_EVALUABLE');}
 assert.equal(predecessorDigest(receipt,tables),digest);
 // Existing data was preserved above; now exercise one clearly labelled synthetic write.
 const f=await fixture(catalog,{textField:true,ruleVersion:'PR14_R2_HTTP_EVIDENCE_V1'}),job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID()});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_PR14_R2_APPROVED_CAMPUS_WRITE'));
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.validTo===null);
 const call=async(path,body,who='maker')=>{const res=await fetch(base.replace('/list','/'+path),{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
 const command={action:'CREATE',validFrom:'2026-01-01T00:00:00',validTo:null,evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_PR14_R2',versionNo:1,recordLocator:'DEMO_PR14_R2',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_REVIEW_FIX'},facts:{campusCode:'DEMO_PR14_R2_'+randomUUID(),campusName:'DEMO PR14 R2 SQL boundary',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}};
 const input=await call('inputs',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',profile:'CORE',command}),requestId=randomUUID(),candidate=await call('plan',{inputId:input.inputId,requestId});
 await call('review',{candidateId:candidate.candidateId},'reviewer');await call('approve',candidate,'reviewer');const outcome=await call('apply',{candidateId:candidate.candidateId,requestId});assert.equal(outcome.status,'COMMITTED');
 const replay=await call('apply',{candidateId:candidate.candidateId,requestId});assert.deepEqual(replay.facts,outcome.facts);
 const view=await call('query',{id:outcome.facts[0].id});assert.equal(view.facts.campusName,command.facts.campusName);
 mkdirSync('.runtime/vnext/p1-02',{recursive:true});const path='.runtime/vnext/p1-02/pr14-r2-deployment-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({status:'PASS',method:'REAL_HTTP_APPROVED_WRITE_AND_REPLAY',databaseOid:receipt.oid,previousPrefix:before.ledger.length,currentPrefix:60,migrationBusinessDataUnchanged:true,syntheticCampusId:outcome.facts[0].id,existingServiceGrantPreserved:true,historicalListEmpty:true,currentRows:current.length},null,2));console.log(JSON.stringify({status:'PASS',evidence:path}));
}finally{await app?.close();await owner.close();await pool.end();await catalog.close();}
