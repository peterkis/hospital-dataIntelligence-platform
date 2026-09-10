import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('recovers Department consumers in independent SDK processes over real PostgreSQL and Fastify', () => {
  const output = execFileSync(process.execPath, [
    '--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts', '--sdk',
  ], { cwd: resolve(import.meta.dirname, '../../../../..'), encoding: 'utf8', windowsHide: true, timeout: 90_000 });
  expect(output).not.toMatch(/postgres:\/\/|postgresql:\/\/|DATABASE_URL=|password|Bearer/iu);
  const result = JSON.parse(output) as Record<string, unknown>;
  expect(result['scenario']).toBe('PV-005-C-01');
  for (const kind of ['departmentMaster', 'departmentHierarchy']) {
    for (const check of ['verifiedBeforeApplyRestart', 'appliedBeforeReceiptRestart', 'receiptBeforeLocalClosureRestart',
      'exactReleaseAndSnapshotVerified', 'callbacksAppliedOnce', 'sdkCheckpointAdvanced', 'sdkOldEventsFiltered',
      'sdkCrossSubscriptionRejected', 'sdkLifecycleTyped', 'childProcessesClosed']) expect(result[`${kind}_${check}`]).toBe(true);
  }
  for (const check of ['persistenceObserved', 'databasePoolClosed', 'portReleased']) expect(result[check]).toBe(true);
}, 95_000);
