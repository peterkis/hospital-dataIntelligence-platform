import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import * as owner from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {readFileSync} from 'node:fs';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));

test('P0-03 unknown adapter refuses execution and cross-job aliases cannot escape their revision', async () => {
  assert.throws(()=>owner.selectImportAdapter({dataset:'UNKNOWN',profile:'CORE',contractVersion:1}),/UNKNOWN_ADAPTER/);
  const context={jobId:randomUUID(),revisionId:randomUUID(),datasetId:randomUUID()};
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,jobId:randomUUID(),clientKey:'ROW_A'}),/CROSS_JOB_ALIAS/);
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,revisionId:randomUUID(),clientKey:'ROW_A'}),/CROSS_REVISION_ALIAS/);
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,datasetId:randomUUID(),clientKey:'ROW_A'}),/CROSS_DATASET_ALIAS/);
  owner.assertJobLocalAlias(context,{...context,clientKey:'ROW_A'});
  // Test-only adapter fixture is never registered as production READY.
  const testAdapter:owner.ImportAdapterBoundary={validate:async()=>({status:'NOT_READY'}),plan:async()=>({status:'NOT_READY'}),apply:async()=>{throw new Error('TEST_ONLY_NOT_READY');}};
  assert.deepEqual(await testAdapter.validate(context),{status:'NOT_READY'});
  assert.deepEqual(await testAdapter.plan(context),{status:'NOT_READY'});
  await assert.rejects(testAdapter.apply(context),/TEST_ONLY_NOT_READY/);
  for(const dataset of ['ORG01','ORG24','PER01']) for(const profile of ['CORE','FULL'] as const){
   assert.equal(owner.selectImportAdapter({dataset,profile,contractVersion:1}).capability,'NOT_READY');
   assert.throws(()=>owner.requireImportExecution({dataset,profile,contractVersion:1}),/ADAPTER_NOT_READY/);
  }
});

test('P0-03 concurrent requests have one logical outcome and only one same-head revision wins',async()=>{
 const catalog=await openCatalog();
 try{
  const {create}=await fixture(catalog);
  for(const invalid of [null,undefined,5,'raw',[],{}])await assert.rejects(catalog.importJobCommand('maker',invalid),/CLOSED_INPUT_REQUIRED/);
  const results=await Promise.all(Array.from({length:8},()=>catalog.importJobCommand('maker',create)));
  for(const result of results)assert.deepEqual(result,results[0]);
  const first=results[0]!;
  const revision={action:'REVISE',scope:'SYNTHETIC',reason:'SYNTHETIC_JOB',jobId:first.id,expectedCurrentRevision:first.revisionId,input:create.input};
  const raced=await Promise.allSettled([catalog.importJobCommand('maker',{...revision,requestId:randomUUID()}),catalog.importJobCommand('maker',{...revision,requestId:randomUUID()})]);
  assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
  const rejected=raced.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected');assert.match(String(rejected.reason),/STALE_REVISION/);
  assert.equal((await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:first.id})).revisions.length,2);
 }finally{await catalog.close();}
});

test('P0-03 closed metadata excludes raw inputs and scope/profile/submitter authorization is exact',async()=>{
 const catalog=await openCatalog();
 try{
  const {create}=await fixture(catalog);
  for(const raw of [{bytes:'abc'},{rows:[{legal_name:'SYNTHETIC'}]},{url:'https://invalid.example'},{path:'C:/input.csv'},{digestStatus:'VERIFIED'}]){
   await assert.rejects(catalog.importJobCommand('maker',{...create,input:{...create.input,...raw}}),/CLOSED_METADATA_REQUIRED/);
  }
  await assert.rejects(catalog.importJobCommand('maker',{...create,extra:[]}),/CLOSED_INPUT_REQUIRED/);
  await assert.rejects(catalog.importJobCommand('maker',{...create,profile:'FULL'}),/EXACT_CONTRACT_UNAVAILABLE/);
  await assert.rejects(catalog.importJobCommand('maker',{...create,scope:'BASELINE'}),/ACCESS_DENIED/);
  const job=await catalog.importJobCommand('maker',create);
  await assert.rejects(catalog.importJobRead('reviewer',{scope:'SYNTHETIC',jobId:job.id}),/ACCESS_DENIED/);
  await assert.rejects(catalog.importJobRead('maker',{scope:'BASELINE',jobId:job.id}),/NOT_FOUND/);
  await assert.rejects(catalog.importJobCommand('outsider',create),/ACCESS_DENIED/);
 }finally{await catalog.close();}
});

test('P0-03 retired exact contract rejects new jobs while historical binding and authorized replay survive',async()=>{
 const catalog=await openCatalog();
 try{
  const {create,contract,cmd}=await fixture(catalog);
  const job=await catalog.importJobCommand('maker',create);
  await catalog.contractCommand('reviewer',cmd('RETIRE',{target:contract.id,expectedHead:contract.head,reviewDigest:contract.reviewDigest}));
  await assert.rejects(catalog.importJobCommand('maker',{...create,requestId:randomUUID()}),/EXACT_CONTRACT_UNAVAILABLE/);
  assert.deepEqual(await catalog.importJobCommand('maker',create),job);
  assert.equal((await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:job.id})).contract.versionId,contract.versionId);
 }finally{await catalog.close();}
});

test('P0-03 current exact-object revocation precedes replay; audit failure rolls back every write', {skip:receipt.purpose!=='TEMPORARY_VALIDATION'},async()=>{
 const catalog=await openCatalog();
 try{
  const {create,dataset}=await fixture(catalog);
  const other=await fixture(catalog);
  const job=await catalog.importJobCommand('maker',create);
  peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE object_id=${quote(dataset.id)}::uuid AND actor_code='maker' AND permission='READ';`);
  await assert.rejects(catalog.importJobCommand('maker',create),/ACCESS_DENIED/);
  await assert.rejects(catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:job.id}),/ACCESS_DENIED/);
  // This fixture owns a fresh database; no current persistent authorization is mutated.
  const count=()=>peer(receipt.name,"SELECT json_build_array((SELECT count(*) FROM governance_catalog.import_job),(SELECT count(*) FROM governance_catalog.import_input_revision),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.request_identity),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.audit_chain))::text;");
  const before=count();
  peer(receipt.name,"CREATE FUNCTION governance_catalog.test_job_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'IMPORT_JOB_%' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_job_audit_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION governance_catalog.test_job_audit_failure();");
  try {await assert.rejects(catalog.importJobCommand('maker',other.create),/TEST_AUDIT_FAILURE/);assert.equal(count(),before);}
  finally {peer(receipt.name,'DROP TRIGGER test_job_audit_failure ON vnext_control.audit; DROP FUNCTION governance_catalog.test_job_audit_failure();');}
  const succeeded=await catalog.importJobCommand('maker',other.create);assert.ok(succeeded.id);
 }finally{await catalog.close();}
});

async function fixture(catalog:Awaited<ReturnType<typeof openCatalog>>) {
  const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_JOB',...extra});
  const publish=async(draft:Awaited<ReturnType<typeof catalog.command>>)=>{
    const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
    return catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));
  };
  const used=(await catalog.read('reviewer',{scope:'SYNTHETIC'})).items.filter(item=>item.kind==='DATASET').map(item=>item.code);
  const code=(await catalog.read('maker',{scope:'BASELINE'})).items.find(item=>item.kind==='DATASET'&&!used.includes(item.code))?.code;
  assert.ok(code,'a synthetic dataset fixture is available');
  const dataset=await publish(await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code,values:{name:'合成作业目录'},validFrom:'2026-01-01T00:00:00'})));
  const datasetItem=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===dataset.id)!;
  const field=datasetItem.payload.fields!.find(item=>item.original.required==='R')!.original;
  let source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.kind==='SOURCE'&&item.status==='PUBLISHED'&&item.validTo===null);
  const sourceVersion=source?.versionId??(await publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'JOB_SOURCE',values:{name:'合成作业来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})))).versionId;
  const draft=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition:{ruleVersion:'JOB_V1',templateVersion:'JOB_V1',sourceVersionId:sourceVersion,fields:[{code:field.code,type:field.type,required:'R',privacy:field.privacy,condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[]}}));
  const create={...cmd('CREATE'),contractId:draft.id,contractVersionId:draft.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}};
  await assert.rejects(catalog.importJobCommand('maker',create),/EXACT_CONTRACT_UNAVAILABLE/,'draft is never an execution contract');
  const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
  const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  return {create,contract,dataset,cmd};
}

test('P0-03 same identity request replays one job; changed payload conflicts; revisions are immutable',async()=>{
 const catalog=await openCatalog();
 try{
  const {create}=await fixture(catalog);
  const first=await catalog.importJobCommand('maker',create);
  assert.deepEqual(await catalog.importJobCommand('maker-alias',create),first);
  await assert.rejects(catalog.importJobCommand('maker',{...create,input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}}),/REQUEST_CONFLICT/);
  const read=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:first.id});
  assert.equal(read.revisions.length,1);assert.equal(read.revisions[0]?.digestStatus,'DECLARED');
  assert.equal(read.contract.versionId,create.contractVersionId);assert.ok(read.contract.schemas);
  const adapter=await catalog.importJobAdapter('maker',{scope:'SYNTHETIC',jobId:first.id});
  assert.equal(adapter.dataset,read.contract.dataset);assert.equal(adapter.profile,read.profile);assert.equal(adapter.capability,'NOT_READY');
  const revision={action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_JOB',jobId:first.id,expectedCurrentRevision:first.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}};
  const second=await catalog.importJobCommand('maker',revision);
  assert.deepEqual(await catalog.importJobCommand('maker',revision),second);
  const after=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:first.id});
  assert.deepEqual(after.revisions[0],read.revisions[0]);assert.equal(after.revisions[1]?.previousRevisionId,first.revisionId);
  assert.equal(after.revisions[1]?.number,'2');assert.equal(after.currentRevisionId,second.revisionId);
 }finally{await catalog.close();}
});

test('P0-03 exact unavailable contract cannot create a job', async () => {
  const catalog = await openCatalog();
  try {
    const baseline=await catalog.contractRead('maker',{scope:'BASELINE',mode:'CURRENT'});
    assert.equal(baseline.length,53);assert.ok(baseline.every(item=>item.status==='DRAFT'));
    await assert.rejects(catalog.importJobCommand('maker', {
      action:'CREATE', scope:'SYNTHETIC', requestId:randomUUID(), reason:'SYNTHETIC_JOB',
      contractId:randomUUID(), contractVersionId:randomUUID(), profile:'CORE',
      input:{kind:'METADATA_ONLY', declaredSha256:'a'.repeat(64)},
    }), /EXACT_CONTRACT_UNAVAILABLE/);
  } finally { await catalog.close(); }
});
