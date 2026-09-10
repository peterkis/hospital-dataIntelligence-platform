import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(import.meta.dirname, '../../..');
const base = '80ed445c7710deb72db5560acc49be3652d8fbdc';
const oldSha = '0a6f4916188d592993dc2bdfa6c8e42c8832ab112a4447f7cd211d7fb228879c';
const file = 'contracts/openapi/phase-01.openapi.json';
const oldBytes = execFileSync('git', ['show', `${base}:${file}`], { cwd: root, windowsHide: true });
// B-02B is a closed delta. Later task guards must validate their own live delta
// from this frozen result without expanding this allowlist.
const candidate = 'dce23903b0147910d7b0f90e6d431a30627d6fcc';
const newBytes = execFileSync('git', ['show', `${candidate}:${file}`], { cwd: root, windowsHide: true });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(oldBytes), oldSha);
const newSha = digest(newBytes);
assert.notEqual(newSha, oldSha);
assert.equal(execFileSync('git', ['show', `${candidate}:contracts/openapi/phase-01.openapi.sha256`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  `${newSha}  phase-01.openapi.json`);
const before = JSON.parse(oldBytes.toString('utf8'));
const after = JSON.parse(newBytes.toString('utf8'));
assert.deepEqual(Object.keys(after.paths).sort(), Object.keys(before.paths).sort());
const allowed = new Map([
  ['createPhase01ConsumerSubscription', 'requestBody'],
  ['createPhase01ConsumerSubscriptionVersion', 'requestBody'],
  ['downloadPhase01CanonicalSnapshot', 'responses'],
]);
const modified: string[] = [];
const browserPaths = Object.keys(before.paths).filter((path) => path.startsWith('/v1/department-governance/'));
assert.equal(browserPaths.length, 15);
for (const path of browserPaths) assert.deepEqual(after.paths[path], before.paths[path], path);
for (const path of Object.keys(before.paths)) {
  assert.deepEqual(Object.keys(after.paths[path]).sort(), Object.keys(before.paths[path]).sort(), path);
  for (const method of Object.keys(before.paths[path])) {
    const left = before.paths[path][method];
    const right = after.paths[path][method];
    if (isDeepStrictEqual(left, right)) continue;
    const field = allowed.get(left.operationId);
    assert.ok(field, `Operation outside B-02B allowlist: ${method} ${path}`);
    assert.deepEqual({ ...right, [field]: undefined }, { ...left, [field]: undefined });
    if (field === 'responses') {
      assert.deepEqual({ ...right.responses, 200: undefined }, { ...left.responses, 200: undefined });
    }
    modified.push(left.operationId);
  }
}
// This implementation uses inline schemas: no component mutation is necessary.
assert.deepEqual(after.components, before.components, 'Unexpected component change');
assert.deepEqual({ ...after, paths: undefined, components: undefined },
  { ...before, paths: undefined, components: undefined }, 'Unexpected document change');
assert.deepEqual(modified.sort(), [...allowed.keys()].sort());
process.stdout.write(`${JSON.stringify({ status: 'PASSED', oldSha, newSha,
  pathsAdded: 0, pathsRemoved: 0, pathsModified: 3, browserDepartmentPathsChanged: 0,
  modifiedOperations: modified, componentsChanged: 0,
  snapshotCorrections: ['releaseKind', 'exact projection type', 'existing Charge V2 and Price V2 envelopes'],
})}\n`);
