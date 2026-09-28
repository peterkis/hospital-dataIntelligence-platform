import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('PF03/PF04: receipt is mandatory; endpoint overrides never select a target', async () => {
  const { resolveTarget } = await import('./lineage.mjs');
  const receipt = JSON.parse(readFileSync('.runtime/vnext/creation.json', 'utf8'));
  const env = { DATABASE_URL: 'postgresql://hdi_prototype@127.0.0.1:55434/hdi_prototype' };
  assert.throws(() => resolveTarget(null, env), /RECEIPT_REQUIRED/);
  assert.throws(() => resolveTarget({ ...receipt, name: 'hdi_prototype' }, env), /RECEIPT_INVALID/);
  for (const override of [{ PGDATABASE: 'other' }, { pgdatabase:'other' }, { PGSSLMODE:'disable' }, { PGPASSWORD:'SYNTHETIC_ONLY' }, { PGSERVICE: 'other' }, { DATABASE_URL: env.DATABASE_URL + '?host=example.invalid' }]) {
    assert.throws(() => resolveTarget(receipt, { ...env, ...override }), /OVERRIDE_FORBIDDEN/);
  }
  const target = resolveTarget(receipt, env);
  assert.equal(new URL(target).pathname, '/' + receipt.name);
});

test('DB02/DB03: immutable ordered checksum prefix, no missing or unknown entries', async () => {
  const { checkPrefix } = await import('./lineage.mjs');
  const files = [{ id: '0001_bootstrap', sha256: 'a'.repeat(64) }, { id: '0002_catalog', sha256: 'b'.repeat(64) }];
  assert.equal(checkPrefix(files, [files[0]]), 1);
  for (const ledger of [[{ ...files[0], sha256: 'c'.repeat(64) }], [files[1]], [...files, files[0]]]) {
    assert.throws(() => checkPrefix(files, ledger), /LINEAGE_MISMATCH/);
  }
  assert.throws(() => checkPrefix([files[0], files[0]], []), /MIGRATION_ORDER/);
});

test('approved persistent repair digests remain accepted without rewriting the source chain', async () => {
  const { checkPrefix, migrationFiles, historicalMigrationDigests } = await import('./lineage.mjs');
  const files = migrationFiles();
  const ledger = files.slice(0, 83).map(({ id, sha256 }) => ({ id, sha256 }));
  ledger[78].sha256 = historicalMigrationDigests['0079_campus_retirement_disposition'];
  ledger[82].sha256 = historicalMigrationDigests['0083_campus_retirement_history_repair'];
  assert.equal(checkPrefix(files, ledger), 83);
  ledger[78].sha256 = '0'.repeat(64);
  assert.throws(() => checkPrefix(files, ledger), /LINEAGE_MISMATCH/);
});

test('Department migration bytes remain canonical and are not historical aliases', async () => {
  const { checkPrefix, migrationFiles, historicalMigrationDigests } = await import('./lineage.mjs');
  const files = migrationFiles();
  const ledger = files.slice(0, 85).map(({ id, sha256 }) => ({ id, sha256 }));
  assert.equal(historicalMigrationDigests['0084_department_core'], undefined);
  assert.equal(historicalMigrationDigests['0085_department_physical_row'], undefined);
  ledger[83].sha256 = '0'.repeat(64);
  assert.throws(() => checkPrefix(files, ledger), /LINEAGE_MISMATCH/);
});
