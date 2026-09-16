import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog,LocalSyntheticKeyProvider,type ReceiveFileInput,type ParseFileInput} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {textWorkbook} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import type {ParserResult} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {fixture} from './protected-fixture.js';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');
test('Vitest setup blocks a non-receipt connection before database access',async()=>{
 const pool=new Pool({database:'synthetic_non_receipt_probe'});
 try{assert.throws(()=>pool.connect(),/NON_RECEIPT_CONNECTION_FORBIDDEN/);}finally{await pool.end();}
});
async function setup() {
 const keys=new LocalSyntheticKeyProvider(),catalog=await openCatalog(undefined,keys);
 try {
  const f=await fixture(catalog),field=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0]!.definition.fields[0]!.code;
  const grant=(permission:string)=>peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const input:ReceiveFileInput={campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'FILE_RECEIVE',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}};
  const parseInput=(jobId:string,revisionId:string,artifactId:string):ParseFileInput=>({scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId,revisionId,artifactId});
  const read=async(artifactId:string)=>catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId});
  return {keys,catalog,f,field,grant,input,parseInput,read};
 }catch(e){await catalog.close();throw e;}
}
test('PR6: public metadata command cannot commit a FILE revision without intake',async()=>{
 const s=await setup();try{await assert.rejects(s.catalog.importJobCommand('maker',s.input.job),/FILE_RECEIVE_REQUIRED/);}finally{await s.catalog.close();}
});
test('PR6 round23: digest kind/status pairs remain constrained with triggers disabled',async()=>{
 const s=await setup();try{
  s.grant('STORE');const file=await s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0012`));
  const id=quote(file.job.revisionId);
  for(const assignment of ["digest_status='DECLARED'","metadata='{}'::jsonb","metadata=jsonb_build_object('kind','METADATA_ONLY')"]){
   peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; DO $$ BEGIN BEGIN UPDATE governance_catalog.import_input_revision SET ${assignment} WHERE id=${id}::uuid; RAISE EXCEPTION 'EXPECTED_DECLARATIVE_CHECK'; EXCEPTION WHEN check_violation THEN NULL; END; END $$; ROLLBACK;`);
  }
 }finally{await s.catalog.close();}
});
test('PR6 round23: RAW_FILE uniqueness survives trigger bypass',async()=>{
 const s=await setup();try{
  s.grant('STORE');const file=await s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0012`));
  peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; DO $$ BEGIN BEGIN INSERT INTO governance_catalog.protected_artifact(job_id,revision_id,request_id,campus,purpose,kind,expires_at) SELECT job_id,revision_id,uuidv7(),campus,purpose,kind,expires_at FROM governance_catalog.protected_artifact WHERE id=${quote(file.artifact.artifactId)}::uuid; RAISE EXCEPTION 'EXPECTED_DECLARATIVE_UNIQUE'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$; ROLLBACK;`);
 }finally{await s.catalog.close();}
});
test('PR6 round24: complete metadata variants remain declaratively closed',async()=>{
 const s=await setup();try{
  s.grant('STORE');const file=await s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0012`));
  for(const metadata of [{kind:'FILE'},{kind:'FILE',format:'OTHER',parserPolicy:'STRICT_V1'},{kind:'FILE',format:'CSV',parserPolicy:'OTHER'},{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1',extra:true},{kind:'METADATA_ONLY',declaredSha256:'bad'},{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64),extra:true}]){
   const status=metadata.kind==='FILE'?'PROTECTED_REFERENCE':'DECLARED';
   peer(receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; DO $$ BEGIN BEGIN UPDATE governance_catalog.import_input_revision SET metadata=${quote(JSON.stringify(metadata))}::jsonb,digest_status=${quote(status)} WHERE id=${quote(file.job.revisionId)}::uuid; RAISE EXCEPTION 'EXPECTED_METADATA_SHAPE_CHECK'; EXCEPTION WHEN check_violation THEN NULL; END; END $$; ROLLBACK;`);
  }
 }finally{await s.catalog.close();}
});
test('PR6: deferred database invariant rejects an orphan FILE revision and rolls back outcome',async()=>{
 const s=await setup();const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});try{
  const before=peer(receipt.name,'SELECT count(*) FROM governance_catalog.import_input_revision;');
  await assert.rejects(pool.query('SELECT governance_catalog.import_job_command($1,$2::jsonb)',['maker',JSON.stringify(s.input.job)]),/FILE_ORIGINAL_REQUIRED/);
  assert.equal(peer(receipt.name,'SELECT count(*) FROM governance_catalog.import_input_revision;'),before);
 }finally{await pool.end();await s.catalog.close();}
});
test('review: changed file request cannot attach another raw file to an existing FILE revision',async()=>{
 const s=await setup();try{s.grant('STORE');await s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0012`));
  await assert.rejects(s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID()},Buffer.from(`${s.field}\n0099`)),/REQUEST_CONFLICT/);
 }finally{await s.catalog.close();}
});
test('review: failed atomic receive retains separate minimal denial audit after rolling back job',async()=>{
 const s=await setup();try{
  const auditCount=()=>Number(peer(receipt.name,"SELECT count(*) FROM vnext_control.audit WHERE action LIKE '%DENIED%';"));const before=auditCount();
  await assert.rejects(s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0012`)),/ACCESS_DENIED/);
  assert.equal(auditCount(),before+1);
 }finally{await s.catalog.close();}
});
test('three actual owner paths persist protected canonical evidence, same semantic rows, no ordinary SHA/value',async()=>{
 const s=await setup();try{
  s.grant('STORE');s.grant('READ');const rows=[];
  for(const format of ['CSV','JSON','XLSX'] as const){
   const input:ReceiveFileInput={...s.input,extension:format==='CSV'?'.csv':format==='JSON'?'.json':'.xlsx',fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID(),input:{kind:'FILE',format,parserPolicy:'STRICT_V1'}}};
   const raw=format==='CSV'?Buffer.from(`${s.field}\n0012`):format==='JSON'?Buffer.from(JSON.stringify([{[s.field]:'0012'}])):textWorkbook([[s.field],['0012']]);
   const file=await s.catalog.receiveFile('maker',input,raw);assert.equal(file.job.digestStatus,'PROTECTED_REFERENCE');
   assert.deepEqual(await s.catalog.receiveFile('maker',input,raw),file,'ACK replay returns same file/revision');
   const parsed=await s.catalog.parseFile('maker',s.parseInput(file.job.id,file.job.revisionId,file.artifact.artifactId));assert.equal(parsed.structuralStatus,'PARSED');assert.equal(parsed.adapterReadiness,'NOT_READY');assert.equal(parsed.artifact.status,'QUARANTINED');
   const saved:{result:ParserResult}=JSON.parse(Buffer.from(await s.read(parsed.artifact.artifactId)).toString());rows.push(saved.result.rows);
   const ordinary=JSON.stringify(await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:file.job.id}));assert.ok(!ordinary.includes('0012'));assert.ok(!ordinary.includes('declaredSha256'));
  }
  assert.deepEqual(rows[0],rows[1]);assert.deepEqual(rows[1],rows[2]);assert.equal((await s.catalog.verifyAudit('auditor')).status,'PASS');
 }finally{await s.catalog.close();}
});
test('receive rolls revision back on missing STORE, replay byte conflict; parser requires independent raw access and exact revision/artifact',async()=>{
 const s=await setup();try{
  const count=()=>peer(receipt.name,'SELECT count(*) FROM governance_catalog.import_job;');const before=count();const raw=Buffer.from(`${s.field}\n0012`);
  await assert.rejects(s.catalog.receiveFile('maker',s.input,raw),/ACCESS_DENIED/);assert.equal(count(),before);
  s.grant('STORE');const file=await s.catalog.receiveFile('maker',s.input,raw);
  await assert.rejects(s.catalog.receiveFile('maker',s.input,Buffer.from(`${s.field}\n0099`)),/REQUEST_CONFLICT/);
  const input=s.parseInput(file.job.id,file.job.revisionId,file.artifact.artifactId);
  await assert.rejects(s.catalog.parseFile('maker',input),/ACCESS_DENIED/);s.grant('READ');
  await assert.rejects(s.catalog.parseFile('maker',{...input,campus:'SOUTH'}),/ACCESS_DENIED/);
  const second=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{...s.input.job,requestId:randomUUID()}},raw);
  await assert.rejects(s.catalog.parseFile('maker',{...input,artifactId:second.artifact.artifactId,requestId:randomUUID()}),/ACCESS_DENIED/);
  const revision=await s.catalog.receiveFile('maker',{...s.input,fileRequestId:randomUUID(),job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'FILE_REPLACE',jobId:file.job.id,expectedCurrentRevision:file.job.revisionId,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}},raw);
  assert.notEqual(revision.job.revisionId,file.job.revisionId);await assert.rejects(s.catalog.parseFile('maker',input),/STALE_REVISION/);
  const noKeys=await openCatalog();try{await assert.rejects(noKeys.parseFile('maker',s.parseInput(revision.job.id,revision.job.revisionId,revision.artifact.artifactId)),/PROTECTED_OPERATION_FAILED/);}finally{await noKeys.close();}
 }finally{await s.catalog.close();}
});
test('malformed input preserves original bytes and protected issue export without exposing values in API or audit',async()=>{
 const s=await setup();try{
  s.grant('STORE');s.grant('READ');const raw=Buffer.from(`\uFEFF${s.field}\n =SYNTHETIC_PRIVATE_SENTINEL`);
  const file=await s.catalog.receiveFile('maker',s.input,raw),input=s.parseInput(file.job.id,file.job.revisionId,file.artifact.artifactId);
  const {inspectEnvelope}=s.catalog;
  const parsed=await inspectEnvelope('maker',input);assert.equal(parsed.structuralStatus,'REJECTED');assert.deepEqual(Buffer.from(await s.read(file.artifact.artifactId)),raw);
  assert.ok(!JSON.stringify(parsed).includes('SYNTHETIC_PRIVATE_SENTINEL'));
  const report=await s.catalog.exportIssueWorkbook('maker',s.parseInput(file.job.id,file.job.revisionId,parsed.artifact.artifactId));assert.equal(report.status,'QUARANTINED');
  const reportBytes=await s.read(report.artifactId);assert.equal(Buffer.from(reportBytes).readUInt32LE(0),0x04034b50);
  const audit=peer(receipt.name,'SELECT coalesce(jsonb_agg(to_jsonb(t))::text,\'[]\') FROM vnext_control.audit t;');assert.ok(!audit.includes('SYNTHETIC_PRIVATE_SENTINEL'));
  const readRef={scope:'SYNTHETIC' as const,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const,artifactId:parsed.artifact.artifactId,requestId:randomUUID()};
  s.keys.rotate();assert.ok((await s.catalog.authorizeSensitiveRead('maker',readRef)).length>0);
 }finally{await s.catalog.close();}
});

test('PR8 public receive snapshots submitted bytes before transaction acquisition',async()=>{
 const s=await setup();try{
  s.grant('STORE');s.grant('READ');
  const bytes=Buffer.from(`${s.field}\nORIGINAL_FILE`),expected=Buffer.from(bytes);
  const pending=s.catalog.receiveFile('maker',s.input,bytes);
  bytes.fill(0);
  const received=await pending;
  assert.deepEqual(Buffer.from(await s.read(received.artifact.artifactId)),expected);
  assert.deepEqual(await s.catalog.receiveFile('maker',s.input,expected),received);
 }finally{await s.catalog.close();}
});
