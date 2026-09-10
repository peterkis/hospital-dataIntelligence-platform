import assert from 'node:assert/strict';
import { Jan, Jul, Aug } from './person-assignment-fixture.js';
import type { ClosureFixture, ClosureCheck } from './person-assignment-closure-fixture.js';

export async function runAssignmentClosureHistory(f: ClosureFixture, check: ClosureCheck) {
  await check(['SE-02', 'PR-01', 'PR-04', 'PR-05', 'TM-06', 'TM-09'],
    'New record knowledge retains PRIMARY before the end, releases at the boundary and preserves older knowledge', async () => {
      const engagement = await f.createEngagement();
      const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId));
      const oldR = await f.now();
      const closed = await f.closure().endAssignment(f.endCommand(source.coreVersion, Aug));
      const newR = await f.now();
      const query = { ...f.scope, engagementId: engagement.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION' as const,
        scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS' as const };
      const before = await f.semantics().resolvePrimaryAffiliation({ ...query, businessAt: Jul, recordAsOf: newR });
      assert.equal(before.resolution, 'UNIQUE');
      assert.equal(before.selectedAssignmentVersionId, closed.assignmentVersionId);
      const boundary = await f.semantics().resolvePrimaryAffiliation({ ...query, businessAt: Aug, recordAsOf: newR });
      assert.equal(boundary.resolution, 'NONE');
      const historical = await f.semantics().resolvePrimaryAffiliation({ ...query, businessAt: '2026-09-01T00:00:00', recordAsOf: oldR });
      assert.equal(historical.resolution, 'UNIQUE');
      assert.equal(historical.selectedAssignmentVersionId, source.coreVersion.assignmentVersionId);
      const reference = { ...f.scope, assignmentId: closed.assignmentId, assignmentVersionId: closed.assignmentVersionId };
      const inherited = await f.semantics().getAssignmentVersionSemantics(reference);
      assert.equal(inherited.classification, 'CLASSIFIED');
      assert.ok('semanticRole' in inherited);
      assert.equal(inherited.semanticRole, 'INHERITED_FOR_CLOSURE');
      const asOf = (businessAt: string, recordAsOf = newR) => f.closure().getAssignmentDeclaredPeriodAsOf({
        ...f.scope, assignmentId: closed.assignmentId, businessAt, recordAsOf });
      assert.equal((await asOf('2026-07-31T23:59:59.999999')).isWithinDeclaredPeriod, true);
      assert.equal((await asOf(Aug)).isWithinDeclaredPeriod, false);
      assert.equal((await asOf(Aug)).endBoundaryReached, true);
      assert.equal((await asOf(Jan)).explicitClosureKnownAsOf, true);
      assert.equal((await asOf(Aug, oldR)).explicitClosureKnownAsOf, false);
      return { source: source.coreVersion.assignmentVersionId, closed: closed.assignmentVersionId, oldR, newR, before, boundary, historical };
    });
}
