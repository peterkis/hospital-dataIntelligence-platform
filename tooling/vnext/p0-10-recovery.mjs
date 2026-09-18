import assert from 'node:assert/strict';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { readReceipt, resolveTarget } from './lineage.mjs';

const receiptPath = process.env.VNEXT_P0_10_RECEIPT;
const jobId = process.env.VNEXT_P0_10_JOB_ID;
if (!receiptPath || !jobId) throw new Error('RECOVERY_INPUT_REQUIRED');

const receipt = readReceipt(receiptPath);
const catalog = await openCatalog(resolveTarget(receipt));
try {
  const summary = await catalog.workbenchSummary('maker', { scope: 'SYNTHETIC', jobId });
  assert.ok(summary.status, 'RECOVERED_JOB_STATUS_MISSING');
  assert.ok(summary.runs.length > 0, 'RECOVERED_RUN_MISSING');
  assert.ok(summary.runs.some((run) => run.issueCount > 0), 'RECOVERED_PROBLEM_MISSING');
  console.log(JSON.stringify({
    status: 'PASS',
    recovered: true,
    runCount: summary.runs.length,
    issueCount: summary.runs.reduce((count, run) => count + run.issueCount, 0),
  }));
} finally {
  await catalog.close();
}
