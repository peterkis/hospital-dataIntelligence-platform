import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('replays Master and Hierarchy through the CLI over real PostgreSQL, with durable restart and monotonic checkpoints', () => {
  const output = execFileSync(process.execPath, ['--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts', '--replay'], {
    cwd: resolve(import.meta.dirname, '../../../../..'), windowsHide: true, encoding: 'utf8', timeout: 120_000,
  });
  expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer/iu);
  const result = JSON.parse(output);
  expect(result.scenario).toBe('PV-005-C-02');
  for (const kind of ['departmentMaster', 'departmentHierarchy']) {
    for (const check of ['replayDryRunZeroMutation', 'replayExactSuccess', 'replayIdempotentRestart', 'replayOldCheckpointMonotonic',
      'replayArtifactBytesUnchanged', 'replayCrossSubscriptionOpaque', 'replayLifecycleRejected', 'replayStdoutSafe', 'replayExitCodesCorrect',
      'replayFailedApplyRecovered', 'replayFrozenSubscriptionVersion', 'replayAuditVerified']) {
      expect(result[`${kind}_${check}`], `${kind}_${check}`).toBe(true);
    }
  }
  for (const check of ['persistenceObserved', 'databasePoolClosed', 'portReleased']) expect(result[check]).toBe(true);
}, 125_000);
