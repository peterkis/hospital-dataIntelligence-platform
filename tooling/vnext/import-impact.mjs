import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,resolveTarget,peer } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
const owned=createTemporary();let catalog;const checks=[];const failures=[];
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt);
 peer(owned.receipt.name,"CREATE TRIGGER import_fault BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();");
 try{await assert.rejects(seed(owned.receipt),/IMMUTABLE_HISTORY/);assert.equal(peer(owned.receipt.name,'SELECT (SELECT count(*) FROM governance_catalog.object)+(SELECT count(*) FROM governance_catalog.source_snapshot)+(SELECT count(*) FROM vnext_control.audit);'),'0');}finally{peer(owned.receipt.name,'DROP TRIGGER import_fault ON vnext_control.audit;');}
 checks.push('IMPORT_AUDIT_ATOMIC_ROLLBACK');
 await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'IMPORT_IMPACT_TEST',...extra});
 const transition=(action,o)=>command(action,{target:o.id,expectedHead:o.head,...(['PUBLISH','RETIRE'].includes(action)?{reviewDigest:o.reviewDigest}:{})});
 const publish=async o=>catalog.command('reviewer',transition('PUBLISH',await catalog.command('maker',transition('SUBMIT',o))));
 await check('BASELINE_IMPORT_AUDIT',async()=>{
  assert.equal(peer(owned.receipt.name,"SELECT count(*) FROM vnext_control.audit WHERE action='BASELINE_IMPORT';"),'53');
  assert.equal(peer(owned.receipt.name,"SELECT count(*) FROM vnext_control.audit WHERE action='BASELINE_IMPORT_BATCH';"),'1');
  const before=await catalog.verifyAudit('auditor');assert.equal(before.eventCount,'54');await seed(owned.receipt);assert.deepEqual(await catalog.verifyAudit('auditor'),before);
 });
 await check('UPSTREAM_IMPACT_CLOSURE',async()=>{
  const source=async(code,evidence)=>publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code,values:{name:'合成影响 '+code,environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:'2026-01-01T00:00:00'})));
  let root=await source('IMPACT_ROOT','SYNTHETIC_BOOTSTRAP');let child=await source('IMPACT_CHILD',root.id.toUpperCase());let grandchild=await source('IMPACT_GRANDCHILD',child.id.toUpperCase());
  const revise=async item=>catalog.command('maker',command('REVISE',{target:item.id,expectedHead:item.head,values:{name:'合成重发 '+item.id},validFrom:'2026-01-01T00:00:00'}));
  const reviewedRoot=await catalog.command('maker',transition('SUBMIT',await revise(root)));
  await assert.rejects(catalog.command('reviewer',transition('PUBLISH',reviewedRoot)),/IMPACT_REVIEW_MISMATCH/);
  root=await catalog.command('reviewer',{...transition('PUBLISH',reviewedRoot),impactDigest:(await catalog.sourceImpact('reviewer','SYNTHETIC',root.id)).impactDigest});
  assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.status==='OPEN').length,2);
  const requalify=async item=>{const reviewed=await catalog.command('maker',transition('SUBMIT',await revise(item)));return catalog.command('reviewer',{...transition('PUBLISH',reviewed),impactDigest:(await catalog.sourceImpact('reviewer','SYNTHETIC',item.id)).impactDigest});};
  child=await requalify(child);grandchild=await requalify(grandchild);
  assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.status==='CLOSED').length,2);
  assert.equal((await catalog.resolveSource('maker','SYNTHETIC',grandchild.id,'2026-09-12T00:00:00')).realApply,'NOT_IMPLEMENTED');
  const preview=await catalog.sourceImpact('reviewer','SYNTHETIC',root.id);assert.equal(preview.current.length,2);assert.ok(preview.history.length>=2);
  await assert.rejects(catalog.command('reviewer',{...transition('RETIRE',root),impactDigest:'wrong'}),/IMPACT_REVIEW_MISMATCH/);
  await assert.rejects(catalog.command('reviewer',transition('RETIRE',root)),/IMPACT_REVIEW_MISMATCH/);
  const grandRevision=await catalog.command('maker',command('REVISE',{target:grandchild.id,expectedHead:grandchild.head,values:{name:'合成下游候选'},validFrom:'2026-01-01T00:00:00'}));
  await assert.rejects(catalog.command('reviewer',{...transition('RETIRE',root),impactDigest:preview.impactDigest}),/IMPACT_REVIEW_MISMATCH/);
  const currentPreview=await catalog.sourceImpact('reviewer','SYNTHETIC',root.id);
  const request={...transition('RETIRE',root),impactDigest:currentPreview.impactDigest};
  const beforeFault=peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM governance_catalog.impact_event));');
  peer(owned.receipt.name,"CREATE FUNCTION governance_catalog.impact_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMPACT_WRITE_FAILURE'; END $$; CREATE TRIGGER impact_fault BEFORE INSERT ON governance_catalog.impact_event FOR EACH ROW EXECUTE FUNCTION governance_catalog.impact_fault();");
  try{await assert.rejects(catalog.command('reviewer',request),/IMPACT_WRITE_FAILURE/);assert.equal(peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM governance_catalog.impact_event));'),beforeFault);}finally{peer(owned.receipt.name,'DROP TRIGGER impact_fault ON governance_catalog.impact_event; DROP FUNCTION governance_catalog.impact_fault();');}
  const retired=await catalog.command('reviewer',request);assert.equal(retired.status,'RETIRED');
  const cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);assert.equal(cases.filter(c=>c.status==='OPEN').length,2);
  assert.deepEqual(await catalog.command('reviewer',request),retired);assert.deepEqual(await catalog.impactCases('reviewer','SYNTHETIC',root.id),cases);
  await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',grandchild.id,'2026-09-12T00:00:00'),/SOURCE_EVIDENCE_NOT_READY/);
  for(const downstream of [child,{...grandchild,head:grandRevision.head}]){const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',downstream.id);await catalog.command('reviewer',{...transition('RETIRE',downstream),impactDigest:impact.impactDigest});}
  const closed=await catalog.impactCases('reviewer','SYNTHETIC',root.id);assert.equal(closed.filter(c=>c.status==='CLOSED').length,4);
  assert.ok(closed.every(c=>typeof c.resolution_event==='string'&&c.events.length===2&&c.events[0].status==='OPEN'&&c.events[1].status==='CLOSED'));
  assert.equal((await catalog.history('maker','SYNTHETIC',root.id)).length,7);
  await assert.rejects(catalog.impactCases('outsider','SYNTHETIC',root.id),/ACCESS_DENIED/);
  assert.equal((await catalog.verifyAudit('auditor')).status,'PASS');
 });
 const owner=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'FILTER_OWNER',values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'})));
 const app=await buildCatalogServer(catalog);await app.listen({host:'127.0.0.1',port:0});
 try{
  const headers={'x-catalog-actor':'maker','content-type':'application/json'};
  await check('REVERSED_INTERVAL_FIELD_4XX',async()=>{
   for(const validTo of ['2026-01-01T00:00:00','2025-12-31T23:59:59.999999']){
    const input=command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成反向区间'},validFrom:'2026-01-01T00:00:00',validTo});
    const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(response.status,400);const error=await response.json();assert.equal(error.code,'INVALID_BUSINESS_PERIOD');assert.equal(error.field,'validTo');
    await assert.rejects(catalog.command('maker',input),/INVALID_BUSINESS_PERIOD/);
   }
   const micro=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(command('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'合成微秒区间'},validFrom:'2026-01-01T00:00:00',validTo:'2026-01-01T00:00:00.000001'}))});assert.equal(micro.status,200);
  });
  await check('RESPONSIBILITY_OWNER_FILTER',async()=>{
   const response=await fetch(app.listeningOrigin+'/api/vnext/catalog?scope=SYNTHETIC&kind=RESPONSIBILITY&owner=SYNTHETIC_OWNER_A',{headers});assert.equal(response.status,200);assert.deepEqual((await response.json()).items.map(i=>i.id),[owner.id]);
  });
  await check('FINITE_API_VALUES',async()=>{
   for(const field of ['environment','sourceKind','deploymentScope','authorityScope','fieldGroup','role','assigneeRole']){
    const response=await fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(command('CREATE',{kind:'RESPONSIBILITY',code:'INVALID_ENUM',values:{[field]:'TYPO'},validFrom:'2026-01-01T00:00:00'}))});assert.equal(response.status,400);assert.equal((await response.json()).code,'CLOSED_INPUT_REQUIRED');
   }
  });
 }finally{await app.close();}
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
