import { describe, expect, it } from 'vitest';
import { evaluateAssignmentPrimary } from './assignment-semantics-policy.js';

describe('Assignment purpose and scoped primary affiliation', () => {
  it('detects an interior microsecond overlap, allows touching boundaries and refuses unknown classification', () => {
    const candidate = { businessValidFrom: '2026-06-01T00:00:00', businessValidTo: '2026-08-01T00:00:00',
      purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'PRIMARY_AFFILIATION' };
    const interior = { assignmentId: 'other', assignmentVersionId: 'v1', businessValidFrom: '2026-07-01T00:00:00.000001',
      businessValidTo: '2026-07-01T00:00:00.000002', purposeCode: null, modeCode: null };
    expect(evaluateAssignmentPrimary(candidate, [interior]).result).toBe('ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE');
    expect(evaluateAssignmentPrimary(candidate, [{ ...interior, purposeCode: candidate.purposeCode,
      modeCode: candidate.modeCode }]).result).toBe('ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');
    expect(evaluateAssignmentPrimary(candidate, [{ ...interior, businessValidFrom: candidate.businessValidTo,
      businessValidTo: null }]).result).toBe('SATISFIED');
  });
  it('allows primary declarations for different purposes but refuses overlapping same-purpose declarations across departments', () => {
    const existing = [{ assignmentId: 'other', assignmentVersionId: 'other-v1',
      businessValidFrom: '2026-01-01T00:00:00', businessValidTo: null,
      purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'PRIMARY_AFFILIATION' }];
    const interval = { businessValidFrom: '2026-06-01T00:00:00', businessValidTo: null };
    expect(evaluateAssignmentPrimary({ ...interval, purposeCode: 'CLINICAL_PRACTICE',
      modeCode: 'PRIMARY_AFFILIATION' }, existing).result).toBe('SATISFIED');
    expect(evaluateAssignmentPrimary({ ...interval, purposeCode: 'ORGANIZATIONAL_AFFILIATION',
      modeCode: 'PRIMARY_AFFILIATION' }, existing).result).toBe('ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');
  });
});
