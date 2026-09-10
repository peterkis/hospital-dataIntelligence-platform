import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { checkDepartmentConsumerCanonical } from './check-department-consumer-canonical.js';

const base = '8b1721ebb2000435415aa2cfd47c398a258d9f09';
const directory = `.runtime/pv006-c01/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const path = 'contracts/openapi/phase-01.openapi.json';
const before = execFileSync('git', ['show', `${base}:${path}`]), after = await readFile(path);
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
assert.equal(hash(before), 'f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035');
assert.deepEqual(after, before);
const oldApi = JSON.parse(before.toString()), currentApi = JSON.parse(after.toString());
const departmentPaths = Object.keys(oldApi.paths).filter(p => p.includes('department'));
assert.equal(departmentPaths.length, 15);
for (const p of departmentPaths) assert.deepEqual(currentApi.paths[p], oldApi.paths[p]);
const protectedDiff = execFileSync('git', ['diff', base, '--', 'packages/generated-api-client', 'apps/admin-web',
  'tooling/prototype/fixtures/department-consumer-baseline.json',
  ...Array.from({ length: 30 }, (_, i) => `:(glob)db/migrations/${String(i + 1).padStart(4, '0')}_*.sql`)], { encoding: 'utf8' });
assert.equal(protectedDiff, '', 'FROZEN_SOURCE_SURFACE_CHANGED');
const canonical = checkDepartmentConsumerCanonical();
assert.equal(canonical.contracts.length, 7);
const operationCount = (api: typeof oldApi) => Object.values(api.paths).reduce<number>((count, item) => count +
  Object.keys(item as object).filter(method => ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)).length, 0);
const result = { task: 'PV-006-C-01', status: 'PASSED', base,
  openApiBeforeSha256: hash(before), openApiAfterSha256: hash(after), openApiBytesUnchanged: true,
  pathDelta: Object.keys(currentApi.paths).length - Object.keys(oldApi.paths).length, operationDelta: operationCount(currentApi) - operationCount(oldApi),
  departmentPaths, generatedApiClientAndBrowserSourcesUnchanged: true, originalMigrationsUnchanged: true, canonical };
await writeFile(`${directory}/frozen-assets.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...result, canonical: { contracts: canonical.contracts.length,
  canonicalArtifactBytesUnchanged: canonical.canonicalArtifactBytesUnchanged }, evidenceDirectory: directory }));
