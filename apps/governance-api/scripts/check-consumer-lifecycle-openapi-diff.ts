import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const START_HEAD = 'dce23903b0147910d7b0f90e6d431a30627d6fcc';
const file = 'contracts/openapi/phase-01.openapi.json';
const oldBytes = execFileSync('git', ['show', `${START_HEAD}:${file}`], { cwd: root, windowsHide: true });
// B-03A is closed; B-03B validates its own live delta without widening this guard.
const candidate = '733072bc592b82c3ceb0bda4a7be16e2979c64e6';
const newBytes = execFileSync('git', ['show', `${candidate}:${file}`], { cwd: root, windowsHide: true });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const oldSha = hash(oldBytes);
const newSha = hash(newBytes);
assert.equal(oldSha, 'afc8cded75fc662758a172cc41efe5df263746f33f90a42dab7310c383cf71fb');
assert.equal(execFileSync('git', ['show', `${candidate}:contracts/openapi/phase-01.openapi.sha256`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), `${newSha}  phase-01.openapi.json`);
const before = JSON.parse(oldBytes.toString('utf8'));
const after = JSON.parse(newBytes.toString('utf8'));
const path = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions';
assert.equal(Object.hasOwn(before.paths, path), false);
assert.deepEqual(Object.keys(after.paths[path]), ['post']);
assert.equal(after.paths[path].post.operationId, 'changePhase01ConsumerSubscriptionLifecycle');
assert.deepEqual(after.paths[path].post.security, [{ browserSession: [] }]);
const browserPaths = Object.keys(before.paths).filter((item) => item.startsWith('/v1/department-governance/'));
assert.equal(browserPaths.length, 15);
for (const item of browserPaths) assert.equal(JSON.stringify(after.paths[item]), JSON.stringify(before.paths[item]), item);
const { [path]: lifecycle, ...remainingPaths } = after.paths;
assert.deepEqual(remainingPaths, before.paths, 'Unrelated path/operation or direct-query API change');
assert.deepEqual({ ...after, paths: undefined }, { ...before, paths: undefined }, 'Unrelated component/document change');
process.stdout.write(`${JSON.stringify({ status: 'PASSED', START_HEAD, oldSha, newSha,
  pathsAdded: 1, pathsRemoved: 0, pathsModified: 0, browserDepartmentPathsChanged: 0,
  componentsChanged: 0, operationAdded: lifecycle.post.operationId })}\n`);
