import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { assignmentSemanticDatabaseIdentity } from './person-assignment-semantics-recovery-support.js';
import { labelCorrectionCommand } from './person-assignment-transfer-definition-repair-guard.js';

const base = '.runtime/pv006-c0302/r1-20260908';
const sourcePath = '.runtime/pv006-c0302/32963283-b097-4a2d-9586-0d1759e658d6/definition-repair.json';
const restore = process.argv[2] === '--restore';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && restore));
assert.ok(process.env['DATABASE_URL']);
const endpoint = new URL(process.env['DATABASE_URL']);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
const sourceText = await readFile(sourcePath, 'utf8'), observed = JSON.parse(sourceText);
const normalize = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
await mkdir(base, { recursive: true });
const operationPath = `${base}/operation.json`;
let operation: { requestId: string; restorationOperationId: string; sourceSha256: string; actorPrincipalId: string };
try { operation = JSON.parse(await readFile(operationPath, 'utf8')); }
catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  operation = { requestId: randomUUID(), restorationOperationId: randomUUID(), sourceSha256: hash(sourceText), actorPrincipalId: observed.current.created_by };
  await writeFile(operationPath, JSON.stringify(operation, null, 2), { flag: 'wx' });
}
assert.equal(operation.sourceSha256, hash(sourceText)); assert.equal(operation.actorPrincipalId, observed.current.created_by);
const runId = randomUUID(), directory = `${base}/${runId}`;
await mkdir(directory, { recursive: false });
const receipt: Record<string, unknown> = { task: 'PV-006-C-03-02', authorization: 'PV-006-C-03-02-R1', runId, ...operation, sourcePath,
  outcome: 'BLOCKED', mode: restore ? 'RESTORE' : 'INSPECT', historicalEffectsUndone: false };
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 1, application_name: 'hdi-c0302-r1-label-correction' });

type Fingerprint = Record<string, { key: unknown; sha256: string }[]>;
async function snapshot(db: Kysely<DB>): Promise<Fingerprint> {
  const tables = (await sql<{ schema: string; name: string; keys: string[] }>`select n.nspname as schema,c.relname as name,
    array_agg(a.attname::text order by u.ord) as keys from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_index i on i.indrelid=c.oid and i.indisprimary
    cross join lateral unnest(i.indkey) with ordinality u(attnum,ord)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=u.attnum
    where n.nspname='person_master' or (n.nspname='audit' and c.relname='audit_event')
    group by n.nspname,c.relname order by n.nspname,c.relname`.execute(db)).rows;
  const result: Fingerprint = {};
  for (const table of tables) {
    const keyParts = table.keys.map(key => sql.ref(`t.${key}`));
    const rows = (await sql<{ key: unknown; sha256: string }>`select jsonb_build_array(${sql.join(keyParts)}) as key,
      encode(digest(to_jsonb(t)::text,'sha256'),'hex') as sha256 from ${sql.table(`${table.schema}.${table.name}`)} as t
      order by jsonb_build_array(${sql.join(keyParts)})::text`.execute(db)).rows;
    result[`${table.schema}.${table.name}`] = rows;
  }
  return result;
}
function unchanged(before: Fingerprint, after: Fingerprint, addedVersionId: string | null, auditId: string | null) {
  assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const table of Object.keys(before)) {
    const old = new Map(before[table]!.map(row => [JSON.stringify(row.key), row.sha256]));
    const current = new Map(after[table]!.map(row => [JSON.stringify(row.key), row.sha256]));
    for (const [key, digest] of old) assert.equal(current.get(key), digest, `R1_OLD_ROW_CHANGED:${table}`);
    const additions = after[table]!.filter(row => !old.has(JSON.stringify(row.key)));
    const allowed = table === 'person_master.assignment_semantic_term_version' ? addedVersionId : table === 'audit.audit_event' ? auditId : null;
    assert.equal(additions.length, allowed ? 1 : 0, `R1_UNAUTHORIZED_INCREMENT:${table}`);
    if (allowed) assert.deepEqual(additions[0]!.key, [allowed]);
  }
}
try {
  const db = handle.database;
  const identity = await assignmentSemanticDatabaseIdentity(db);
  for (const key of ['database', 'oid', 'role', 'address', 'port', 'migrations'] as const) assert.equal(identity[key], observed.identity[key]);
  receipt['identity'] = identity;
  await db.transaction().execute(async tx => {
    const expected = observed.current;
    // Same request lock ordering as the owner, then stable identity lock.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT_TERM_REQUEST:${expected.governance_object_id}:${operation.requestId}`},0))`.execute(tx);
    const stable = await tx.selectFrom('person_master.assignment_semantic_term').selectAll()
      .where('term_id', '=', expected.term_id).where('governance_object_id', '=', expected.governance_object_id).forUpdate().executeTakeFirstOrThrow();
    assert.equal(stable.dimension, expected.dimension); assert.equal(stable.code, expected.code);
    const rows = () => tx.selectFrom('person_master.assignment_semantic_term_version').selectAll().where('term_id', '=', stable.term_id).orderBy('version_no').execute();
    const beforeRows = await rows(), source = beforeRows.find(row => row.term_version_id === observed.original.term_version_id)!;
    assert.deepEqual(normalize(source), observed.original, 'R1_SOURCE_CHANGED');
    const prior = beforeRows.find(row => row.term_version_id === expected.term_version_id)!;
    assert.deepEqual(normalize(prior), expected, 'R1_PRIOR_CHANGED');
    const command = labelCorrectionCommand(normalize(source), normalize(prior), expected);
    const existing = beforeRows.find(row => row.request_id === operation.requestId);
    const head = beforeRows.at(-1)!;
    if (existing) {
      assert.equal(head.term_version_id, existing.term_version_id, 'R1_HEAD_DRIFT');
      assert.equal(existing.supersedes_term_version_id, prior.term_version_id);
      assert.equal(existing.label, source.label); assert.equal(existing.created_by, operation.actorPrincipalId);
      assert.equal(existing.definition_state, prior.definition_state); assert.equal(existing.business_valid_from, prior.business_valid_from);
      assert.equal(existing.business_valid_to, prior.business_valid_to); assert.equal(existing.reason_code, 'LABEL_CORRECTION');
    } else assert.equal(head.term_version_id, expected.term_version_id, 'R1_HEAD_DRIFT');
    const before = await snapshot(tx);
    await writeFile(`${directory}/before.json`, JSON.stringify(before), { flag: 'wx' });
    const now = (await sql<{ now: string }>`select platform.local_now() as now`.execute(tx)).rows[0]!.now;
    const scope = await createAssignmentScope(tx, { actorPrincipalId: operation.actorPrincipalId, requestId: operation.requestId,
      correlationId: operation.restorationOperationId, occurredAt: now });
    // Owner validates active human actor, object scope and current effective grants.
    await scope.authorizeSemantics(expected.governance_object_id, 'DEFINITION_WRITE');
    const frozenRows = () => tx.selectFrom('person_master.assignment_version_semantics as s')
      .innerJoin('person_master.assignment_semantic_term_version as v', 'v.term_version_id', 's.purpose_term_version_id')
      .select(['s.assignment_id', 's.assignment_version_id', 's.governance_object_id', 'v.term_version_id', 'v.label'])
      .where('v.term_id', '=', stable.term_id).orderBy('s.assignment_version_id').execute();
    const frozen = await frozenRows();
    const historical = frozen.find(row => row.label === 'SYNTHETIC C0302 DEFINITION RACE');
    assert.ok(historical, 'R1_FROZEN_RACE_HISTORY_REQUIRED');
    const readFrozen = () => scope.assignment.readAssignmentSemanticsSnapshot({ governanceObjectId: historical.governance_object_id,
      assignmentId: historical.assignment_id, assignmentVersionId: historical.assignment_version_id });
    const oldFrozen = await readFrozen();
    const oldKnowledge = await scope.definitions.findAssignmentSemanticTermAsOf({ governanceObjectId: stable.governance_object_id,
      dimension: 'PURPOSE', code: stable.code, recordAsOf: prior.recorded_from });
    assert.equal(oldKnowledge?.label, prior.label);
    Object.assign(receipt, { source, prior, stable, definitionHistory: beforeRows, frozenReferenceHashBefore: hash(frozen),
      historicalFrozen: oldFrozen, beforeHashes: `${directory}/before.json`, beforeRecordAsOf: now, command });
    if (!restore) { receipt['outcome'] = 'INSPECTED'; return; }
    const result = await scope.definitions.appendAssignmentSemanticTermVersion(command);
    const audit = await tx.selectFrom('audit.audit_event').selectAll().where('request_id', '=', operation.requestId)
      .where('action', '=', 'ASSIGNMENT_SEMANTIC_TERM_VERSION_CREATED').execute();
    assert.equal(audit.length, 1); assert.equal(audit[0]!.entity_version_id, result.termVersionId);
    assert.equal(audit[0]!.actor_principal_id, operation.actorPrincipalId);
    const afterAppend = await snapshot(tx);
    unchanged(before, afterAppend, existing ? null : result.termVersionId, existing ? null : audit[0]!.audit_event_id);
    const replay = await scope.definitions.appendAssignmentSemanticTermVersion(command);
    assert.deepEqual(replay, result); assert.deepEqual(await snapshot(tx), afterAppend, 'R1_REPLAY_MUTATED_DATABASE');
    const afterRows = await rows();
    assert.deepEqual(afterRows.filter(row => row.term_version_id !== result.termVersionId), beforeRows.filter(row => row.term_version_id !== result.termVersionId));
    assert.equal(result.label, source.label); assert.equal(result.definitionState, prior.definition_state);
    assert.equal(result.businessValidFrom, prior.business_valid_from); assert.equal(result.businessValidTo, prior.business_valid_to);
    assert.equal(result.supersedesTermVersionId, prior.term_version_id); assert.equal(result.versionNo, String(BigInt(prior.version_no) + 1n));
    assert.ok(result.recordedFrom > prior.recorded_from); if (!existing) assert.ok(result.recordedFrom >= now);
    const query = { governanceObjectId: stable.governance_object_id, dimension: 'PURPOSE' as const, code: stable.code };
    assert.equal((await scope.definitions.findAssignmentSemanticTermAsOf({ ...query, recordAsOf: prior.recorded_from }))?.termVersionId, prior.term_version_id);
    assert.equal((await scope.definitions.findAssignmentSemanticTermAsOf({ ...query, recordAsOf: result.recordedFrom }))?.termVersionId, result.termVersionId);
    const currentTime = (await sql<{ now: string }>`select platform.local_now() as now`.execute(tx)).rows[0]!.now;
    assert.equal((await scope.definitions.findAssignmentSemanticTermAsOf({ ...query, recordAsOf: currentTime }))?.label, source.label);
    assert.deepEqual(await readFrozen(), oldFrozen);
    const frozenAfter = await frozenRows(); assert.deepEqual(frozenAfter, frozen);
    await writeFile(`${directory}/after.json`, JSON.stringify(afterAppend), { flag: 'wx' });
    Object.assign(receipt, { outcome: existing ? 'ALREADY_RESTORED' : 'APPENDED', result, audit: audit[0],
      afterHashes: `${directory}/after.json`, oldRowsUnchanged: true, frozenReferenceHashAfter: hash(frozenAfter), frozenExactResultUnchanged: true,
      historicalKnowledgePreserved: true, onlyAuthorizedIncrement: true, replayNoVersionOrSuccessAudit: true, actualCurrentRecordAsOf: currentTime });
  });
  receipt['transactionCommitted'] = true; receipt['status'] = 'PASS';
} catch (error) {
  receipt['outcome'] = 'BLOCKED'; receipt['status'] = 'FAILED';
  receipt['error'] = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : 'UNKNOWN';
  process.exitCode = 1;
} finally {
  await handle.close(); receipt['poolClosed'] = true;
  await writeFile(`${directory}/definition-repair.json`, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: receipt['task'], outcome: receipt['outcome'], status: receipt['status'], error: receipt['error'], directory }));
}
