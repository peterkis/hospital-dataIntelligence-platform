import { expect, it } from 'vitest';
import { assignmentEndConstraint, validateAssignmentEnd, type AssignmentClosureVersion, type EndAssignment } from './assignment-closure-contracts.js';
import { validateAssignmentRevise, type AssignmentAdmissionVersion, type AssignmentVersion, type ReviseAssignment } from './assignment-contracts.js';

const from = '2026-01-01T00:00:00', end = '2026-08-01T00:00:00';
const command: EndAssignment = { governanceObjectId: '76000000-0000-7000-8000-000000000001',
  assignmentId: '76000000-0000-7000-8000-000000000002', expectedCurrentVersionId: '76000000-0000-7000-8000-000000000003',
  endedAt: end, reasonCode: 'PLACEMENT_ENDED' };

it('END accepts only own relation identity, expected head, finite end and a closed reason', () => {
  expect(() => validateAssignmentEnd(command)).not.toThrow();
  for (const key of ['businessValidFrom', 'from', 'personId', 'engagementId', 'departmentId', 'placement', 'purposeCode', 'modeCode',
    'force', 'override', 'sourceSemanticsVersionId', 'closureEvidence', 'acceptanceEvidence', 'recordedFrom', 'recordAsOf', 'versionNo', 'newAssignmentId'])
    expect(() => validateAssignmentEnd({ ...command, [key]: 'SYNTHETIC_FORGED' })).toThrow();
  for (const endedAt of [null, '', 'infinity', '-infinity', '0000-01-01T00:00:00', '2026-02-30T00:00:00',
    '2026-08-01T00:00:00Z', '2026-08-01T00:00:00+08:00', '2026-08-01T00:00:00.0000001'])
    expect(() => validateAssignmentEnd(JSON.parse(JSON.stringify({ ...command, endedAt })))).toThrow();
  for (const reasonCode of ['TRANSFER', 'REOPEN', 'RESUME', 'LIFECYCLE_END', null])
    expect(() => validateAssignmentEnd(JSON.parse(JSON.stringify({ ...command, reasonCode })))).toThrow();
});

it('allows an equal finite end once and forbids expansion, zero width and negative width', () => {
  expect(assignmentEndConstraint(from, null, end)).toBeNull();
  expect(assignmentEndConstraint(from, end, end)).toBeNull();
  expect(assignmentEndConstraint(from, end, '2026-07-01T00:00:00')).toBeNull();
  expect(assignmentEndConstraint(from, end, '2026-08-01T00:00:00.000001')).toBe('ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN');
  expect(assignmentEndConstraint(from, null, from)).toBe('ASSIGNMENT_CLOSURE_PERIOD_INVALID');
  expect(assignmentEndConstraint(from, null, '2025-12-31T23:59:59.999999')).toBe('ASSIGNMENT_CLOSURE_PERIOD_INVALID');
});

it('retains microseconds in a fixed-seed independent finite-set non-expansion oracle', () => {
  let seed = 60301;
  const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const tick = (value: number) => `2026-01-01T00:00:00.${String(value).padStart(6, '0')}`;
  for (let i = 0; i < 2000; i++) {
    const start = next(30), priorEnd = next(4) === 0 ? null : start + 1 + next(30), closure = next(70);
    // Independent oracle: enumerate every integer microsecond in the finite test universe.
    const oldPoints = new Set(Array.from({ length: 80 }, (_, n) => n).filter(n => n >= start && (priorEnd === null || n < priorEnd)));
    const closedPoints = Array.from({ length: 80 }, (_, n) => n).filter(n => n >= start && n < closure);
    const acceptable = closedPoints.length > 0 && closedPoints.every(n => oldPoints.has(n));
    expect(assignmentEndConstraint(tick(start), priorEnd === null ? null : tick(priorEnd), tick(closure)) === null).toBe(acceptable);
  }
});

it('does not admit lifecycle-end through the old revision contract', () => {
  expect(() => validateAssignmentRevise(JSON.parse(JSON.stringify({ governanceObjectId: command.governanceObjectId,
    assignmentId: command.assignmentId, expectedCurrentVersionId: command.expectedCurrentVersionId,
    businessValidFrom: from, businessValidTo: end, reasonCode: 'LIFECYCLE_END' })))).toThrow('ASSIGNMENT_INPUT_INVALID');
});

function compiledConsumers(version: AssignmentVersion, closure: AssignmentClosureVersion, accepted: AssignmentAdmissionVersion) {
  if (version.recordKind === 'CLOSURE') {
    const proof: 'NON_EXPANSIVE_CLOSURE' = version.closureEvidence.proofKind;
    // @ts-expect-error Closure cannot masquerade as fresh admission.
    void version.acceptanceEvidence;
    void proof;
  } else { void version.acceptanceEvidence; }
  // @ts-expect-error Closure is not an accepted version returned by create/revise.
  const falseAdmission: AssignmentAdmissionVersion = closure;
  // @ts-expect-error END is never an ordinary revision reason.
  const reason: ReviseAssignment['reasonCode'] = closure.reasonCode;
  void falseAdmission; void reason; void accepted;
}
void compiledConsumers;
