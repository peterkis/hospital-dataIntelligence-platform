import assert from 'node:assert/strict';
import type { ClosureCheck, ClosureFixture } from './person-assignment-closure-fixture.js';

/** Integer sets, independent of production temporal helpers, model old/new knowledge. */
export async function runAssignmentClosureOracle(f: ClosureFixture, check: ClosureCheck) {
  await check(['EV-05', 'TM-09', 'PR-01', 'PR-03'], 'Fixed-seed integer-set oracle checks declared period and occupancy across old/new record knowledge', async () => {
    let seed = 6030107;
    const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const tick = (n: number) => `2026-07-01T00:00:00.${String(n).padStart(6, '0')}`;
    const samples = [];
    let pointAssertions = 0;
    for (let i = 0; i < 36; i++) {
      const from = 2 + next(15), priorEnd = i % 3 === 0 ? null : from + 2 + next(25);
      const ended = priorEnd !== null && i % 4 === 0 ? priorEnd : from + 1 + next(priorEnd === null ? 25 : priorEnd - from);
      const mode = i % 3 === 0 ? 'RAW' : i % 3 === 1 ? 'PRIMARY' : 'CONCURRENT';
      const e = await f.createEngagement(), period = { businessValidFrom: tick(from), businessValidTo: priorEnd === null ? null : tick(priorEnd) };
      const source = mode === 'RAW' ? await f.app().createAssignment(f.command(e.engagementId, period))
        : (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { ...period,
          modeCode: mode === 'PRIMARY' ? 'PRIMARY_AFFILIATION' : 'STANDING_CONCURRENT' }))).coreVersion;
      const oldR = await f.now(), closed = await f.closure().endAssignment(f.endCommand(source, tick(ended))), newR = await f.now();
      const universe = Array.from({ length: 80 }, (_, n) => n);
      const oldSet = new Set(universe.filter(n => n >= from && (priorEnd === null || n < priorEnd)));
      const closedSet = new Set(universe.filter(n => n >= from && n < ended));
      assert.ok([...closedSet].every(n => oldSet.has(n)));
      const points = [...new Set([from - 1, from, ended - 1, ended, ended + 1, priorEnd ?? 79])];
      for (const [knowledge, recordAsOf, expectedSet, selectedId] of [
        ['OLD', oldR, oldSet, source.assignmentVersionId], ['NEW', newR, closedSet, closed.assignmentVersionId],
      ] as const) for (const point of points) {
        const within = expectedSet.has(point), businessAt = tick(point);
        const declaration = await f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: source.assignmentId, businessAt, recordAsOf });
        assert.equal(declaration.isWithinDeclaredPeriod, within); assert.equal(declaration.selectedAssignmentVersionId, selectedId);
        assert.equal(declaration.explicitClosureKnownAsOf, knowledge === 'NEW');
        const resolution = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId,
          purposeCode: 'ORGANIZATIONAL_AFFILIATION', scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt, recordAsOf });
        const expected = !within || mode === 'CONCURRENT' ? 'NONE' : mode === 'RAW' ? 'UNKNOWN' : 'UNIQUE';
        assert.equal(resolution.resolution, expected);
        assert.equal(resolution.selectedAssignmentVersionId, expected === 'UNIQUE' ? selectedId : null);
        pointAssertions++;
      }
      samples.push({ mode, from, priorEnd, ended, points, oldR, newR, source: source.assignmentVersionId, closure: closed.assignmentVersionId });
    }
    return { seed: 6030107, sampleCount: samples.length, pointAssertions, oracle: 'FINITE_INTEGER_MICROSECOND_SETS', samples };
  });
}
