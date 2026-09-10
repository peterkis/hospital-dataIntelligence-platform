import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const START_HEAD = '733072bc592b82c3ceb0bda4a7be16e2979c64e6';
const file = 'contracts/openapi/phase-01.openapi.json';
const oldBytes = execFileSync('git', ['show', `${START_HEAD}:${file}`], { cwd: root, windowsHide: true });
// B-03B is closed. C-02 has its own live delta guard; do not widen this one.
const candidate = '3dcd9e018b6ffe2ca1c0c73cb4aada709de434f8';
const newBytes = execFileSync('git', ['show', `${candidate}:${file}`], { cwd: root, windowsHide: true });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const oldSha = hash(oldBytes), newSha = hash(newBytes);
assert.equal(oldSha, '5c32b5bedf0cbd67171e31bd8a8b0aa5ca46dfd06b7dadf1bfa2b19b410831bb');
assert.equal(execFileSync('git', ['show', `${candidate}:contracts/openapi/phase-01.openapi.sha256`], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim(), `${newSha}  phase-01.openapi.json`);
const before = JSON.parse(oldBytes.toString('utf8'));
const after = JSON.parse(newBytes.toString('utf8'));
const prefix = '/v1/phase-01/consumer-subscriptions';
const added = `${prefix}/{subscriptionId}/operational-status`;
assert.equal(before.paths[added], undefined);
assert.deepEqual(Object.keys(after.paths[added]), ['get']);
assert.equal(after.paths[added].get.operationId, 'getPhase01ConsumerOperationalStatus');
assert.deepEqual(after.paths[added].get.security, [{ serviceBearer: [] }]);
// Only optional SLA properties may be added to the two existing command bodies.
for (const path of [prefix, `${prefix}/{subscriptionId}/versions`]) {
  const oldVariants = before.paths[path].post.requestBody.content['application/json'].schema.anyOf;
  const newVariants = after.paths[path].post.requestBody.content['application/json'].schema.anyOf;
  assert.equal(newVariants.length, oldVariants.length);
  for (const variant of newVariants) {
    assert.equal(variant.required.includes('sla'), false);
    assert.equal(variant.properties.sla.additionalProperties, false);
    assert.deepEqual(Object.keys(variant.properties.sla.properties).sort(), ['criticality', 'expectedApplyWithinSeconds', 'retryWindowSeconds']);
    delete variant.properties.sla;
  }
}
delete after.paths[added];
assert.deepEqual(after, before, 'Change outside optional consumer SLA inputs and operational read');
assert.equal(Object.keys(before.paths).filter((path) => path.startsWith('/v1/department-governance/')).length, 15);
process.stdout.write(`${JSON.stringify({ status: 'PASSED', START_HEAD, oldSha, newSha,
  pathsAdded: 1, pathsRemoved: 0, pathsModified: 2, componentsChanged: 0, browserDepartmentPathsChanged: 0 })}\n`);
