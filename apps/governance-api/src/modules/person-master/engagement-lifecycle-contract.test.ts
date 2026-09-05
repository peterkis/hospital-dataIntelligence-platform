import { describe, expect, it } from 'vitest';
import {
  deriveEngagementBusinessState,
  safeEngagementLifecycleError,
  validateEndEngagement,
  validateEngagementBusinessStateQuery,
  validateResumeEngagement,
  validateSuspendEngagement,
} from './index.js';

const governanceObjectId = '76000000-0000-7000-8000-000000000001';
const engagementId = '76000000-0000-7000-8000-000000000002';
const expectedCurrentEngagementVersionId = '76000000-0000-7000-8000-000000000003';

describe('Person Engagement business lifecycle contract', () => {
  it('derives only PLANNED, ACTIVE, SUSPENDED and ENDED from period plus lifecycle evidence', () => {
    const period = {
      businessValidFrom: '2026-02-01T00:00:00',
      businessValidTo: '2026-09-01T00:00:00',
    } as const;
    expect(deriveEngagementBusinessState({ ...period,
      businessAt: '2026-01-31T23:59:59', lastApplicableEventType: null })).toBe('PLANNED');
    expect(deriveEngagementBusinessState({ ...period,
      businessAt: '2026-02-01T00:00:00', lastApplicableEventType: null })).toBe('ACTIVE');
    expect(deriveEngagementBusinessState({ ...period,
      businessAt: '2026-04-01T00:00:00', lastApplicableEventType: 'SUSPENDED' })).toBe('SUSPENDED');
    expect(deriveEngagementBusinessState({ ...period,
      businessAt: '2026-05-01T00:00:00', lastApplicableEventType: 'RESUMED' })).toBe('ACTIVE');
    expect(deriveEngagementBusinessState({ ...period,
      businessAt: '2026-09-01T00:00:00', lastApplicableEventType: 'SUSPENDED' })).toBe('ENDED');
  });

  it('validates bounded append-only suspend and resume commands with an expected sequence', () => {
    const suspend = { governanceObjectId, engagementId,
      businessEffectiveAt: '2026-04-01T08:00:00', expectedLifecycleSequence: '0',
      reasonCode: 'SYNTHETIC_ADMINISTRATIVE_HOLD' } as const;
    validateSuspendEngagement(suspend);
    validateResumeEngagement({ ...suspend, expectedLifecycleSequence: '1',
      businessEffectiveAt: '2026-04-10T08:00:00', reasonCode: 'SYNTHETIC_HOLD_CLEARED' });
    expect(() => validateSuspendEngagement({ ...suspend, expectedLifecycleSequence: '-1' }))
      .toThrow('ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID');
    expect(() => validateResumeEngagement({ ...suspend, reasonCode: 'free text reason' }))
      .toThrow('ENGAGEMENT_LIFECYCLE_REASON_INVALID');
    expect(() => validateSuspendEngagement({ ...suspend, currentStatus: 'ACTIVE' } as never))
      .toThrow('PERSON_INPUT_INVALID');
  });

  it('requires an expected current Engagement version for end and keeps time offset-free', () => {
    const command = { governanceObjectId, engagementId, expectedCurrentEngagementVersionId,
      businessEffectiveAt: '2026-08-01T00:00:00', reasonCode: 'SYNTHETIC_RELATION_ENDED' } as const;
    validateEndEngagement(command);
    expect(() => validateEndEngagement({ ...command, expectedCurrentEngagementVersionId: '' }))
      .toThrow('ENGAGEMENT_EXPECTED_VERSION_INVALID');
    expect(() => validateEndEngagement({ ...command,
      businessEffectiveAt: '2026-08-01T00:00:00+08:00' }))
      .toThrow('ENGAGEMENT_LIFECYCLE_TIME_INVALID');
  });

  it('requires businessAt and recordAsOf for the derived-state query', () => {
    validateEngagementBusinessStateQuery({ governanceObjectId, engagementId,
      businessAt: '2026-04-01T00:00:00', recordAsOf: '2026-04-02T00:00:00' });
    expect(() => validateEngagementBusinessStateQuery({ governanceObjectId, engagementId,
      businessAt: '2026-04-01T00:00:00', recordAsOf: '2026-04-02T00:00:00Z' }))
      .toThrow('ENGAGEMENT_LIFECYCLE_TIME_INVALID');
  });

  it('discards raw database details from lifecycle errors', () => {
    const unsafe = Object.assign(new Error('SYNTHETIC-SENSITIVE-BASIS'), {
      detail: 'SYNTHETIC-SENSITIVE-BASIS', code: '23514',
    });
    const safe = safeEngagementLifecycleError(unsafe);
    expect(safe.message).toBe('ENGAGEMENT_LIFECYCLE_OPERATION_FAILED');
    expect(JSON.stringify(safe)).toBe('{}');
    expect(safe.stack?.includes('SYNTHETIC-SENSITIVE-BASIS')).toBe(false);
  });
});
