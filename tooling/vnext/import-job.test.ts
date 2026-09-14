import {fixture} from './protected-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import * as owner from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {readFileSync} from 'node:fs';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(receipt.purpose,'TEMPORARY_VALIDATION','mutating suite requires a disposable receipt');

test('job contract and version must belong to the same contract at the database boundary',async()=>{
 assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');
 const catalog=await openCatalog();
 try{
  const first=await fixture(catalog);const second=await fixture(catalog);
  const job=await catalog.importJobCommand('maker',first.create);
  assert.throws(()=>peer(receipt.name,`BEGIN; UPDATE governance_catalog.import_job SET contract_version_id=${quote(second.contract.versionId)}::uuid WHERE id=${quote(job.id)}::uuid; ROLLBACK;`),/VNEXT_ADMIN_COMMAND_FAILED/);
  assert.match(readFileSync('.runtime/vnext/last-admin-error.log','utf8'),/import_job_contract_version_pair/);
 }finally{await catalog.close();}
});

test('P0-03 unknown adapter refuses execution and cross-job aliases cannot escape their revision', async () => {
  assert.throws(()=>owner.selectImportAdapter({dataset:'UNKNOWN',profile:'CORE',contractVersion:1}),/UNKNOWN_ADAPTER/);
  const context={jobId:randomUUID(),revisionId:randomUUID(),datasetId:randomUUID()};
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,jobId:randomUUID(),clientKey:'ROW_A'}),/CROSS_JOB_ALIAS/);
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,revisionId:randomUUID(),clientKey:'ROW_A'}),/CROSS_REVISION_ALIAS/);
  assert.throws(()=>owner.assertJobLocalAlias(context,{...context,datasetId:randomUUID(),clientKey:'ROW_A'}),/CROSS_DATASET_ALIAS/);
  owner.assertJobLocalAlias(context,{...context,clientKey:'ROW_A'});
  for(const dataset of ['ORG01','ORG24','PER01']) for(const profile of ['CORE','FULL'] as const){
   assert.equal(owner.selectImportAdapter({dataset,profile,contractVersion:1}).capability,'NOT_READY');
   for(const stage of ['validate','plan','apply'] as const)assert.throws(()=>owner.requireImportExecution({dataset,profile,contractVersion:1},stage),/ADAPTER_NOT_READY/);
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
