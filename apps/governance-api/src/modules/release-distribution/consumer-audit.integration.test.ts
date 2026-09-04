import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('persists the Consumer Release evidence chain, denial and replay history with bounded isolated queries and atomic receipts', () => {
  const output = execFileSync(process.execPath, ['--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts', '--audit'], {
    cwd: resolve(import.meta.dirname, '../../../../..'), windowsHide: true, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer/iu);
  const result = JSON.parse(output);
  expect(result.scenario).toBe('PV-005-C-03');
  for (const kind of ['departmentMaster', 'departmentHierarchy']) for (const check of [
    'auditTaxonomy', 'auditPaginationBounds', 'auditIsolation', 'auditAppendOnly', 'auditMutationRoutesAbsent',
    'auditSecretsAbsent', 'auditAtomicReceiptRollback', 'auditVerificationApplyFailure', 'auditReplayTerminals',
  ]) expect(result[`${kind}_${check}`]).toBe(true);
  expect(result.auditRestartPersistence).toBe(true);
  expect(result.forbiddenTimezoneTypeCount).toBe(0);
  expect(result.databasePoolClosed).toBe(true); expect(result.portReleased).toBe(true);
}, 125_000);
