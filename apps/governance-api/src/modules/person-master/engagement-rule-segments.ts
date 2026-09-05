import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { EngagementOverlapDecision } from './engagement-policy-contracts.js';

export const TEMPORAL_LIMIT = 'ENGAGEMENT_TEMPORAL_EVALUATION_LIMIT_EXCEEDED';
export const MAX_RULE_CANDIDATES = 32;
export const MAX_RULE_SEGMENTS = 64;
export const MAX_OVERLAPPING_ENGAGEMENTS = 32;
export const MAX_TEMPORAL_AUDIT_BYTES = 65_536;
export interface TemporalRule {
  readonly engagement_overlap_rule_version_id: string;
  readonly engagement_overlap_rule_id: string;
  readonly version_no: string;
  readonly decision: EngagementOverlapDecision;
  readonly recorded_from: string;
  readonly business_valid_from: string;
  readonly business_valid_to: string | null;
}
export interface RuleSegment {
  readonly from: string;
  readonly to: string | null;
  readonly decision: EngagementOverlapDecision | 'MISSING';
  readonly winner: TemporalRule | null;
}
export function temporalKey(value: string): string {
  parseLocalDateTime(value);
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
}
export function segmentRules(
  from: string, to: string | null, recordAsOf: string, candidates: readonly TemporalRule[],
): readonly RuleSegment[] {
  const lower = temporalKey(from), upper = to === null ? null : temporalKey(to), r = temporalKey(recordAsOf);
  if (upper !== null && lower >= upper) throw new Error('ENGAGEMENT_TIME_INVALID');
  const visible = candidates.filter(v => temporalKey(v.recorded_from) <= r &&
    (upper === null || temporalKey(v.business_valid_from) < upper) &&
    (v.business_valid_to === null || temporalKey(v.business_valid_to) > lower));
  if (visible.length > MAX_RULE_CANDIDATES) throw new Error(TEMPORAL_LIMIT);
  const boundaries = new Set([lower]);
  if (upper !== null) boundaries.add(upper);
  for (const rule of visible) for (const value of [rule.business_valid_from, rule.business_valid_to]) {
    if (value === null) continue;
    const key = temporalKey(value);
    if (key > lower && (upper === null || key < upper)) boundaries.add(key);
  }
  const points = [...boundaries].sort();
  const count = points.length - (upper === null ? 0 : 1);
  if (count > MAX_RULE_SEGMENTS) throw new Error(TEMPORAL_LIMIT);
  return points.slice(0, count).map((start, index) => {
    const winner = visible.filter(v => temporalKey(v.business_valid_from) <= start &&
      (v.business_valid_to === null || temporalKey(v.business_valid_to) > start))
      .reduce<TemporalRule | null>((best, v) => !best || BigInt(v.version_no) > BigInt(best.version_no) ? v : best, null);
    return { from: start, to: points[index + 1] ?? null, decision: winner?.decision ?? 'MISSING', winner };
  });
}
export type OverlapFailureCode = 'ENGAGEMENT_OVERLAP_FORBIDDEN' |
  'ENGAGEMENT_OVERLAP_RULE_MISSING' | 'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED';
export function segmentFailure(segments: readonly RuleSegment[]): OverlapFailureCode | null {
  if (segments.some(s => s.decision === 'FORBID')) return 'ENGAGEMENT_OVERLAP_FORBIDDEN';
  if (segments.some(s => s.decision === 'MISSING')) return 'ENGAGEMENT_OVERLAP_RULE_MISSING';
  if (segments.some(s => s.decision === 'REVIEW_REQUIRED')) return 'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED';
  return null;
}
