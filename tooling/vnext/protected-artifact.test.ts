import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog,LocalSyntheticKeyProvider,type ProtectedStoreInput,type ProtectedReadInput} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
const {peer,quote}=await import('./lineage.mjs');
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');
const raw=Buffer.from('SYNTHETIC_PRIVATE_VALUE_password_NEVER_LOG');
async function setup() {
 const keys=new LocalSyntheticKeyProvider();const catalog=await openCatalog(undefined,keys);
 try {
  const f=await fixture(catalog);const job=await catalog.importJobCommand('maker',f.create);
  const input:ProtectedStoreInput={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,kind:'RAW_CELL',retentionSeconds:3600};
  const grant=(actor='maker',permission='STORE')=>peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES(${quote(actor)},${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
  const ref=(artifactId:string):ProtectedReadInput=>({scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId});
  return {catalog,keys,f,job,input,grant,ref};
 } catch(error){await catalog.close();throw error;}
}
test('PR5: scope-denied and unknown-actor attempts retain the queried artifact or job in the audit',async()=>{
 const s=await setup();try{
  s.grant();const artifact=await s.catalog.storeProtectedArtifact('maker',s.input,raw);
  const auditedObject=(input:ProtectedReadInput|ProtectedStoreInput)=>peer(receipt.name,`SELECT object_id::text FROM vnext_control.audit WHERE content_digest=encode(sha256(convert_to(${quote(JSON.stringify(input))}::jsonb::text,'UTF8')),'hex') ORDER BY recorded_at DESC LIMIT 1;`);
  for(const actor of ['outsider','unregistered-synthetic']) {
   for(const artifactId of [artifact.artifactId,randomUUID()]) {
    for(const read of [s.catalog.authorizeSensitiveRead,s.catalog.readMasked,s.catalog.purgeOwnedExpiredArtifact]) {
     const input=s.ref(artifactId);
     await assert.rejects(read(actor,input),/^Error: ACCESS_DENIED$/);
     assert.equal(auditedObject(input),artifactId,'denial audit must identify the queried artifact, not the request');
    }
   }
   const input={...s.input,requestId:randomUUID()};
   await assert.rejects(s.catalog.storeProtectedArtifact(actor,input,raw),/^Error: ACCESS_DENIED$/);
   assert.equal(auditedObject(input),s.job.id,'denied storage must identify the referenced job');
  }
  assert.equal((await s.catalog.verifyAudit('auditor')).status,'PASS');
 }finally{await s.catalog.close();}
});
test('AC01: metadata read does not confer raw access; wrong purpose/campus/identity and revoked grants deny',async()=>{
 const s=await setup();try{
  await assert.rejects(s.catalog.storeProtectedArtifact('maker',s.input,raw),/ACCESS_DENIED/);
  s.grant();const a=await s.catalog.storeProtectedArtifact('maker',s.input,raw);const r=s.ref(a.artifactId);
  assert.equal(a.status,'QUARANTINED');assert.equal((await s.catalog.readMasked('maker',r)).masked,'[REDACTED]');
  await assert.rejects(s.catalog.authorizeSensitiveRead('maker',r),/ACCESS_DENIED/);
  s.grant('maker','READ');assert.deepEqual(await s.catalog.authorizeSensitiveRead('maker',r),raw);
  for(const wrong of [{...r,purpose:'CONTACT_VERIFY' as const},{...r,campus:'SOUTH' as const}])await assert.rejects(s.catalog.authorizeSensitiveRead('maker',wrong),/ACCESS_DENIED/);
  await assert.rejects(s.catalog.authorizeSensitiveRead('reviewer',r),/ACCESS_DENIED/);
  const metadata=JSON.stringify(await s.catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:s.job.id}));assert.ok(!metadata.includes('ciphertext')&&!metadata.includes(raw.toString())&&!metadata.includes(a.artifactId));
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE dataset_id=${quote(s.f.dataset.id)}::uuid AND permission='READ';`);
  await assert.rejects(s.catalog.authorizeSensitiveRead('maker',r),/ACCESS_DENIED/);
  const pool=new Pool({connectionString:process.env['VNEXT_DATABASE_URL']});try{
   for(const table of ['protected_artifact','protected_payload'])assert.equal((await pool.query(`SELECT * FROM governance_catalog.${table}`)).rowCount,0);
   await assert.rejects(pool.query('DELETE FROM governance_catalog.protected_payload'),/permission denied/);
  }finally{await pool.end();}
 }finally{await s.catalog.close();}
});
test('AC02/03: rotated payload keys preserve old bytes, missing keys and tampering fail closed',async()=>{
 const s=await setup();try{
  s.grant();s.grant('maker','READ');const a=await s.catalog.storeProtectedArtifact('maker',s.input,raw);s.keys.rotate();
  const b=await s.catalog.storeProtectedArtifact('maker',{...s.input,requestId:randomUUID(),kind:'RAW_FILE'},raw);
  for(const id of [a.artifactId,b.artifactId])assert.deepEqual(await s.catalog.authorizeSensitiveRead('maker',s.ref(id)),raw);
  const c=await s.catalog.storeProtectedArtifact('maker',{...s.input,requestId:randomUUID()},Buffer.from('OTHER_SYNTHETIC'));
  peer(receipt.name,`UPDATE governance_catalog.protected_payload p SET (key_id,nonce,tag,ciphertext)=(SELECT key_id,nonce,tag,ciphertext FROM governance_catalog.protected_payload WHERE artifact_id=${quote(c.artifactId)}::uuid) WHERE p.artifact_id=${quote(a.artifactId)}::uuid;`);
  await assert.rejects(s.catalog.authorizeSensitiveRead('maker',s.ref(a.artifactId)),/^Error: PROTECTED_OPERATION_FAILED$/);
  const failed=await openCatalog(undefined,{current(){throw new Error(raw.toString());},payload(){throw new Error(raw.toString());},lookup(){throw new Error(raw.toString());}});
  try{await assert.rejects(failed.authorizeSensitiveRead('maker',s.ref(a.artifactId)),/^Error: PROTECTED_OPERATION_FAILED$/);await assert.rejects(failed.storeProtectedArtifact('maker',{...s.input,requestId:randomUUID()},raw),/^Error: PROTECTED_OPERATION_FAILED$/);}finally{await failed.close();}
  peer(receipt.name,`UPDATE governance_catalog.protected_payload SET tag=decode(repeat('00',16),'hex') WHERE artifact_id=${quote(a.artifactId)}::uuid;`);
  await assert.rejects(s.catalog.authorizeSensitiveRead('maker',s.ref(a.artifactId)),/^Error: PROTECTED_OPERATION_FAILED$/);
 }finally{await s.catalog.close();}
});
test('AC04: retention uses database time; purge survives upstream revocation, removes payload only and retains audit',async()=>{
 const s=await setup();try{
  s.grant();s.grant('maker','READ');s.grant('maker','PURGE');const a=await s.catalog.storeProtectedArtifact('maker',{...s.input,retentionSeconds:1},raw);const r=s.ref(a.artifactId);
  await assert.rejects(s.catalog.purgeOwnedExpiredArtifact('maker',r),/RETENTION_NOT_EXPIRED/);
  // Advance actual DB wall time; never accept caller-supplied purge time or mutate expiry evidence.
  peer(receipt.name,'SELECT pg_sleep(1.1);');
  await assert.rejects(s.catalog.authorizeSensitiveRead('maker',r),/PAYLOAD_UNAVAILABLE/);
  peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE object_id=${quote(s.f.dataset.id)}::uuid AND actor_code='maker';`);
  const purged=await s.catalog.purgeOwnedExpiredArtifact('maker',r);assert.equal(purged.purged,true);assert.deepEqual(await s.catalog.purgeOwnedExpiredArtifact('maker',r),purged);
  assert.equal(peer(receipt.name,`SELECT count(*) FROM governance_catalog.protected_payload WHERE artifact_id=${quote(a.artifactId)}::uuid;`),'0');
  assert.equal(peer(receipt.name,`SELECT count(*) FROM governance_catalog.protected_artifact WHERE id=${quote(a.artifactId)}::uuid;`),'1');
  assert.ok(Number(peer(receipt.name,`SELECT count(*) FROM vnext_control.audit WHERE object_id=${quote(a.artifactId)}::uuid;`))>=4);
  assert.equal((await s.catalog.verifyAudit('auditor')).status,'PASS');
 }finally{await s.catalog.close();}
});
test('AC05: closed input and safe failures; no plaintext or ordinary raw SHA in metadata, outcome, audit or payload',async()=>{
 const s=await setup();try{
  s.grant();const a=await s.catalog.storeProtectedArtifact('maker',s.input,raw);
  await assert.rejects(s.catalog.storeProtectedArtifact('maker',{...s.input,...{filename:raw.toString()}},raw),/CLOSED_INPUT_REQUIRED/);
  const tables=['governance_catalog.import_job','governance_catalog.import_input_revision','governance_catalog.protected_artifact','governance_catalog.protected_payload','vnext_control.outcome','vnext_control.audit','vnext_control.audit_chain'];
  for(const table of tables){const serialized=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]')::text FROM ${table} t;`);assert.ok(!serialized.includes(raw.toString())&&!serialized.includes(createHash('sha256').update(raw).digest('hex')));}
  assert.equal((await s.catalog.readMasked('maker',s.ref(a.artifactId))).status,'QUARANTINED');
 }finally{await s.catalog.close();}
});
test('atomic replay, concurrent stores, cross revision, current authorization and audit rollback',async()=>{
 const s=await setup();try{
  s.grant();s.grant('maker-alias');s.grant('maker','READ');const results=await Promise.all(Array.from({length:4},()=>s.catalog.storeProtectedArtifact('maker',s.input,raw)));
  for(const result of results)assert.deepEqual(result,results[0]);assert.deepEqual(await s.catalog.storeProtectedArtifact('maker-alias',s.input,raw),results[0]);
  const reordered:ProtectedStoreInput={retentionSeconds:s.input.retentionSeconds,kind:s.input.kind,revisionId:s.input.revisionId,jobId:s.input.jobId,requestId:s.input.requestId,purpose:s.input.purpose,campus:s.input.campus,scope:s.input.scope};
  assert.deepEqual(await s.catalog.storeProtectedArtifact('maker',reordered,raw),results[0]);
  await assert.rejects(s.catalog.storeProtectedArtifact('maker',s.input,Buffer.from('different')),/REQUEST_CONFLICT/);
  await assert.rejects(s.catalog.storeProtectedArtifact('maker',{...s.input,requestId:randomUUID(),revisionId:randomUUID()},raw),/STALE_REVISION/);
  const count=()=>peer(receipt.name,"SELECT json_build_array((SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM governance_catalog.protected_payload),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.audit),(SELECT count(*) FROM vnext_control.request_identity))::text;");const before=count();
  peer(receipt.name,"CREATE FUNCTION governance_catalog.test_protected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'PROTECTED_%' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_protected_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION governance_catalog.test_protected_failure();");
  try{await assert.rejects(s.catalog.storeProtectedArtifact('maker',{...s.input,requestId:randomUUID()},raw),/PROTECTED_OPERATION_FAILED/);assert.equal(count(),before);
   await assert.rejects(s.catalog.authorizeSensitiveRead('maker',s.ref(results[0]!.artifactId)),/PROTECTED_OPERATION_FAILED/);assert.equal(count(),before);
  }finally{peer(receipt.name,'DROP TRIGGER test_protected_failure ON vnext_control.audit; DROP FUNCTION governance_catalog.test_protected_failure();');}
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE dataset_id=${quote(s.f.dataset.id)}::uuid AND actor_code='maker';`);
  await assert.rejects(s.catalog.storeProtectedArtifact('maker',s.input,raw),/ACCESS_DENIED/);
 }finally{await s.catalog.close();}
});
