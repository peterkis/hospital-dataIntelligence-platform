import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('completes Department Master and Hierarchy consumption on real PostgreSQL and HTTP', () => {
  const root = resolve(import.meta.dirname, '../../../../..');
  const output = execFileSync(process.execPath, [
    '--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts',
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer /iu);
  const result = JSON.parse(output);
  expect(result.status).toBe('PASSED');
  for (const check of [
    'departmentMasterSubscriptionSupported', 'departmentHierarchySubscriptionSupported',
    'departmentMasterEventObserved', 'departmentHierarchyEventObserved',
    'departmentMasterSnapshotValidated', 'departmentHierarchySnapshotValidated',
    'snapshotDigestVerified', 'schemaDigestVerified', 'departmentMasterPayloadSchemaValid',
    'departmentHierarchyPayloadSchemaValid', 'departmentMasterReceiptApplied', 'departmentHierarchyReceiptApplied',
    'checkpointAdvanced', 'crossSubscriptionAccessRejected', 'governanceObjectProjectionMismatchRejected',
    'servicePrincipalKindEnforced', 'canonicalDepartmentSchemaDigestsUnchanged',
    'subscriptionVersionHistoryImmutable', 'incompatibleContractBlocked', 'persistenceObserved', 'databasePoolClosed',
  ]) expect(result[check], check).toBe(true);
  expect(result.migrationCount).toBe(16);
  expect(result.forbiddenTimezoneTypeCount).toBe(0);
}, 65_000);
