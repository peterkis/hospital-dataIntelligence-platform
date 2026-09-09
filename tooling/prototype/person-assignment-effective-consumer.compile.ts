import type { AssignmentEffectivePeriodContext, AssignmentEffectivePeriodReader, EngagementPeriodAssertion } from '../../apps/governance-api/src/modules/person-master/index.js';

/** Test-only consumer: at most classify whether further independent checks can begin. */
export function planIndependentChecks(context: AssignmentEffectivePeriodContext): 'INDEPENDENT_CHECKS_REQUIRED' | 'INSUFFICIENT_CONTEXT' {
  return context.declaredCoverage === 'FULL' && context.structuralDependencies.result === 'SATISFIED'
    ? 'INDEPENDENT_CHECKS_REQUIRED' : 'INSUFFICIENT_CONTEXT';
}
function compileOnly(reader: AssignmentEffectivePeriodReader, historical: EngagementPeriodAssertion, context: AssignmentEffectivePeriodContext) {
  // @ts-expect-error A historical assertion is not an effective Assignment window.
  planIndependentChecks(historical);
  // @ts-expect-error Read port cannot mutate an Assignment.
  reader.createAssignment({});
  // @ts-expect-error Read port cannot expose a Transaction.
  reader.transaction();
  // @ts-expect-error Structural observation has no clinical permission field.
  context.canPractice;
  // @ts-expect-error Structural observation has no role-approval field.
  context.ROLE_APPROVED;
  // @ts-expect-error Consumer outcome can never mean ROLE_APPROVED.
  const approval: 'ROLE_APPROVED' = planIndependentChecks(context);
  return approval;
}
void compileOnly;
