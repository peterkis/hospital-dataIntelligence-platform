import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { createValidationOwnerSession, dropValidationOwnerSession } from './validation-owner-session.mjs';
import { migrate, migrationFiles, resolveTarget } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { grantDepartment } from './p2-01-validate.mjs';
import { peer } from './lineage.mjs';

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/p2-02-validate.mjs')) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--upgrade'].includes(arg))) throw new Error('CLOSED_COMMAND_REQUIRED');
  const owned = createTemporary('P2-02');
  let owner;
  try {
    if (args.includes('--upgrade')) {
      await migrate(owned.receipt, migrationFiles().slice(0, 87));
      await seed(owned.receipt);
    }
    await migrate(owned.receipt);
    await seed(owned.receipt);
    const types = spawnSync(process.execPath, ['tooling/vnext/managed.mjs', 'types-generate', owned.receiptPath], { stdio: 'inherit', windowsHide: true });
    assert.equal(types.status, 0);
    const typesVerify = spawnSync(process.execPath, ['tooling/vnext/managed.mjs', 'types-verify', owned.receiptPath], { stdio: 'inherit', windowsHide: true });
    assert.equal(typesVerify.status, 0);
    owner = await createValidationOwnerSession(owned.receipt);
    grantDepartment(owned.receipt, owner.receipt.role);
    peer(owned.receipt.name, `INSERT INTO department_master.department(id,code) VALUES ('00000000-0000-7000-8000-000000000099','P2-02-SYNTHETIC-OWNER') ON CONFLICT (id) DO NOTHING; INSERT INTO department_master.access(actor,scope,permission) VALUES ('maker','HOSPITAL','WRITE'),('reviewer','HOSPITAL','READ') ON CONFLICT DO NOTHING;`);
    const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tooling/vnext/tsconfig.p2-02.json'], { stdio: 'inherit', windowsHide: true });
    assert.equal(typecheck.status, 0);
    const unit = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tooling/vnext/vitest.p2-02-unit.config.ts'], { stdio: 'inherit', windowsHide: true });
    assert.equal(unit.status, 0);
    const db = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tooling/vnext/vitest.p2-02-db.config.ts'], { env: { ...process.env, VNEXT_DATABASE_URL: resolveTarget(owned.receipt), VNEXT_VALIDATION_OWNER_URL: owner.connectionString, VNEXT_TEST_RECEIPT: owned.receiptPath, VNEXT_CONNECTION_STEP: 'P2-02' }, stdio: 'inherit', windowsHide: true });
    process.exitCode = db.status ?? 1;
    console.log(JSON.stringify({ gate: 'P2-02', exit: db.status, mode: args.includes('--upgrade') ? '87_TO_CURRENT' : 'FRESH', receipt: owned.receiptPath }));
  } finally {
    dropTemporary(owned.receipt);
    if (owner) dropValidationOwnerSession(owner);
  }
}
