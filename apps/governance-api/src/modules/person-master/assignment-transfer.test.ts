import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignmentTransferChildRequests, assignmentTransferPeriodValid, validateAssignmentTransfer, type TransferAssignment } from './assignment-transfer-contracts.js';

const command: TransferAssignment = { governanceObjectId: '11111111-1111-7111-8111-111111111111',
  sourceAssignmentId: '22222222-2222-7222-8222-222222222222', expectedSourceVersionId: '33333333-3333-7333-8333-333333333333',
  effectiveAt: '2026-08-01T00:00:00', reasonCode: 'ORGANIZATIONAL_TRANSFER', targetPlacement: { scope: 'DEPARTMENT',
    departmentGovernanceObjectId: '44444444-4444-7444-8444-444444444444', departmentId: '55555555-5555-7555-8555-555555555555' } };
describe('atomic transfer boundary', () => {
  it('rejects identity, period and clock overrides rather than interpreting them as another operation', () => {
    expect(() => validateAssignmentTransfer(command)).not.toThrow();
    for (const key of ['personId', 'engagementId', 'purposeCode', 'modeCode', 'targetEnd', 'targetAssignmentId', 'recordAsOf', 'force', 'sourceRequestId'])
      expect(() => validateAssignmentTransfer({ ...command, [key]: 'forbidden' })).toThrow();
    for (const effectiveAt of ['0000-01-01T00:00:00', 'infinity', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00+08:00'])
      expect(() => validateAssignmentTransfer({ ...command, effectiveAt })).toThrow();
    const injectedPlacement = { ...command.targetPlacement, campusId: command.sourceAssignmentId };
    expect(() => validateAssignmentTransfer({ ...command, targetPlacement: injectedPlacement })).toThrow();
  });
  it('agrees with exhaustive independent integer-set residual conservation, including one microsecond and infinity', () => {
    const stamp = (n: number) => `2026-01-01T00:00:00.${String(n).padStart(6, '0')}`;
    for (let from = 0; from < 8; from++) for (const to of [null, 8, 13, 19]) for (let at = 0; at <= 20; at++) {
      const valid = from < at && (to === null || at < to);
      expect(assignmentTransferPeriodValid(stamp(from), to === null ? null : stamp(to), stamp(at))).toBe(valid);
      if (valid) for (let point = 0; point <= 22; point++) {
        const original = from <= point && (to === null || point < to), source = from <= point && point < at,
          target = at <= point && (to === null || point < to);
        expect(source || target).toBe(original); expect(source && target).toBe(false);
      }
    }
  });
  it('keeps bounded distinct child namespaces and one transaction without public child or recording overrides', () => {
    const first = assignmentTransferChildRequests(command.governanceObjectId, 'a'.repeat(128));
    const second = assignmentTransferChildRequests(command.governanceObjectId, 'a'.repeat(127) + 'b');
    expect(first.source.length).toBeLessThanOrEqual(128); expect(first.target.length).toBeLessThanOrEqual(128);
    expect(first.source).not.toBe(first.target); expect(first.source).not.toBe(second.source);
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    const coordinator = read('./assignment-transfer-store.ts');
    expect(coordinator).not.toMatch(/createAssignmentClosureApplication|createAssignmentSemanticsApplication|\.transaction\(|excludeAssignmentId|recordedFromOverride|\.updateTable\(|\.deleteFrom\(|sql\.raw/);
    expect(coordinator).toContain('savepoint transfer_body'); expect(coordinator).toContain('rollback to savepoint transfer_body');
    expect(coordinator.indexOf('.endAssignment(end)')).toBeLessThan(coordinator.indexOf('.createClassifiedAssignment(create)'));
    expect(read('../../composition/create-assignment-transfer-application.ts')).toContain("read ? 'repeatable read' : 'read committed'");
  });
});
