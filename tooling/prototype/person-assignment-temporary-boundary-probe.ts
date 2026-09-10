import assert from 'node:assert/strict';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';

// This executable is intentionally read-only: it tests admission to the shared
// mutation/cleanup boundary before any fixture can issue a write.
assert.ok(process.argv.length===3&&process.argv[2]==='--shared-mutation-guard','C04_BOUNDARY_MODE_REQUIRED');
assert.ok(process.env['DATABASE_URL'],'C04_MANAGED_DATABASE_REQUIRED');
const handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:1,application_name:'hdi-pv006-c04-boundary-negative'});
try {
  const result=await requireTemporaryFixtureTarget(handle.database,'SHARED_DEFINITION_MUTATION');
  console.log(JSON.stringify({task:'PV-006-C-04',status:'ALLOWED',mode:result.mode}));
} finally {await handle.close();}
