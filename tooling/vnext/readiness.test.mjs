import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

test('P0-02 single active database: readiness selects vNext without connecting to the legacy target', async () => {
  const { probe } = await import('./readiness.mjs');
  const receipt = JSON.parse(readFileSync('.runtime/vnext/creation.json', 'utf8'));
  const result = await probe(receipt);
  assert.equal(result.databaseConnected, true);
  assert.equal(result.identity.name, receipt.name);
  assert.equal(result.identity.oid, receipt.oid);
  assert.ok(result.ledger.length >= 2);
});

test('P0-02 readiness rejects identity and checksum drift with the legacy connection forbidden', async () => {
  const { probe } = await import('./readiness.mjs');
  const receipt = JSON.parse(readFileSync('.runtime/vnext/creation.json', 'utf8'));
  const Pool = pg.Pool;
  const targets = [];
  let corruptChecksum = false;
  pg.Pool = class extends Pool {
    constructor(options) {
      const target = new URL(options.connectionString).pathname.slice(1);
      assert.equal(target, receipt.name, 'any legacy or unrelated connection is forbidden');
      targets.push(target);
      super(options);
    }
    async query(...args) {
      const result = await super.query(...args);
      if (corruptChecksum && args[0] === 'select lineage,id,sha256 from vnext_control.migration order by id') {
        result.rows[0].sha256 = '0'.repeat(64);
      }
      return result;
    }
  };
  try {
    assert.equal((await probe(receipt)).databaseConnected, true);
    await assert.rejects(probe({ ...receipt, oid: '0' }), /RECEIPT_IDENTITY_MISMATCH/);
    corruptChecksum = true;
    await assert.rejects(probe(receipt), /LINEAGE_MISMATCH/);
    assert.equal(targets.length, 3);
  } finally { pg.Pool = Pool; }
});

test('legacy target is refused before a pg client opens a connection',async()=>{
  await import('./connection-guard.mjs');
  const pool=new pg.Pool({connectionString:'postgresql://hdi_prototype@127.0.0.1:55434/hdi_prototype'});
  try {await assert.rejects(async()=>pool.query('select 1'),/NON_RECEIPT_CONNECTION_FORBIDDEN/);}
  finally {await pool.end();}
});
