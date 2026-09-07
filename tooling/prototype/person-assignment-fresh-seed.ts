import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { personContext, personCreation, seedPersonScope } from './person-subject-fixture.js';
import { seedEngagementLifecycleScope } from './person-engagement-lifecycle-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('ASSIGNMENT_DATABASE_REQUIRED');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4 });
try {
  const target = (await sql<{ name: string }>`select current_database() as name`.execute(handle.database)).rows[0]!.name;
  assert.match(target, /^pv006_c0(?:[12]|301|302)_[a-f0-9]{32}$/u);
  await seedPersonScope(handle.database);
  for (let i = 0; i < 6; i++) await createPersonApplication(handle.database, personContext()).createPersonSubject(personCreation);
  await seedEngagementLifecycleScope(handle.database);
  console.log(JSON.stringify({ task: 'PV-006-C-01', mode: 'FRESH_SEED', database: target, status: 'PASSED' }));
} finally { await handle.close(); }
