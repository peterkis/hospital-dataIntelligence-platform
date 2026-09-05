import { describe, expect, it } from 'vitest';
import {
  safeEngagementError, validateEngagementCreation, validateEngagementPeriod,
  validateEngagementRevision, validateEngagementTimes,
} from './index.js';

const governanceObjectId = '76000000-0000-7000-8000-000000000001';
const personId = '76000000-0000-7000-8000-000000000002';
const engagementId = '76000000-0000-7000-8000-000000000003';
const expectedCurrentVersionId = '76000000-0000-7000-8000-000000000004';
const validity = { businessValidFrom: '2026-01-01T00:00:00', businessValidTo: null };
const creation = { governanceObjectId, personId,
  relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS' as const, ...validity };

describe('Person Engagement Core contract', () => {
  it('requires a governed type code and an explicit distinct-relation declaration', () => {
    const classifiedCreation = { ...creation, engagementTypeCode: 'CONTRACT_EMPLOYEE' };
    validateEngagementCreation(classifiedCreation);
    expect(() => validateEngagementCreation(creation as typeof classifiedCreation))
      .toThrow('ENGAGEMENT_TYPE_CODE_INVALID');
    expect(() => validateEngagementCreation({ ...classifiedCreation,
      relationBasis: 'REUSE_PREVIOUS_RELATION' } as unknown as typeof classifiedCreation))
      .toThrow('ENGAGEMENT_RELATION_BASIS_REQUIRED');
  });

  it('keeps category mutation, lifecycle, assignment, role and credential facts absent', () => {
    for (const forbidden of ['engagementType', 'engagementCategory', 'employmentType', 'employmentStatus',
      'businessState', 'lifecycleState', 'departmentId', 'campusId', 'jobCode', 'roleCode',
      'credential', 'basisReference', 'contractNo', 'employeeNo']) {
      expect(() => validateEngagementCreation({ ...creation,
        engagementTypeCode: 'CONTRACT_EMPLOYEE', [forbidden]: 'SYNTHETIC' }))
        .toThrow('PERSON_INPUT_INVALID');
    }
  });

  it('requires an existing Engagement, expected current version and bounded reason for revision', () => {
    const revision = { governanceObjectId, engagementId, expectedCurrentVersionId, ...validity,
      reasonCode: 'CONTINUATION_EXTENSION' as const };
    validateEngagementRevision(revision);
    expect(() => validateEngagementRevision({ ...revision, expectedCurrentVersionId: '' }))
      .toThrow('ENGAGEMENT_EXPECTED_VERSION_INVALID');
    expect(() => validateEngagementRevision({ ...revision,
      reasonCode: 'REHIRE' } as unknown as typeof revision)).toThrow('ENGAGEMENT_REASON_INVALID');
    expect(() => validateEngagementRevision({ ...revision,
      personId } as unknown as typeof revision)).toThrow('PERSON_INPUT_INVALID');
    expect(() => validateEngagementRevision({ ...revision,
      engagementTypeCode: 'PERMANENT_EMPLOYEE' } as unknown as typeof revision))
      .toThrow('PERSON_INPUT_INVALID');
  });

  it('accepts only the B-01 revision reason closed set', () => {
    for (const reasonCode of ['FACT_CORRECTION', 'VALIDITY_CORRECTION', 'CONTINUATION_EXTENSION'] as const) {
      validateEngagementRevision({ governanceObjectId, engagementId, expectedCurrentVersionId,
        ...validity, reasonCode });
    }
  });

  for (const invalid of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00+08:00',
    '2026-02-29T00:00:00']) {
    it(`rejects invalid Asia/Shanghai local business time ${invalid}`, () => {
      expect(() => validateEngagementPeriod({ businessValidFrom: invalid, businessValidTo: null }))
        .toThrow('ENGAGEMENT_TIME_INVALID');
    });
  }

  it('rejects empty or inverted half-open periods and offset record time', () => {
    expect(() => validateEngagementPeriod({ businessValidFrom: '2026-01-01T00:00:00',
      businessValidTo: '2026-01-01T00:00:00.000000' })).toThrow('ENGAGEMENT_TIME_INVALID');
    expect(() => validateEngagementTimes({ businessAt: '2026-01-01T00:00:00',
      recordAsOf: '2026-01-01T00:00:00Z' })).toThrow('ENGAGEMENT_TIME_INVALID');
  });

  it('discards raw database details from public errors', () => {
    const unsafe = Object.assign(new Error('SYNTHETIC-CONTRACT-REFERENCE'), {
      detail: 'SYNTHETIC-CONTRACT-REFERENCE', code: '23505',
      cause: new Error('SYNTHETIC-CONTRACT-REFERENCE'),
    });
    const safe = safeEngagementError(unsafe);
    expect(safe.message).toBe('ENGAGEMENT_OPERATION_FAILED');
    expect(JSON.stringify(safe)).toBe('{}');
    expect(safe.cause).toBeUndefined();
    expect(safe.stack?.includes('SYNTHETIC-CONTRACT-REFERENCE')).toBe(false);
  });
});
