import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
const owned=createTemporary();let catalog;const checks=[];const failures=[];
const check=async(name,fn)=>{try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 await migrate(owned.receipt);await seed(owned.receipt);catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'OBJECT_ACCESS_TEST',...extra});
 const create=code=>command('CREATE',{kind:'DATASET',code,values:{name:'合成对象授权 '+code},validFrom:'2026-01-01T00:00:00',validTo:'2027-01-01T00:00:00'});
 const publish=async o=>{const review=await catalog.command('maker',command('SUBMIT',{target:o.id,expectedHead:o.head}));return catalog.command('reviewer',command('PUBLISH',{target:o.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));};
 const firstRequest=create('ORG01');const first=await catalog.command('maker',firstRequest);await catalog.command('maker',create('ORG02'));
 peer(owned.receipt.name,"INSERT INTO vnext_control.actor_grant SELECT 'outsider','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE','REVIEW']) p;");
 await check('BASE_SCOPE_DOES_NOT_GRANT_OBJECT_WRITE',async()=>{await assert.rejects(catalog.command('outsider',command('REVISE',{target:first.id,expectedHead:first.head,values:{name:'越权候选'},validFrom:'2026-01-01T00:00:00'})),/ACCESS_DENIED/);});
 await check('BASE_SCOPE_DOES_NOT_GRANT_OBJECT_READ',async()=>{assert.equal((await catalog.read('outsider',{scope:'SYNTHETIC'})).items.length,0);});
 const grant=(actor,id,permission,kind='DATASET',campus='N_A',group='DEFINITION',purpose='METADATA')=>peer(owned.receipt.name,`INSERT INTO vnext_control.object_grant VALUES(${quote(actor)},${quote(id)},'SYNTHETIC',${quote(kind)},${quote(campus)},${quote(purpose)},${quote(group)},${quote(permission)}) ON CONFLICT DO NOTHING;`);
 await check('EXPLICIT_OBJECT_ALIAS_AND_PUBLISH_CAPABILITIES',async()=>{
  await assert.rejects(catalog.command('outsider',create('ORG08')),/ACCESS_DENIED/);
  grant('outsider',first.id,'READ');assert.deepEqual((await catalog.read('outsider',{scope:'SYNTHETIC'})).items.map(i=>i.id),[first.id]);
  assert.ok((await catalog.read('outsider',{scope:'SYNTHETIC'})).domains.every(d=>d.datasets.length===0));
  await assert.rejects(catalog.history('outsider','SYNTHETIC',(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.code==='ORG02').id),/ACCESS_DENIED/);
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker-alias' AND object_id=${quote(first.id)} AND permission='WRITE';`);
  await assert.rejects(catalog.command('maker-alias',firstRequest),/ACCESS_DENIED/);
  grant('maker-alias',first.id,'WRITE');assert.deepEqual(await catalog.command('maker-alias',firstRequest),first);
  const review=await catalog.command('maker',command('SUBMIT',{target:first.id,expectedHead:first.head}));
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(first.id)} AND permission='PUBLISH';`);
  const publication=command('PUBLISH',{target:first.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
  await assert.rejects(catalog.command('reviewer',publication),/ACCESS_DENIED/);grant('reviewer',first.id,'PUBLISH');await catalog.command('reviewer',publication);
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(first.id)} AND permission='PUBLISH';`);
  await assert.rejects(catalog.command('reviewer',publication),/ACCESS_DENIED/);grant('reviewer',first.id,'PUBLISH');
 });
 await check('TYPE_CAMPUS_FIELD_GROUP_AND_PURPOSE',async()=>{
  const responsibility=await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'SCOPED_OWNER',values:{dataset:'ORG07',authorityScope:'NORTH',fieldGroup:'IDENTITY',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}));
  grant('outsider',responsibility.id,'READ','DATASET','SYNTHETIC_NORTH','IDENTITY');
  assert.ok(!(await catalog.read('outsider',{scope:'SYNTHETIC'})).items.some(i=>i.id===responsibility.id));
  grant('outsider',responsibility.id,'READ','RESPONSIBILITY','N_A','IDENTITY');
  assert.ok(!(await catalog.read('outsider',{scope:'SYNTHETIC'})).items.some(i=>i.id===responsibility.id));
  for(const permission of ['READ','WRITE'])grant('outsider',responsibility.id,permission,'RESPONSIBILITY','SYNTHETIC_NORTH','IDENTITY');
  assert.ok((await catalog.read('outsider',{scope:'SYNTHETIC'})).items.some(i=>i.id===responsibility.id));
  for(const values of [{authorityScope:'SOUTH'},{fieldGroup:'CONTACT'}])await assert.rejects(catalog.command('outsider',command('REVISE',{target:responsibility.id,expectedHead:responsibility.head,values,validFrom:'2026-01-01T00:00:00'})),/ACCESS_DENIED/);
  const source=await publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'PURPOSE_SOURCE',values:{name:'合成用途授权',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})));
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(source.id)} AND purpose='SYNTHETIC_REFERENCE';`);
  assert.ok((await catalog.read('maker',{scope:'SYNTHETIC'})).items.some(i=>i.id===source.id));
  await assert.rejects(catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-09-12T00:00:00'),/ACCESS_DENIED/);
  grant('maker',source.id,'READ','SOURCE','SYNTHETIC_ALL','DEFINITION','SYNTHETIC_REFERENCE');
  assert.equal((await catalog.resolveSource('maker','SYNTHETIC',source.id,'2026-09-12T00:00:00')).realApply,'NOT_IMPLEMENTED');
  peer(owned.receipt.name,"DELETE FROM vnext_control.audit_stream_grant WHERE actor_code='auditor';");await assert.rejects(catalog.verifyAudit('auditor'),/ACCESS_DENIED/);
  peer(owned.receipt.name,"INSERT INTO vnext_control.audit_stream_grant VALUES('auditor','GOVERNANCE_CATALOG','AUDIT_VERIFY');");
 });
 await check('RETIRE_CHECKS_PUBLISHED_DIMENSIONS',async()=>{
  const accepted=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'RETIRE_DIMENSIONS',values:{dataset:'ORG09',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'})));
  for(const actor of ['maker','reviewer'])for(const permission of ['READ','WRITE','REVIEW','PUBLISH'])grant(actor,accepted.id,permission,'RESPONSIBILITY','SYNTHETIC_NORTH','ALL');
  const candidate=await catalog.command('maker',command('REVISE',{target:accepted.id,expectedHead:accepted.head,values:{authorityScope:'NORTH'},validFrom:'2026-07-01T00:00:00'}));
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(accepted.id)} AND campus='SYNTHETIC_ALL' AND permission IN ('REVIEW','PUBLISH');`);
  const retirement=command('RETIRE',{target:accepted.id,expectedHead:candidate.head,reviewDigest:accepted.reviewDigest});
  await assert.rejects(catalog.command('reviewer',retirement),/ACCESS_DENIED/);
  for(const permission of ['REVIEW','PUBLISH'])grant('reviewer',accepted.id,permission,'RESPONSIBILITY','SYNTHETIC_ALL','ALL');
  assert.equal((await catalog.command('reviewer',retirement)).status,'RETIRED');
 });
 await check('PROSPECTIVE_OWNER_TIMELINE',async()=>{
  const a1=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'TIMED_OWNER_A',values:{dataset:'ORG10',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'})));
  for(const actor of ['maker','reviewer'])for(const permission of ['READ','WRITE','REVIEW','PUBLISH'])grant(actor,a1.id,permission,'RESPONSIBILITY','SYNTHETIC_NORTH','ALL');
  const a2=await publish(await catalog.command('maker',command('REVISE',{target:a1.id,expectedHead:a1.head,values:{authorityScope:'NORTH'},validFrom:'2026-07-01T00:00:00'})));
  await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'TIMED_OWNER_B',values:{dataset:'ORG10',authorityScope:'SOUTH',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_B'},validFrom:'2026-07-01T00:00:00'})));
  const correction=await catalog.command('maker',command('REVISE',{target:a2.id,expectedHead:a2.head,values:{assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-07-01T00:00:00',validTo:'2026-08-01T00:00:00'}));
  await assert.rejects(publish(correction),/OWNER_PERIOD_CONFLICT/);
 });
 await check('PUBLISH_CHECKS_PROJECTED_DIMENSIONS',async()=>{
  const a1=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'PROJECTED_DIMENSIONS',values:{dataset:'ORG11',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'})));
  for(const actor of ['maker','reviewer'])for(const permission of ['READ','WRITE','REVIEW','PUBLISH'])grant(actor,a1.id,permission,'RESPONSIBILITY','SYNTHETIC_NORTH','ALL');
  const a2=await publish(await catalog.command('maker',command('REVISE',{target:a1.id,expectedHead:a1.head,values:{authorityScope:'NORTH'},validFrom:'2026-07-01T00:00:00'})));
  const corrected=await catalog.command('maker',command('REVISE',{target:a2.id,expectedHead:a2.head,values:{},validFrom:'2026-07-01T00:00:00',validTo:'2026-08-01T00:00:00'}));
  const review=await catalog.command('maker',command('SUBMIT',{target:corrected.id,expectedHead:corrected.head}));
  const request=command('PUBLISH',{target:review.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
  peer(owned.receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='reviewer' AND object_id=${quote(a1.id)} AND campus='SYNTHETIC_ALL' AND permission IN ('REVIEW','PUBLISH');`);
  await assert.rejects(catalog.command('reviewer',request),/ACCESS_DENIED/);
  for(const permission of ['REVIEW','PUBLISH'])grant('reviewer',a1.id,permission,'RESPONSIBILITY','SYNTHETIC_ALL','ALL');
  assert.equal((await catalog.command('reviewer',request)).status,'PUBLISHED');
 });
 await check('INDIRECT_REFERENCE_DISCLOSURE_AND_ATOMIC_GRANTS',async()=>{
  const source=async(code,evidence)=>publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code,values:{name:'合成间接授权',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:evidence},validFrom:'2026-01-01T00:00:00'})));
  const root=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.code==='PURPOSE_SOURCE');const child=await source('ACCESS_CHILD',root.id);
  grant('outsider',root.id,'READ','SOURCE','SYNTHETIC_ALL');
  await assert.rejects(catalog.sourceImpact('outsider','SYNTHETIC',root.id),/ACCESS_DENIED/,'indirect impact preview');
  assert.deepEqual(await catalog.impactCases('outsider','SYNTHETIC',root.id),[]);
  const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',root.id);
  await catalog.command('reviewer',command('RETIRE',{target:root.id,expectedHead:root.head,reviewDigest:root.reviewDigest,impactDigest:impact.impactDigest}));
  await assert.rejects(catalog.impactCases('outsider','SYNTHETIC',root.id),/ACCESS_DENIED/,'indirect impact cases');
  grant('outsider',child.id,'READ','SOURCE','SYNTHETIC_ALL');
  assert.equal((await catalog.sourceImpact('outsider','SYNTHETIC',root.id)).current.length,1);
  const counts=()=>peer(owned.receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.object),(SELECT count(*) FROM governance_catalog.version),(SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.request_identity),(SELECT count(*) FROM vnext_control.object_grant));');
  const before=counts();
  peer(owned.receipt.name,'CREATE TRIGGER object_grant_fault BEFORE INSERT ON vnext_control.object_grant FOR EACH ROW EXECUTE FUNCTION vnext_control.immutable();');
  try{await assert.rejects(catalog.command('maker',create('ORG12')),/IMMUTABLE_HISTORY/);assert.equal(counts(),before);}finally{peer(owned.receipt.name,'DROP TRIGGER object_grant_fault ON vnext_control.object_grant;');}
  assert.equal(peer(owned.receipt.name,"SELECT bool_and(NOT has_function_privilege('hdi_prototype',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('governance_catalog','vnext_control') AND (p.proname LIKE '%_raw' OR p.proname IN ('bootstrap_catalog_grants','grant_created_object','definition_spans'));"),'t');
 });
 await check('OBJECT_REVOKE_RACE',async()=>{
  const target=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===first.id);
  const clean=['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE'].flatMap(k=>['-u',k]);
  const admin=spawn('wsl.exe',['-d','Anolis-8.9-HDI-POC','-u','postgres','--','env',...clean,'stdbuf','-oL','psql','-X','-v','ON_ERROR_STOP=1','-p','55434','-d',owned.receipt.name,'-At'],{windowsHide:true,stdio:'pipe'});
  let output='';admin.stdout.on('data',chunk=>{output+=chunk;});admin.stderr.resume();
  const closed=new Promise(resolve=>admin.on('close',resolve));
  try{
   admin.stdin.write(`BEGIN; DELETE FROM vnext_control.object_grant WHERE actor_code='maker-alias' AND object_id=${quote(first.id)} AND permission='WRITE'; SELECT 'REVOKE_STAGED';\n`);
   for(let n=0;n<100&&!output.includes('REVOKE_STAGED');n++)await delay(50);assert.ok(output.includes('REVOKE_STAGED'));
   const pending=catalog.command('maker-alias',command('REVISE',{target:target.id,expectedHead:target.head,values:{name:'撤权竞态'},validFrom:'2026-01-01T00:00:00'})).then(value=>({value}),error=>({error}));
   let waiting=false;for(let n=0;n<30&&!waiting;n++){waiting=peer(owned.receipt.name,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hdi-vnext-catalog' AND wait_event='advisory');")==='t';if(!waiting)await delay(50);}assert.ok(waiting);
   admin.stdin.end('COMMIT;\n');assert.equal(await closed,0);const result=await pending;assert.match(result.error?.message??'',/ACCESS_DENIED/);
  }finally{if(!admin.stdin.destroyed)admin.stdin.end('ROLLBACK;\n');await closed;}
 });
 await check('FUTURE_BITEMPORAL_VERSION',async()=>{
  const v1=await publish(await catalog.command('maker',create('ORG03')));
  const v2=await publish(await catalog.command('maker',command('REVISE',{target:v1.id,expectedHead:v1.head,values:{name:'未来有效'},validFrom:'2027-01-01T00:00:00',validTo:null})));
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00'})).items.find(i=>i.id===v1.id)?.versionId,v1.versionId);
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2027-01-01T00:00:00'})).items.find(i=>i.id===v1.id)?.versionId,v2.versionId);
  assert.equal((await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2026-09-12T00:00:00',asOf:v1.recordedAt})).items.find(i=>i.id===v1.id)?.versionId,v1.versionId);
  const corrected=await publish(await catalog.command('maker',command('REVISE',{target:v2.id,expectedHead:v2.head,values:{name:'纠正未来期限'},validFrom:'2027-01-01T00:00:00',validTo:'2027-06-01T00:00:00'})));
  assert.ok(!(await catalog.readEffective('maker',{scope:'SYNTHETIC',businessAt:'2027-07-01T00:00:00'})).items.some(i=>i.id===corrected.id));
 });
 const app=await buildCatalogServer(catalog);await app.listen({host:'127.0.0.1',port:0});
 try{
  await check('DUPLICATE_CODE_CONFLICT',async()=>{
   const headers={'x-catalog-actor':'maker','content-type':'application/json'};
   const attempts=await Promise.all([1,2].map(()=>fetch(app.listeningOrigin+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify(create('ORG04'))})));
   assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);const conflict=await attempts.find(r=>r.status===409).json();assert.equal(conflict.code,'CATALOG_CODE_CONFLICT');assert.equal(conflict.field,'code');
  });
 }finally{await app.close();}
 console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,receipt:owned.receipt}));if(failures.length)process.exitCode=1;
}finally{await catalog?.close();dropTemporary(owned.receipt);}
