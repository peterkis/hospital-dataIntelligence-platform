import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../..');
const start = 'b3c9ae58dbec4e3d2429c06763b1613065f7d570';
const file = 'contracts/openapi/phase-01.openapi.json';
const before = JSON.parse(execFileSync('git', ['show', `${start}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true }));
const bytes = readFileSync(resolve(root, file));
const after = JSON.parse(bytes.toString('utf8'));
const prefix = '/v1/phase-01/consumer-subscriptions/{subscriptionId}';
for (const [suffix, method, operation] of [['audit-events', 'get', 'queryPhase01ConsumerReleaseAudit'],
  ['audit-reports', 'post', 'reportPhase01ConsumerReleaseAudit']]) {
  const path = `${prefix}/${suffix}`;
  assert.equal(before.paths[path], undefined);
  assert.deepEqual(Object.keys(after.paths[path]), [method]);
  assert.deepEqual(after.paths[path][method].security, [{ serviceBearer: [] }]);
  assert.equal(after.paths[path][method].operationId, operation);
  delete after.paths[path];
}
assert.deepEqual(after, before, 'C03_CHANGE_OUTSIDE_CONSUMER_AUDIT_CONTRACT');
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(readFileSync(resolve(root, 'contracts/openapi/phase-01.openapi.sha256'), 'utf8').trim(), `${hash}  phase-01.openapi.json`);
console.log(JSON.stringify({ status: 'PASSED', pathsAdded: 2, existingPathsChanged: 0,
  componentsChanged: 0, departmentBrowserPathsChanged: 0, canonicalSchemasChanged: 0, openapiSha256: hash }));
