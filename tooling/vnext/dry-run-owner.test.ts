import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,type BuildDryRunInput} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');assert.equal(receipt.taskId,'P0-07');
const {peer,quote}=await import('./lineage.mjs');
const dimensions={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const};

function readAuditCount(artifactId:string,reason:string){
 return Number(peer(receipt.name,`SELECT count(*) FROM vnext_control.audit WHERE object_id=${quote(artifactId)}::uuid AND action='PROTECTED_READ_IDENTITY_VERIFY_NORTH' AND reason=${quote(reason)};`));
}

async function setup(){
 const provider=new LocalSyntheticKeyProvider();
 const catalog=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL'],provider);
 try{
  const f=await fixture(catalog,{businessKey:true,textField:true});
  const contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0]!;
  for(const permission of ['READ','STORE'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const field=contract.definition.fields[0]!.code;
  const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DRY_RUN_FILE',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(`${field}\nPRIVATE_ROW_A\nPRIVATE_ROW_B`));
  const parse=await catalog.parseFile('maker',{...dimensions,jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId,requestId:randomUUID(),outputRequestId:randomUUID(),retentionSeconds:3600});
  const validation={...dimensions,jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parse.artifact.artifactId,requestId:randomUUID(),outputRequestId:randomUUID(),retentionSeconds:3600};
  const run=await catalog.validateRevision('maker',validation);
  const input:BuildDryRunInput={...dimensions,jobId:file.job.id,revisionId:file.job.revisionId,runId:run.runId,commands:[{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[]}]};
  return {catalog,provider,f,contract,field,file,parse,run,validation,input};
 }catch(error){await catalog.close();throw error;}
}
function metadataCounts(){
 return peer(receipt.name,`SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.object),(SELECT count(*) FROM governance_catalog.version),(SELECT count(*) FROM governance_catalog.import_job),(SELECT count(*) FROM governance_catalog.import_input_revision),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM governance_catalog.validation_run),(SELECT count(*) FROM governance_catalog.quality_issue),(SELECT count(*) FROM governance_catalog.issue_disposition));`);
}
test('P0-07-AC-01/05: verified preview has zero domain writes, no permanent IDs and no L8 loop',async()=>{
 const s=await setup();try{
  const before=metadataCounts();
  const preview=await s.catalog.buildDryRun('maker',s.input);
  assert.equal(preview.analysisAvailable,true);assert.ok(preview.quality.notRunLayers.includes(8));
  assert.equal(preview.quality.eligible,false);assert.equal(preview.applyImplemented,false);
  assert.equal(preview.prerequisitesMet,false);assert.equal(preview.candidateFreezable,false);
  assert.equal(preview.domainWriteCount,0);assert.equal(preview.permanentBusinessIdsAllocated,0);
  assert.equal(preview.planRef.kind,'CHANGE_PLAN');assert.equal(preview.prerequisites.evidence,true);assert.equal(preview.prerequisites.domain,false);
  assert.equal(preview.certificate.status,'BLOCKED');
  assert.equal(preview.diff[0]!.effect,'NOT_EVALUABLE');assert.equal(preview.diff[0]!.affectedRelationshipCount,null);
  assert.ok(!JSON.stringify(preview).includes('PRIVATE_ROW'));
  assert.ok(!Buffer.from(preview.planToken.split('.')[0]!,'base64url').toString().includes('PRIVATE_ROW'));
  const frozen=await s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken});
  assert.equal(frozen.status,'BLOCKED');assert.equal(frozen.candidate,null);assert.equal(frozen.approvalGranted,false);
  assert.equal(metadataCounts(),before);
  assert.equal(peer(receipt.name,"SELECT count(*) FROM pg_namespace WHERE nspname IN ('person','department','organization','person_master','department_master');"),'0');
  assert.deepEqual((await s.catalog.planApplyUnits('maker',s.input)).graph,preview.graph);
  assert.deepEqual((await s.catalog.explainImpact('maker',s.input)).diff,preview.diff);
 }finally{await s.catalog.close();}
});
test('closed input and tampered/actor-substituted observations cannot become approval evidence',async()=>{
 const s=await setup();try{
  await assert.rejects(s.catalog.buildDryRun('maker',{...s.input,rows:[{name:'FORGED'}],eligible:true} as never),/CLOSED_INPUT_REQUIRED/);
  const preview=await s.catalog.buildDryRun('maker',s.input);
  await assert.rejects(s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken+'0'}),/INVALID_PLAN_TOKEN/);
  await assert.rejects(s.catalog.freezeApprovalCandidate('maker-alias',{planToken:preview.planToken}),/INVALID_PLAN_TOKEN/);
  await assert.rejects(s.catalog.buildDryRun('maker-alias',s.input),/ACCESS_DENIED/);
  const noKey=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL']);
  try{await assert.rejects(noKey.freezeApprovalCandidate('maker',{planToken:preview.planToken}),/KEY_UNAVAILABLE/);}finally{await noKey.close();}
 }finally{await s.catalog.close();}
});
test('P0-07-AC-02: same-job relationship graph can be inspected; undeclared fields and cycles block',async()=>{
 const s=await setup();try{
  const input:BuildDryRunInput={...s.input,commands:[{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[{field:s.field,alias:{kind:'JOB_ALIAS',row:1}}]}]};
  const preview=await s.catalog.buildDryRun('maker',input);
  assert.equal(preview.graph.status,'BLOCKED');assert.deepEqual(preview.graph.units,[]);
  assert.ok(preview.blockers.includes('UNDECLARED_RELATION'));assert.equal(preview.candidateFreezable,false);
  input.commands[0]!.dependencies=[{field:s.field,alias:{kind:'JOB_ALIAS',row:2}}];
  const cycle=await s.catalog.buildDryRun('maker',input);assert.deepEqual(cycle.graph.units,[]);
  assert.ok(cycle.blockers.includes('UNDECLARED_BUNDLE_CYCLE'));
 }finally{await s.catalog.close();}
});
test('P0-07-AC-04: changing one file character makes prior observation STALE and preserves it',async()=>{
 const s=await setup();try{
  const old=await s.catalog.buildDryRun('maker',s.input);const copy=JSON.stringify(old);
  await s.catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'ONE_CHARACTER',jobId:s.input.jobId,expectedCurrentRevision:s.input.revisionId,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(`${s.field}\nPRIVATE_ROW_C\nPRIVATE_ROW_B`));
  assert.equal((await s.catalog.freezeApprovalCandidate('maker',{planToken:old.planToken})).status,'STALE');
  assert.equal(JSON.stringify(old),copy);
 }finally{await s.catalog.close();}
});

test('PR9 R2: absent parsed rows cannot produce a planned graph or apply units',async()=>{
 const s=await setup();try{
  const preview=await s.catalog.buildDryRun('maker',{...s.input,commands:[{row:999,intent:'CREATE',dependencies:[]}]});
  assert.ok(preview.blockers.includes('ROW_REFERENCE_INVALID'));
  assert.equal(preview.graph.status,'BLOCKED');assert.equal(preview.prerequisites.graph,false);
  assert.deepEqual(preview.graph.order,[]);assert.deepEqual(preview.graph.units,[]);
 }finally{await s.catalog.close();}
});

test('PR9 R3: aggregate token capacity is checked before protected evidence is read',async()=>{
 const s=await setup();try{
  const commands:BuildDryRunInput['commands']=Array.from({length:1000},(_,index)=>({row:index+1,intent:'CREATE',dependencies:Array.from({length:100},(_,field)=>({field:`field_${field}`,alias:{kind:'JOB_ALIAS',row:1}}))}));
  const before=readAuditCount(s.run.resultArtifactId,'REQUEST_AUTHORIZED');
  await assert.rejects(s.catalog.buildDryRun('maker',{...s.input,commands}),/PLAN_INPUT_LIMIT/);
  assert.equal(readAuditCount(s.run.resultArtifactId,'REQUEST_AUTHORIZED'),before,'over-budget input must be rejected before database observation');
  const admitted=await s.catalog.buildDryRun('maker',{...s.input,commands:commands.slice(0,50)});
  assert.ok(admitted.planToken.length<=1048576);
  assert.equal((await s.catalog.freezeApprovalCandidate('maker',{planToken:admitted.planToken})).status,'BLOCKED');
 }finally{await s.catalog.close();}
});
test('current run does not hide historical unresolved issues; ledger change stales observation',async()=>{
 const s=await setup();try{
  const old=await s.catalog.buildDryRun('maker',s.input);
  const opened=await s.catalog.openIssue('maker',{...dimensions,runId:s.run.runId,requestId:randomUUID(),reason:'INGEST'});
  assert.ok(opened.total>0);
  assert.equal((await s.catalog.freezeApprovalCandidate('maker',{planToken:old.planToken})).status,'STALE');
  const run=await s.catalog.validateRevision('maker',{...s.validation,requestId:randomUUID(),outputRequestId:randomUUID()});
  const preview=await s.catalog.buildDryRun('maker',{...s.input,runId:run.runId});
  assert.ok(preview.quality.unresolvedIssueCount>=opened.total);
  assert.equal(preview.candidateFreezable,false);
 }finally{await s.catalog.close();}
});
test('PARSED evidence expiry or revoked READ cannot freeze or preview',async()=>{
 const s=await setup();try{
  const preview=await s.catalog.buildDryRun('maker',s.input);
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(s.f.dataset.id)}::uuid AND permission='READ';`);
  await assert.rejects(s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken}),/ACCESS_DENIED/);
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id=${quote(s.parse.artifact.artifactId)}::uuid; COMMIT;`);
  const frozen=await s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken});
  assert.equal(frozen.status,'BLOCKED');assert.equal(frozen.candidate,null);
  await assert.rejects(s.catalog.buildDryRun('maker',s.input),/PAYLOAD_UNAVAILABLE/);
 }finally{await s.catalog.close();}
});

test('PR9 P1: failed preview and freeze retain denied and authorized protected-read audits',async()=>{
 const s=await setup();try{
  const preview=await s.catalog.buildDryRun('maker',s.input);
  const report=s.run.resultArtifactId;
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(s.f.dataset.id)}::uuid AND permission='READ';`);
  const deniedBefore=readAuditCount(report,'ACCESS_DENIED');
  await assert.rejects(s.catalog.buildDryRun('maker',s.input),/ACCESS_DENIED/);
  assert.equal(readAuditCount(report,'ACCESS_DENIED'),deniedBefore+1,'preview denial audit must commit');
  await assert.rejects(s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken}),/ACCESS_DENIED/);
  assert.equal(readAuditCount(report,'ACCESS_DENIED'),deniedBefore+2,'freeze denial audit must commit');
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(s.f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
  const before=readAuditCount(report,'REQUEST_AUTHORIZED');
  const noKey=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL']);
  try{await assert.rejects(noKey.buildDryRun('maker',s.input),/PROTECTED_OPERATION_FAILED/);}finally{await noKey.close();}
  assert.equal(readAuditCount(report,'REQUEST_AUTHORIZED'),before+1,'crypto failure must retain the access audit');
  const originalTag=peer(receipt.name,`SELECT encode(tag,'hex') FROM governance_catalog.protected_payload WHERE artifact_id=${quote(report)}::uuid;`);
  const beforeCorrupt=readAuditCount(report,'REQUEST_AUTHORIZED');
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_payload SET tag=decode(repeat('00',16),'hex') WHERE artifact_id=${quote(report)}::uuid; COMMIT;`);
  try{await assert.rejects(s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken}),/PROTECTED_OPERATION_FAILED/);}
  finally{peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_payload SET tag=decode(${quote(originalTag)},'hex') WHERE artifact_id=${quote(report)}::uuid; COMMIT;`);}
  assert.equal(readAuditCount(report,'REQUEST_AUTHORIZED'),beforeCorrupt+1,'corrupt envelope must retain the original access audit');
  const beforeSql=readAuditCount(report,'REQUEST_AUTHORIZED');
  // Fault injection in this owned temporary database only. Restore the same function/OID.
  peer(receipt.name,'ALTER FUNCTION governance_catalog.quality_eligibility(text,jsonb,jsonb,jsonb) RENAME TO quality_eligibility_pr9_hidden;');
  try{await assert.rejects(s.catalog.buildDryRun('maker',s.input),/DRY_RUN_FAILED/);}
  finally{peer(receipt.name,'ALTER FUNCTION governance_catalog.quality_eligibility_pr9_hidden(text,jsonb,jsonb,jsonb) RENAME TO quality_eligibility;');}
  assert.equal(readAuditCount(report,'REQUEST_AUTHORIZED'),beforeSql+1,'later SQL abort must not erase preceding protected-read audits');
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id=${quote(s.parse.artifact.artifactId)}::uuid; COMMIT;`);
  const expiredBefore=readAuditCount(s.parse.artifact.artifactId,'PAYLOAD_UNAVAILABLE');
  assert.equal((await s.catalog.freezeApprovalCandidate('maker',{planToken:preview.planToken})).status,'BLOCKED');
  assert.equal(readAuditCount(s.parse.artifact.artifactId,'PAYLOAD_UNAVAILABLE'),expiredBefore+1,'mapped BLOCKED result must retain the denial audit');
 }finally{await s.catalog.close();}
});
