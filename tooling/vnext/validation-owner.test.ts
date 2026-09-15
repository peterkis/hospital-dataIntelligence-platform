import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider,type ReceiveFileInput} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');
async function setup(businessKey=true,textField=false){
 const provider=new LocalSyntheticKeyProvider(),catalog=await openCatalog(undefined,provider);
 try{
  const f=await fixture(catalog,{businessKey,textField}),contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0]!;
  for(const permission of ['STORE','READ'])peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const input:ReceiveFileInput={campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'VALIDATION_TEST',contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}};
  const file=await catalog.receiveFile('maker',input,Buffer.from(contract.definition.fields[0]!.code+'\n0012'));
  const parse={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId};
  const parsed=await catalog.parseFile('maker',parse);
  const validate={...parse,artifactId:parsed.artifact.artifactId,requestId:randomUUID(),outputRequestId:randomUUID()};
  return {catalog,provider,f,contract,input,file,parse,parsed,validate};
 }catch(e){await catalog.close();throw e;}
}
test('generic RAW_CELL cannot impersonate parser output; exact source required',async()=>{
 const s=await setup();try{
  const bytes=await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:s.parsed.artifact.artifactId});
  const fake=await s.catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),retentionSeconds:3600,jobId:s.file.job.id,revisionId:s.file.job.revisionId,kind:'RAW_CELL'},bytes);
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,artifactId:fake.artifactId}),/PARSE_PROVENANCE_REQUIRED/);
 }finally{await s.catalog.close();}
});
test('PR7 R4: long parser-accepted text produces an immutable L2 failure run',async()=>{
 const s=await setup(true,true);try{
  const field=s.contract.definition.fields[0]!.code;
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID()}},Buffer.from(field+'\n'+'😀'.repeat(8192)));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  assert.equal(parsed.structuralStatus,'PARSED');
  const run=await s.catalog.validateRevision('maker',{...s.validate,jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId});
  assert.equal(run.decision,'FAIL');
  const details=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId});
  assert.ok(details.evaluation.issues.some(i=>i.layer===2&&i.field===field&&i.code==='VALUE_TOO_LONG'));
 }finally{await s.catalog.close();}
});
test('P0-05-AC-03/05: immutable runs, authorized ACK replay and deterministic business results',async()=>{
 const s=await setup();try{
  const first=await s.catalog.validateRevision('maker',s.validate);
  assert.deepEqual(await s.catalog.validateRevision('maker',s.validate),first);
  const second=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()});
  assert.notEqual(first.runId,second.runId);
  const compare=await s.catalog.compareValidationRuns('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',leftRunId:first.runId,rightRunId:second.runId});
  assert.equal(compare.sameConclusion,true);assert.equal(compare.sameEvaluation,true);assert.equal(first.adapterReadiness,'NOT_READY');
  assert.ok(!JSON.stringify(first).includes('0012'));
 }finally{await s.catalog.close();}
});
test('PR7 R2: comparison exposes parser and interpretation policy equality',async()=>{
 const s=await setup();try{
  const first=await s.catalog.validateRevision('maker',s.validate);
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID(),input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}},Buffer.from(s.contract.definition.fields[0]!.code+'\n0012'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  const second=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId});
  const comparison=await s.catalog.compareValidationRuns('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',leftRunId:first.runId,rightRunId:second.runId});
  assert.equal(comparison.sameContractVersion,true);assert.equal(comparison.sameRuleVersion,true);
  assert.equal(comparison.sameParserPolicy,false);assert.equal(comparison.sameInterpretationPolicy,true);
 }finally{await s.catalog.close();}
});
test('PR7 R3: newly authored keyless CORE definitions are rejected',async()=>{
 await assert.rejects(setup(false,true),/BUSINESS_KEY_REQUIRED/);
});
test('PR7 R2: explicit non-ID key is frozen in contract schema and invalid declarations fail closed',async()=>{
 const s=await setup(true,true);try{
  const schema=s.contract.schemas['sourceRowSchema'];
  assert.ok(schema&&typeof schema==='object'&&'x-businessKey' in schema);
  assert.deepEqual(schema['x-businessKey'],s.contract.definition.businessKey);
  const run=await s.catalog.validateRevision('maker',s.validate);
  const details=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId});
  assert.equal(details.evaluation.layers.find(l=>l.layer===3)!.status,'PASS');
  for(const businessKey of [[],['UNSELECTED'],[s.contract.definition.fields[0]!.code,s.contract.definition.fields[0]!.code],null]){
   await assert.rejects(s.catalog.contractCommand('maker',s.f.cmd('REVISE',{target:s.contract.id,expectedHead:s.f.contract.head,validFrom:s.contract.validFrom,validTo:null,definition:{...s.contract.definition,ruleVersion:'BAD_KEY',businessKey}})),/BUSINESS_KEY_INVALID/);
  }
  const {businessKey:omitted,...legacyDefinition}=s.contract.definition;
  await assert.rejects(s.catalog.contractCommand('maker',s.f.cmd('REVISE',{target:s.contract.id,expectedHead:s.f.contract.head,validFrom:s.contract.validFrom,validTo:null,definition:{...legacyDefinition,ruleVersion:'NO_KEY'}})),/BUSINESS_KEY_REQUIRED/);
 }finally{await s.catalog.close();}
});
test('PR7: fresh validation request cannot reuse an already consumed output request',async()=>{
 const s=await setup();try{
  const original=await s.catalog.validateRevision('maker',s.validate);
  const counts=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.validation_run),(SELECT count(*) FROM governance_catalog.protected_artifact))::text;');
  const before=counts();
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID()}),error=>error instanceof Error && error.message==='REQUEST_CONFLICT');
  assert.equal(counts(),before);
  assert.deepEqual(await s.catalog.validateRevision('maker',s.validate),original);
  const next=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()});
  assert.notEqual(next.resultArtifactId,original.resultArtifactId);
 }finally{await s.catalog.close();}
});
test('PR7: identical canonical rows are recorded as ignored duplicates by the validation Owner',async()=>{
 const s=await setup();try{
  const first=await s.catalog.validateRevision('maker',s.validate);
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID()}},Buffer.from(s.contract.definition.fields[0]!.code+'\n0012\n0012'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  const run=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId});
  assert.equal(run.decision,'BLOCKED');assert.equal(run.issueCount,0);
  const details=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId});
  assert.deepEqual(details.evaluation.duplicates,[{row:2,duplicateOf:1}]);
  const comparison=await s.catalog.compareValidationRuns('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',leftRunId:first.runId,rightRunId:run.runId});
  assert.equal(comparison.sameConclusion,true);assert.equal(comparison.sameEvaluation,false);
 }finally{await s.catalog.close();}
});
test('PR7: V2 rejected input exports through the real protected File Owner',async()=>{
 const s=await setup();try{
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID()}},Buffer.from(s.contract.definition.fields[0]!.code+'\n INVALID'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  assert.equal(parsed.structuralStatus,'REJECTED');
  const report=await s.catalog.exportIssueWorkbook('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId});
  assert.equal(report.status,'QUARANTINED');
  const bytes=await s.catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:report.artifactId});
  assert.equal(Buffer.from(bytes).readUInt32LE(0),0x04034b50);
 }finally{await s.catalog.close();}
});
test('P0-05-AC-03: publishing a new rule version preserves old run and requires a new frozen job',async()=>{
 const s=await setup();try{
  const run=await s.catalog.validateRevision('maker',s.validate);
  const query={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,runId:run.runId};
  const before=await s.catalog.explainIssue('maker',query);
  const draft=await s.catalog.contractCommand('maker',s.f.cmd('REVISE',{target:s.contract.id,expectedHead:s.f.contract.head,validFrom:s.contract.validFrom,validTo:null,definition:{...s.contract.definition,ruleVersion:'TEST_V2'}}));
  const approved=await s.catalog.contractCommand('reviewer',s.f.cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
  const published=await s.catalog.contractCommand('reviewer',s.f.cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  assert.deepEqual(await s.catalog.explainIssue('maker',query),before);
  const next=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID(),action:'CREATE',contractId:published.id,contractVersionId:published.versionId,profile:'CORE'}},Buffer.from(s.contract.definition.fields[0]!.code+'\n0012'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:next.job.id,revisionId:next.job.revisionId,artifactId:next.artifact.artifactId});
  const nextRun=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:next.job.id,revisionId:next.job.revisionId,artifactId:parsed.artifact.artifactId});
  assert.equal(nextRun.ruleVersion,'TEST_V2');assert.notEqual(nextRun.contractVersionId,run.contractVersionId);
  peer(receipt.name,`DO $$ BEGIN BEGIN UPDATE governance_catalog.validation_run SET issue_count=99 WHERE id=${quote(run.runId)}::uuid; RAISE EXCEPTION 'EXPECTED_IMMUTABLE'; EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM='EXPECTED_IMMUTABLE' THEN RAISE; END IF; END; END $$;`);
  assert.deepEqual(await s.catalog.explainIssue('maker',query),before);
 }finally{await s.catalog.close();}
});
test('actual nullable datetime contract passes V2 structure and field checks without changing raw empty text',async()=>{
 const s=await setup();try{
  const dataset=(await s.catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===s.f.dataset.id)!;
  const end=dataset.payload.fields!.find(f=>f.original.code==='valid_to')!.original;
  const draft=await s.catalog.contractCommand('maker',s.f.cmd('REVISE',{target:s.contract.id,expectedHead:s.f.contract.head,validFrom:s.contract.validFrom,validTo:null,definition:{...s.contract.definition,ruleVersion:'NULL_DATE_V2',fields:[...s.contract.definition.fields,{code:end.code,type:end.type,required:end.required,privacy:end.privacy,condition:'OPTIONAL',enumValues:[]}]}}));
  const approved=await s.catalog.contractCommand('reviewer',s.f.cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
  const pub=await s.catalog.contractCommand('reviewer',s.f.cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,action:'CREATE',requestId:randomUUID(),contractId:pub.id,contractVersionId:pub.versionId,profile:'CORE'}},Buffer.from(s.contract.definition.fields[0]!.code+',valid_to\n0012,'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  assert.equal(parsed.structuralStatus,'PARSED');
  const run=await s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId});
  assert.equal(run.issueCount,0);assert.equal(run.decision,'BLOCKED');
 }finally{await s.catalog.close();}
});
test('current authorization denies replay, explanations and cross-campus reads',async()=>{
 const s=await setup();try{
  const run=await s.catalog.validateRevision('maker',s.validate);
  const query={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,runId:run.runId};
  await assert.rejects(s.catalog.explainIssue('maker',{...query,campus:'SOUTH'}),/ACCESS_DENIED/);
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(s.f.dataset.id)}::uuid AND permission='READ';`);
  await assert.rejects(s.catalog.explainIssue('maker',query),/ACCESS_DENIED/);
  await assert.rejects(s.catalog.validateRevision('maker',s.validate),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});
test('PR7 R5: revoked STORE denies validation replay but preserves authorized historical reads',async()=>{
 const s=await setup();try{
  const run=await s.catalog.validateRevision('maker',s.validate);
  const query={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,runId:run.runId};
  const before=await s.catalog.explainIssue('maker',query);
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(s.f.dataset.id)}::uuid AND permission='STORE';`);
  await assert.rejects(s.catalog.validateRevision('maker',s.validate),/ACCESS_DENIED/);
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()}),/ACCESS_DENIED/);
  assert.deepEqual(await s.catalog.explainIssue('maker',query),before);
  assert.equal((await s.catalog.compareValidationRuns('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',leftRunId:run.runId,rightRunId:run.runId})).sameConclusion,true);
 }finally{await s.catalog.close();}
});
test('audit failure rolls back run, result artifact and replay outcome in one root',async()=>{
 const s=await setup();try{
  const counts=()=>peer(receipt.name,'SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.validation_run),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM vnext_control.outcome))::text;');
  const before=counts();
  peer(receipt.name,"CREATE FUNCTION vnext_control.test_validation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='VALIDATE_REVISION' THEN RAISE EXCEPTION 'TEST_AUDIT_FAULT'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_validation_fault BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.test_validation_fault();");
  try{await assert.rejects(s.catalog.validateRevision('maker',s.validate),/TEST_AUDIT_FAULT/);assert.equal(counts(),before);}
  finally{peer(receipt.name,'DROP TRIGGER test_validation_fault ON vnext_control.audit; DROP FUNCTION vnext_control.test_validation_fault();');}
  assert.ok((await s.catalog.validateRevision('maker',s.validate)).runId);
 }finally{await s.catalog.close();}
});
test('concurrent identical requests produce one run; a new revision refuses old input',async()=>{
 const s=await setup();try{
  const results=await Promise.all([s.catalog.validateRevision('maker',s.validate),s.catalog.validateRevision('maker',s.validate)]);
  assert.deepEqual(results[0],results[1]);
  await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'NEW_INPUT',jobId:s.file.job.id,expectedCurrentRevision:s.file.job.revisionId,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},Buffer.from(s.contract.definition.fields[0]!.code+'\n0099'));
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,requestId:randomUUID(),outputRequestId:randomUUID()}),/STALE_REVISION/);
  const historical=await s.catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:results[0]!.runId});assert.equal(historical.isCurrentRevision,false);
 }finally{await s.catalog.close();}
});
test('rejected structure, unavailable process key and expired source never become successful zero-row runs',async()=>{
 const s=await setup();try{
  const noKeys=await openCatalog();try{await assert.rejects(noKeys.validateRevision('maker',s.validate),/PROTECTED_OPERATION_FAILED/);}finally{await noKeys.close();}
  const file=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID()}},Buffer.from(s.contract.definition.fields[0]!.code+'\n INVALID'));
  const parsed=await s.catalog.parseFile('maker',{...s.parse,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId});
  await assert.rejects(s.catalog.validateRevision('maker',{...s.validate,jobId:file.job.id,revisionId:file.job.revisionId,artifactId:parsed.artifact.artifactId}),/STRUCTURAL_REJECTED/);
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.protected_artifact SET recorded_at='2019-01-01',expires_at='2020-01-01' WHERE id=${quote(s.file.artifact.artifactId)}::uuid; COMMIT;`);
  await assert.rejects(s.catalog.validateRevision('maker',s.validate),/PAYLOAD_UNAVAILABLE/);
 }finally{await s.catalog.close();}
});
test('result metadata tampering and generic encrypted reports cannot become trusted explanations or replays',async()=>{
 const s=await setup();try{
  const run=await s.catalog.validateRevision('maker',s.validate);
  const query={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,runId:run.runId};
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE governance_catalog.validation_run SET issue_count=1 WHERE id=${quote(run.runId)}::uuid; COMMIT;`);
  await assert.rejects(s.catalog.explainIssue('maker',query),/VALIDATION_PROVENANCE_REQUIRED/);
  // A forged outcome must fail the same verification on ACK replay.
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; UPDATE vnext_control.outcome SET result=jsonb_set(result,'{issueCount}','1') WHERE request_id=${quote(s.validate.requestId)}::uuid; COMMIT;`);
  await assert.rejects(s.catalog.validateRevision('maker',s.validate),/VALIDATION_PROVENANCE_REQUIRED/);
 }finally{await s.catalog.close();}
});
test('finite source rule is accepted by actual contract Owner but unresolved business reference still blocks publication',async()=>{
 const s=await setup();try{
  const draft=await s.catalog.command('maker',s.f.cmd('CREATE',{kind:'DATASET',code:'PER17',values:{name:'合成条件接线'},validFrom:'2026-01-01T00:00:00'}));
  const submitted=await s.catalog.command('maker',s.f.cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
  const dataset=await s.catalog.command('reviewer',s.f.cmd('PUBLISH',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
  const item=(await s.catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!;
  const fields=item.payload.fields!.filter(f=>['account_kind','person_id'].includes(f.original.code)).map(f=>({code:f.original.code,type:f.original.type,required:f.original.required,privacy:f.original.privacy,condition:f.original.required==='C'?'EVALUATED':'ALWAYS',enumValues:f.original.code==='account_kind'?['HUMAN','SERVICE']:[]}));
  const m=conditionMappings.find(m=>m.id==='SRC-COND-061')!;
  const definition={businessKey:['account_kind','person_id'],ruleVersion:'CONDITION_V1',templateVersion:'CONDITION_V1',sourceVersionId:s.contract.definition.sourceVersionId,fields,rules:[{id:m.id,field:m.field,text:m.text,status:'MACHINE',version:m.version}],references:item.payload.fields!.filter(f=>['account_kind','person_id'].includes(f.original.code)&&f.original.ref).map(f=>({field:f.original.code,target:f.original.ref,status:'BLOCKED_DEPENDENCY'})),codeSets:[{field:'account_kind',codeSystem:'SYNTHETIC_ACCOUNT',version:'V1',status:'SYNTHETIC_ADOPTED',codes:['HUMAN','SERVICE'],validFrom:'2026-01-01T00:00:00',validTo:null,sourceVersionId:s.contract.definition.sourceVersionId}]};
  const contract=await s.catalog.contractCommand('maker',s.f.cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition}));
  const validation=await s.catalog.contractCommand('maker',s.f.cmd('VALIDATE',{target:contract.id,expectedHead:contract.head}));
  assert.ok(validation.blockers.includes('REFERENCE_NOT_READY'));assert.ok(!validation.blockers.includes('UNRESOLVED_RULE'));assert.ok(!validation.blockers.includes('UNRESOLVED_REQUIRED_CONDITION'));
  await assert.rejects(s.catalog.contractCommand('reviewer',s.f.cmd('APPROVE',{target:contract.id,expectedHead:validation.head,reviewDigest:validation.reviewDigest})),/CONTRACT_VALIDATION_BLOCKED/);
  await assert.rejects(s.catalog.contractCommand('maker',s.f.cmd('REVISE',{target:contract.id,expectedHead:validation.head,validFrom:'2026-01-01T00:00:00',validTo:null,definition:{...definition,ruleVersion:'FORGED_V2',rules:[{...definition.rules[0],text:'CALLER_OVERRIDE'}]}})),/FINITE_RULE_REQUIRED/);
 }finally{await s.catalog.close();}
});
