import type { AssignmentMode, AssignmentSemanticOperation, AssignmentSemanticsApplication,
  CreateSourceLinkedTemporaryAssignment, TemporaryAssignmentApplication } from '../../apps/governance-api/src/modules/person-master/index.js';

// Compile-time positive/negative contract checks. This function is never executed.
export function checkTemporaryAssignmentTypes(ordinary: AssignmentSemanticsApplication, temporary: TemporaryAssignmentApplication,
  command: CreateSourceLinkedTemporaryAssignment) {
  const known: AssignmentMode = 'SECONDMENT';
  const operation: AssignmentSemanticOperation = 'TEMPORARY_CREATE';
  void known; void operation;
  void temporary.createSourceLinkedTemporaryAssignment(command);
  // @ts-expect-error SECONDMENT is not a mode for generic classified create.
  void ordinary.createClassifiedAssignment({ governanceObjectId: '', engagementId: '', relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', placement: command.targetPlacement, businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo, purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'SECONDMENT' });
  // @ts-expect-error Source-free adoption cannot select SECONDMENT.
  void ordinary.adoptAssignmentSemantics({ governanceObjectId: '', assignmentId: '', expectedCurrentVersionId: '', purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'SECONDMENT' });
  // @ts-expect-error Generic semantic correction cannot select SECONDMENT.
  void ordinary.correctAssignmentSemantics({ governanceObjectId: '', assignmentId: '', expectedCurrentVersionId: '', purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'SECONDMENT', reasonCode: 'MODE_CORRECTION' });
  // @ts-expect-error A temporary child must have a finite required end.
  void temporary.createSourceLinkedTemporaryAssignment({ ...command, businessValidTo: null });
  // @ts-expect-error Person identity is derived from the source, never caller supplied.
  void temporary.createSourceLinkedTemporaryAssignment({ ...command, personId: '' });
}
