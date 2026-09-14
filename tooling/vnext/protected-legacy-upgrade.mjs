import assert from 'node:assert/strict';
import {createCipheriv,createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {migrate,migrationFiles,peer,quote,resolveTarget,inspect} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';

// Simulate the two vulnerable historical application orderings, not the fixed TS entry.
export async function validateLegacyUpgradeFence() {
 const owned=createTemporary('P0-11');
 try {
  await migrate(owned.receipt,migrationFiles().slice(0,24));await seed(owned.receipt);
  const keys=new LocalSyntheticKeyProvider();const catalog=await openCatalog(resolveTarget(owned.receipt),keys);
  const pool=new Pool({connectionString:resolveTarget(owned.receipt)});
  try {
   const f=await fixture(catalog);
   peer(owned.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','STORE'),('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
   for(const beforeStore of [true,false]) {
    const bytes=Buffer.from('SYNTHETIC_LEGACY_CONFLICT');const plainHash=createHash('sha256').update(bytes).digest('hex');
    const job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID(),input:{kind:'METADATA_ONLY',declaredSha256:beforeStore?plainHash:'a'.repeat(64)}});
    const input={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,kind:'RAW_CELL',retentionSeconds:3600};
    const {id,key}=keys.current();const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([input.jobId,input.revisionId,input.kind,input.campus,input.purpose,input.requestId])));
    const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
    const envelope={keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};
    const digest=createHmac('sha256',keys.lookup()).update(input.requestId).update(bytes).digest('hex');
    const artifact=(await pool.query("select governance_catalog.protected_command($1,'STORE',$2::jsonb,$3::jsonb,$4) as result",['maker',JSON.stringify(input),JSON.stringify(envelope),digest])).rows[0].result;
    assert.ok(artifact.artifactId);
    if(!beforeStore)await catalog.importJobCommand('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_JOB',jobId:job.id,expectedCurrentRevision:job.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:plainHash}});
    const history=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:job.id});
    assert.ok(history.revisions.some(revision=>revision.input.declaredSha256===plainHash));
    assert.deepEqual(await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:artifact.artifactId}),bytes);
   }
  } finally {await pool.end();await catalog.close();}
  await migrate(owned.receipt,migrationFiles().slice(0,25));
  const snapshot=()=>peer(owned.receipt.name,`SELECT jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM governance_catalog.protected_artifact t),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.artifact_id) FROM governance_catalog.protected_payload t),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM governance_catalog.import_input_revision t),
   (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vnext_control.audit t))::text;`);
  const before=snapshot();
  await assert.rejects(migrate(owned.receipt),/PROTECTED_LEGACY_SCAN_REQUIRED/);
  assert.equal((await inspect(owned.receipt)).ledger.length,25);
  assert.equal(snapshot(),before,'failed upgrade must retain original metadata, ciphertext and audit');
  console.log(JSON.stringify({gate:'PREFIX_25_LEGACY_CONFLICTS_BLOCK_UPGRADE',fixtures:2,status:'PASS'}));
 }finally{dropTemporary(owned.receipt);}
}
