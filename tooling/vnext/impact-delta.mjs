import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {migrate,migrationFiles,resolveTarget,peer,quote} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
const owned=createTemporary();let catalog;const checks=[],failures=[];
const prefix=process.argv.includes('--prefix10'),upgrade=process.argv.includes('--upgrade');
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
const A='{["2027-01-01 00:00:00","2028-01-01 00:00:00")}',B='{["2029-01-01 00:00:00","2030-01-01 00:00:00")}';
const hash=value=>createHash('sha256').update(value).digest('hex');
try{
 await migrate(owned.receipt,prefix||upgrade?migrationFiles().slice(0,10):migrationFiles());await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const cmd=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'EVENT_DELTA_TEST',...extra});
 const impact=(id,action='PUBLISH')=>catalog.sourceImpact('reviewer','SYNTHETIC',id,action);
 const publish=async item=>{const review=await catalog.command('maker',cmd('SUBMIT',{target:item.id,expectedHead:item.head}));const approved=await impact(item.id);const result=await catalog.command('reviewer',cmd('PUBLISH',{target:item.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:approved.impactDigest}));return {...result,approved};};
 const source=async(code,evidence,validFrom='2026-01-01T00:00:00')=>publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code,values:{name:'合成事件区间',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom})));
 const revise=async(item,from,to)=>publish(await catalog.command('maker',cmd('REVISE',{target:item.id,expectedHead:item.head,values:{},validFrom:from,validTo:to})));
 let root=await source('DELTA_ROOT','SYNTHETIC_BOOTSTRAP');let child=await source('DELTA_CHILD',root.id.toUpperCase());let grand=await source('DELTA_GRAND',child.id.toUpperCase());
 root=await revise(root,'2027-01-01T00:00:00','2028-01-01T00:00:00');const firstHead=root.head;
 root=await revise(root,'2029-01-01T00:00:00','2030-01-01T00:00:00');const secondHead=root.head;
 if(upgrade){
  let legacy=await source('LEGACY_CAPS_EXPOSURE',root.id.toUpperCase(),'2035-01-01T00:00:00');
  root=await revise(root,'2036-01-01T00:00:00','2037-01-01T00:00:00');
  legacy=await revise(legacy,'2036-01-01T00:00:00','2037-01-01T00:00:00');
  legacy=await revise(legacy,'2036-01-01T00:00:00','2036-07-01T00:00:00');const legacyExposureHead=legacy.head;
  const saved=peer(owned.receipt.name,"SELECT jsonb_build_object('events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY case_id,event_sequence) FROM governance_catalog.impact_event t),'assessments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_head) FROM governance_catalog.source_assessment t),'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM vnext_control.audit t))::text;");
  await catalog.close();await migrate(owned.receipt);await migrate(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
  const after=peer(owned.receipt.name,"SELECT jsonb_build_object('events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY case_id,event_sequence) FROM governance_catalog.impact_event t),'assessments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_head) FROM governance_catalog.source_assessment t),'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM vnext_control.audit t))::text;");
  await check('ACTUAL_10_TO_11_PRESERVES_ALL_EVENTS_ASSESSMENTS_AND_AUDIT',async()=>assert.equal(hash(after),hash(saved)));
  await check('UPPERCASE_LEGACY_EXPOSED_CASE_DERIVES_AND_CLOSES',async()=>{
   const opened=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).find(c=>c.assessment_head===legacyExposureHead&&c.downstream_object===legacy.id);
   assert.equal(opened.obligation.affectedSpans,'{["2036-07-01 00:00:00","2037-01-01 00:00:00")}');assert.equal(opened.obligation.basis,'DERIVED_LEGACY_ASSESSMENT_DELTA');
   legacy=await revise(legacy,'2036-07-01T00:00:00','2037-01-01T00:00:00');
   assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).find(c=>c.case_id===opened.case_id).status,'CLOSED');
  });
 }else await check('NEW_DOWNSTREAM_CASES_FREEZE_ONLY_EVENT_DELTA',async()=>{assert.equal(root.approved.opening.length,2);assert.ok(root.approved.opening.every(item=>item.affectedSpans===B));});
 let cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);
 const first=cases.find(c=>c.upstream_event===firstHead&&c.downstream_object===child.id),second=cases.find(c=>c.upstream_event===secondHead&&c.downstream_object===child.id);
 if(!prefix)await check('CASE_SCOPE_IS_EXPLICIT_AND_LEGACY_BASIS_IS_HONEST',async()=>{assert.equal(first.obligation.affectedSpans,A);assert.equal(second.obligation.affectedSpans,B);assert.equal(second.obligation.basis,upgrade?'DERIVED_LEGACY_ASSESSMENT_DELTA':'FROZEN_EVENT_DELTA');});
 child=await revise(child,'2029-01-01T00:00:00','2029-07-01T00:00:00');
 await check('PARTIAL_B_REPAIR_CANNOT_CLOSE_REMAINDER',async()=>{assert.equal(child.approved.closing.length,0);assert.equal((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).find(c=>c.case_id===second.case_id).status,'OPEN');});
 const fullCandidate=await catalog.command('maker',cmd('REVISE',{target:child.id,expectedHead:child.head,values:{},validFrom:'2029-01-01T00:00:00',validTo:'2030-01-01T00:00:00'}));
 const fullReview=await catalog.command('maker',cmd('SUBMIT',{target:child.id,expectedHead:fullCandidate.head}));const fullImpact=await impact(child.id);
 const fullRequest=cmd('PUBLISH',{target:child.id,expectedHead:fullReview.head,reviewDigest:fullReview.reviewDigest,impactDigest:fullImpact.impactDigest});
 if(!prefix)await check('SCOPED_CLOSURE_ALL_WRITE_STAGES_ARE_ATOMIC',async()=>{
  const counts=()=>peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.source_assessment),(SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM governance_catalog.impact_event),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.request_identity),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.audit_chain));');
  for(const table of ['governance_catalog.source_assessment','vnext_control.audit','governance_catalog.event','governance_catalog.impact_event','vnext_control.outcome','vnext_control.request_identity']){
   const before=counts();peer(owned.receipt.name,`CREATE FUNCTION governance_catalog.delta_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DELTA_CLOSURE_FAULT'; END $$; CREATE TRIGGER zz_delta_fault AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION governance_catalog.delta_fault();`);
   try{await assert.rejects(catalog.command('reviewer',fullRequest),/DELTA_CLOSURE_FAULT/);assert.equal(counts(),before,table);}finally{peer(owned.receipt.name,`DROP TRIGGER zz_delta_fault ON ${table}; DROP FUNCTION governance_catalog.delta_fault();`);}
  }
 });
 child={...await catalog.command('reviewer',fullRequest),approved:fullImpact};
 await check('REPAIR_B_CLOSES_B_WITH_A_STILL_OPEN',async()=>{
  assert.deepEqual(child.approved.closing.map(c=>c.caseId),[second.case_id]);
  cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);assert.equal(cases.find(c=>c.case_id===second.case_id).status,'CLOSED');assert.equal(cases.find(c=>c.case_id===first.case_id).status,'OPEN');
 });
 grand=await revise(grand,'2029-01-01T00:00:00','2030-01-01T00:00:00');
 await check('TRANSITIVE_CASES_CLOSE_ONLY_THEIR_OWN_INTERVAL',async()=>{
  const cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);assert.equal(cases.filter(c=>c.upstream_event===secondHead&&c.status==='CLOSED').length,2);assert.equal(cases.filter(c=>c.upstream_event===firstHead&&c.status==='OPEN').length,2);
 });
 child=await revise(child,'2029-01-01T00:00:00','2029-07-01T00:00:00');
 await check('EXPOSED_TARGET_VERSION_FREEZES_ONLY_NEW_DELTA',async()=>{
  const own=child.approved.opening.filter(c=>c.downstreamObject===child.id);assert.equal(own.length,1);assert.equal(own[0].affectedSpans,'{["2029-07-01 00:00:00","2030-01-01 00:00:00")}');
 });
 const exposedHead=child.head;
 child=await revise(child,'2029-07-01T00:00:00','2030-01-01T00:00:00');
 await check('EXPOSED_CASE_CLOSES_WITH_UNRELATED_A_REMAINING',async()=>{
  const cases=await catalog.impactCases('reviewer','SYNTHETIC',root.id);const exposed=cases.find(c=>c.events[0].assessment_head===exposedHead&&c.downstream_object===child.id);assert.equal(exposed.status,'CLOSED');assert.equal(cases.find(c=>c.case_id===first.case_id).status,'OPEN');
 });
 if(!prefix){
  await check('DERIVED_CASE_READ_OBEYS_CURRENT_PINNED_REFERENCE_ACCESS',async()=>{
   peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(root.id)} AND permission='READ' AND purpose='SYNTHETIC_REFERENCE';`);
   try{await assert.rejects(catalog.impactCases('reviewer','SYNTHETIC',root.id),/ACCESS_DENIED/);}finally{peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant VALUES('reviewer',${quote(root.id)},'SYNTHETIC','SOURCE','SYNTHETIC_ALL','SYNTHETIC_REFERENCE','DEFINITION','READ');`);}
  });
  await check('OVERLAPPING_OBLIGATIONS_REMAIN_INDEPENDENT',async()=>{
   let r=await source('OVERLAP_ROOT',root.id,'2040-01-01T00:00:00');let c=await source('OVERLAP_CHILD',r.id,'2040-01-01T00:00:00');
   r=await revise(r,'2047-01-01T00:00:00','2048-01-01T00:00:00');const first=r.head;
   r=await revise(r,'2047-01-01T00:00:00','2047-07-01T00:00:00');
   r=await revise(r,'2047-07-01T00:00:00','2048-07-01T00:00:00');const second=r.head;
   assert.equal(r.approved.opening[0].affectedSpans,'{["2047-07-01 00:00:00","2048-07-01 00:00:00")}');
   c=await revise(c,'2047-07-01T00:00:00','2048-07-01T00:00:00');
   let cases=await catalog.impactCases('reviewer','SYNTHETIC',r.id);assert.equal(cases.find(x=>x.upstream_event===second).status,'CLOSED');assert.equal(cases.find(x=>x.upstream_event===first).status,'OPEN');
   c=await revise(c,'2047-01-01T00:00:00','2047-07-01T00:00:00');cases=await catalog.impactCases('reviewer','SYNTHETIC',r.id);assert.ok(cases.every(x=>x.status==='CLOSED'));
  });
 }
 await catalog.verifyAudit('auditor');
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
