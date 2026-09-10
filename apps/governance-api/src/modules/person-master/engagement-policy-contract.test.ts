import { describe, expect, it } from 'vitest';
import {
  canonicalizeEngagementTypePair,
  validateAppendEngagementOverlapRuleVersion,
  validateAppendEngagementTypeVersion,
} from './index.js';

const governanceObjectId = '76000000-0000-7000-8000-000000000001';
const baseValidity = {
  businessValidFrom: '2020-01-01T00:00:00',
  businessValidTo: null,
};

describe('Person Engagement classification and overlap policy contract', () => {
  it('accepts only the four frozen top-level categories', () => {
    for (const categoryCode of [
      'LABOR_OR_HR',
      'DISPATCH_OR_SERVICE',
      'EXTERNAL_PROFESSIONAL',
      'TRAINING_OR_LEARNING',
    ] as const) {
      validateAppendEngagementTypeVersion({ governanceObjectId,
        typeCode: 'CONTRACT_EMPLOYEE', expectedCurrentVersionId: null,
        categoryCode, displayName: 'SYNTHETIC CONTRACT EMPLOYEE', ...baseValidity });
    }
    expect(() => validateAppendEngagementTypeVersion({ governanceObjectId,
      typeCode: 'CONTRACT_EMPLOYEE', expectedCurrentVersionId: null,
      categoryCode: 'EMPLOYEE' as 'LABOR_OR_HR', displayName: 'SYNTHETIC', ...baseValidity }))
      .toThrow('ENGAGEMENT_CATEGORY_CODE_INVALID');
  });

  it('requires stable machine codes and bounded synthetic display names', () => {
    for (const typeCode of ['', 'contract_employee', ' CONTRACT_EMPLOYEE', 'CONTRACT-EMPLOYEE']) {
      expect(() => validateAppendEngagementTypeVersion({ governanceObjectId,
        typeCode, expectedCurrentVersionId: null, categoryCode: 'LABOR_OR_HR',
        displayName: 'SYNTHETIC', ...baseValidity })).toThrow('ENGAGEMENT_TYPE_CODE_INVALID');
    }
  });

  it('canonicalizes symmetric pairs and accepts the three closed decisions', () => {
    expect(canonicalizeEngagementTypePair('PERMANENT_EMPLOYEE', 'CONTRACT_EMPLOYEE'))
      .toEqual(['CONTRACT_EMPLOYEE', 'PERMANENT_EMPLOYEE']);
    expect(canonicalizeEngagementTypePair('INTERN', 'INTERN')).toEqual(['INTERN', 'INTERN']);
    for (const decision of ['ALLOW', 'FORBID', 'REVIEW_REQUIRED'] as const) {
      validateAppendEngagementOverlapRuleVersion({ governanceObjectId,
        leftEngagementTypeCode: 'PERMANENT_EMPLOYEE',
        rightEngagementTypeCode: 'CONTRACT_EMPLOYEE', expectedCurrentVersionId: null,
        decision, ...baseValidity });
    }
    expect(() => validateAppendEngagementOverlapRuleVersion({ governanceObjectId,
      leftEngagementTypeCode: 'PERMANENT_EMPLOYEE',
      rightEngagementTypeCode: 'CONTRACT_EMPLOYEE', expectedCurrentVersionId: null,
      decision: 'WARN' as 'ALLOW', ...baseValidity })).toThrow('ENGAGEMENT_OVERLAP_DECISION_INVALID');
  });
});
