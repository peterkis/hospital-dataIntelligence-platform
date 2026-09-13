import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { migrate, resolveTarget, root, migrationFiles, peer } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';

const owned = createTemporary('P0-02');
try {
  const contractPrefix=process.argv.includes('--contract-prefix');
  let existingHistory;
  const readExisting=()=>peer(owned.receipt.name,`SELECT governance_catalog.contract_read('maker','{"scope":"BASELINE","mode":"CURRENT"}'::jsonb)::text;`);
  if(process.argv.includes('--upgrade')||contractPrefix){
    await migrate(owned.receipt,migrationFiles().slice(0,contractPrefix?18:11));
    await seed(owned.receipt);
    if(contractPrefix)existingHistory=readExisting();
  }
  await migrate(owned.receipt);
  await seed(owned.receipt);
  if(contractPrefix){assert.equal(readExisting(),existingHistory,'existing contract tokens, schemas and metadata survive stream migration');console.log(JSON.stringify({gate:'EXISTING_CONTRACT_STREAM_UPGRADE',status:'PASS',prefix:18}));}
  if(process.argv.includes('--types')){
    const generated=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{cwd:root,env:{...process.env,VNEXT_TEST_RECEIPT:owned.receiptPath,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${new URL('./connection-guard.mjs',import.meta.url).href}`},stdio:'inherit',windowsHide:true});
    if(generated.status!==0)throw new Error('CONTRACT_CODEGEN_FAILED');
  }
  const run = spawnSync(process.execPath, ['--import', './tooling/vnext/connection-guard.mjs', '--import', 'tsx', '--test', 'tooling/vnext/contract-registry.test.ts'], {
    cwd: root, env: { ...process.env, VNEXT_DATABASE_URL: resolveTarget(owned.receipt), VNEXT_TEST_RECEIPT: owned.receiptPath },
    stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = run.status ?? 1;
  console.log(JSON.stringify({gate:'P0-02-CONTRACTS',mode:contractPrefix?'PREFIX_18_TO_CURRENT':process.argv.includes('--upgrade')?'PREFIX_11_TO_CURRENT':'FRESH',exit:run.status,receipt:owned.receiptPath}));
} finally { dropTemporary(owned.receipt); }
