import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
const owned=createTemporary();let catalog;const checks=[];const failures=[];
const legacy=process.argv.includes('--prefix9');
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt,legacy?migrationFiles().slice(0,9):migrationFiles());await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const cmd=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'IMPACT_ASSESSMENT_TEST',...extra});
 const impact=(id,action)=>legacy?Promise.resolve(JSON.parse(peer(owned.receipt.name,`SELECT governance_catalog.change_impact('reviewer','SYNTHETIC',${quote(id)});`))):catalog.sourceImpact('reviewer','SYNTHETIC',id,action);
 const publish=async item=>{const review=await catalog.command('maker',cmd('SUBMIT',{target:item.id,expectedHead:item.head}));const assessment=await impact(item.id,'PUBLISH');return catalog.command('reviewer',cmd('PUBLISH',{target:item.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:assessment.impactDigest}));};
 const source=async(code,evidence)=>publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code,values:{name:'合成拟执行影响',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:'2026-01-01T00:00:00'})));
 const root=await source('ASSESS_ROOT','SYNTHETIC_BOOTSTRAP');const child=await source('ASSESS_CHILD',root.id);const grand=await source('ASSESS_GRAND',child.id);
 const revision=await catalog.command('maker',cmd('REVISE',{target:root.id,expectedHead:root.head,values:{name:'合成未来定义'},validFrom:'2027-01-01T00:00:00'}));
 const review=await catalog.command('maker',cmd('SUBMIT',{target:root.id,expectedHead:revision.head}));const proposed=await impact(root.id,'PUBLISH');
 const publication=cmd('PUBLISH',{target:root.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:proposed.impactDigest});
 const published=await catalog.command('reviewer',publication);
 await check('APPROVED_PROJECTED_OPENINGS_EQUAL_EXECUTED_CASES',async()=>{
  assert.ok(proposed.current.every(r=>r.affectedSpans==='{}'));
  const actual=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.upstream_event===published.head);
  assert.equal(actual.length,2);
  assert.deepEqual(actual.map(c=>c.downstream_version).sort(),(proposed.opening??[]).map(c=>c.downstreamVersion).sort());
  assert.ok(proposed.opening.every(c=>String(c.affectedSpans).includes('2027')));
 });
 if(!legacy)await check('IMMUTABLE_RECEIPT_AND_REPLAY',async()=>{
  const receipt=JSON.parse(peer(owned.receipt.name,`SELECT to_jsonb(s) FROM governance_catalog.source_assessment s WHERE event_head=${quote(published.head)};`));
  const {impactDigest,...body}=proposed;assert.deepEqual(receipt.content,body);assert.equal(receipt.digest,impactDigest);
  const before=peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.source_assessment),(SELECT count(*) FROM governance_catalog.impact_event),(SELECT count(*) FROM vnext_control.audit));');
  assert.deepEqual(await catalog.command('reviewer',publication),published);
  assert.equal(peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.source_assessment),(SELECT count(*) FROM governance_catalog.impact_event),(SELECT count(*) FROM vnext_control.audit));'),before);
 });
 if(!legacy){
  const restoreRootRead=()=>peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant VALUES('reviewer',${quote(root.id)},'SYNTHETIC','SOURCE','SYNTHETIC_ALL','METADATA','DEFINITION','READ') ON CONFLICT DO NOTHING;`);
  const revokeRootRead=()=>peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(root.id)} AND permission='READ' AND purpose='METADATA';`);
  const counts=()=>peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.source_assessment),(SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM governance_catalog.impact_event),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.request_identity),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.audit_chain));');
  let childCurrent;let rootHead=published.head;
  await check('PROJECTED_CLOSURE_AUTHORIZATION_AND_EXACT_EXECUTION',async()=>{
   const revision=await catalog.command('maker',cmd('REVISE',{target:child.id,expectedHead:child.head,values:{},validFrom:'2027-01-01T00:00:00'}));
   const review=await catalog.command('maker',cmd('SUBMIT',{target:child.id,expectedHead:revision.head}));
   peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant VALUES('maker',${quote(root.id)},'SYNTHETIC','SOURCE','UNRESOLVED_DECLARATION','METADATA','DEFINITION','WRITE'),('reviewer',${quote(root.id)},'SYNTHETIC','SOURCE','UNRESOLVED_DECLARATION','METADATA','DEFINITION','READ');`);
   const changedRoot=await catalog.command('maker',cmd('REVISE',{target:root.id,expectedHead:rootHead,values:{deploymentScope:'UNRESOLVED_DECLARATION'},validFrom:'2027-01-01T00:00:00'}));
   peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(root.id)} AND campus='SYNTHETIC_ALL' AND permission='READ' AND purpose='METADATA';`);
   await assert.rejects(impact(child.id,'PUBLISH'),/ACCESS_DENIED/);restoreRootRead();
   rootHead=(await catalog.command('maker',cmd('REVISE',{target:root.id,expectedHead:changedRoot.head,values:{deploymentScope:'SYNTHETIC_ALL'},validFrom:'2027-01-01T00:00:00'}))).head;
   checks.push('REFERENCED_EVENT_DIMENSIONS_ENFORCED');
   revokeRootRead();await assert.rejects(impact(child.id,'PUBLISH'),/ACCESS_DENIED/);restoreRootRead();
   const approved=await impact(child.id,'PUBLISH');assert.equal(approved.closing.length,1);assert.equal(approved.opening.length,0);
   const request=cmd('PUBLISH',{target:child.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:approved.impactDigest});
   revokeRootRead();await assert.rejects(catalog.command('reviewer',request),/ACCESS_DENIED/);restoreRootRead();
   childCurrent=await catalog.command('reviewer',request);
   const closed=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.resolution_event===childCurrent.head);
   assert.deepEqual(closed.map(c=>c.case_id).sort(),approved.closing.map(c=>c.caseId).sort());assert.ok(closed.every(c=>c.assessment_head===childCurrent.head));
  });
  await check('NEWLY_EXPOSED_VERSION_REQUIRES_APPROVAL',async()=>{
   const revision=await catalog.command('maker',cmd('REVISE',{target:child.id,expectedHead:childCurrent.head,values:{},validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'}));
   const review=await catalog.command('maker',cmd('SUBMIT',{target:child.id,expectedHead:revision.head}));
   const approved=await impact(child.id,'PUBLISH');
   assert.ok(!approved.current.some(c=>c.versionId===child.versionId));
   assert.equal(approved.opening.length,1);assert.equal(approved.opening[0].downstreamVersion,child.versionId);assert.equal(approved.opening[0].reason,'SOURCE_REVISION_EXPOSED_PIN');
   assert.ok(String(approved.opening[0].affectedSpans).includes('2028'));
   revokeRootRead();await assert.rejects(catalog.command('reviewer',cmd('PUBLISH',{target:child.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:approved.impactDigest})),/ACCESS_DENIED/);restoreRootRead();
   childCurrent=await catalog.command('reviewer',cmd('PUBLISH',{target:child.id,expectedHead:review.head,reviewDigest:review.reviewDigest,impactDigest:approved.impactDigest}));
   const opened=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.assessment_head===childCurrent.head);
   assert.equal(opened.length,1);assert.equal(opened[0].downstream_version,child.versionId);assert.equal(opened[0].status,'OPEN');
  });
  let grandHead=grand.head;
  await check('STALE_DOWNSTREAM_AND_CANDIDATE_REJECTED',async()=>{
   const before=await impact(root.id,'RETIRE');
   const changed=await catalog.command('maker',cmd('REVISE',{target:grand.id,expectedHead:grandHead,values:{name:'合成摘要失效'},validFrom:'2027-01-01T00:00:00',validTo:'2028-01-01T00:00:00'}));grandHead=changed.head;
   await assert.rejects(catalog.command('reviewer',cmd('RETIRE',{target:root.id,expectedHead:rootHead,reviewDigest:published.reviewDigest,impactDigest:before.impactDigest})),/IMPACT_REVIEW_MISMATCH/);
   const candidatePreview=await impact(root.id,'RETIRE');
   const candidate=await catalog.command('maker',cmd('REVISE',{target:root.id,expectedHead:rootHead,values:{name:'合成新候选'},validFrom:'2027-01-01T00:00:00'}));
   await assert.rejects(catalog.command('reviewer',cmd('RETIRE',{target:root.id,expectedHead:rootHead,reviewDigest:published.reviewDigest,impactDigest:candidatePreview.impactDigest})),/STALE_HEAD/);rootHead=candidate.head;
  });
  const retirement=await impact(root.id,'RETIRE');const retireRequest=cmd('RETIRE',{target:root.id,expectedHead:rootHead,reviewDigest:published.reviewDigest,impactDigest:retirement.impactDigest});
  await check('ASSESSMENT_REVOKE_RACE',async()=>{
   const clean=['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE'].flatMap(k=>['-u',k]);
   const admin=spawn('wsl.exe',['-d','Anolis-8.9-HDI-POC','-u','postgres','--','env',...clean,'stdbuf','-oL','psql','-X','-v','ON_ERROR_STOP=1','-p','55434','-d',owned.receipt.name,'-At'],{windowsHide:true,stdio:'pipe'});
   let output='';admin.stdout.on('data',chunk=>{output+=chunk;});admin.stderr.resume();const closed=new Promise(resolve=>admin.on('close',resolve));
   try{
    admin.stdin.write(`BEGIN; DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(root.id)} AND permission='READ' AND purpose='METADATA'; SELECT 'ASSESSMENT_REVOKE_STAGED';\n`);
    for(let n=0;n<100&&!output.includes('ASSESSMENT_REVOKE_STAGED');n++)await delay(50);assert.ok(output.includes('ASSESSMENT_REVOKE_STAGED'));
    const pending=catalog.command('reviewer',retireRequest).then(value=>({value}),error=>({error}));
    let waiting=false;for(let n=0;n<30&&!waiting;n++){waiting=peer(owned.receipt.name,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hdi-vnext-catalog' AND wait_event='advisory');")==='t';if(!waiting)await delay(50);}assert.ok(waiting);
    admin.stdin.end('COMMIT;\n');assert.equal(await closed,0);assert.match((await pending).error?.message??'',/ACCESS_DENIED/);
   }finally{if(!admin.stdin.destroyed)admin.stdin.end('ROLLBACK;\n');await closed;restoreRootRead();}
  });
  await check('EVERY_WRITE_STAGE_ROLLS_BACK',async()=>{
   for(const [table,timing] of [['governance_catalog.source_assessment','BEFORE'],['vnext_control.audit','AFTER'],['governance_catalog.event','AFTER'],['governance_catalog.impact_event','AFTER'],['vnext_control.outcome','AFTER'],['vnext_control.request_identity','AFTER']]){
    const before=counts();peer(owned.receipt.name,`CREATE FUNCTION governance_catalog.freeze_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ASSESSMENT_FAULT'; END $$; CREATE TRIGGER zz_freeze_fault ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION governance_catalog.freeze_fault();`);
    try{await assert.rejects(catalog.command('reviewer',retireRequest),/ASSESSMENT_FAULT/);assert.equal(counts(),before,table);}finally{peer(owned.receipt.name,`DROP TRIGGER zz_freeze_fault ON ${table}; DROP FUNCTION governance_catalog.freeze_fault();`);}
   }
  });
  await check('TRIGGER_REQUIRES_CORRECT_RECEIPT_AND_APP_CANNOT_FORGE',async()=>{
   const pool=new pg.Pool({connectionString:resolveTarget(owned.receipt),max:1});
   try{for(const statement of ['SELECT * FROM governance_catalog.source_assessment','DELETE FROM governance_catalog.source_assessment','TRUNCATE governance_catalog.source_assessment'])await assert.rejects(pool.query(statement),/permission denied/);}finally{await pool.end();}
   const before=counts();
   peer(owned.receipt.name,`BEGIN; DO $$ DECLARE rejected boolean:=false; BEGIN BEGIN INSERT INTO governance_catalog.event(object_id,version_id,status,actor_code,reason) VALUES(${quote(root.id)},${quote(published.versionId)},'RETIRED','reviewer','TEST'); EXCEPTION WHEN raise_exception THEN IF SQLERRM='IMPACT_ASSESSMENT_REQUIRED' THEN rejected:=true; ELSE RAISE; END IF; END; IF NOT rejected THEN RAISE EXCEPTION 'MISSING_RECEIPT_ACCEPTED'; END IF; END $$; ROLLBACK;`);
   const {impactDigest,...body}=retirement;
   peer(owned.receipt.name,`BEGIN; DO $$ DECLARE h bigint; rejected boolean:=false; BEGIN BEGIN h:=nextval('governance_catalog.event_head_seq'); INSERT INTO governance_catalog.source_assessment(event_head,object_id,action,request_id,reviewer_actor,reviewer_identity,reason,content,digest) VALUES(h,${quote(root.id)},'RETIRE',uuidv7(),'maker','SYNTHETIC_MAKER','TEST',${quote(JSON.stringify(body))}::jsonb,${quote(impactDigest)}); INSERT INTO governance_catalog.event(head,object_id,version_id,status,actor_code,reason) OVERRIDING SYSTEM VALUE VALUES(h,${quote(root.id)},${quote(published.versionId)},'RETIRED','reviewer','TEST'); EXCEPTION WHEN raise_exception THEN IF SQLERRM='IMPACT_ASSESSMENT_MISMATCH' THEN rejected:=true; ELSE RAISE; END IF; END; IF NOT rejected THEN RAISE EXCEPTION 'WRONG_RECEIPT_ACCEPTED'; END IF; END $$; ROLLBACK;`);
   assert.equal(counts(),before);
  });
  await check('RETIREMENT_AND_CLOSURES_MATCH_FROZEN_ASSESSMENTS',async()=>{
   const retired=await catalog.command('reviewer',retireRequest);
   const created=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.assessment_head===retired.head);
   assert.deepEqual(created.map(c=>c.downstream_version).sort(),retirement.opening.map(c=>c.downstreamVersion).sort());
   for(const item of [{...childCurrent},{...grand,head:grandHead}]){
    const approved=await impact(item.id,'RETIRE');const result=await catalog.command('reviewer',cmd('RETIRE',{target:item.id,expectedHead:item.head,reviewDigest:item.reviewDigest,impactDigest:approved.impactDigest}));
    const closed=(await catalog.impactCases('reviewer','SYNTHETIC',root.id)).filter(c=>c.resolution_event===result.head);
    assert.deepEqual(closed.map(c=>c.case_id).sort(),approved.closing.filter(c=>c.upstreamObject===root.id).map(c=>c.caseId).sort());
   }
   assert.ok((await catalog.impactCases('reviewer','SYNTHETIC',root.id)).every(c=>c.status==='CLOSED'));await catalog.verifyAudit('auditor');
  });
 }
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
