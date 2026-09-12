import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('tooling/vnext/baseline.mjs');
function run(args, cwd = process.cwd()) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

test('AC-01: inspect preserves untracked user bytes and blocks baseline creation', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hdi-p000-git-'));
  const git = spawnSync('git', ['init', cwd], { encoding: 'utf8' });
  assert.equal(git.status, 0);
  writeFileSync(join(cwd, 'user.txt'), 'USER OWNED\n');
  const result = run(['inspect'], cwd);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /WORKTREE_NOT_CLEAN/);
  assert.equal(readFileSync(join(cwd, 'user.txt'), 'utf8'), 'USER OWNED\n');
});

test('AC-02: no receipt or foreign database cannot be cleaned', () => {
  for (const args of [['cleanup'], ['cleanup', 'hdi_prototype'], ['cleanup', '--receipt', 'unknown.json']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /DISPOSAL_NOT_AUTHORIZED/);
  }
});

test('AC-03: replacement registry rejects removal without semantic test mapping', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hdi-p000-registry-'));
  const file = join(cwd, 'registry.json');
  writeFileSync(file, JSON.stringify([{ id: 'wire', oldConstraint: 'old hash', replacement: 'current version', semanticTests: [] }]));
  const result = run(['check-registry', file]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SEMANTIC_TEST_MAPPING_REQUIRED/);
});

test('AC-05: local remote-tracking refs never become a remote observation', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hdi-p000-ref-'));
  function git(...args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git('init');
  git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const result = run(['inspect'], cwd);
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.remoteObservation, 'NOT_OBSERVED');
  assert.match(report.localRefs, /refs\/remotes\/origin\/main/);
});

test('independent lineage refuses legacy migration runner before connecting', () => {
  const result = spawnSync(process.execPath, ['tooling/runtime/apply-migrations.mjs', 'db/migrations'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/hdi_mc_vnext_0123456789abcdef' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VNEXT_LEGACY_LINEAGE_FORBIDDEN/);
});

test('migration lineage guard includes PGDATABASE fallback', () => {
  const result = spawnSync(process.execPath, ['tooling/runtime/apply-migrations.mjs', 'db/migrations'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1', PGDATABASE: 'hdi_mc_vnext_0123456789abcdef' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VNEXT_LEGACY_LINEAGE_FORBIDDEN/);
});

test('receipt store initializes absent directories and never overwrites evidence', async () => {
  const { saveExclusiveReceipt } = await import('./receipt.mjs');
  const root = mkdtempSync(join(tmpdir(), 'hdi-p000-receipt-'));
  const path = join(root, 'absent', 'intent.json');
  saveExclusiveReceipt(path, { requestId: 'synthetic' });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { requestId: 'synthetic' });
  assert.throws(() => saveExclusiveReceipt(path, { requestId: 'replacement' }), { code: 'EEXIST' });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).requestId, 'synthetic');
});

test('database endpoint rejects query overrides before connecting', async () => {
  const { localDatabaseUrl } = await import('./connection.mjs');
  assert.throws(() => localDatabaseUrl('postgresql://synthetic@127.0.0.1:55434/hdi_prototype?host=example.invalid&port=5432'), /LOCAL_DATABASE_REQUIRED/);
  assert.throws(() => localDatabaseUrl('postgresql://synthetic@example.invalid:55434/hdi_prototype'), /LOCAL_DATABASE_REQUIRED/);
  assert.throws(() => localDatabaseUrl('postgresql://synthetic@127.0.0.1:55434'), /LOCAL_DATABASE_REQUIRED/);
  assert.equal(localDatabaseUrl('postgresql://synthetic@127.0.0.1:55434/hdi_prototype').hostname, '127.0.0.1');
});
