import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readReceipt,inspect,migrate,migrationFiles,root,peer,quote,identitySQL} from './lineage.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {fixture} from './protected-fixture.ts';
import {campusCodeSet} from './campus-fixture.ts';
const args=process.argv.slice(2);if(args.some(a=>a!=='--resume')||args.length>1)throw new Error('CLOSED_COMMAND_REQUIRED');
const files=migrationFiles();assert.equal(files.length,59,'This deployment entry is bounded to the reviewed 0059 chain');
const receipt=readReceipt(),before=await inspect(receipt),checkpointPath='.runtime/vnext/p1-02/migration-0057.json';
const keyHash=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex');const previousKeys=keyHash();
let checkpoint;
if(before.ledger.length===56&&!args.length){
 const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables);const after=await migrate(receipt,files);
 assert.equal(predecessorDigest(receipt,tables),digest);assert.equal(after.identity.oid,before.identity.oid);
 assert.equal(after.ledger.length,59);assert.deepEqual(after.ledger.slice(0,56),before.ledger);assert.equal(after.ledger[56].id,'0057_campus_master');
 checkpoint={status:'MIGRATION_VERIFIED',databaseOid:receipt.oid,requestId:receipt.requestId,previousPrefix:56,ledger:after.ledger,retainedTables:tables.length,previousDataPreserved:true,keyFileHash:previousKeys};
 mkdirSync('.runtime/vnext/p1-02',{recursive:true});writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2),{flag:'wx'});
}else if([57,58,59].includes(before.ledger.length)&&args[0]==='--resume'){
 checkpoint=JSON.parse(readFileSync(checkpointPath,'utf8'));assert.equal(checkpoint.status,'MIGRATION_VERIFIED');assert.equal(checkpoint.databaseOid,receipt.oid);assert.equal(checkpoint.requestId,receipt.requestId);assert.equal(checkpoint.keyFileHash,previousKeys);assert.ok([57,58,59].includes(checkpoint.ledger.length));assert.deepEqual(before.ledger.slice(0,checkpoint.ledger.length),checkpoint.ledger);const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables),after=await migrate(receipt,files);assert.equal(predecessorDigest(receipt,tables),digest);assert.deepEqual(after.ledger.slice(0,before.ledger.length),before.ledger);
}else throw new Error('P1_02_PREFIX_OR_RECOVERY_CHECKPOINT_REQUIRED');
const connection=await ownerServiceConnection(),ownership=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
peer(receipt.name,identitySQL(receipt));grantOrganization(receipt,ownership.role);
const provider=organizationKeys(receipt),campus=openCampus(connection,provider),catalog=await openCatalog(connection,provider);let app;
try{
 const f=await fixture(catalog,{textField:true,ruleVersion:'ORG02_MANUAL_EVIDENCE_TRANSPORT_V1'}),job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID()});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_P1_02_PHYSICAL_ADDRESS_PUBLIC_PHONE_APPROVAL'));
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.validTo===null);
 const codes=await campusCodeSet(catalog,source.versionId);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,{owner:campus,actor:r=>actor(r.headers)});await app.listen({host:'127.0.0.1',port:0});const base=`http://127.0.0.1:${app.server.address().port}/api/vnext/campuses/`;
 const call=async(path,body,who='maker')=>{const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});const result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result;};
 const common={validFrom:'2026-01-01T00:00:00',validTo:null,evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_P1_02',versionNo:1,recordLocator:'DEMO_MANUAL_ROW',recordedAt:'2026-01-01T00:00:00+08:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_OFFICE_APPROVAL'}};
 const apply=async(command)=>{const input=await call('inputs',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',profile:'CORE',command});const requestId=randomUUID(),candidate=await call('plan',{inputId:input.inputId,requestId});await call('review',{candidateId:candidate.candidateId},'reviewer');await call('approve',candidate,'reviewer');const result=await call('apply',{candidateId:candidate.candidateId,requestId});assert.equal(result.status,'COMMITTED');return result.facts[0];};
 const target=f=>({owner:'organization-master/campus',id:f.id,expectedVersion:f.version});
 const subjectCount=peer(receipt.name,'SELECT count(*) FROM organization_master.subject;'),nodes=[];
 for(const [name,role] of [['本部','HEADQUARTERS'],['高新','HIGH_TECH'],['中心','CITY_CENTER']]){
  const facts={campusCode:'DEMO_'+randomUUID(),campusName:'DEMO '+name,nodeRole:role,nodeKind:'PHYSICAL',campusAddress:'DEMO 合成地址',adminDivision:codes.reference,publicPhone:'DEMO_PUBLIC_PHONE',openingDate:null};
  const a=await apply({...common,action:'CREATE',facts});const moved=await apply({...common,action:'REVISE',target:target(a),facts:{...facts,campusName:'DEMO '+name+'更名',campusAddress:'DEMO 迁址'}});assert.equal(moved.id,a.id);
  const planned=await apply({...common,action:'SCHEDULE_OPENING',target:target(moved),plannedOpeningAt:'2027-01-01T00:00:00'});
  assert.equal((await call('query',{id:a.id,businessAt:'2027-02-01T00:00:00'})).operationStatus,'PLANNING');
  const active=await apply({...common,action:'ACTIVATE',target:target(planned),sourceOperationStatus:'RUNNING',state:'RUNNING',validFrom:'2027-01-01T00:00:00.000001'});
  assert.equal((await call('query',{id:a.id,businessAt:'2027-01-01T00:00:00'})).operationStatus,'PLANNING');const old=await call('history',{id:a.id});
  assert.equal((await call('query',{id:a.id,businessAt:'2027-01-01T00:00:00.000001'})).operationStatus,'RUNNING');
  await apply({...common,action:'SUSPEND',target:target(active),sourceOperationStatus:'SUSPENDED',reason:'DEMO_STOP',validFrom:'2026-12-01T00:00:00'});
  assert.equal((await call('query',{id:a.id,businessAt:'2027-02-01T00:00:00'})).operationStatus,'SUSPENDED');
  assert.equal((await call('query',{id:a.id,businessAt:'2027-02-01T00:00:00',asOf:old.operations.at(-1).recordedAt})).operationStatus,'RUNNING');nodes.push(a.id);
 }
 assert.equal(peer(receipt.name,'SELECT count(*) FROM organization_master.subject;'),subjectCount);assert.equal(new Set(nodes).size,3);assert.equal(keyHash(),previousKeys);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 const final=await inspect(receipt);assert.equal(final.identity.oid,before.identity.oid);mkdirSync('.runtime/vnext/p1-02',{recursive:true});const path='.runtime/vnext/p1-02/deployment-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({status:'PASS',method:'REAL_HTTP',previousPrefix:56,currentPrefix:final.ledger.length,databaseOid:final.identity.oid,previousDataPreserved:true,retainedTables:checkpoint.retainedTables,keyFileUnchanged:true,nodes,organizationCountUnchanged:true,formalAcceptance:'NOT_RUN',browser:'NOT_RUN',operatingPermission:'NOT_EVALUABLE'},null,2));console.log(JSON.stringify({status:'PASS',gate:'P1-02-PERSISTENT-HTTP',evidence:path}));
}finally{await app?.close();await campus.close();await catalog.close();}
