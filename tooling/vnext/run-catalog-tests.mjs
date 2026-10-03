import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { root, migrate, resolveTarget,readReceipt } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';

const args=process.argv.slice(2);
if(args[0]==='--dispose-owned') {
 if(args.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
 const receipt=readReceipt(args[1]);
 if(receipt.taskId!=='P0-01'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 dropTemporary(receipt);process.exit(0);
}
if(args.length)throw new Error('CLOSED_COMMAND_REQUIRED');
const owned = createTemporary();
try {
  await migrate(owned.receipt);
  await seed(owned.receipt);
  const result=spawnSync(process.execPath,['--import','tsx','--test','tooling/vnext/catalog.integration.test.ts'],{
    cwd:root, env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath},stdio:'inherit',windowsHide:true,
  });
  if(result.status!==0) process.exitCode=1;
} finally { dropTemporary(owned.receipt); }
