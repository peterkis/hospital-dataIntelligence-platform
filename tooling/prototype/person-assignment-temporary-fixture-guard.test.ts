import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTemporaryFreshAuthority } from './person-assignment-temporary-fixture-guard.js';

const runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const name = `pv006_c04_${runId.replaceAll('-', '')}`;
const live = { database: name, oid: '12345', owner: 'hdi_prototype', role: 'hdi_prototype',
  createdb: false, superuser: false, endpoint: { host: '127.0.0.1', port: '55434', role: 'hdi_prototype' } };
const receipt = { task: 'PV-006-C-04', runId, mode: 'FRESH_INSTALL', databaseName: name,
  identity: { name, oid: '12345', owner: 'hdi_prototype' }, endpoint: live.endpoint, createdByPeerRole: 'postgres' };
test('C04 fixture: only matching receipt-owned fresh authority allows shared mutation', () => {
  assert.doesNotThrow(() => validateTemporaryFreshAuthority(live, receipt));
});
test('C04 fixture: missing, wrong task/mode/database/OID/owner/endpoint/role rejects', () => {
  for (const wrong of [null, { ...receipt, task: 'PV-006-C-03-02' }, { ...receipt, mode: 'RETAINED' },
    { ...receipt, databaseName: 'hdi_prototype' }, { ...receipt, runId: '00000000-0000-4000-8000-000000000000' },
    { ...receipt, identity: { ...receipt.identity, oid: '0' } },
    { ...receipt, identity: { ...receipt.identity, owner: 'postgres' } },
    { ...receipt, endpoint: { ...receipt.endpoint, port: '5432' } },
    { ...receipt, endpoint: { ...receipt.endpoint, host: 'example.com' } }])
    assert.throws(() => validateTemporaryFreshAuthority(live, wrong));
  assert.throws(() => validateTemporaryFreshAuthority({ ...live, database: 'hdi_prototype' }, receipt));
  assert.throws(() => validateTemporaryFreshAuthority({ ...live, createdb: true }, receipt));
  assert.throws(() => validateTemporaryFreshAuthority({ ...live, superuser: true }, receipt));
  assert.throws(() => validateTemporaryFreshAuthority({ ...live, role: 'postgres' }, receipt));
});
