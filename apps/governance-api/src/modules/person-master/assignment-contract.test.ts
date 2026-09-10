import { expect, it } from 'vitest';
import { assignmentPeriodCovered, assignmentEngagementConstraint, validateAssignmentCreate, validateAssignmentRevise,
  type AssignmentDependencyEvidence, type CreateAssignment } from './assignment-contracts.js';
import type { EngagementPeriodAssertion } from './engagement-contracts.js';
import type { DepartmentSummaryDTO } from '../department-master/index.js';

// SYNTHETIC / NON_PRODUCTION / ASSIGNMENT_DEPARTMENT_CORE_V1 test policy.
it('rejects a placement whose start is valid but whose tail exceeds its authoritative Engagement', () => {
  expect(assignmentPeriodCovered(
    '2026-01-01T00:00:00', '2026-08-01T00:00:00',
    '2026-07-01T00:00:00', '2026-12-01T00:00:00',
  )).toBe(false);
});

it('matches 1500 independent integer containment cases with infinity and mixed fractional precision', () => {
  let seed = 601;
  const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const tick = (n: number) => `2026-07-01T00:00:00.${String(n * 1000).padStart(6, '0').replace(/0+$/u, '') || '0'}`;
  for (let i = 0; i < 1500; i++) {
    const p = next(10), q = next(4) === 0 ? null : p + 1 + next(10);
    const a = next(15), b = next(4) === 0 ? null : a + 1 + next(10);
    const expected = a >= p && (q === null || (b !== null && b <= q));
    expect(assignmentPeriodCovered(tick(p), q === null ? null : tick(q),
      tick(a), b === null ? null : tick(b))).toBe(expected);
  }
});

const valid: CreateAssignment = {
  governanceObjectId: '76000000-0000-7000-8000-000000000001', engagementId: '76000000-0000-7000-8000-000000000002',
  relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', placement: { scope: 'DEPARTMENT',
    departmentGovernanceObjectId: '74000000-0000-7000-8000-000000000001', departmentId: '74000000-0000-7000-8000-000000000002' },
  businessValidFrom: '2026-07-01T00:00:00', businessValidTo: null,
};
it('rejects forged dependency inputs, unsupported scopes and binding revisions as closed objects', () => {
  for (const key of ['personId', 'recordAsOf', 'evaluationRecordAsOf', 'authorityVersionId', 'snapshot', 'hash',
    'validated', 'approval', 'force', 'override', 'allowSuspended', 'primary', 'mode', 'assignmentPurpose'])
    expect(() => validateAssignmentCreate({ ...valid, [key]: 'FORGED' })).toThrow();
  for (const scope of ['HOSPITAL', 'CAMPUS', 'GROUP'])
    expect(() => validateAssignmentCreate(JSON.parse(JSON.stringify({ ...valid, placement: { ...valid.placement, scope } })))).toThrow();
  for (const key of ['nodeId', 'departmentCode', 'departmentName', 'campusId', 'parentId', 'serviceLocation'])
    expect(() => validateAssignmentCreate({ ...valid, placement: { ...valid.placement, [key]: 'FORGED' } })).toThrow();
  for (const key of ['engagementId', 'personId', 'placement', 'departmentId', 'departmentGovernanceObjectId'])
    expect(() => validateAssignmentRevise({ governanceObjectId: valid.governanceObjectId,
      assignmentId: valid.engagementId, expectedCurrentVersionId: valid.engagementId,
      businessValidFrom: valid.businessValidFrom, businessValidTo: null, reasonCode: 'VALIDITY_CORRECTION', [key]: 'FORGED' })).toThrow();
});
it('normalizes equivalent microseconds and rejects offsets, invalid dates and empty periods', () => {
  expect(assignmentPeriodCovered('2026-07-01T00:00:00.1', '2026-07-01T00:00:00.100001',
    '2026-07-01T00:00:00.100000', '2026-07-01T00:00:00.100001')).toBe(true);
  for (const from of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00+08:00', '2026-02-30T00:00:00',
    '0000-01-01T00:00:00', '2026-07-01T00:00:00.0000001'])
    expect(() => validateAssignmentCreate({ ...valid, businessValidFrom: from })).toThrow();
  expect(() => validateAssignmentCreate({ ...valid, businessValidTo: valid.businessValidFrom })).toThrow();
});

// Compiled negative consumers. No casts can bypass owner semantic identities.
function negativeTypes(history: EngagementPeriodAssertion, browser: DepartmentSummaryDTO, client: { validated: true }) {
  // @ts-expect-error A historical assertion is not complete effective-period authority.
  const engagement: AssignmentDependencyEvidence['engagement'] = history;
  // @ts-expect-error A browser DTO is not a record-visible publication reference.
  const department: AssignmentDependencyEvidence['department'] = browser;
  // @ts-expect-error A supplied validation flag is not owner evidence.
  const evidence: AssignmentDependencyEvidence = client;
  // @ts-expect-error Mutation input never accepts caller evidence.
  const input: CreateAssignment = { ...valid, snapshot: evidence };
  void engagement; void department; void input;
}
void negativeTypes;

it('rejects latest ended authority without falling back to an old open assertion', () => {
  expect(assignmentEngagementConstraint({
    authoritativeBusinessValidFrom: '2026-01-01T00:00:00',
    authoritativeBusinessValidTo: '2026-08-01T00:00:00',
    requestedFrom: '2026-07-01T00:00:00', requestedTo: null,
    stateSegments: [{ from: '2026-07-01T00:00:00', to: '2026-08-01T00:00:00', businessState: 'ACTIVE',
      lastApplicableLifecycleEventId: null, lifecycleSequence: '0' },
    { from: '2026-08-01T00:00:00', to: null, businessState: 'ENDED',
      lastApplicableLifecycleEventId: null, lifecycleSequence: '0' }],
  })).toBe('ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED');
});

it('requires review for an interior one-microsecond suspension even with ACTIVE endpoints', () => {
  expect(assignmentEngagementConstraint({
    authoritativeBusinessValidFrom: '2026-01-01T00:00:00', authoritativeBusinessValidTo: null,
    requestedFrom: '2026-07-01T00:00:00', requestedTo: '2026-08-01T00:00:00',
    stateSegments: [
      { from: '2026-07-01T00:00:00', to: '2026-07-02T00:00:00.000001', businessState: 'ACTIVE', lastApplicableLifecycleEventId: null, lifecycleSequence: '0' },
      { from: '2026-07-02T00:00:00.000001', to: '2026-07-02T00:00:00.000002', businessState: 'SUSPENDED', lastApplicableLifecycleEventId: 'suspend', lifecycleSequence: '1' },
      { from: '2026-07-02T00:00:00.000002', to: '2026-08-01T00:00:00', businessState: 'ACTIVE', lastApplicableLifecycleEventId: 'resume', lifecycleSequence: '2' },
    ],
  })).toBe('ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED');
});
