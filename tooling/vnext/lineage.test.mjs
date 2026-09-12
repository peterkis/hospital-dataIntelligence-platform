import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('PF03/PF04: receipt is mandatory; endpoint overrides never select a target', async () => {
  const { resolveTarget } = await import('./lineage.mjs');
  const receipt = JSON.parse(readFileSync('.runtime/vnext/creation.json', 'utf8'));
  const env = { DATABASE_URL: 'postgresql://hdi_prototype@127.0.0.1:55434/hdi_prototype' };
  assert.throws(() => resolveTarget(null, env), /RECEIPT_REQUIRED/);
  assert.throws(() => resolveTarget({ ...receipt, name: 'hdi_prototype' }, env), /RECEIPT_INVALID/);
  for (const override of [{ PGDATABASE: 'other' }, { PGSERVICE: 'other' }, { DATABASE_URL: env.DATABASE_URL + '?host=example.invalid' }]) {
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
