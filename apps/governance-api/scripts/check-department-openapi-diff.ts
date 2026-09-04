import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(import.meta.dirname, '../../..');
const base = 'a81aa3165039f438951c17a22b4b7c320cf0fd13';
const oldSha = 'eaa3c1c12fcf2069e0f66252f0be0411c1f0e00876bbc6e72abd8a3a5d12b017';
const file = 'contracts/openapi/phase-01.openapi.json';
const oldBytes = execFileSync('git', ['show', `${base}:${file}`], { cwd: root });
const newBytes = readFileSync(resolve(root, file));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(oldBytes), oldSha);
const newSha = digest(newBytes);
assert.notEqual(newSha, oldSha);
assert.equal(readFileSync(resolve(root, 'contracts/openapi/phase-01.openapi.sha256'), 'utf8').trim(),
  `${newSha}  phase-01.openapi.json`);

const oldDocument = JSON.parse(oldBytes.toString('utf8'));
const newDocument = JSON.parse(newBytes.toString('utf8'));
const added = Object.keys(newDocument.paths).filter((path) => !Object.hasOwn(oldDocument.paths, path));
const removed = Object.keys(oldDocument.paths).filter((path) => !Object.hasOwn(newDocument.paths, path));
const modified = Object.keys(oldDocument.paths).filter((path) =>
  Object.hasOwn(newDocument.paths, path) && !isDeepStrictEqual(oldDocument.paths[path], newDocument.paths[path]));
assert.equal(added.length, 15);
assert.ok(added.every((path) => path.startsWith('/v1/department-governance/')));
assert.deepEqual(removed, []);
assert.deepEqual(modified, []);
for (const [key, value] of Object.entries(oldDocument.components)) {
  if (key === 'schemas') {
    for (const [name, schema] of Object.entries(value as object)) {
      assert.deepEqual(newDocument.components.schemas[name], schema, `Existing schema changed: ${name}`);
    }
  } else {
    assert.deepEqual(newDocument.components[key], value, `Existing component changed: ${key}`);
  }
}
assert.deepEqual(Object.keys(newDocument.components).sort(), Object.keys(oldDocument.components).sort());
for (const key of new Set([...Object.keys(oldDocument), ...Object.keys(newDocument)])) {
  if (['paths', 'components', 'tags'].includes(key)) continue;
  assert.deepEqual(newDocument[key], oldDocument[key], `Document field changed: ${key}`);
}
assert.deepEqual(newDocument.tags, [...(oldDocument.tags ?? []), {
  name: 'Department Governance',
  description: '面向治理工作台人员的科室主数据治理接口，不是第三方系统主数据消费接口。',
}]);
process.stdout.write(`${JSON.stringify({
  oldSha, newSha, addedPathCount: added.length, deletedPathCount: removed.length,
  modifiedExistingPathCount: modified.length, existingSchemasUnchanged: true,
  existingSecurityUnchanged: true, addedPaths: added.sort(),
}, null, 2)}\n`);
