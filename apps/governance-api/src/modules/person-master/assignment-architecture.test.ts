import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
it('keeps Assignment on owner ports, with no historical fallback or cross-owner table SQL', () => {
  const source = read('./assignment-repository.ts');
  expect(source).not.toMatch(/department_master\.|findEngagementAsOf|findEngagementPeriodAssertionAsOf/);
  expect(source).not.toMatch(/person_master\.(?:engagement|engagement_version|engagement_lifecycle_event)\b/);
  expect(source).not.toMatch(/as unknown as|\.updateTable\(|\.deleteFrom\(|sql\.raw/);
  const period = read('./engagement-effective-period.ts');
  expect(period).toContain('resolveEngagementTemporalContext');
  expect(period).toContain('deriveEngagementBusinessState');
  expect(period).not.toMatch(/findEngagementAsOf|findEngagementPeriodAssertionAsOf|new Date|setInterval/);
  const department = read('../department-master/placement-reference.ts');
  expect(department).not.toMatch(/person_master\.|DepartmentSummaryDTO|hierarchy_node|campus_id|standard_name/);
});
it('binds both owner readers and Assignment to one scoped database transaction', () => {
  const composition = read('../../composition/create-assignment-application.ts');
  expect(composition).toContain('createEngagementEffectivePeriodScope(database, authorization');
  expect(composition).toContain('createDepartmentPlacementReferenceScope(database, authorization');
  expect(composition).toContain('createAssignmentCoreModule(database, context');
  expect(composition).toContain("setIsolationLevel('repeatable read')");
  expect(composition).not.toMatch(/createEngagementEffectiveReader\(|createDepartmentQueryService\(/);
});
it('does not introduce Assignment role, purpose, campus or approval state into closed commands', () => {
  const contract = read('./assignment-contracts.ts');
  expect(contract).not.toMatch(/readonly (?:primary|assignmentPurpose|mode|roleId|campusId|approval|canAssign|canPractice):/);
  const mutationContracts = [...contract.matchAll(/export interface (?:CreateAssignment|ReviseAssignment)[^{]*\{([\s\S]*?)\n\}/gu)].map(m => m[1]).join('\n');
  expect(mutationContracts).not.toContain('recordAsOf');
  expect(contract).not.toMatch(/createVersion|upsert|deleteAssignment|moveAssignment|rebindAssignment/);
});
