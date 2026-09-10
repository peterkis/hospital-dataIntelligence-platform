import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentDeclaredCoverage, validateAssignmentEffectivePeriodQuery } from '../../apps/governance-api/src/modules/person-master/assignment-effective-period-contracts.js';

const stamp = (value: number) => `2026-01-01T00:00:00.${String(value).padStart(6, '0')}`;
test('CS-05/DC-03/06/07: independent integer-set oracle for half-open microsecond coverage and complete difference', () => {
  let cases = 0, pointAssertions = 0;
  for (let df = 0; df < 8; df++) for (const dt of [...Array.from({ length: 9 - df }, (_,i) => df + i + 1), null])
    for (let wf = 0; wf < 10; wf++) for (const wt of [...Array.from({ length: 11 - wf }, (_,i) => wf + i + 1), null]) {
      const requested = Array.from({ length: 14 }, (_,i) => i).filter(i => i >= wf && (wt === null || i < wt));
      const covered = requested.filter(i => i >= df && (dt === null || i < dt));
      const result = assignmentDeclaredCoverage({ from: stamp(df), to: dt === null ? null : stamp(dt) },
        { from: stamp(wf), to: wt === null ? null : stamp(wt) });
      assert.equal(result.declaredCoverage, covered.length === requested.length ? 'FULL' : covered.length === 0 ? 'NONE' : 'PARTIAL');
      for (let point = 0; point < 14; point++) {
        const gapContains = result.uncoveredPeriods.some(gap => point >= Number(gap.from.slice(-6)) && (gap.to === null || point < Number(gap.to.slice(-6))));
        assert.equal(gapContains, requested.includes(point) && !covered.includes(point)); pointAssertions++;
      }
      assert.ok(result.uncoveredPeriods.length <= 2); cases++;
    }
  assert.ok(cases > 3000); assert.ok(pointAssertions > 42000);
  console.log(JSON.stringify({ oracle: 'independent-discrete-microsecond-sets', cases, pointAssertions }));
});
test('SC-05/CS-07/AU-08: closed input preserves normalized microseconds and refuses forged authority fields', () => {
  const valid = { governanceObjectId: '76000000-0000-7000-8000-000000000001', assignmentId: '76000000-0000-7000-8000-000000000002',
    requestedFrom: '2026-01-01T00:00:00', requestedTo: null, recordAsOf: '2026-09-09T00:00:00.1' };
  assert.equal(validateAssignmentEffectivePeriodQuery(valid).recordAsOf, '2026-09-09T00:00:00.100000');
  for (const key of ['expectedValid','approved','role','rawSql','assignmentVersionId','fallback'])
    assert.throws(() => validateAssignmentEffectivePeriodQuery({ ...valid, [key]: true }));
  for (const requestedTo of [valid.requestedFrom, 'infinity','2026-07-01T00:00:00Z','2026-07-01T00:00:00+08:00','0000-07-01T00:00:00'])
    assert.throws(() => validateAssignmentEffectivePeriodQuery({ ...valid, requestedTo }));
});
