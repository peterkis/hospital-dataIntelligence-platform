import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Pool,type QueryConfig} from 'pg';
import {finiteCoordinator} from './apply-owner-fixture.js';
import {fixture} from './protected-fixture.js';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {LocalSyntheticKeyProvider,type ProtectedReadInput} from '../../apps/governance-api/src/modules/governance-catalog/protected-artifact.js';
import {applyCoordinator,type OwnerCommand,type UnitOutcome} from '../../apps/governance-api/src/modules/governance-catalog/apply-coordinator.js';
import {canonicalPlan} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.js';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');assert.equal(receipt.taskId,'P0-08');
const execute=(text:string)=>peer(receipt.name,text);
const initial:OwnerCommand[]=[
 {owner:'FINITE_LEFT',row:1,intent:'CREATE',target:null,aliases:[],value:{text:'PRIVATE_FINITE_A'}},
 {owner:'FINITE_RIGHT',row:2,intent:'CREATE',target:null,aliases:[1],value:{text:'PRIVATE_FINITE_B'}},
 {owner:'FINITE_LEFT',row:3,intent:'CREATE',target:null,aliases:[2],value:{text:'PRIVATE_FINITE_C'}}
];
async function setup(commands=initial,readProtected=false){
 execute('DELETE FROM p0_08_owner.failure;');
 const source=JSON.parse(execute(`WITH inserted AS (INSERT INTO p0_08_owner.source(rows) VALUES(${quote(JSON.stringify(commands))}::jsonb) RETURNING *) SELECT jsonb_build_object('id',id,'revision',revision) FROM inserted;`));
 execute(`INSERT INTO p0_08_owner.grant_access SELECT actor,${quote(source.id)}::uuid,permission FROM unnest(ARRAY['maker','maker-alias','reviewer']) actor CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW']) permission;`);
 const provider=new LocalSyntheticKeyProvider();
 let protectedRead:ProtectedReadInput|undefined;
 if(readProtected){
  const catalog=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL'],provider);
  try{
   const f=await fixture(catalog,{textField:true});
   execute(`INSERT INTO vnext_control.protected_grant SELECT 'maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
   const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'ATOMIC_READ_PROBE',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from('restricted_probe\nPRIVATE_PROTECTED_PROBE'));
   protectedRead={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:file.artifact.artifactId};
  }finally{await catalog.close();}
 }
 const service=finiteCoordinator(process.env['VNEXT_VALIDATION_OWNER_URL']!,provider,protectedRead);
 const input={requestId:randomUUID(),jobId:source.id as string,revisionId:source.revision as string,scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const};
 return {...service,provider,input};
}
async function approved(s:Awaited<ReturnType<typeof setup>>){
 const c=await s.coordinator.planOwnerUnit('maker',s.input);
 const read=await s.coordinator.readApplyCandidate('reviewer',{candidateId:c.candidateId});
 assert.equal(read.digest,c.digest);assert.equal(read.unit.commands.length,3);
 await s.coordinator.approveApplyUnit('reviewer',c);
 return {candidateId:c.candidateId,requestId:s.input.requestId};
}
function counts(){return execute(`SELECT jsonb_build_array((SELECT count(*) FROM p0_08_owner.left_fact),(SELECT count(*) FROM p0_08_owner.right_fact),(SELECT count(*) FROM governance_catalog.apply_commit),(SELECT count(*) FROM vnext_control.audit WHERE action='OWNER_APPLY_COMMIT'),(SELECT count(*) FROM p0_08_owner.read_audit),(SELECT count(*) FROM vnext_control.audit WHERE action LIKE 'PROTECTED_READ_%'));`);}

test('AC-01: row three throws or rejects after writes and intermediate protected-read checkpoint; all writes roll back',async()=>{
 for(const mode of ['THROW','REJECT']){
  const s=await setup(initial,true);try{
   const request=await approved(s);const before=counts();
   execute(`INSERT INTO p0_08_owner.failure VALUES(3,${quote(mode)});`);
   await assert.rejects(s.coordinator.applyUnit('maker',request),/OWNER_REJECTED/);
   assert.equal(counts(),before);assert.equal(await s.coordinator.resumeOutcome('maker',request),null);
  }finally{await s.close();}
 }
});

test('positive multi-Owner commit is durable and same request concurrently returns original IDs; no second execution',async()=>{
 const s=await setup();try{
  const request=await approved(s);
  const [one,two]=await Promise.all([s.coordinator.applyUnit('maker',request),s.coordinator.applyUnit('maker',request)]);
  assert.equal(one.status,'COMMITTED');assert.deepEqual(one,two);
  if(one.status!=='COMMITTED')throw new Error('ASSERT_COMMIT');
  assert.deepEqual(one.facts.map(f=>f.owner),['FINITE_LEFT','FINITE_RIGHT','FINITE_LEFT']);
  const before=counts();assert.deepEqual(await s.coordinator.applyUnit('maker-alias',request),one);assert.equal(counts(),before);
  await assert.rejects(s.coordinator.applyUnit('maker',{...request,requestId:randomUUID()}),/REQUEST_CONFLICT/);
  assert.equal(counts(),before);
  const other=await s.coordinator.planOwnerUnit('maker',{...s.input,requestId:randomUUID()});
  await assert.rejects(s.coordinator.applyUnit('maker',{...request,candidateId:other.candidateId}),/REQUEST_CONFLICT/);
  assert.equal((await s.coordinator.reconcileCommittedUnit('maker',request)).status,'MATCHED');
 }finally{await s.close();}
});

test('approval is explicit, maker-checker uses underlying identity, wrong digest/shape/scope and unavailable production Owner block',async()=>{
 const s=await setup();try{
  const c=await s.coordinator.planOwnerUnit('maker',s.input);const request={candidateId:c.candidateId,requestId:s.input.requestId};
  await assert.rejects(s.coordinator.applyUnit('maker',request),/APPROVAL_REQUIRED/);
  await assert.rejects(s.coordinator.approveApplyUnit('maker-alias',c),/MAKER_CHECKER_REQUIRED/);
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',{...c,digest:'a'.repeat(64)}),/STALE_VALIDATION/);
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',{...c,approved:true} as never),/CLOSED_INPUT_REQUIRED/);
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',{planToken:'BLOCKED_PREVIEW'} as never),/CLOSED_INPUT_REQUIRED/);
  await assert.rejects(s.coordinator.planOwnerUnit('maker',{...s.input,campus:'SOUTH'}),/ACCESS_DENIED/);
  await assert.rejects(applyCoordinator(s.db,s.provider).planOwnerUnit('maker',s.input),/BLOCKED_DEPENDENCY/);
  await assert.rejects(s.coordinator.readApplyCandidate('outsider',{candidateId:c.candidateId}),/ACCESS_DENIED/);
 }finally{await s.close();}
});

test('AC-03: changed revision, quality, rules, members and target heads invalidate the approval before any write',async()=>{
 for(const change of ["revision=uuidv7()","quality_head=quality_head+1","rule_version='FINITE_OWNER_V2'","rows=jsonb_set(rows,'{0,value,text}','\"REPLACED\"')"]){
  const s=await setup();try{
   const request=await approved(s);const before=counts();
   execute(`UPDATE p0_08_owner.source SET ${change} WHERE id=${quote(s.input.jobId)};`);
   await assert.rejects(s.coordinator.applyUnit('maker',request),/STALE_VALIDATION/);assert.equal(counts(),before);
  }finally{await s.close();}
 }
 const id=JSON.parse(execute("WITH inserted AS (INSERT INTO p0_08_owner.left_fact(value) VALUES('{}') RETURNING id) SELECT to_jsonb(id) FROM inserted;")) as string;
 const commands=structuredClone(initial);commands[0]={...commands[0]!,intent:'REVISE',target:{owner:'FINITE_LEFT',id,version:'1'}};
 const s=await setup(commands);try{
  const request=await approved(s);const before=counts();
  execute(`UPDATE p0_08_owner.left_fact SET version=version+1 WHERE id=${quote(id)};`);
  await assert.rejects(s.coordinator.applyUnit('maker',request),/STALE_VALIDATION/);assert.equal(counts(),before);
 }finally{await s.close();}
});

test('current executor, approver, recovery and object grants are rechecked',async()=>{
 for(const actor of ['maker','reviewer']){
  const s=await setup();try{
   const request=await approved(s);const before=counts();
   execute(`DELETE FROM p0_08_owner.grant_access WHERE actor=${quote(actor)} AND job=${quote(s.input.jobId)} AND permission=${quote(actor==='maker'?'WRITE':'REVIEW')};`);
   await assert.rejects(s.coordinator.applyUnit('maker',request),/ACCESS_DENIED/);assert.equal(counts(),before);
  }finally{await s.close();}
 }
 const s=await setup();try{
  const request=await approved(s);await s.coordinator.applyUnit('maker',request);
  execute(`DELETE FROM p0_08_owner.grant_access WHERE actor='maker' AND job=${quote(s.input.jobId)} AND permission='READ';`);
  await assert.rejects(s.coordinator.resumeOutcome('maker',request),/ACCESS_DENIED/);
 }finally{await s.close();}
});

test('AC-02/05: domain failure, precommit network loss and postcommit callback failure are distinguished',async()=>{
 const s=await setup();try{
  const request=await approved(s);const before=counts();
  execute("INSERT INTO p0_08_owner.failure VALUES(3,'NETWORK');");
  await assert.rejects(s.coordinator.applyUnit('maker',request),/TRANSPORT_FAILED/);assert.equal(counts(),before);
  execute('DELETE FROM p0_08_owner.failure;');
  const result=await s.coordinator.applyUnit('maker',request,async()=>{throw new Error('consumer unavailable');});
  assert.equal(result.status,'COMMITTED');if(result.status!=='COMMITTED')throw new Error('ASSERT_COMMIT');
  assert.equal(result.responseStatus,'POST_COMMIT_FAILED');
  assert.equal((await s.coordinator.resumeOutcome('maker',request))?.status,'COMMITTED');
  assert.equal((await s.coordinator.reconcileCommittedUnit('maker',request)).status,'MATCHED');
  execute(`UPDATE p0_08_owner.left_fact SET version=version+1 WHERE id=${quote(result.facts[0]!.id)};`);
  assert.equal((await s.coordinator.reconcileCommittedUnit('maker',request)).status,'MISMATCH');
 }finally{await s.close();}
});

test('AC-04: new connection and child process recover technical outcome after key loss and stale original source',async()=>{
 const s=await setup();try{
  const request=await approved(s);const committed=await s.coordinator.applyUnit('maker',request);
  assert.equal(committed.status,'COMMITTED');
  const saved=await s.coordinator.resumeOutcome('maker',request);
  execute(`UPDATE p0_08_owner.source SET revision=uuidv7() WHERE id=${quote(s.input.jobId)};`);
  const next=finiteCoordinator(process.env['VNEXT_VALIDATION_OWNER_URL']!);
  try{assert.deepEqual(await next.coordinator.resumeOutcome('maker',request),saved);}finally{await next.close();}
  const child=spawnSync(process.execPath,['--import','tsx','tooling/vnext/apply-recover.ts'],{env:{...process.env,APPLY_RECOVERY_REQUEST:JSON.stringify(request)},encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),saved);
 }finally{await s.close();}
});

test('AC-06: ordinary application cannot DML Owners or forge candidate/approval/outcome',async()=>{
 const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']!});
 try{
  for(const statement of ["INSERT INTO p0_08_owner.left_fact(value) VALUES('{}')","SELECT p0_08_owner.write_right('{}')","INSERT INTO governance_catalog.apply_candidate(maker,maker_identity,input,digest,envelope) VALUES('maker','SYNTHETIC_MAKER','{}',repeat('a',64),'{}')","SELECT governance_catalog.apply_record('maker','FREEZE','{}')"]){
   await assert.rejects(pool.query(statement),(error:unknown)=>(error as {code?:string}).code==='42501');
  }
 }finally{await pool.end();}
});

test('capacity and undeclared cyclic aliases reject complete unit; no splitting; canonical keys stable',async()=>{
 assert.equal(canonicalPlan({b:1,a:{z:0,y:2}}),canonicalPlan({a:{y:2,z:0},b:1}));
 for(const commands of [Array.from({length:101},(_,i)=>({...initial[0]!,row:i+1})),[{...initial[0]!,aliases:[3]},...initial.slice(1)]]){
  const s=await setup(commands);try{await assert.rejects(s.coordinator.planOwnerUnit('maker',s.input),/PLAN_INPUT_LIMIT|BLOCKED_DEPENDENCY/);}finally{await s.close();}
 }
});

test('AC-03: a concurrent connection changes head while Apply waits on the root lock',async()=>{
 const id=JSON.parse(execute("WITH inserted AS (INSERT INTO p0_08_owner.left_fact(value) VALUES('{}') RETURNING id) SELECT to_jsonb(id) FROM inserted;")) as string;
 const commands=structuredClone(initial);commands[0]={...commands[0]!,intent:'REVISE',target:{owner:'FINITE_LEFT',id,version:'1'}};
 const s=await setup(commands);const blocker=await s.pool.connect();
 try{
  const request=await approved(s);const before=counts();
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(901002)');
  const attempt=s.coordinator.applyUnit('maker',request);
  const denied=assert.rejects(attempt,/STALE_VALIDATION/);
  await blocker.query('SELECT p0_08_owner.advance_target($1)',[id]);await blocker.query('COMMIT');
  await denied;assert.equal(counts(),before);
 }finally{await blocker.query('ROLLBACK');blocker.release();await s.close();}
});

test('AC-02/04: lost COMMIT ACK is uncertain, durable recovery locates original facts and safe retry does not write twice',async()=>{
 const s=await setup();let loseAck=false;let injected=false;
 // Instrument only this pool's transport. PostgreSQL executes the real COMMIT before its ACK is lost.
 const patch=(client:import('pg').PoolClient)=>{
  const query=client.query.bind(client);
  client.query=((config:string|QueryConfig,...args:unknown[])=>{
   const text=typeof config==='string'?config:config.text;
   const result=Reflect.apply(query,client,[config,...args]);
   if(loseAck&&text.trim().toLowerCase()==='commit'){
    loseAck=false;injected=true;
    return Promise.resolve(result).then(()=>{throw Object.assign(new Error('ACK_LOST'),{code:'ECONNRESET'});});
   }
   return result;
  }) as typeof client.query;
 };
 s.pool.on('connect',patch);
 // setup opens no connection; all subsequently created clients get the transport instrumentation.
 try{
  const request=await approved(s);loseAck=true;
  const result=await s.coordinator.applyUnit('maker',request);
  assert.equal(injected,true);assert.equal(result.status,'COMMIT_UNKNOWN');
  const before=counts();const durable=await s.coordinator.resumeOutcome('maker',request);
  assert.equal(durable?.status,'COMMITTED');
  const replay=await s.coordinator.applyUnit('maker',request);
  assert.equal(replay.status,'COMMITTED');assert.equal(counts(),before);
  if(replay.status==='COMMITTED')assert.deepEqual(replay.facts,durable?.facts);
 }finally{await s.close();}
});

test('review regression: object READ revocation blocks sensitive candidate release even with REVIEW',async()=>{
 const s=await setup();try{
  const c=await s.coordinator.planOwnerUnit('maker',s.input);
  execute(`DELETE FROM p0_08_owner.grant_access WHERE actor='reviewer' AND job=${quote(s.input.jobId)} AND permission='READ';`);
  await assert.rejects(s.coordinator.readApplyCandidate('reviewer',{candidateId:c.candidateId}),/ACCESS_DENIED/);
 }finally{await s.close();}
});

test('review regression: sensitive candidate read audit commits before release and survives missing key',async()=>{
 const s=await setup();try{
  const c=await s.coordinator.planOwnerUnit('maker',s.input);
  const auditCount=()=>Number(execute(`SELECT count(*) FROM vnext_control.audit WHERE object_id=${quote(c.candidateId)} AND actor_code='reviewer' AND action='OWNER_APPLY_READ_SENSITIVE' AND reason='IDENTITY_VERIFY_NORTH';`));
  const before=auditCount();await s.coordinator.readApplyCandidate('reviewer',{candidateId:c.candidateId});
  assert.equal(auditCount(),before+1);
  const noKey=finiteCoordinator(process.env['VNEXT_VALIDATION_OWNER_URL']!);
  try{await assert.rejects(noKey.coordinator.readApplyCandidate('reviewer',{candidateId:c.candidateId}),/KEY_UNAVAILABLE/);}finally{await noKey.close();}
  assert.equal(auditCount(),before+2);
  assert.equal(execute(`SELECT count(*) FROM governance_catalog.apply_candidate WHERE id=${quote(c.candidateId)} AND (input::text LIKE '%PRIVATE_FINITE_%' OR envelope::text LIKE '%PRIVATE_FINITE_%');`),'0');
 }finally{await s.close();}
});

test('PR10: concurrent and alias freeze retries preserve one candidate and original committed IDs',async()=>{
 const s=await setup();try{
  const [first,retry]=await Promise.all([s.coordinator.planOwnerUnit('maker',s.input),s.coordinator.planOwnerUnit('maker-alias',s.input)]);
  assert.deepEqual(retry,first);
  await s.coordinator.readApplyCandidate('reviewer',{candidateId:first.candidateId});
  await s.coordinator.approveApplyUnit('reviewer',first);
  const request={candidateId:first.candidateId,requestId:s.input.requestId};
  const committed=await s.coordinator.applyUnit('maker',request);
  execute(`UPDATE p0_08_owner.source SET revision=uuidv7() WHERE id=${quote(s.input.jobId)};`);
  assert.deepEqual(await s.coordinator.planOwnerUnit('maker-alias',s.input),first);
  const replay=await s.coordinator.applyUnit('maker-alias',{...request,candidateId:retry.candidateId});
  assert.deepEqual(replay,committed);
  const other=await setup();try{
   await assert.rejects(other.coordinator.planOwnerUnit('maker',{...other.input,requestId:s.input.requestId}),/REQUEST_CONFLICT/);
  }finally{await other.close();}
 }finally{await s.close();}
});

test('PR10: every missing-Owner command blocks before Apply storage access',async()=>{
 const catalog=await openCatalog(process.env['VNEXT_DATABASE_URL']);
 const candidateId=randomUUID();const requestId=randomUUID();
 try{
  for(const operation of [
   ()=>catalog.readApplyCandidate('maker',{candidateId}),
   ()=>catalog.approveApplyUnit('reviewer',{candidateId,digest:'a'.repeat(64)}),
   ()=>catalog.applyUnit('maker',{candidateId,requestId}),
   ()=>catalog.resumeOutcome('maker',{candidateId,requestId}),
   ()=>catalog.reconcileCommittedUnit('maker',{candidateId,requestId})
  ])await assert.rejects(operation(),/BLOCKED_DEPENDENCY/);
 }finally{await catalog.close();}
});

test('PR10: code-less pg termination and class-08 exceptions classify as precommit transport failures',async()=>{
 const s=await setup();try{
  const request=await approved(s);const before=counts();
  for(const mode of ['PG_TERMINATED','PG_TERMINATED_REQUESTED','PG_CLASS_08']){
   execute(`DELETE FROM p0_08_owner.failure;INSERT INTO p0_08_owner.failure VALUES(3,${quote(mode)});`);
   await assert.rejects(s.coordinator.applyUnit('maker',request),/TRANSPORT_FAILED/);
   assert.equal(counts(),before);
  }
 }finally{await s.close();}
});

test('PR10 R2: approval requires this reviewer to successfully read the exact frozen candidate',async()=>{
 const s=await setup();try{
  const first=await s.coordinator.planOwnerUnit('maker',s.input);
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',first),/CANDIDATE_REVIEW_REQUIRED/);
  await s.coordinator.readApplyCandidate('maker',{candidateId:first.candidateId});
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',first),/CANDIDATE_REVIEW_REQUIRED/);
  const noKey=finiteCoordinator(process.env['VNEXT_VALIDATION_OWNER_URL']!);
  try{await assert.rejects(noKey.coordinator.readApplyCandidate('reviewer',{candidateId:first.candidateId}),/KEY_UNAVAILABLE/);}finally{await noKey.close();}
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',first),/CANDIDATE_REVIEW_REQUIRED/);
  const second=await s.coordinator.planOwnerUnit('maker',{...s.input,requestId:randomUUID()});
  await s.coordinator.readApplyCandidate('reviewer',{candidateId:second.candidateId});
  await assert.rejects(s.coordinator.approveApplyUnit('reviewer',first),/CANDIDATE_REVIEW_REQUIRED/);
  await s.coordinator.readApplyCandidate('reviewer',{candidateId:first.candidateId});
  execute("UPDATE vnext_control.actor SET identity_code='SYNTHETIC_REVIEWER_CHANGED' WHERE code='reviewer';");
  try{await assert.rejects(s.coordinator.approveApplyUnit('reviewer',first),/CANDIDATE_REVIEW_REQUIRED/);}
  finally{execute("UPDATE vnext_control.actor SET identity_code='SYNTHETIC_REVIEWER' WHERE code='reviewer';");}
  await s.coordinator.approveApplyUnit('reviewer',first);
  assert.equal(execute(`SELECT count(*) FROM governance_catalog.apply_approval a JOIN vnext_control.audit r ON r.id=a.review_audit_id WHERE a.candidate_id=${quote(first.candidateId)} AND r.object_id=a.candidate_id AND r.actor_code=a.actor_code AND r.action='OWNER_APPLY_READ_READY';`),'1');
  const outcome=await s.coordinator.applyUnit('maker',{candidateId:first.candidateId,requestId:s.input.requestId});
  assert.equal(outcome.status,'COMMITTED');
 }finally{await s.close();}
});
