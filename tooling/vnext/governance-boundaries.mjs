import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,resolveTarget,peer } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';

const owned=createTemporary();let catalog;const failures=[];const checks=[];
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt);await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'BOUNDARY_TEST',...extra});
 const create=code=>catalog.command('maker',command('CREATE',{kind:'DATASET',code,values:{name:'合成边界'},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'}));
 const transition=(action,o)=>command(action,{target:o.id,expectedHead:o.head,...(['PUBLISH','RETIRE'].includes(action)?{reviewDigest:o.reviewDigest}:{})});
 const publish=async o=>catalog.command('reviewer',transition('PUBLISH',await catalog.command('maker',transition('SUBMIT',o))));
 const approved=await publish(await create('ORG01'));
 await check('INDEPENDENT_RETIRE',async()=>{
  await assert.rejects(catalog.command('maker-alias',transition('RETIRE',approved)),/SELF_REVIEW_FORBIDDEN/);
  await assert.rejects(catalog.command('reviewer',{...transition('RETIRE',approved),reviewDigest:'wrong'}),/REVIEW_DIGEST_MISMATCH/);
  peer(owned.receipt.name,"DELETE FROM vnext_control.actor_grant WHERE actor_code='reviewer' AND permission='REVIEW';");
  await assert.rejects(catalog.command('reviewer',transition('RETIRE',approved)),/ACCESS_DENIED/);
  peer(owned.receipt.name,"INSERT INTO vnext_control.actor_grant VALUES('reviewer','SYNTHETIC','REVIEW');");
  const request=transition('RETIRE',approved);const retired=await catalog.command('reviewer',request);assert.equal(retired.status,'RETIRED');
  assert.deepEqual(await catalog.command('reviewer',request),retired);
 });
 const candidate=await create('ORG02');
 await check('ACTION_CLOSED_FIELDS',async()=>{
  for(const extra of [{kind:'SOURCE'},{code:'OTHER'},{reviewDigest:'ignored'},{values:{}}])await assert.rejects(catalog.command('maker',{...transition('SUBMIT',candidate),...extra}),/ACTION_FIELDS_FORBIDDEN/);
  await assert.rejects(catalog.command('maker',command('REVISE',{target:candidate.id,expectedHead:candidate.head,kind:'DATASET',values:{name:'合成'},validFrom:'2026-01-01T00:00:00'})),/ACTION_FIELDS_FORBIDDEN/);
 });
 await check('EFFECTIVE_AND_HEAD_SEPARATION',async()=>{
  const published=await publish(await create('ORG03'));
  const revised=await catalog.command('maker',command('REVISE',{target:published.id,expectedHead:published.head,values:{name:'未批准'},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'}));
  assert.equal((await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===published.id).versionId,revised.versionId);
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00'})).items.find(i=>i.id===published.id).versionId,published.versionId);
  assert.ok(!(await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2027-01-01T00:00:00'})).items.some(i=>i.id===published.id));
  assert.ok(!(await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2025-12-31T23:59:59.999999'})).items.some(i=>i.id===published.id));
  const request={...transition('RETIRE',revised),reviewDigest:published.reviewDigest};
  await catalog.command('reviewer',request);
  assert.ok(!(await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00'})).items.some(i=>i.id===published.id));
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00',asOf:published.recordedAt})).items.find(i=>i.id===published.id).versionId,published.versionId);
  await assert.rejects(catalog.readEffective('outsider',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00',asOf:published.recordedAt}),/ACCESS_DENIED/);
  const owner=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'EFFECTIVE_OWNER',values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00',validTo:null})));
  const future=await catalog.command('maker',command('REVISE',{target:owner.id,expectedHead:owner.head,values:{},validFrom:'2027-01-01T00:00:00',validTo:null}));
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00'})).items.find(i=>i.id===owner.id).versionId,owner.versionId);
  await publish(future);
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00'})).items.find(i=>i.id===owner.id).versionId,owner.versionId);
  assert.ok((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2027-01-01T00:00:00'})).items.some(i=>i.id===owner.id));
 });
 const app=await buildCatalogServer(catalog);await app.listen({host:'127.0.0.1',port:0});
 try{
  const headers={'x-catalog-actor':'maker','content-type':'application/json'};
  await check('CALENDAR_FIELD_4XX',async()=>{
   for(const value of ['2026-02-30T00:00:00','2026-13-01T00:00:00','2026-01-01T24:00:00','0000-01-01T00:00:00']){
    const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成'},validFrom:value}))});
    assert.equal(response.status,400);const body=await response.json();assert.equal(body.code,'LOCAL_TIME_REQUIRED');assert.equal(body.field,'validFrom');
    await assert.rejects(catalog.command('maker',command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成'},validFrom:value})),/LOCAL_TIME_REQUIRED/);
   }
   const leap=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成闰年'},validFrom:'2028-02-29T23:59:59.123456'}))});assert.equal(leap.status,200);
  });
  await check('HTTP_CLOSED_ACTION',async()=>{
   const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify({...transition('SUBMIT',candidate),code:'IGNORED'})});assert.equal(response.status,400);
  });
  await check('HTTP_EFFECTIVE_READ',async()=>{
   const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/effective?scope=SYNTHETIC&businessAt=2026-09-12T00%3A00%3A00',{headers});assert.equal(response.status,200);assert.ok(Array.isArray((await response.json()).items));
  });
 }finally{await app.close();}
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
