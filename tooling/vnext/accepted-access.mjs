import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
const owned=createTemporary();let catalog;const checks=[];const failures=[];
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt,migrationFiles().slice(0,7));await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'ACCEPTED_ACCESS_TEST',...extra});
 const publish=async item=>{const review=await catalog.command('maker',command('SUBMIT',{target:item.id,expectedHead:item.head}));return catalog.command('reviewer',command('PUBLISH',{target:review.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));};
 const owner=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'ACCEPTED_OWNER',values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'})));
 const source=async(code,evidence)=>publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code,values:{name:'合成已接受定义',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:'2026-01-01T00:00:00'})));
 const root=await source('ACCEPTED_ROOT','SYNTHETIC_BOOTSTRAP');const child=await source('ACCEPTED_CHILD',root.id);
 peer(owned.receipt.name,`INSERT INTO vnext_control.actor_grant VALUES('outsider','SYNTHETIC','READ');
 INSERT INTO vnext_control.object_grant VALUES
 ('outsider',${quote(owner.id)},'SYNTHETIC','RESPONSIBILITY','SYNTHETIC_ALL','METADATA','ALL','READ'),
 ('maker',${quote(owner.id)},'SYNTHETIC','RESPONSIBILITY','SYNTHETIC_NORTH','METADATA','IDENTITY','WRITE'),
 ('maker',${quote(root.id)},'SYNTHETIC','SOURCE','UNRESOLVED_DECLARATION','METADATA','DEFINITION','WRITE');
 INSERT INTO vnext_control.object_grant SELECT 'outsider',id,'SYNTHETIC','SOURCE','SYNTHETIC_ALL',purpose,'DEFINITION','READ' FROM governance_catalog.object CROSS JOIN unnest(ARRAY['METADATA','SYNTHETIC_REFERENCE']) purpose WHERE kind='SOURCE';`);
 const ownerDraft=await catalog.command('maker',command('REVISE',{target:owner.id,expectedHead:owner.head,values:{authorityScope:'NORTH',fieldGroup:'IDENTITY'},validFrom:'2026-01-01T00:00:00'}));
 const rootDraft=await catalog.command('maker',command('REVISE',{target:root.id,expectedHead:root.head,values:{deploymentScope:'UNRESOLVED_DECLARATION'},validFrom:'2026-01-01T00:00:00'}));
 const facts=()=>peer(owned.receipt.name,"SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM governance_catalog.version v),(SELECT jsonb_agg(to_jsonb(e) ORDER BY head) FROM governance_catalog.event e),(SELECT jsonb_agg(to_jsonb(o) ORDER BY request_id) FROM vnext_control.outcome o),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vnext_control.audit a));");
 const before=facts();await catalog.close();catalog=null;
 if(!process.argv.includes('--prefix7'))await migrate(owned.receipt);
 assert.equal(facts(),before);catalog=await openCatalog(resolveTarget(owned.receipt));
 const effective=asOf=>catalog.readEffective('outsider',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00',...(asOf?{asOf}:{})});
 await check('ACCEPTED_OWNER_UNAFFECTED_BY_DRAFT_DIMENSIONS',async()=>{
  assert.equal((await effective()).items.find(i=>i.id===owner.id)?.versionId,owner.versionId);
  assert.equal((await effective(owner.recordedAt)).items.find(i=>i.id===owner.id)?.versionId,owner.versionId);
  assert.ok(!(await catalog.read('outsider',{scope:'SYNTHETIC'})).items.some(i=>i.id===owner.id));
 });
 await check('ACCEPTED_SOURCE_AND_PINNED_CHAIN_UNAFFECTED',async()=>{
  assert.equal((await effective()).items.find(i=>i.id===root.id)?.versionId,root.versionId);
  await catalog.resolveSource('outsider','SYNTHETIC',root.id,'2026-09-12T00:00:00');
  assert.equal((await catalog.resolveSource('outsider','SYNTHETIC',child.id,'2026-09-12T00:00:00')).realApply,'NOT_IMPLEMENTED');
 });
 await catalog.command('maker',command('SUBMIT',{target:owner.id,expectedHead:ownerDraft.head}));await catalog.command('maker',command('SUBMIT',{target:root.id,expectedHead:rootDraft.head}));
 await check('REVIEW_DIMENSIONS_DO_NOT_REPLACE_ACCEPTED_AUTHORIZATION',async()=>{
  assert.equal((await effective()).items.find(i=>i.id===owner.id)?.versionId,owner.versionId);
  await catalog.resolveSource('outsider','SYNTHETIC',child.id,'2026-09-12T00:00:00');
 });
 await check('CURRENT_ACCEPTED_GRANT_REVOKE_STILL_ENFORCED',async()=>{
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='outsider' AND object_id=${quote(owner.id)}; DELETE FROM vnext_control.object_grant WHERE actor_code='outsider' AND object_id=${quote(root.id)} AND purpose='SYNTHETIC_REFERENCE';`);
  assert.ok(!(await effective(owner.recordedAt)).items.some(i=>i.id===owner.id));
  await assert.rejects(catalog.resolveSource('outsider','SYNTHETIC',child.id,'2026-09-12T00:00:00'),/ACCESS_DENIED/);
 });
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,upgradeFactsUnchanged:true,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
