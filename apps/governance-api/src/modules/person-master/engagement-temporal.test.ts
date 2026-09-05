import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { segmentRules, segmentFailure, TEMPORAL_LIMIT, type TemporalRule } from './engagement-rule-segments.js';
import type { EngagementPeriodAssertion } from './engagement-contracts.js';
import type { EngagementEffectiveContext, EngagementEffectiveReader } from './engagement-effective-contracts.js';

const tick = (n: number) => `2026-07-01T00:00:00.${String(n).padStart(6, '0')}`;
const rule = (version: number, from: number, to: number | null,
  decision: TemporalRule['decision'], recorded = 1): TemporalRule => ({
  engagement_overlap_rule_id: 'rule', engagement_overlap_rule_version_id: `v${version}`,
  version_no: String(version), business_valid_from: tick(from),
  business_valid_to: to === null ? null : tick(to), recorded_from: tick(recorded), decision,
});

describe('B04 rule boundary oracle', () => {
  it('matches an independent integer oracle across 1500 deterministic cases and record views', () => {
    let seed = 704;
    const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let trial = 0; trial < 1500; trial++) {
      const input = Array.from({ length: 1 + next(8) }, (_, i) => {
        const from = next(12);
        return { version: i + 1, from, to: next(4) === 0 ? null : from + 1 + next(7),
          decision: (['ALLOW', 'FORBID', 'REVIEW_REQUIRED'] as const)[next(3)]!, recorded: next(5) };
      });
      for (const recordAt of [0, 2, 4]) {
        const segments = segmentRules(tick(0), tick(20), tick(recordAt), input.map(v =>
          rule(v.version, v.from, v.to, v.decision, v.recorded)));
        expect(segments[0]!.from).toBe(tick(0));
        expect(segments.at(-1)!.to).toBe(tick(20));
        for (let i = 1; i < segments.length; i++) expect(segments[i - 1]!.to).toBe(segments[i]!.from);
        for (let b = 0; b < 20; b++) {
          let expected: typeof input[number] | undefined;
          for (const v of input) if (v.recorded <= recordAt && v.from <= b && (v.to === null || b < v.to)) expected = v;
          const owners = segments.filter(s => s.from <= tick(b) && (s.to === null || tick(b) < s.to));
          expect(owners).toHaveLength(1);
          expect(owners[0]!.winner?.engagement_overlap_rule_version_id ?? null).toBe(expected ? `v${expected.version}` : null);
          expect(owners[0]!.decision).toBe(expected?.decision ?? 'MISSING');
        }
      }
    }
  });
  it('keeps a one-microsecond FORBID, half-open boundaries and an unbounded missing tail', () => {
    const rules = [rule(1, 0, null, 'ALLOW'), rule(2, 5, 6, 'FORBID')];
    expect(segmentRules(tick(0), tick(10), tick(2), rules).map(s => s.decision)).toEqual(['ALLOW', 'FORBID', 'ALLOW']);
    expect(segmentFailure(segmentRules(tick(0), tick(5), tick(2), rules))).toBeNull();
    expect(segmentFailure(segmentRules(tick(5), tick(6), tick(2), rules))).toBe('ENGAGEMENT_OVERLAP_FORBIDDEN');
    expect(segmentRules(tick(0), null, tick(2), [rule(1, 0, 4, 'ALLOW')]).at(-1))
      .toMatchObject({ from: tick(4), to: null, decision: 'MISSING' });
  });
  it('normalizes fractional precision and enforces candidate and segment limits', () => {
    const r = { ...rule(1, 0, null, 'ALLOW'), business_valid_from: '2026-07-01T00:00:00.1' };
    expect(segmentRules('2026-07-01T00:00:00.100000', null, tick(2), [r])[0]!.decision).toBe('ALLOW');
    expect(() => segmentRules(tick(0), null, tick(2), Array.from({ length: 33 }, (_, i) => rule(i + 1, 0, null, 'ALLOW'))))
      .toThrow(TEMPORAL_LIMIT);
    expect(() => segmentRules(tick(0), tick(100), tick(2), Array.from({ length: 32 }, (_, i) => rule(i + 1, i * 2 + 1, i * 2 + 2, 'ALLOW'))))
      .toThrow(TEMPORAL_LIMIT);
  });
  it('reports deterministic error priority without taking the strictest historical decision', () => {
    expect(segmentFailure(segmentRules(tick(0), tick(20), tick(2), [rule(1, 1, 2, 'REVIEW_REQUIRED'), rule(2, 5, 6, 'FORBID')]))).toBe('ENGAGEMENT_OVERLAP_FORBIDDEN');
    expect(segmentFailure(segmentRules(tick(0), tick(20), tick(2), [rule(1, 1, 2, 'REVIEW_REQUIRED')]))).toBe('ENGAGEMENT_OVERLAP_RULE_MISSING');
    expect(segmentFailure(segmentRules(tick(0), tick(20), tick(2), [rule(1, 0, null, 'FORBID'), rule(2, 0, 20, 'ALLOW')]))).toBeNull();
  });
});

describe('B04 capability separation', () => {
  it('keeps historical calls in the explicit compatibility allowlist', () => {
    const directory = new URL('.', import.meta.url);
    const allow = new Set(['engagement-contracts.ts', 'engagement-repository.ts', 'engagement-application.ts']);
    for (const file of readdirSync(directory).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      if (allow.has(file)) continue;
      expect(readFileSync(new URL(file, directory), 'utf8')).not.toMatch(/findEngagementAsOf|findEngagementPeriodAssertionAsOf/);
    }
    const core = readFileSync(new URL('engagement-repository.ts', directory), 'utf8');
    const mutations = core.slice(core.indexOf('async createEngagement(command)'), core.indexOf('async getEngagement(query)'));
    expect(mutations).not.toMatch(/historicalAssertion|findEngagementAsOf|findEngagementPeriodAssertionAsOf/);
    const resolver = readFileSync(new URL('engagement-temporal-resolver.ts', directory), 'utf8');
    expect(resolver.match(/\.execute\(database\)/gu)).toHaveLength(1);
    expect(resolver).not.toMatch(/forUpdate|advisory.*lock|setIsolationLevel/);
  });
});

// Compiled consumer stub; never invoked. A history result is not effective authority.
function checkConsumerTypes(history: EngagementPeriodAssertion, reader: EngagementEffectiveReader) {
  // @ts-expect-error Discriminant and authority fields prevent historical substitution.
  const effective: EngagementEffectiveContext = history;
  // @ts-expect-error The public reader has no mutation entrypoint.
  reader.createEngagement({});
  // @ts-expect-error Period presence does not decide clinical or assignment eligibility.
  effective.canAssign;
}
void checkConsumerTypes;
