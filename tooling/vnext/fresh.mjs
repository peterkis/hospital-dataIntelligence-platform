import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { saveExclusiveReceipt, localReceiptTime } from './receipt.mjs';
import { peer, quote, root, identitySQL, migrate, migrationFiles, inspect,resolveTarget } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';

export function createTemporary(taskId='P0-01') {
  if(!['P0-01','P0-02','P0-03','P0-04','P0-05','P0-06','P0-07','P0-08','P0-09','P0-10','P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07','P2-01','P2-02','P0-11'].includes(taskId))throw new Error('TEMPORARY_TASK_INVALID');
  const name = 'hdi_mc_vnext_' + randomUUID().replaceAll('-', '').slice(0, 16);
  const receiptPath = resolve(root, '.runtime/vnext/fresh', name + '.json');
  const intent = { taskId, purpose:'TEMPORARY_VALIDATION', lineage:'HDIP-MC-VNEXT', name, owner:'hdi_prototype', distro:'Anolis-8.9-HDI-POC', port:55434, requestId:randomUUID(), recordedAt:localReceiptTime() };
  saveExclusiveReceipt(receiptPath + '.intent', intent);
  peer('postgres', `CREATE DATABASE ${name} OWNER hdi_prototype TEMPLATE template0;`);
  const oid = peer('postgres', `SELECT oid::text FROM pg_database WHERE datname=${quote(name)} AND pg_get_userbyid(datdba)='hdi_prototype';`);
  const receipt = { ...intent, oid };
  saveExclusiveReceipt(receiptPath, receipt);
  return { receipt, receiptPath };
}
export function dropTemporary(receipt,transport={}) {
  const resolveReceipt=transport.resolveTarget??resolveTarget,execute=transport.peer??peer;
  resolveReceipt(receipt);
  if (!['P0-01','P0-02','P0-03','P0-04','P0-05','P0-06','P0-07','P0-08','P0-09','P0-10','P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07','P2-01','P2-02','P0-11'].includes(receipt.taskId) || receipt.purpose!=='TEMPORARY_VALIDATION' || !/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(receipt.name)) throw new Error('DISPOSAL_NOT_AUTHORIZED');
  const path=resolve(root,'.runtime/vnext/fresh',receipt.name+'.json');
  const persisted=JSON.parse(readFileSync(path,'utf8'));
  const intent=JSON.parse(readFileSync(path+'.intent','utf8'));
  if(JSON.stringify(persisted)!==JSON.stringify(receipt)||intent.requestId!==receipt.requestId||intent.name!==receipt.name||intent.owner!==receipt.owner)throw new Error('DISPOSAL_NOT_AUTHORIZED');
  execute(receipt.name, identitySQL(receipt));
  const sessions = execute('postgres', `SELECT count(*) FROM pg_stat_activity WHERE datname=${quote(receipt.name)};`);
  if (sessions !== '0') throw new Error('UNRELATED_SESSIONS_PRESENT');
  execute('postgres', `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=${quote(receipt.name)} AND oid::text=${quote(receipt.oid)} AND pg_get_userbyid(datdba)=${quote(receipt.owner)}) THEN RAISE EXCEPTION 'RECEIPT_IDENTITY_MISMATCH'; END IF; END $$;\nDROP DATABASE ${receipt.name};`);
  saveExclusiveReceipt(resolve(root, '.runtime/vnext/fresh', receipt.name + '.disposed.json'), { name:receipt.name, oid:receipt.oid, disposed:true, time:localReceiptTime() });
}
export async function freshValidation(prefix = false) {
  const owned = createTemporary();
  try {
    const files = migrationFiles();
    if (prefix) {
      await migrate(owned.receipt, files.slice(0, 1));
      peer(owned.receipt.name,"INSERT INTO vnext_control.actor(code,identity_code,active) VALUES ('prefix-marker','SYNTHETIC_PREFIX',true);");
    }
    await migrate(owned.receipt);
    await migrate(owned.receipt);
    await seed(owned.receipt);
    await seed(owned.receipt);
    if (process.argv.includes('--types')) {
      const generated = spawnSync(process.execPath, [resolve(root,'tooling/vnext/managed.mjs'),'types-generate',owned.receiptPath], {env:process.env,encoding:'utf8',windowsHide:true});
      if(generated.status!==0) throw new Error('FRESH_CODEGEN_FAILED');
    }
    if(prefix && peer(owned.receipt.name,"SELECT count(*) FROM vnext_control.actor WHERE code='prefix-marker';")!=='1') throw new Error('PREFIX_DATA_LOST');
    console.log(JSON.stringify({ status:'PASS', mode:prefix?'UPGRADE':'FRESH', receipt:owned.receipt, observation:await inspect(owned.receipt) }));
  } finally { dropTemporary(owned.receipt); }
}
if (process.argv[1] === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1').replaceAll('/', '\\') || process.argv[1]?.replaceAll('\\','/') === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1')) {
  try { await freshValidation(process.argv.includes('--upgrade')); }
  catch(error) { console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z][A-Z0-9_]+$/u.test(error.message)?error.message:'FRESH_FAILED'})); process.exitCode=1; }
}
