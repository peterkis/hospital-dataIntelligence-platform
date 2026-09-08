import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';

export interface TemporaryDatabaseIdentity {
  readonly database: string; readonly oid: string; readonly owner: string; readonly role: string;
  readonly createdb: boolean; readonly superuser: boolean;
  readonly endpoint: { readonly host: string; readonly port: string; readonly role: string };
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'C04_FRESH_RECEIPT_REQUIRED');
  return Object.fromEntries(Object.entries(value));
}
export function validateTemporaryFreshAuthority(live: TemporaryDatabaseIdentity, supplied: unknown): void {
  assert.match(live.database, /^pv006_c04_[a-f0-9]{32}$/u, 'C04_FRESH_DATABASE_REQUIRED');
  assert.match(live.oid, /^[1-9]\d*$/u, 'C04_FRESH_OID_REQUIRED');
  assert.equal(live.role, 'hdi_prototype'); assert.equal(live.owner, 'hdi_prototype');
  assert.equal(live.createdb, false); assert.equal(live.superuser, false);
  const receipt = record(supplied);
  assert.equal(receipt['task'], 'PV-006-C-04'); assert.equal(receipt['mode'], 'FRESH_INSTALL');
  assert.equal(receipt['createdByPeerRole'], 'postgres');
  const runId = receipt['runId'];
  assert.equal(typeof runId, 'string');
  assert.equal(live.database, `pv006_c04_${String(runId).replaceAll('-', '')}`);
  assert.equal(receipt['databaseName'], live.database);
  assert.deepEqual(receipt['identity'], { name: live.database, oid: live.oid, owner: live.owner });
  const endpoint = { host: '127.0.0.1', port: '55434', role: 'hdi_prototype' };
  assert.deepEqual(live.endpoint, endpoint); assert.deepEqual(receipt['endpoint'], endpoint);
}
export async function temporaryDatabaseIdentity(database: Kysely<DB>): Promise<TemporaryDatabaseIdentity> {
  const url = new URL(process.env['DATABASE_URL'] ?? 'missing');
  const endpoint = { host: url.hostname, port: url.port, role: decodeURIComponent(url.username) };
  assert.deepEqual(endpoint, { host: '127.0.0.1', port: '55434', role: 'hdi_prototype' }, 'C04_ENDPOINT_REQUIRED');
  const live = (await sql<Omit<TemporaryDatabaseIdentity, 'endpoint'>>`select current_database() as database,
    d.oid::text as oid,pg_get_userbyid(d.datdba) as owner,current_user as role,
    r.rolcreatedb as createdb,r.rolsuper as superuser from pg_database d join pg_roles r on r.rolname=current_user
    where d.datname=current_database()`.execute(database)).rows[0]!;
  assert.equal(decodeURIComponent(url.pathname.slice(1)), live.database);
  return { ...live, endpoint };
}
export async function requireTemporaryFixtureTarget(database: Kysely<DB>, operation: 'COHORT' | 'SHARED_DEFINITION_MUTATION' | 'CORRUPTION') {
  assert.ok(['COHORT', 'SHARED_DEFINITION_MUTATION', 'CORRUPTION'].includes(operation), 'C04_FIXTURE_OPERATION_REQUIRED');
  const live = await temporaryDatabaseIdentity(database);
  const receiptPath = process.env['C04_FRESH_OWNERSHIP_RECEIPT'];
  if (live.database === 'hdi_prototype' && !receiptPath) {
    assert.equal(operation, 'COHORT', 'C04_RETAINED_SHARED_MUTATION_FORBIDDEN');
    assert.equal(live.oid, '16389'); assert.equal(live.role, 'hdi_prototype'); assert.equal(live.owner, 'hdi_prototype');
    assert.equal(live.createdb, false); assert.equal(live.superuser, false);
    return { mode: 'RETAINED' as const, identity: live };
  }
  assert.ok(receiptPath, 'C04_FRESH_RECEIPT_REQUIRED');
  validateTemporaryFreshAuthority(live, JSON.parse(await readFile(receiptPath, 'utf8')));
  return { mode: 'OWNED_FRESH' as const, identity: live };
}
