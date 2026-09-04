import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { readdirSync } from 'node:fs';

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
  expect(result.migrationCount).toBe(readdirSync(resolve(root, 'db/migrations')).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).length);
  expect(result.forbiddenTimezoneTypeCount).toBe(0);
}, 65_000);

it('enforces subscription lifecycle through HTTP, modules and persistent PostgreSQL transactions', () => {
  const root = resolve(import.meta.dirname, '../../../../..');
  const output = execFileSync(process.execPath, [
    '--env-file-if-exists=.env.prototype.local', '--import', 'tsx',
    'tooling/prototype/validate-department-consumer-flow.ts', '--lifecycle',
  ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer /iu);
  const result = JSON.parse(output);
  expect(result.status).toBe('PASSED');
  expect(result.scenario).toBe('PV-005-B-03A');
  for (const check of [
    'lifecycleDefaultActive', 'lifecycleLegalTransitions', 'lifecycleRetriesIdempotent',
    'lifecycleInvalidTransitionsRejected', 'lifecycleConsumerBoundaryEnforced',
    'lifecycleSuspendedVersionAllowed', 'lifecycleTerminalVersionRejected',
    'lifecycleHistoryPreserved', 'lifecycleAuditAtomicAndVerifiable',
    'lifecycleConcurrentReceiptBlocked', 'lifecycleServicePrincipalStillRequired',
    'lifecycleRuntimeValuesRejected', 'lifecycleArchivedDispatcherBlocked', 'lifecyclePersistenceObserved',
    'lifecycleSuspendedBacklogPreserved', 'lifecycleTerminalPublicationSkipped',
    'databasePoolClosed', 'portReleased',
  ]) expect(result[check], check).toBe(true);
}, 65_000);
