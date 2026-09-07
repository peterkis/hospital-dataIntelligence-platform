import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import type { AssignmentPlacement, AssignmentAdmissionVersion } from './assignment-contracts.js';
import type { AssignmentClosureVersion } from './assignment-closure-contracts.js';
import type { ClassifiedAssignmentSemantics } from './assignment-semantics-contracts.js';

export const ASSIGNMENT_TRANSFER_POLICY = {
  policyCode: 'ASSIGNMENT_ATOMIC_TRANSFER_V1', policyVersion: 1,
  policyLabel: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY',
} as const;
export const ASSIGNMENT_TRANSFER_POLICY_DIGEST = canonicalSha256(ASSIGNMENT_TRANSFER_POLICY).toString('hex');
export const ASSIGNMENT_TRANSFER_CHILD_PREFIX = '~assignment-transfer:';
export function assignmentTransferChildRequests(governanceObjectId: string, rootRequestId: string) {
  const hash = canonicalSha256([governanceObjectId, rootRequestId]).toString('hex');
  return { source: `${ASSIGNMENT_TRANSFER_CHILD_PREFIX}${hash}:source`, target: `${ASSIGNMENT_TRANSFER_CHILD_PREFIX}${hash}:target` };
}
export interface TransferAssignment {
  readonly governanceObjectId: string;
  readonly sourceAssignmentId: string;
  readonly expectedSourceVersionId: string;
  readonly effectiveAt: string;
  readonly targetPlacement: AssignmentPlacement;
  readonly reasonCode: 'ORGANIZATIONAL_TRANSFER';
}
export interface AssignmentTransferResult {
  readonly semanticRole: 'ATOMIC_ASSIGNMENT_TRANSFER_RESULT';
  readonly transferId: string;
  readonly governanceObjectId: string;
  readonly rootRequestId: string;
  readonly sourceRequestId: string;
  readonly targetRequestId: string;
  readonly sourceAssignmentId: string;
  readonly sourcePreviousVersionId: string;
  readonly sourceClosureVersionId: string;
  readonly sourceClosure: AssignmentClosureVersion;
  readonly targetAssignmentId: string;
  readonly targetAdmissionVersionId: string;
  readonly targetAdmission: AssignmentAdmissionVersion;
  readonly targetSemantics: ClassifiedAssignmentSemantics;
  readonly personId: string;
  readonly engagementId: string;
  readonly preservedPurposeCode: string;
  readonly preservedModeCode: string;
  readonly effectiveAt: string;
  readonly sourceOriginalPeriod: { readonly from: string; readonly to: string | null };
  readonly sourceClosedPeriod: { readonly from: string; readonly to: string };
  readonly targetPeriod: { readonly from: string; readonly to: string | null };
  readonly transferRecordedFrom: string;
  readonly policyCode: typeof ASSIGNMENT_TRANSFER_POLICY.policyCode;
  readonly policyVersion: 1;
  readonly policyLabel: typeof ASSIGNMENT_TRANSFER_POLICY.policyLabel;
  readonly policyDigest: string;
  readonly transferEvidenceFingerprint: string;
}
export interface AssignmentTransferApplication {
  transferAssignment(command: TransferAssignment): Promise<AssignmentTransferResult>;
  getAssignmentTransfer(query: { governanceObjectId: string; transferId: string }): Promise<AssignmentTransferResult>;
}
export function validateAssignmentTransfer(command: TransferAssignment) {
  assertClosedObject(command, ['governanceObjectId', 'sourceAssignmentId', 'expectedSourceVersionId', 'effectiveAt', 'targetPlacement', 'reasonCode']);
  for (const value of [command.governanceObjectId, command.sourceAssignmentId, command.expectedSourceVersionId]) assertPersonUuid(value);
  assertClosedObject(command.targetPlacement, ['scope', 'departmentGovernanceObjectId', 'departmentId']);
  assertPersonUuid(command.targetPlacement.departmentGovernanceObjectId); assertPersonUuid(command.targetPlacement.departmentId);
  if (command.reasonCode !== 'ORGANIZATIONAL_TRANSFER' || command.targetPlacement.scope !== 'DEPARTMENT') throw new Error('ASSIGNMENT_INPUT_INVALID');
  if (typeof command.effectiveAt !== 'string' || command.effectiveAt.startsWith('0000-')) throw new Error('ASSIGNMENT_TIME_INVALID');
  temporalKey(command.effectiveAt);
}
export function assignmentTransferPeriodValid(from: string, to: string | null, at: string) {
  return temporalKey(from) < temporalKey(at) && (to === null || temporalKey(at) < temporalKey(to));
}
