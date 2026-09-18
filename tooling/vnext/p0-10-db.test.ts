import {test, expect} from 'vitest';
import {runDbIntegration} from './p0-10-db-scenarios.mjs';
import {writeEvidence} from './p0-10-evidence.ts';

test('P0-10 receipt-owned fresh and upgrade acceptance retains domain isolation', async () => {
  const result = await runDbIntegration();
  expect(result.status).toBe('PASS');
  expect(result.sourceAcceptance.A001.evidence).toHaveLength(9);
  const output = process.env['VNEXT_P0_10_DB_REPORT'];
  if (!output) throw new Error('DB_REPORT_REQUIRED');
  writeEvidence(output,result);
}, 300000);
