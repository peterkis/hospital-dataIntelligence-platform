import { spawnSync } from 'node:child_process';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { migrate, resolveTarget, root, migrationFiles } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';

const owned = createTemporary('P0-02');
try {
  if(process.argv.includes('--upgrade')){
    await migrate(owned.receipt,migrationFiles().slice(0,11));
    await seed(owned.receipt);
  }
  await migrate(owned.receipt);
  await seed(owned.receipt);
  if(process.argv.includes('--types')){
    const generated=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{cwd:root,env:{...process.env,VNEXT_TEST_RECEIPT:owned.receiptPath,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${new URL('./connection-guard.mjs',import.meta.url).href}`},stdio:'inherit',windowsHide:true});
    if(generated.status!==0)throw new Error('CONTRACT_CODEGEN_FAILED');
  }
  const run = spawnSync(process.execPath, ['--import', './tooling/vnext/connection-guard.mjs', '--import', 'tsx', '--test', 'tooling/vnext/contract-registry.test.ts'], {
    cwd: root, env: { ...process.env, VNEXT_DATABASE_URL: resolveTarget(owned.receipt), VNEXT_TEST_RECEIPT: owned.receiptPath },
    stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = run.status ?? 1;
  console.log(JSON.stringify({gate:'P0-02-CONTRACTS',mode:process.argv.includes('--upgrade')?'PREFIX_11_TO_CURRENT':'FRESH',exit:run.status,receipt:owned.receiptPath}));
} finally { dropTemporary(owned.receipt); }
