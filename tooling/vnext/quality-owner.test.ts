import {qualityResolutionProof} from '../../apps/governance-api/src/modules/governance-catalog/quality-resolution-proof.js';
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';

const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');
const {peer,quote}=await import('./lineage.mjs');

async function setup(){
 const provider=new LocalSyntheticKeyProvider();
 const catalog=await openCatalog(undefined,provider);
 try{
  const f=await fixture(catalog,{businessKey:true,textField:true});
  const contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0]!;
  for(const permission of ['STORE','READ'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const field=contract.definition.fields[0]!.code;
  const bytes=Buffer.from(`${field}\nSENTINEL_PII_${'X'.repeat(8000)}`);
  const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_FILE',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},bytes);
  const parseInput={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId};
  const parse=await catalog.parseFile('maker',parseInput);
  const validate={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parse.artifact.artifactId,retentionSeconds:3600};
  const run=await catalog.validateRevision('maker',validate);
  return {catalog,provider,f,contract,file,parse,parseInput,validate,run,field};
 }catch(error){await catalog.close();throw error;}
}

async function setupTwoFields(){
 const provider=new LocalSyntheticKeyProvider();
 const catalog=await openCatalog(undefined,provider);
 try{
 const base=await fixture(catalog,{businessKey:true,textField:true});
  const baseContract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:base.contract.id,versionId:base.contract.versionId}))[0]!;
  const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===base.dataset.id)!;
  const first=baseContract.definition.fields[0]!;
  const secondSource=(dataset.payload.fields!.find(field=>field.original.type==='text'&&field.original.required==='R'&&field.original.code!==first.code&&!field.original.ref)??dataset.payload.fields!.find(field=>field.original.type==='text'&&field.original.code!==first.code&&!field.original.ref)!).original;
  const secondRequired=secondSource.required as 'R'|'C'|'O';
  const secondCondition=secondRequired==='R'?'ALWAYS':secondRequired==='O'?'OPTIONAL':'UNRESOLVED';
  const definition={...baseContract.definition,ruleVersion:'QUALITY_TWO_FIELD_V1',fields:[first,{code:secondSource.code,type:'text' as const,required:secondRequired,privacy:secondSource.privacy as 'INTERNAL'|'RESTRICTED'|'HIGH_RESTRICTED',condition:secondCondition,enumValues:[]}]};
  const draft=await catalog.contractCommand('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:base.contract.id,expectedHead:base.contract.head,datasetVersionId:base.contract.datasetVersionId,validFrom:'2026-01-01T00:00:00',validTo:null,definition});
  const approved=await catalog.contractCommand('reviewer',{action:'APPROVE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest});
  const contract=await catalog.contractCommand('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest});
  for(const permission of ['STORE','READ','PURGE'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(base.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const key=first.code,errorField=secondSource.code;
  const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_FILE',contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(`${key},${errorField}\nKEY_001,${'X'.repeat(8000)}`));
  const parse=await catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  const validate={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parse.artifact.artifactId,retentionSeconds:3600};
  const run=await catalog.validateRevision('maker',validate);
  return {catalog,provider,base,contract,file,parse,validate,run,key,errorField};
 }catch(error){await catalog.close();throw error;}
}

async function publishResponsibility(catalog:Awaited<ReturnType<typeof openCatalog>>,dataset:string){
 const draft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:`QUALITY_OWNER_${randomUUID().slice(0,8).toUpperCase()}`,values:{dataset,authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'});
 const review=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head});
 return catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
}

test('P0-06 ingestion is signed, idempotent per run, and never stores raw values',async()=>{
 const s=await setup();try{
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId};
  const first=await s.catalog.openIssue('maker',input);
  assert.equal(first.total,2);
  assert.equal(first.inserted,2);
  await assert.rejects(s.catalog.openIssue('maker',{...input,resolved:true} as never),/CLOSED_INPUT_REQUIRED/);
  const appPool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try{
   await assert.rejects(appPool.query('UPDATE governance_catalog.quality_issue SET classification=$1 WHERE id=$2',['REVIEW',first.issueIds[0]]),/permission denied/);
   await assert.rejects(appPool.query('SELECT governance_catalog.quality_issue_ingest($1,$2::jsonb,$3::jsonb)',[ 'maker',JSON.stringify({...input,requestId:randomUUID()}),JSON.stringify([{sourceKind:'RULE',sourceStatus:'FAIL',classification:'ERROR',layer:1,rule:'FORGED',requirementId:'',row:1,field:s.field,ownerRef:'',relatedRefs:[],boundedCode:'FORGED'}]) ]),/VALIDATION_PROVENANCE_REQUIRED/);
  }finally{await appPool.end();}
  const replay=await s.catalog.openIssue('maker',{...input,requestId:randomUUID()});
  assert.equal(replay.inserted,0);assert.equal(replay.replayed,2);
  const sameRequest=await s.catalog.openIssue('maker',input);assert.deepEqual(sameRequest,first);
  const listed=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id,pageSize:10,offset:0});
  assert.equal(listed.total,2);
  const lengthIssue=listed.items.find((item:{rule:string})=>item.rule==='LENGTH')!;
  const bypassPool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try {
   await assert.rejects(bypassPool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)', ['maker',JSON.stringify({scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'FORGED_RESOLVE',issueId:lengthIssue.id,expectedHead:'0',newRunId:s.run.runId,newRevisionId:s.run.revisionId,targetRow:1,targetField:s.field,matchStatus:'MATCHED'})]),/REVISION_LINEAGE_INVALID|VALIDATION_PROVENANCE_REQUIRED/);
  } finally {await bypassPool.end();}
  const detail=await s.catalog.qualityIssueDetail('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',issueId:lengthIssue.id});
  assert.equal(JSON.stringify(detail).includes('SENTINEL_PII'),false);
  const secondRun=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()});
  const second=await s.catalog.openIssue('maker',{...input,requestId:randomUUID(),runId:secondRun.runId});
  assert.equal(second.inserted,2);assert.notDeepEqual(second.issueIds,first.issueIds);
 }finally{await s.catalog.close();}
});

test('P0-06 responsibility assignment does not grant a cross-identity read',async()=>{
 const s=await setup();try{
  const draft=await s.catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:'QUALITY_OWNER',values:{dataset:s.contract.dataset,authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'});
  const review=await s.catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head});
  const responsibility=await s.catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId});
  const issueId=opened.issueIds[0];assert.ok(issueId);
  const assigned=await s.catalog.assignIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'ASSIGN_OWNER',issueId,expectedHead:'0',responsibilityId:responsibility.id});
  assert.equal(assigned.ownerRef,'SYNTHETIC_OWNER_A');
  peer(receipt.name,"INSERT INTO vnext_control.actor(code,identity_code,active) VALUES('outsider','OUTSIDER_ID',true) ON CONFLICT DO NOTHING; INSERT INTO vnext_control.actor_grant(actor_code,scope,permission) VALUES('outsider','SYNTHETIC','READ') ON CONFLICT DO NOTHING;");
  await assert.rejects(s.catalog.qualityIssueDetail('outsider',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',issueId}),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});

test('P0-06 responsibility assignment matches the issue permission dimensions',async()=>{
 const s=await setup();try{
  const draft=await s.catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:`QUALITY_SCOPED_${randomUUID().slice(0,8).toUpperCase()}`,values:{dataset:s.contract.dataset,authorityScope:'SOUTH',fieldGroup:'IDENTITY',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'});
  const review=await s.catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head});
  const responsibility=await s.catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest});
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId});
  await assert.rejects(s.catalog.assignIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'ASSIGN_OWNER',issueId:opened.issueIds[0]!,expectedHead:'0',responsibilityId:responsibility.id}),/RESPONSIBILITY_NOT_READY/);
 }finally{await s.catalog.close();}
});

test('P0-06 complete correction preserves old evidence and resolves only an exact matched field',async()=>{
 const s=await setupTwoFields();try{
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId});
  const listed=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id,pageSize:10,offset:0});
  const lengthIssue=listed.items.find(item=>item.rule==='LENGTH')!;assert.ok(lengthIssue);
  const oldBytes=Buffer.from(await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.file.artifact.artifactId}));
  const correctionInput={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),receiveRequestId:randomUUID(),reason:'PROPOSE_CORRECTION',issueId:lengthIssue.id,jobId:s.file.job.id,sourceRunId:s.run.runId,expectedCurrentRevision:s.file.job.revisionId,format:'CSV' as const,parserPolicy:'STRICT_V2' as const,retentionSeconds:3600};
  const correction=await s.catalog.proposeCorrection('maker',correctionInput,Buffer.from(`${s.key},${s.errorField}\nKEY_001,GOOD`));
  assert.ok(correction.received);assert.equal(correction.revisionId,correction.received.job.revisionId);
  const oldBytesAfter=Buffer.from(await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.file.artifact.artifactId}));
  assert.deepEqual(oldBytesAfter,oldBytes);
  assert.equal(createHash('sha256').update(oldBytesAfter).digest('hex'),createHash('sha256').update(oldBytes).digest('hex'));
  const nextParse=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:correction.revisionId!,artifactId:correction.received.artifact.artifactId});
  const nextRun=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),revisionId:correction.revisionId!,artifactId:nextParse.artifact.artifactId});
  const job=await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:s.file.job.id});
  const proof=async(run:typeof nextRun)=>{
   const bytes=await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:run.parseArtifactId});
   const parsed=JSON.parse(Buffer.from(bytes).toString('utf8')).result;bytes.fill(0);
   const {evaluation}=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId});
   return qualityResolutionProof(s.provider,job,parsed,evaluation,{campus:'NORTH',purpose:'IDENTITY_VERIFY'});
  };
  const direct={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'DIRECT_PROOF',issueId:lengthIssue.id,expectedHead:correction.head,newRunId:nextRun.runId,newRevisionId:correction.revisionId,targetRow:1,targetField:s.errorField,matchStatus:'MATCHED',oldProof:await proof(s.run),newProof:await proof(nextRun)};
  const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try{
   for(const change of [{newProof:direct.newProof.replace('QUALITY_RESOLUTION_V1','FORGED')},{oldProof:direct.newProof},{newProof:null}])await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify({...direct,...change})]),/VALIDATION_PROVENANCE_REQUIRED/);
   await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify({...direct,targetRow:2})]),/UNMATCHED/);
   await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify({...direct,targetField:s.key})]),/VALIDATION_NOT_PASSED/);
   peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
   try{await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify(direct)]),/ACCESS_DENIED/);}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.base.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
  }finally{await pool.end();}
  const resolved=await s.catalog.resolveWithEvidence('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'RESOLVE_CORRECTED',issueId:lengthIssue.id,expectedHead:correction.head!,newRunId:nextRun.runId,newRevisionId:correction.revisionId!});
  assert.equal(resolved.kind,'RESOLVED');
  const replayPool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try{
   // Reconstruct the committed public command without reading any sensitive values.
   const request=peer(receipt.name,`SELECT request_id::text FROM governance_catalog.issue_disposition WHERE id=${quote(resolved.eventId)}::uuid;`);
   const replayInput={...direct,requestId:request,reason:'RESOLVE_CORRECTED'};
   assert.deepEqual((await replayPool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb) AS result',['maker',JSON.stringify(replayInput)])).rows[0].result,resolved);
   peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
   try{await assert.rejects(replayPool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify(replayInput)]),/ACCESS_DENIED/);}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.base.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
  }finally{await replayPool.end();}

  const detail=await s.catalog.qualityIssueDetail('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',issueId:lengthIssue.id});
  assert.equal(detail.issue.status,'RESOLVED');
  const current=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_CURRENT',runId:nextRun.runId});
  assert.equal(current.inserted,1);
  const eligibility=await s.catalog.qualityEligibilityRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id,revisionId:correction.revisionId!,runId:nextRun.runId});
  assert.equal(eligibility.applyImplemented,false);assert.equal(eligibility.isolationBlocked,true);assert.equal(eligibility.eligible,false);assert.ok(eligibility.notRunLayers.length>=3);assert.ok(eligibility.unresolvedIssueCount>=1);
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id=${quote(s.run.resultArtifactId)}::uuid; COMMIT;`);
  await s.catalog.purgeOwnedExpiredArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.run.resultArtifactId});
  const unavailable=await s.catalog.qualityIssueDetail('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',issueId:lengthIssue.id});
  assert.equal(unavailable.evidenceAvailable,false);assert.equal(unavailable.evidenceStatus,'NOT_RECOVERABLE');
 }finally{await s.catalog.close();}
});

test('P0-06 batch rejection blocks new processing but preserves safe historical replay',async()=>{
 const s=await setup();try{
  const stopInput={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'STOP_BATCH',jobId:s.file.job.id,expectedHead:'0'};
  const rejected=await s.catalog.rejectBatch('maker',stopInput);
  assert.equal(rejected.status,'REJECTED');
  assert.deepEqual(await s.catalog.rejectBatch('maker',stopInput),rejected);
  assert.equal((await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:s.file.job.id})).status,'REJECTED');
  assert.deepEqual(await s.catalog.parseFile('maker',s.parseInput),s.parse);
  await assert.rejects(s.catalog.parseFile('maker',{...s.parseInput,requestId:randomUUID(),outputRequestId:randomUUID()}),/BATCH_REJECTED/);
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()}),/BATCH_REJECTED/);
  assert.deepEqual(await s.catalog.validateRevision('maker',s.validate),s.run);
 }finally{await s.catalog.close();}
});

test('P0-06 rejected batches replay committed file revisions but reject new requests',async()=>{
 const s=await setup();try{
  const input={campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv' as const,job:{action:'REVISE' as const,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'REPLAY_REVISION',jobId:s.file.job.id,expectedCurrentRevision:s.file.job.revisionId,input:{kind:'FILE' as const,format:'CSV' as const,parserPolicy:'STRICT_V2' as const}}};
  const bytes=Buffer.from(`${s.field}\nREPLAY_VALUE`);
  const received=await s.catalog.receiveFile('maker',input,bytes);
  await s.catalog.rejectBatch('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'STOP_BATCH',jobId:s.file.job.id,expectedHead:'0'});
  assert.deepEqual(await s.catalog.receiveFile('maker',input,bytes),received);
  await assert.rejects(s.catalog.receiveFile('maker',{...input,fileRequestId:randomUUID(),job:{...input.job,requestId:randomUUID(),expectedCurrentRevision:received.job.revisionId}},bytes),/BATCH_REJECTED/);
 }finally{await s.catalog.close();}
});

test('P0-06 audit failure rolls back correction receive and its disposition together',async()=>{
 const s=await setupTwoFields();try{
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId});
  const listed=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id,pageSize:10,offset:0});
  const issue=listed.items.find(item=>item.rule==='LENGTH')!;assert.ok(issue);
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),receiveRequestId:randomUUID(),reason:'FAULT_CORRECTION',issueId:issue.id,jobId:s.file.job.id,sourceRunId:s.run.runId,expectedCurrentRevision:s.file.job.revisionId,format:'CSV' as const,parserPolicy:'STRICT_V2' as const,retentionSeconds:3600};
  const counts=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.issue_disposition),(SELECT count(*) FROM governance_catalog.import_input_revision),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM vnext_control.outcome))::text;');
  const before=counts();
  peer(receipt.name,"CREATE FUNCTION vnext_control.test_quality_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='QUALITY_CORRECTION_PROPOSED' THEN RAISE EXCEPTION 'TEST_QUALITY_AUDIT_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_quality_fault BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.test_quality_fault();");
  try{await assert.rejects(s.catalog.proposeCorrection('maker',input,Buffer.from(`${s.key},${s.errorField}\nKEY_001,GOOD`)),/QUALITY_OPERATION_FAILED/);}finally{peer(receipt.name,'DROP TRIGGER test_quality_fault ON vnext_control.audit; DROP FUNCTION vnext_control.test_quality_fault();');}
  assert.equal(counts(),before);assert.equal((await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:s.file.job.id})).currentRevisionId,s.file.job.revisionId);
  assert.equal((await s.catalog.proposeCorrection('maker',input,Buffer.from(`${s.key},${s.errorField}\nKEY_001,GOOD`))).kind,'CORRECTION_PROPOSED');
 }finally{await s.catalog.close();}
});

test('P0-06 concurrent assignments at one head serialize to one disposition',async()=>{
 const s=await setup();try{
  const responsibility=await publishResponsibility(s.catalog,s.contract.dataset);
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_ISSUES',runId:s.run.runId});
  const issueId=opened.issueIds[0]!;
  const results=await Promise.allSettled([1,2].map(()=>s.catalog.assignIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'ASSIGN_OWNER',issueId,expectedHead:'0',responsibilityId:responsibility.id})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  const rejection=results.find(result=>result.status==='rejected');assert.ok(rejection?.status==='rejected');assert.match(String(rejection.reason),/STALE_HEAD/);
 }finally{await s.catalog.close();}
});
