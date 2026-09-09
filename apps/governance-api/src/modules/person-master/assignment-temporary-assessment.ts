import type { Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { assignmentEngagementConstraint, assignmentPeriodCovered, type AssignmentVersion } from './assignment-contracts.js';
import type { AssignmentCoreModule, AssignmentDependencies } from './assignment-repository.js';
import { assignmentSemanticCandidates, assignmentSemanticExact } from './assignment-semantic-store.js';
import { evaluateAssignmentPrimary, type AssignmentSemanticCandidate } from './assignment-semantics-policy.js';
import type { AssignmentVersionSemantics } from './assignment-semantics-contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { readTemporarySourceLink } from './assignment-temporary-evidence.js';
import type { TemporaryAssignmentApplication, TemporaryAssignmentAssessment, TemporaryConstraintResult,
  TemporarySourceObservation } from './assignment-temporary-contracts.js';

export const TEMPORARY_DEPENDENCY_REJECTIONS = new Set([
  'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED', 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED',
  'ASSIGNMENT_DEPENDENCY_UNKNOWN', 'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT', 'ASSIGNMENT_PLACEMENT_NOT_FOUND',
  'ASSIGNMENT_PLACEMENT_UNPUBLISHED', 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
  'ASSIGNMENT_PLACEMENT_NOT_ACTIVE', 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
  'ENGAGEMENT_NOT_FOUND', 'ENGAGEMENT_NOT_KNOWN_AS_OF', 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT',
  'ASSIGNMENT_TERM_NOT_APPLICABLE', 'ASSIGNMENT_NOT_KNOWN_AS_OF', 'ASSIGNMENT_NOT_FOUND',
]);
export function temporaryOverlaps(from: string, to: string, other: AssignmentSemanticCandidate): boolean {
  return temporalKey(other.businessValidFrom) < temporalKey(to)
    && (other.businessValidTo === null || temporalKey(from) < temporalKey(other.businessValidTo));
}
function semanticFingerprint(semantics: AssignmentVersionSemantics | null) {
  if (semantics?.classification !== 'CLASSIFIED') return null;
  return semantics.semanticRole === 'INHERITED_FOR_CLOSURE' ? semantics.sourceSemanticFingerprint : semantics.semanticFingerprint;
}
function normalize(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value)) return temporalKey(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}
export async function assessTemporaryDependencies(database: Transaction<DB>, dependencies: AssignmentDependencies,
  core: Pick<AssignmentCoreModule, 'readAssignmentVersionSnapshot'>,
  query: Parameters<TemporaryAssignmentApplication['assessTemporaryAssignmentDependencies']>[0]): Promise<TemporaryAssignmentAssessment> {
  const link = await readTemporarySourceLink(database, query.governanceObjectId, query.targetAssignmentId);
  await dependencies.authorizeDependencies(query.governanceObjectId, link.sourcePlacement);
  await dependencies.authorizeDependencies(query.governanceObjectId, link.targetPlacement);
  const target = await core.readAssignmentVersionSnapshot({ governanceObjectId: query.governanceObjectId,
    assignmentId: query.targetAssignmentId, assignmentVersionId: query.assignmentVersionId });
  if (temporalKey(query.recordAsOf) < temporalKey(target.recordedFrom) || temporalKey(query.recordAsOf) < temporalKey(link.recordedFrom))
    throw new Error('ASSIGNMENT_NOT_KNOWN_AS_OF');
  if (target.businessValidTo === null) throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
  const admission = await core.readAssignmentVersionSnapshot({ governanceObjectId: query.governanceObjectId,
    assignmentId: query.targetAssignmentId, assignmentVersionId: link.targetAdmissionVersionId });
  if (admission.recordKind === 'CLOSURE') throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
  const latestTarget = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
    .where('assignment_id', '=', query.targetAssignmentId).where('recorded_from', '<=', query.recordAsOf)
    .orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
  const evaluated = await evaluateTemporaryAssignmentWindow(database, dependencies, core, query, link,
    { from: target.businessValidFrom, to: target.businessValidTo });
  const { componentResults: components, observedSourceEvidence, reasons, constraintResult } = evaluated;
  const { sourceVersion, sourceSemantics, engagement, sourceDepartment, targetDepartment, candidates: others } = observedSourceEvidence;
  const baselineRefs = {
    sourceVersion: link.sourceAssignmentVersionId, sourceSemantic: link.sourceSemanticFingerprint,
    engagementVersion: admission.acceptanceEvidence.engagement.authorityEngagementVersionId,
    lifecycleSequence: admission.acceptanceEvidence.engagement.recordVisibleLifecycleSequence,
    sourceDepartmentVersion: link.sourceWindowValidationEvidence.sourceDepartment.departmentVersionId,
    targetDepartmentVersion: admission.acceptanceEvidence.department.departmentVersionId,
    candidates: link.sourcePrimaryEvaluationEvidence.candidates,
  };
  const currentRefs = {
    sourceVersion: sourceVersion?.assignmentVersionId, sourceSemantic: semanticFingerprint(sourceSemantics),
    engagementVersion: engagement?.authorityEngagementVersionId, lifecycleSequence: engagement?.recordVisibleLifecycleSequence,
    sourceDepartmentVersion: sourceDepartment?.departmentVersionId, targetDepartmentVersion: targetDepartment?.departmentVersionId,
    candidates: others,
  };
  const comparable = sourceVersion && sourceSemantics?.classification === 'CLASSIFIED' && engagement && sourceDepartment && targetDepartment && others;
  const referenceComparison = !comparable ? 'NOT_COMPARABLE' : canonicalSha256(normalize(baselineRefs)).equals(canonicalSha256(normalize(currentRefs)))
    ? 'UNCHANGED' : 'CHANGED';
  const result: TemporaryAssignmentAssessment = { semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_ASSESSMENT', evaluatedAssignmentVersionId: query.assignmentVersionId,
    assessedRecordAsOf: query.recordAsOf, isLatestAssignmentVersionAsOf: latestTarget.assignment_version_id === query.assignmentVersionId,
    referenceComparison, constraintResult, componentResults: components, baselineSourceEvidence: link,
    observedSourceEvidence, reasons: [...new Set(reasons)] };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= 65536) return result;
  // Do not return an apparently complete SATISFIED result after dropping evidence.
  // Keep its immutable basis and explicitly report that this bounded comparison
  // cannot be represented; no business fact or repair action is written.
  const bounded: TemporaryAssignmentAssessment = { ...result, referenceComparison: 'NOT_COMPARABLE', constraintResult: 'UNKNOWN',
    componentResults: { sourceDeclaration: 'UNKNOWN', sourcePrimary: 'UNKNOWN', engagement: 'UNKNOWN',
      sourceDepartment: 'UNKNOWN', targetDepartment: 'UNKNOWN', temporaryOverlap: 'UNKNOWN' },
    observedSourceEvidence: { sourceVersion: null, sourceSemantics: null, engagement: null,
      sourceDepartment: null, targetDepartment: null, candidates: null }, reasons: ['ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT'] };
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > 65536) throw new Error('ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT');
  return bounded;
}

/** Owner-private evaluation of a selected immutable target over an explicit window.
 * No version object or immutable link is changed to represent the subwindow. */
export async function evaluateTemporaryAssignmentWindow(database: Transaction<DB>, dependencies: AssignmentDependencies,
  core: Pick<AssignmentCoreModule, 'readAssignmentVersionSnapshot'>,
  query: Parameters<TemporaryAssignmentApplication['assessTemporaryAssignmentDependencies']>[0],
  link: TemporaryAssignmentAssessment['baselineSourceEvidence'],
  window: { readonly from: string; readonly to: string }) {
  const components: Record<keyof TemporaryAssignmentAssessment['componentResults'], TemporaryConstraintResult> = {
    sourceDeclaration: 'UNKNOWN', sourcePrimary: 'UNKNOWN', engagement: 'UNKNOWN',
    sourceDepartment: 'UNKNOWN', targetDepartment: 'UNKNOWN', temporaryOverlap: 'UNKNOWN',
  };
  const reasons: string[] = [];
  async function observe<T>(work: () => Promise<T>): Promise<T | null> {
    try { return await work(); }
    catch (error) {
      if (!(error instanceof Error) || !TEMPORARY_DEPENDENCY_REJECTIONS.has(error.message)) throw error;
      reasons.push(error.message); return null;
    }
  }
  const sourceRow = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
    .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', link.sourceAssignmentId)
    .where('recorded_from', '<=', query.recordAsOf).orderBy('version_no', 'desc').limit(1).executeTakeFirst();
  let sourceVersion: AssignmentVersion | null = null;
  let sourceSemantics: AssignmentVersionSemantics | null = null;
  if (sourceRow) {
    sourceVersion = await core.readAssignmentVersionSnapshot({ governanceObjectId: query.governanceObjectId,
      assignmentId: link.sourceAssignmentId, assignmentVersionId: sourceRow.assignment_version_id });
    sourceSemantics = await assignmentSemanticExact(database, sourceRow.assignment_version_id);
    if (sourceSemantics.classification === 'CLASSIFIED') {
      const qualifies = sourceSemantics.mode.code === 'PRIMARY_AFFILIATION'
        && sourceSemantics.purpose.code === link.preservedPurposeCode
        && assignmentPeriodCovered(sourceVersion.businessValidFrom, sourceVersion.businessValidTo, window.from, window.to);
      components.sourceDeclaration = qualifies ? 'SATISFIED' : 'NOT_SATISFIED';
      if (!qualifies) reasons.push('ASSIGNMENT_TEMPORARY_SOURCE_DECLARATION_NOT_SATISFIED');
    } else reasons.push('ASSIGNMENT_TEMPORARY_SOURCE_SEMANTICS_UNKNOWN');
  } else reasons.push('ASSIGNMENT_NOT_KNOWN_AS_OF');

  const candidates = await observe(() => assignmentSemanticCandidates(database, query.governanceObjectId,
    link.engagementId, query.recordAsOf, query.targetAssignmentId));
  const others = candidates?.filter(candidate => candidate.assignmentId !== link.sourceAssignmentId) ?? null;
  if (others) {
    const primary = evaluateAssignmentPrimary({ businessValidFrom: window.from, businessValidTo: window.to,
      purposeCode: link.preservedPurposeCode, modeCode: 'PRIMARY_AFFILIATION' }, others);
    components.sourcePrimary = components.sourceDeclaration === 'UNKNOWN' ? 'UNKNOWN' :
      components.sourceDeclaration !== 'SATISFIED' || primary.result === 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' ? 'NOT_SATISFIED' :
        primary.result === 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' ? 'UNKNOWN' : 'SATISFIED';
    if (primary.result !== 'SATISFIED') reasons.push(primary.result);
    const collision = others.some(candidate => candidate.modeCode === 'SECONDMENT' && candidate.purposeCode === link.preservedPurposeCode
      && temporaryOverlaps(window.from, window.to, candidate));
    components.temporaryOverlap = collision ? 'NOT_SATISFIED' : 'SATISFIED';
    if (collision) reasons.push('ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT');
  }
  const engagement = await observe(() => dependencies.engagement.getEngagementEffectivePeriodAsOf({ governanceObjectId: query.governanceObjectId,
    engagementId: link.engagementId, requestedFrom: window.from, requestedTo: window.to, recordAsOf: query.recordAsOf }));
  if (engagement) {
    const reason = assignmentEngagementConstraint(engagement);
    components.engagement = reason === null ? 'SATISFIED' : reason === 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED'
      ? 'REVIEW_REQUIRED' : reason === 'ASSIGNMENT_DEPENDENCY_UNKNOWN' ? 'UNKNOWN' : 'NOT_SATISFIED';
    if (reason) reasons.push(reason);
  }
  async function department(which: 'sourceDepartment' | 'targetDepartment') {
    const placement = which === 'sourceDepartment' ? link.sourcePlacement : link.targetPlacement;
    const observed = await observe(() => dependencies.department.getDepartmentPlacementReferenceAsOf({
      departmentGovernanceObjectId: placement.departmentGovernanceObjectId, departmentId: placement.departmentId, recordAsOf: query.recordAsOf }));
    if (observed) {
      const satisfied = observed.businessStatus === 'ACTIVE'
        && assignmentPeriodCovered(observed.businessValidFrom, observed.businessValidTo, window.from, window.to);
      components[which] = satisfied ? 'SATISFIED' : 'NOT_SATISFIED';
      if (!satisfied) reasons.push(which === 'sourceDepartment' ? 'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_NOT_SATISFIED' : 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED');
    }
    return observed;
  }
  const sourceDepartment = await department('sourceDepartment'), targetDepartment = await department('targetDepartment');
  const observedSourceEvidence: TemporarySourceObservation = { sourceVersion, sourceSemantics, engagement, sourceDepartment,
    targetDepartment, candidates: others };
  const results = Object.values(components);
  const constraintResult = results.includes('NOT_SATISFIED') ? 'NOT_SATISFIED' as const : results.includes('REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' as const
    : results.includes('UNKNOWN') ? 'UNKNOWN' as const : 'SATISFIED' as const;
  return { componentResults: components, observedSourceEvidence, reasons, constraintResult };
}
