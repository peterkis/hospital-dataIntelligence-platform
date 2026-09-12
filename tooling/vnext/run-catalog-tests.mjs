import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { root, migrate, resolveTarget } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';

const owned = createTemporary();
try {
  await migrate(owned.receipt);
  await seed(owned.receipt);
  const result=spawnSync(process.execPath,['--import','tsx','--test','tooling/vnext/catalog.integration.test.ts'],{
    cwd:root, env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath},stdio:'inherit',windowsHide:true,
  });
  if(result.status!==0) process.exitCode=1;
} finally { dropTemporary(owned.receipt); }
