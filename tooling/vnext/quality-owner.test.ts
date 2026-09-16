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
 const catalog=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL'],provider);
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

async function setupTwoFields(extraRow:'NONE'|'EXACT'|'CONFLICT'='NONE',optionalTextField=false){
 const provider=new LocalSyntheticKeyProvider();
 const catalog=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL'],provider);
 try{
 const base=await fixture(catalog,{businessKey:true,textField:true,twoTextFields:true,optionalTextField});
  const baseContract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:base.contract.id,versionId:base.contract.versionId}))[0]!;
  const dataset=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===base.dataset.id)!;
  const first=baseContract.definition.fields[0]!;
  const secondSource=(dataset.payload.fields!.find(field=>field.original.type==='text'&&field.original.required===(optionalTextField?'O':'R')&&field.original.code!==first.code&&!field.original.ref)??dataset.payload.fields!.find(field=>field.original.type==='text'&&field.original.required==='O'&&field.original.code!==first.code&&!field.original.ref)!).original;
  const secondRequired=secondSource.required as 'R'|'C'|'O';
  const secondCondition=secondRequired==='R'?'ALWAYS':secondRequired==='O'?'OPTIONAL':'UNRESOLVED';
  const definition={...baseContract.definition,ruleVersion:'QUALITY_TWO_FIELD_V1',fields:[first,{code:secondSource.code,type:'text' as const,required:secondRequired,privacy:secondSource.privacy as 'INTERNAL'|'RESTRICTED'|'HIGH_RESTRICTED',condition:secondCondition,enumValues:[]}]};
  const draft=await catalog.contractCommand('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:base.contract.id,expectedHead:base.contract.head,datasetVersionId:base.contract.datasetVersionId,validFrom:'2026-01-01T00:00:00',validTo:null,definition});
  const approved=await catalog.contractCommand('reviewer',{action:'APPROVE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest});
  const contract=await catalog.contractCommand('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_CONTRACT',target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest});
  for(const permission of ['STORE','READ','PURGE'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(base.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const key=first.code,errorField=secondSource.code;
  const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'QUALITY_FILE',contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(`${key},${errorField}\nKEY_001,${'X'.repeat(8000)}${extraRow==='NONE'?'':extraRow==='EXACT'?'\nKEY_001,'+'X'.repeat(8000):'\nKEY_001,OTHER'}`));
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
  const fakeReport=await s.catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),retentionSeconds:3600,jobId:s.file.job.id,revisionId:s.file.job.revisionId,kind:'ERROR_REPORT'},Buffer.from('{}'));
  const appCatalog=await openCatalog(process.env['VNEXT_DATABASE_URL'],s.provider);
  try{
   await assert.rejects(appCatalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()}),/VALIDATION_OWNER_REQUIRED/);
   assert.deepEqual(await appCatalog.validateRevision('maker',s.validate),s.run);
  }finally{await appCatalog.close();}
  const untrusted=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try{
   await assert.rejects(untrusted.query('SELECT governance_catalog.accept_validation($1,$2::jsonb,$3::uuid,$4,$5,$6::uuid,$7,$8,$9,$10,$11)', ['maker',JSON.stringify({...s.validate,requestId:randomUUID()}),fakeReport.artifactId,'BLOCKED',0,randomUUID(),s.run.recordedAt,'0'.repeat(64),'1'.repeat(64),'2'.repeat(64),'3'.repeat(64)]),/permission denied/);
   const trustedRole=new URL(process.env['VNEXT_VALIDATION_OWNER_URL']!).username;
   await assert.rejects(untrusted.query(`SET ROLE ${trustedRole}`),/permission denied/);
  }finally{await untrusted.end();}
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
  const revised=await s.catalog.command('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY_EDIT',target:responsibility.id,expectedHead:responsibility.head,values:{dataset:s.contract.dataset,authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_B'},validFrom:'2026-01-01T00:00:00'});
  const pending=await s.catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY_REVIEW',target:revised.id,expectedHead:revised.head});
  assert.ok(pending.head);
  const duringEdit=await s.catalog.assignIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'ASSIGN_DURING_EDIT',issueId,expectedHead:assigned.head,responsibilityId:responsibility.id});
  assert.equal(duringEdit.ownerRef,'SYNTHETIC_OWNER_A');

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
  assert.ok(correction.artifactId);assert.ok(correction.revisionId);
  const oldBytesAfter=Buffer.from(await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.file.artifact.artifactId}));
  assert.deepEqual(oldBytesAfter,oldBytes);
  assert.equal(createHash('sha256').update(oldBytesAfter).digest('hex'),createHash('sha256').update(oldBytes).digest('hex'));
  const nextParse=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:correction.revisionId!,artifactId:correction.artifactId});
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
  await assert.rejects(s.catalog.resolveWithEvidence('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'WRONG_REVISION',issueId:lengthIssue.id,expectedHead:correction.head,newRunId:nextRun.runId,newRevisionId:randomUUID()}),/REVISION_REFERENCE_INVALID/);
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


for(const [oldRows,newRows,expected] of [['EXACT','NONE','RESOLVED'],['EXACT','EXACT','RESOLVED'],['CONFLICT','NONE','UNMATCHED'],['NONE','CONFLICT','UNMATCHED']] as const)test(`PR8 exact duplicate matching ${oldRows} -> ${newRows}`,async()=>{
 const s=await setupTwoFields(oldRows);try{
  await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_DUPLICATES',runId:s.run.runId});
  const listed=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id});
  const issue=listed.items.find(i=>i.rule==='LENGTH')!;
  const correction=await s.catalog.proposeCorrection('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),receiveRequestId:randomUUID(),reason:'CORRECT_DUPLICATES',issueId:issue.id,jobId:s.file.job.id,sourceRunId:s.run.runId,expectedCurrentRevision:s.file.job.revisionId,format:'CSV',parserPolicy:'STRICT_V2',retentionSeconds:3600},Buffer.from(`${s.key},${s.errorField}\nKEY_001,GOOD${newRows==='NONE'?'':newRows==='EXACT'?'\nKEY_001,GOOD':'\nKEY_001,OTHER'}`));
  const parse=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:correction.revisionId,artifactId:correction.artifactId!});
  const run=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),revisionId:correction.revisionId,artifactId:parse.artifact.artifactId});
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'RESOLVE_DUPLICATES',issueId:issue.id,expectedHead:correction.head,newRunId:run.runId,newRevisionId:correction.revisionId};
  const job=await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:s.file.job.id});
  const proof=async(v:typeof run)=>{
   const bytes=await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:v.parseArtifactId});
   const parsed=JSON.parse(Buffer.from(bytes).toString('utf8')).result;bytes.fill(0);
   const {evaluation}=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:v.runId});
   return qualityResolutionProof(s.provider,job,parsed,evaluation,input);
  };
  const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});
  try{
   const direct={...input,targetRow:expected==='UNMATCHED'?1:2,targetField:s.errorField,matchStatus:'MATCHED',oldProof:await proof(s.run),newProof:await proof(run)};
   await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_resolve($1,$2::jsonb)',['maker',JSON.stringify(direct)]),/UNMATCHED/);
  }finally{await pool.end();}
  if(expected==='UNMATCHED')await assert.rejects(s.catalog.resolveWithEvidence('maker',input),/UNMATCHED/);
  else assert.equal((await s.catalog.resolveWithEvidence('maker',input)).kind,'RESOLVED');
 }finally{await s.catalog.close();}
});

test('PR8 ingestion replay survives expired payload but still enforces permissions and intent',async()=>{
 const s=await setup();try{
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'OPEN_THEN_EXPIRE',runId:s.run.runId};
  const opened=await s.catalog.openIssue('maker',input);
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id=${quote(s.run.resultArtifactId)}::uuid; COMMIT;`);
  assert.deepEqual(await s.catalog.openIssue('maker',input),opened);
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','PURGE') ON CONFLICT DO NOTHING;`);
  await s.catalog.purgeOwnedExpiredArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.run.resultArtifactId});
  const noKeys=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL']);
  try{assert.deepEqual(await noKeys.openIssue('maker',input),opened);}finally{await noKeys.close();}
  await assert.rejects(s.catalog.openIssue('maker',{...input,reason:'CHANGED_INTENT'}),/REQUEST_CONFLICT/);
  await assert.rejects(s.catalog.openIssue('maker',{...input,requestId:randomUUID()}),/PAYLOAD_UNAVAILABLE/);
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
  await assert.rejects(s.catalog.openIssue('maker',input),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});


async function prepareCorrection(mutateInput=false,reason='CORRECT_RECOVERY',optionalEmpty=false){
 const s=await setupTwoFields('NONE',optionalEmpty);
 try{
  await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_RECOVERY',runId:s.run.runId});
  const list=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id});
  const issue=list.items.find(i=>i.rule==='LENGTH')!;
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),receiveRequestId:randomUUID(),reason,issueId:issue.id,jobId:s.file.job.id,sourceRunId:s.run.runId,expectedCurrentRevision:s.file.job.revisionId,format:'CSV' as const,parserPolicy:'STRICT_V2' as const,retentionSeconds:3600};
  const bytes=Buffer.from(`${s.key},${s.errorField}\nKEY_001,${optionalEmpty?'':'GOOD'}`);
  const expected=Buffer.from(bytes);
  const pending=s.catalog.proposeCorrection('maker',input,bytes);
  if(mutateInput)bytes.fill(90);
  const correction=await pending;
  return {...s,input,bytes,expected,correction,issue};
 }catch(e){await s.catalog.close();throw e;}
}

test('PR8 correction association is not an ordinary app-role seam',async()=>{
 const s=await prepareCorrection();const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});try{
  const fake={...s.input,requestId:randomUUID(),receiveRequestId:randomUUID(),fileDigest:'a'.repeat(64)};
  await assert.rejects(pool.query('SELECT governance_catalog.quality_issue_record_correction($1,$2::jsonb,$3::uuid,$4::uuid)',['maker',JSON.stringify(fake),s.correction.revisionId,s.correction.artifactId]),/permission denied/);
  const ownerPool=new Pool({connectionString:process.env['VNEXT_VALIDATION_OWNER_URL']});
  try{
   for(const change of [{receiveRequestId:randomUUID()},{format:'JSON'},{parserPolicy:'STRICT_V1'}])await assert.rejects(ownerPool.query('SELECT governance_catalog.quality_issue_record_correction($1,$2::jsonb,$3::uuid,$4::uuid)',['maker',JSON.stringify({...s.input,requestId:randomUUID(),fileDigest:'a'.repeat(64),...change}),s.correction.revisionId,s.correction.artifactId]),/CORRECTION_RECEIPT_MISMATCH/);
  }finally{await ownerPool.end();}
 }finally{await pool.end();await s.catalog.close();}
});

test('PR8 correction replay requires current precise STORE permission',async()=>{
 const s=await prepareCorrection();try{
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='STORE';`);
  await assert.rejects(s.catalog.proposeCorrection('maker',s.input,s.bytes),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});

test('PR8 committed resolution replays after revision changes and evidence expiry',async()=>{
 const s=await prepareCorrection();try{
  const parsed=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:s.correction.revisionId,artifactId:s.correction.artifactId!,retentionSeconds:3600});
  const run=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),revisionId:s.correction.revisionId,artifactId:parsed.artifact.artifactId});
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'RESOLVE_RECOVERY',issueId:s.issue.id,expectedHead:s.correction.head,newRunId:run.runId,newRevisionId:run.revisionId};
  const resolved=await s.catalog.resolveWithEvidence('maker',input);
  await s.catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'LATER_REVISION',jobId:s.file.job.id,expectedCurrentRevision:run.revisionId,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},s.bytes);
  assert.deepEqual(await s.catalog.resolveWithEvidence('maker',input),resolved);
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id IN (${quote(s.run.resultArtifactId)}::uuid,${quote(run.resultArtifactId)}::uuid); COMMIT;`);
  await s.catalog.purgeOwnedExpiredArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:run.resultArtifactId});
  const noKeys=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL']);
  try{assert.deepEqual(await noKeys.resolveWithEvidence('maker',input),resolved);}finally{await noKeys.close();}
  await assert.rejects(s.catalog.resolveWithEvidence('maker',{...input,candidate:{row:1,field:s.errorField}}),/REQUEST_CONFLICT/);
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
  await assert.rejects(s.catalog.resolveWithEvidence('maker',input),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});


test('PR8 correction snapshots caller bytes and returns one durable receipt',async()=>{
 const s=await prepareCorrection(true);try{
  const raw=await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.correction.artifactId!});
  assert.deepEqual(Buffer.from(raw),s.expected);
  assert.deepEqual(await s.catalog.proposeCorrection('maker',s.input,s.expected),s.correction);
 }finally{await s.catalog.close();}
});

test('PR8 quality expansion and replay require exact dataset WRITE',async()=>{
 const s=await setup();try{
  const responsibility=await publishResponsibility(s.catalog,s.contract.dataset);
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'OPEN_WRITE_TEST',runId:s.run.runId};
  const opened=await s.catalog.openIssue('maker',input);
  const assignment={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'ASSIGN_WRITE_TEST',issueId:opened.issueIds[0]!,expectedHead:'0',responsibilityId:responsibility.id};
  await s.catalog.assignIssue('maker',assignment);
  peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(s.f.dataset.id)}::uuid AND permission='WRITE';`);
  for(const requestId of [input.requestId,randomUUID()])await assert.rejects(s.catalog.openIssue('maker',{...input,requestId}),/ACCESS_DENIED/);
  await assert.rejects(s.catalog.assignIssue('maker',assignment),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});

test('PR8 stopping an owned batch does not require upstream source access',async()=>{
 const s=await setup();const grants=peer(receipt.name,"SELECT coalesce(jsonb_agg(g),'[]'::jsonb)::text FROM vnext_control.object_grant g WHERE actor_code='maker' AND object_kind='SOURCE' AND permission='READ';");
 try{
  peer(receipt.name,"DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_kind='SOURCE' AND permission='READ';");
  const input={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,requestId:randomUUID(),reason:'STOP_WITHOUT_UPSTREAM',jobId:s.file.job.id,expectedHead:'0'};
  const stopped=await s.catalog.rejectBatch('maker',input);assert.equal(stopped.status,'REJECTED');
  assert.deepEqual(await s.catalog.rejectBatch('maker',input),stopped);
 }finally{
  peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`);
  await s.catalog.close();
 }
});


test('PR8 correction accepts numbered public reasons without changing receive grammar',async()=>{
 const s=await prepareCorrection(false,'FIX_1');try{
  assert.equal(s.correction.kind,'CORRECTION_PROPOSED');
  assert.deepEqual(await s.catalog.proposeCorrection('maker',s.input,s.bytes),s.correction);
  const reason=peer(receipt.name,`SELECT reason FROM governance_catalog.issue_disposition WHERE id=${quote(s.correction.eventId)}::uuid;`);
  assert.equal(reason,'FIX_1');
  await assert.rejects(s.catalog.proposeCorrection('maker',{...s.input,reason:'FIX_2'},s.bytes),/REQUEST_CONFLICT/);
 }finally{await s.catalog.close();}
});


test('PR8 issue lists count and paginate only the requested campus and purpose',async()=>{
 const s=await setup();try{
  const expected=[];
  const first=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'OPEN_DIMENSIONS',runId:s.run.runId});
  expected.push({campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,runId:s.run.runId,ids:first.issueIds});
  let current=s.file.job.revisionId;
  for(const [campus,purpose] of [['SOUTH','IDENTITY_VERIFY'],['NORTH','CONTACT_VERIFY']] as const){
   for(const permission of ['STORE','READ'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.f.dataset.id)}::uuid,${quote(campus)},${quote(purpose)},${quote(permission)}) ON CONFLICT DO NOTHING;`);
   const received=await s.catalog.receiveFile('maker',{campus,purpose,retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DIMENSION_REVISION',jobId:s.file.job.id,expectedCurrentRevision:current,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(`${s.field}\n${'Y'.repeat(8000)}`));
   current=received.job.revisionId;
   const parse=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus,purpose,retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:current,artifactId:received.artifact.artifactId});
   const run=await s.catalog.validateRevision('maker',{...s.validate,campus,purpose,requestId:randomUUID(),outputRequestId:randomUUID(),revisionId:current,artifactId:parse.artifact.artifactId});
   const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus,purpose,requestId:randomUUID(),reason:'OPEN_DIMENSIONS',runId:run.runId});
   expected.push({campus,purpose,runId:run.runId,ids:opened.issueIds});
  }
  for(const dimension of expected){
   const ids=[];
   for(let offset=0;offset<=dimension.ids.length;offset++){
    const page=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:dimension.campus,purpose:dimension.purpose,jobId:s.file.job.id,pageSize:1,offset});
    assert.equal(page.total,dimension.ids.length);
    for(const item of page.items){assert.equal(item.campus,dimension.campus);assert.equal(item.purpose,dimension.purpose);assert.equal(item.runId,dimension.runId);ids.push(item.id);}
   }
   assert.deepEqual(ids,dimension.ids);
  }
  await assert.rejects(s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'SOUTH',purpose:'CONTACT_VERIFY',jobId:s.file.job.id}),/ACCESS_DENIED/);
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.f.dataset.id)}::uuid,'SOUTH','CONTACT_VERIFY','READ');`);
  const empty=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'SOUTH',purpose:'CONTACT_VERIFY',jobId:s.file.job.id});
  assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);
 }finally{await s.catalog.close();}
});


test('PR8 ledger positions remain lossless above the JavaScript safe integer limit',async()=>{
 const s=await setup();try{
  const base='9007199254740992';
  peer(receipt.name,`UPDATE governance_catalog.import_job SET quality_issue_sequence=${base},quality_disposition_sequence=${base} WHERE id=${quote(s.file.job.id)}::uuid;`);
  const responsibility=await publishResponsibility(s.catalog,s.contract.dataset);
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'BIGINT_POSITIONS',runId:s.run.runId});
  const assigned=await s.catalog.assignIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'BIGINT_ASSIGNMENT',issueId:opened.issueIds[0]!,expectedHead:base,responsibilityId:responsibility.id});
  const list=await s.catalog.qualityIssueRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id});
  const detail=await s.catalog.qualityIssueDetail('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',issueId:opened.issueIds[0]!});
  assert.equal(detail.history[0]!.head,'9007199254740993');
  assert.equal(assigned.head,'9007199254740993');
  assert.deepEqual(list.items.map(i=>i.sequence),['9007199254740993','9007199254740994']);
  assert.equal(detail.issue.sequence,'9007199254740993');
 }finally{await s.catalog.close();}
});

test('PR8 issue metadata requires precise current protected READ even for a submitter alias',async()=>{
 const s=await setup();try{
  const opened=await s.catalog.openIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'READ_GRANTS',runId:s.run.runId});
  const list={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,jobId:s.file.job.id};
  const detail={scope:list.scope,campus:list.campus,purpose:list.purpose,issueId:opened.issueIds[0]!};
  assert.ok(await s.catalog.importJobRead('maker-alias',{scope:'SYNTHETIC',jobId:s.file.job.id}));
  for(const granted of [false,true,false]){
   if(granted)peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker-alias',${quote(s.f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
   else peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker-alias' AND dataset_id=${quote(s.f.dataset.id)}::uuid;`);
   if(granted){assert.equal((await s.catalog.qualityIssueRead('maker-alias',list)).total,opened.total);assert.equal((await s.catalog.qualityIssueDetail('maker-alias',detail)).issue.id,detail.issueId);}
   else{await assert.rejects(s.catalog.qualityIssueRead('maker-alias',list),/ACCESS_DENIED/);await assert.rejects(s.catalog.qualityIssueDetail('maker-alias',detail),/ACCESS_DENIED/);}
  }
 }finally{await s.catalog.close();}
});

test('PR8 optional empty correction resolves its field error while Owner blockers remain',async()=>{
 const s=await prepareCorrection(false,'CLEAR_OPTIONAL',true);try{
  const parsed=await s.catalog.parseFile('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),outputRequestId:randomUUID(),jobId:s.file.job.id,revisionId:s.correction.revisionId,artifactId:s.correction.artifactId,retentionSeconds:3600});
  const run=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),revisionId:s.correction.revisionId,artifactId:parsed.artifact.artifactId});
  const resolved=await s.catalog.resolveWithEvidence('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),reason:'RESOLVE_ABSENCE',issueId:s.issue.id,expectedHead:s.correction.head,newRunId:run.runId,newRevisionId:run.revisionId});
  assert.equal(resolved.kind,'RESOLVED');
  const eligibility=await s.catalog.qualityEligibilityRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',jobId:s.file.job.id,revisionId:run.revisionId,runId:run.runId});
  assert.equal(eligibility.eligible,false);assert.equal(eligibility.isolationBlocked,true);assert.equal(eligibility.applyImplemented,false);
 }finally{await s.catalog.close();}
});
