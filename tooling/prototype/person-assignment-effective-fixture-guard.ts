import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';

/** Reuse the verified C04 fresh infrastructure for this ticket's regression job. */
export async function requireEffectiveFixtureTarget(database: Kysely<DB>, operation: 'COHORT' | 'CORRUPTION' | 'SHARED_DEFINITION_MUTATION') {
  const ownership = await requireTemporaryFixtureTarget(database, operation);
  if (ownership.mode === 'OWNED_FRESH') {
    const path = process.env['C04_FRESH_OWNERSHIP_RECEIPT'];
    assert.ok(path, 'C05_FRESH_RECEIPT_REQUIRED');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(receipt.consumerTask, 'PV-006-C-05', 'C05_FRESH_TASK_REQUIRED');
  }
  return ownership;
}
