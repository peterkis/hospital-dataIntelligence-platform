import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('closes both Department C hardening chains through committed operational metrics and process restart', () => {
  const output = execFileSync(process.execPath, ['--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts', '--metrics'], {
    cwd: resolve(import.meta.dirname, '../../../../..'), windowsHide: true, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer/iu);
  const result = JSON.parse(output);
  expect(result.scenario).toBe('PV-005-C-04');
  for (const kind of ['departmentMaster', 'departmentHierarchy']) for (const check of [
    'metricsDigestFailuresNoClosure', 'metricsCallbackFailure', 'metricsProcessingDigestNoClosure',
    'metricsReceiptRollback', 'metricsAuditRetry', 'metricsSlaNotConfigured', 'metricsSlaNeverApplied',
    'metricsLifecycleOverride', 'metricsAppliedSuccess', 'metricsSlaHealthy', 'metricsPublishRollbackRetry',
    'metricsReplaySuccessFailure', 'metricsReplayRetryNoApply', 'metricsDryRunExcluded', 'metricsSlaLate',
    'metricsLagFormula', 'metricsRevokedArchivedOverride', 'auditReplayTerminals',
  ]) expect(result[`${kind}_${check}`], `${kind}_${check}`).toBe(true);
  for (const check of ['metricsRestartPersistence', 'metricsEndpointNoSecrets', 'auditRestartPersistence',
    'invalidProjectionPairRejected', 'servicePrincipalKindEnforced', 'crossSubscriptionAccessRejected',
    'databasePoolClosed', 'portReleased']) expect(result[check], check).toBe(true);
  expect(result.forbiddenTimezoneTypeCount).toBe(0);
}, 185_000);
