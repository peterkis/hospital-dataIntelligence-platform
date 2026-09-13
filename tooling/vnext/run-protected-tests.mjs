import {spawnSync} from 'node:child_process';
import {resolveTarget,root,migrate,migrationFiles,peer,quote} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
const owned=createTemporary('P0-11');
try {
 let before; let originalJob; let jobId; let originalArtifact; let originalEvidence;
 const keys=new LocalSyntheticKeyProvider();
 const protectedEvidence=()=>peer(owned.receipt.name,`SELECT jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM governance_catalog.protected_artifact t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.artifact_id) FROM governance_catalog.protected_payload t),
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM vnext_control.audit t))::text;`);
 const baseline=()=>peer(owned.receipt.name,`SELECT governance_catalog.contract_read('maker','{"scope":"BASELINE","mode":"CURRENT"}'::jsonb)::text;`);
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,23));await seed(owned.receipt);before=baseline();
  const catalog=await openCatalog(resolveTarget(owned.receipt),keys);
  try {
   const f=await fixture(catalog);const job=await catalog.importJobCommand('maker',f.create);jobId=job.id;originalJob=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId});
   peer(owned.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','STORE'),('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);
   originalArtifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),jobId,revisionId:job.revisionId,kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('SYNTHETIC_UPGRADE'));
   originalEvidence=protectedEvidence();
  }finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.equal(baseline(),before);console.log(JSON.stringify({gate:'PREFIX_23_PRESERVES_CONTRACTS',status:'PASS'}));}
 if(originalJob){const catalog=await openCatalog(resolveTarget(owned.receipt),keys);try{
  assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId}),originalJob);
  assert.equal(protectedEvidence(),originalEvidence);
  assert.deepEqual(await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:originalArtifact.artifactId}),Buffer.from('SYNTHETIC_UPGRADE'));
  assert.equal((await catalog.verifyAudit('auditor')).status,'PASS');
  console.log(JSON.stringify({gate:'PREFIX_23_PRESERVES_JOB_PAYLOAD_AUDIT',status:'PASS'}));
 }finally{await catalog.close();}}
 const run=spawnSync(process.execPath,['--import','./tooling/vnext/connection-guard.mjs','--import','tsx','--test','tooling/vnext/protected-artifact.test.ts'],{
  cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-11-PROTECTED'},stdio:'inherit',windowsHide:true,
 });
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-11',mode:before?'PREFIX_23':'FRESH',exit:run.status,oid:owned.receipt.oid}));
}finally{dropTemporary(owned.receipt);}
