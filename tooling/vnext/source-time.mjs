import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
const owned=createTemporary();let catalog;const checks=[];const failures=[];
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt,process.argv.includes('--prefix8')?migrationFiles().slice(0,8):migrationFiles());await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SOURCE_TIME_TEST',...extra});
 const publish=async item=>{const review=await catalog.command('maker',command('SUBMIT',{target:item.id,expectedHead:item.head}));const impact=process.argv.includes('--prefix8')?JSON.parse(peer(owned.receipt.name,`SELECT governance_catalog.change_impact('reviewer','SYNTHETIC',${quote(item.id)});`)):await catalog.sourceImpact('reviewer','SYNTHETIC',item.id,'PUBLISH');return catalog.command('reviewer',command('PUBLISH',{target:review.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:impact.impactDigest}));};
 const create=(code,evidence,from='2026-01-01T00:00:00',to=null)=>catalog.command('maker',command('CREATE',{kind:'SOURCE',code,values:{name:'合成时态来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:from,validTo:to}));
 const revise=(item,from,to=null)=>catalog.command('maker',command('REVISE',{target:item.id,expectedHead:item.head,values:{name:'合成时态修订'},validFrom:from,validTo:to}));
 const root1=await publish(await create('TIMED_ROOT','SYNTHETIC_BOOTSTRAP'));const child1=await publish(await create('TIMED_CHILD',root1.id));const grand1=await publish(await create('TIMED_GRAND',child1.id));
 const root2=await publish(await revise(root1,'2027-01-01T00:00:00'));
 const qualify=(id,b)=>catalog.resolveSource('maker','SYNTHETIC',id,b);
 await check('BUSINESS_EFFECTIVE_ROOT_AND_FIXED_CHAIN',async()=>{
  assert.equal((await qualify(root1.id,'2026-09-12T00:00:00')).versionId,root1.versionId);
  assert.equal((await qualify(child1.id,'2026-09-12T00:00:00')).versionId,child1.versionId);
  await qualify(grand1.id,'2026-09-12T00:00:00');
  assert.equal((await qualify(root1.id,'2027-01-01T00:00:00')).versionId,root2.versionId);
  await assert.rejects(qualify(child1.id,'2027-01-01T00:00:00'),/SOURCE_EVIDENCE_NOT_READY/);
 });
 await check('ADMISSION_REQUIRES_ONE_FULL_PERIOD_PIN',async()=>{
  await assert.rejects(create('CROSSING_PIN',root1.id),/SOURCE_PERIOD_NOT_COVERED/);
  const past=await publish(await create('PAST_PIN',root1.id,'2026-01-01T00:00:00','2027-01-01T00:00:00'));
  const entry=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===past.id);
  assert.equal(entry.payload.sourceEvidenceVersion,root1.versionId);await qualify(past.id,'2026-09-12T00:00:00');
  const deepPast=await publish(await create('DEEP_PAST_PIN',child1.id,'2026-01-01T00:00:00','2027-01-01T00:00:00'));await qualify(deepPast.id,'2026-09-12T00:00:00');
 });
 await check('PARTIAL_REQUALIFICATION_PRESERVES_FUTURE_IMPACT',async()=>{
  const partial=await publish(await revise(child1,'2027-01-01T00:00:00','2028-01-01T00:00:00'));
  assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root1.id)).find(c=>c.downstream_version===child1.versionId)?.status,'OPEN');
  assert.equal((await qualify(child1.id,'2026-09-12T00:00:00')).versionId,child1.versionId);
  assert.equal((await qualify(child1.id,'2027-06-01T00:00:00')).versionId,partial.versionId);
  await assert.rejects(qualify(child1.id,'2028-01-01T00:00:00'),/SOURCE_EVIDENCE_NOT_READY/);
  const complete=await publish(await revise(partial,'2027-01-01T00:00:00'));
  const childCase=(await catalog.impactCases('reviewer','SYNTHETIC',root1.id)).find(c=>c.downstream_version===child1.versionId);
  assert.equal(childCase.status,'CLOSED');assert.equal(childCase.resolution_event,complete.head);
  assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root1.id)).find(c=>c.downstream_version===grand1.versionId).status,'OPEN');
  await publish(await revise(grand1,'2027-01-01T00:00:00'));
  assert.ok((await catalog.impactCases('reviewer','SYNTHETIC',root1.id)).every(c=>c.status==='CLOSED'));
  await qualify(grand1.id,'2026-09-12T00:00:00');await qualify(grand1.id,'2028-01-01T00:00:00');
 });
 await check('PUBLICATION_RECHECKS_FULL_PARENT_COVERAGE',async()=>{
  const pending=await create('PENDING_PERIOD',root1.id,'2026-01-01T00:00:00','2027-01-01T00:00:00');
  await publish(await revise(root2,'2026-01-01T00:00:00','2026-06-01T00:00:00'));
  await assert.rejects(publish(pending),/SOURCE_PERIOD_NOT_COVERED/);
 });
 await check('QUALIFICATION_CURRENT_PURPOSE_REVOKE',async()=>{
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(root1.id)} AND purpose='SYNTHETIC_REFERENCE';`);
  await assert.rejects(qualify(root1.id,'2026-09-12T00:00:00'),/ACCESS_DENIED/);
  await assert.rejects(qualify(grand1.id,'2027-06-01T00:00:00'),/ACCESS_DENIED/);
 });
 const app=await buildCatalogServer(catalog);await app.listen({host:'127.0.0.1',port:0});
 try{await check('CREATE_KIND_FIELDS_REJECTED_BEFORE_STORAGE',async()=>{
  const before=peer(owned.receipt.name,'SELECT count(*) FROM vnext_control.audit;');
  for(const [kind,values] of [['SOURCE',{}],['SOURCE',{dataset:'ORG01'}],['RESPONSIBILITY',{}],['DATASET',{role:'OWNER'}],['SOURCE',{name:'TEST',environment:'SYNTHETIC',sourceKind:'SOFTWARE',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'}]]){
   const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers:{'x-catalog-actor':'maker','content-type':'application/json'},body:JSON.stringify(command('CREATE',{kind,code:'INVALID_FIELDS',values,validFrom:'2026-01-01T00:00:00'}))});assert.equal(response.status,400);assert.equal((await response.json()).code,'CLOSED_INPUT_REQUIRED');
  }
  assert.equal(peer(owned.receipt.name,'SELECT count(*) FROM vnext_control.audit;'),before);
 });}finally{await app.close();}
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
