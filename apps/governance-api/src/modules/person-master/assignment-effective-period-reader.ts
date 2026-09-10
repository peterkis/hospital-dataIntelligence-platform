import type { Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import type { DepartmentPlacementReference } from '../department-master/index.js';
import { assignmentEngagementConstraint, assignmentPeriodCovered, type AssignmentPlacement } from './assignment-contracts.js';
import type { AssignmentCoreModule, AssignmentDependencies } from './assignment-repository.js';
import { ASSIGNMENT_PURPOSES, ASSIGNMENT_KNOWN_MODES, type AssignmentVersionSemantics } from './assignment-semantics-contracts.js';
import type { EngagementEffectivePeriodContext } from './engagement-effective-period-contracts.js';
import { readTemporarySourceLink } from './assignment-temporary-evidence.js';
import { evaluateTemporaryAssignmentWindow } from './assignment-temporary-assessment.js';
import { temporalKey } from './engagement-rule-segments.js';
import { evaluateOrdinaryAssignmentWindow } from './assignment-dependency-window.js';
import { assignmentDeclaredCoverage, validateAssignmentEffectivePeriodQuery, assignmentWindowReasons,
  type AssignmentEffectivePeriodReader, type AssignmentEffectivePeriodContext, type AssignmentSemanticsReference,
  type AssignmentObservedDepartmentReference, type AssignmentObservedEvidenceReferences,
  type AssignmentWindowDependencyObservation, type AssignmentWindowResult } from './assignment-effective-period-contracts.js';

const UNKNOWN_REASONS = new Set(['ENGAGEMENT_NOT_FOUND', 'ENGAGEMENT_NOT_KNOWN_AS_OF',
  'ASSIGNMENT_PLACEMENT_NOT_FOUND', 'ASSIGNMENT_PLACEMENT_UNPUBLISHED', 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED']);
function semanticsReference(value: AssignmentVersionSemantics): AssignmentSemanticsReference {
  if (value.classification === 'UNCLASSIFIED') return { classification: 'UNCLASSIFIED',
    assignmentVersionId: value.assignmentVersionId, semanticRole: 'UNCLASSIFIED', purposeCode: null, modeCode: null,
    purposeTermVersionId: null, modeTermVersionId: null, semanticVersionId: null, semanticFingerprint: null };
  const inherited = value.semanticRole === 'INHERITED_FOR_CLOSURE';
  const purposeCode = ASSIGNMENT_PURPOSES.find(code => code === value.purpose.code);
  const modeCode = ASSIGNMENT_KNOWN_MODES.find(code => code === value.mode.code);
  if (!purposeCode || !modeCode || value.purpose.dimension !== 'PURPOSE' || value.mode.dimension !== 'MODE')
    throw new Error('ASSIGNMENT_SEMANTIC_EVIDENCE_INVALID');
  return { classification: 'CLASSIFIED', assignmentVersionId: value.assignmentVersionId,
    semanticRole: inherited ? 'INHERITED_FOR_CLOSURE' : 'FROZEN_ADMISSION',
    purposeCode, modeCode,
    purposeTermVersionId: value.purpose.termVersionId, modeTermVersionId: value.mode.termVersionId,
    semanticVersionId: inherited ? value.sourceAssignmentVersionId : value.assignmentVersionId,
    semanticFingerprint: inherited ? value.sourceSemanticFingerprint : value.semanticFingerprint };
}
function departmentReference(value: DepartmentPlacementReference | null): AssignmentObservedDepartmentReference | null {
  return value === null ? null : { departmentId: value.departmentId, departmentVersionId: value.departmentVersionId,
    publicationProjectionId: value.publicationProjectionId, releaseId: value.releaseId, contentHash: value.contentHash };
}
function aggregate(results: readonly AssignmentWindowResult[]): AssignmentWindowResult {
  return results.includes('NOT_SATISFIED') ? 'NOT_SATISFIED' : results.includes('REVIEW_REQUIRED') ? 'REVIEW_REQUIRED'
    : results.includes('UNKNOWN') ? 'UNKNOWN' : 'SATISFIED';
}
function emptyReferences(): AssignmentObservedEvidenceReferences {
  return { engagementVersionId: null, lifecycleSequence: null, lifecycleEventIds: [], targetDepartment: null,
    sourceDepartment: null, sourceAssignmentVersionId: null, sourceSemanticFingerprint: null, candidateVersions: [] };
}
function engagementReferences(value: EngagementEffectivePeriodContext | null) {
  return { engagementVersionId: value?.authorityEngagementVersionId ?? null,
    lifecycleSequence: value?.recordVisibleLifecycleSequence ?? null,
    lifecycleEventIds: [...new Set(value?.stateSegments.flatMap(s => s.lastApplicableLifecycleEventId ? [s.lastApplicableLifecycleEventId] : []) ?? [])].sort() };
}

/** Composition-only scoped port. No audit append and no nested root transaction. */
export function createAssignmentEffectivePeriodScope(database: Transaction<DB>, dependencies: AssignmentDependencies,
  core: Pick<AssignmentCoreModule, 'readAssignmentVersionSnapshot' | 'readAssignmentSemanticsSnapshot'>): AssignmentEffectivePeriodReader {
  return { async getAssignmentEffectivePeriodAsOf(input): Promise<AssignmentEffectivePeriodContext> {
    const query = validateAssignmentEffectivePeriodQuery(input);
    await dependencies.authorize(query.governanceObjectId, 'READ');
    await dependencies.authorizeSemantics(query.governanceObjectId, 'READ');
    const relation = await database.selectFrom('person_master.assignment').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', query.assignmentId).executeTakeFirst();
    if (!relation) throw new Error('ASSIGNMENT_NOT_FOUND');
    const placement: AssignmentPlacement = { scope: 'DEPARTMENT', departmentGovernanceObjectId: relation.department_governance_object_id,
      departmentId: relation.department_id };
    await dependencies.authorizeDependencies(query.governanceObjectId, placement);
    // Select solely by record visibility and versionNo, before inspecting W.
    const row = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
      .where('governance_object_id', '=', query.governanceObjectId).where('assignment_id', '=', query.assignmentId)
      .where('recorded_from', '<=', query.recordAsOf).orderBy('version_no', 'desc').limit(1).executeTakeFirst();
    if (!row) throw new Error('ASSIGNMENT_NOT_KNOWN_AS_OF');
    const exact = { governanceObjectId: query.governanceObjectId, assignmentId: query.assignmentId, assignmentVersionId: row.assignment_version_id };
    const selected = await core.readAssignmentVersionSnapshot(exact);
    const semantics = await core.readAssignmentSemanticsSnapshot(exact);
    const assignmentSemantics = semanticsReference(semantics);
    const linkRow = await database.selectFrom('person_master.assignment_temporary_source').select('source_department_governance_object_id')
      .where('governance_object_id', '=', query.governanceObjectId).where('target_assignment_id', '=', query.assignmentId).executeTakeFirst();
    const isTemporary = assignmentSemantics.modeCode === 'SECONDMENT';
    if (Boolean(linkRow) !== isTemporary) throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
    const link = linkRow ? await readTemporarySourceLink(database, query.governanceObjectId, query.assignmentId) : null;
    if (link) {
      await dependencies.authorizeDependencies(query.governanceObjectId, link.sourcePlacement);
      if (temporalKey(link.recordedFrom) > query.recordAsOf) throw new Error('ASSIGNMENT_NOT_KNOWN_AS_OF');
      if (link.engagementId !== relation.engagement_id || link.personId !== relation.person_id ||
        link.targetPlacement.departmentId !== placement.departmentId || link.preservedPurposeCode !== assignmentSemantics.purposeCode)
        throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
      const parent = await database.selectFrom('person_master.assignment_temporary_source').select('target_assignment_id')
        .where('target_assignment_id', '=', link.sourceAssignmentId).executeTakeFirst();
      if (parent) throw new Error('ASSIGNMENT_TEMPORARY_SOURCE_CHAIN_NOT_SUPPORTED');
    }
    const closure = selected.recordKind === 'CLOSURE' ? selected.closureEvidence : null;
    const originalEvidenceRefs = { admissionVersionId: closure?.sourceAcceptanceVersionId ?? selected.assignmentVersionId,
      admissionDependencyFingerprint: selected.recordKind === 'CLOSURE' ? selected.closureEvidence.sourceAcceptanceDependencyFingerprint
        : selected.acceptanceEvidence.dependencyFingerprint,
      semanticVersionId: assignmentSemantics.semanticVersionId, semanticFingerprint: assignmentSemantics.semanticFingerprint,
      closureVersionId: closure?.closureVersionId ?? null, closureFingerprint: closure?.closureEvidenceFingerprint ?? null,
      temporaryTargetAdmissionVersionId: link?.targetAdmissionVersionId ?? null,
      temporarySourceLinkFingerprint: link?.sourceLinkFingerprint ?? null, sourceAssignmentId: link?.sourceAssignmentId ?? null,
      sourceAssignmentVersionId: link?.sourceAssignmentVersionId ?? null, sourceSemanticVersionId: link?.sourceSemanticVersionId ?? null,
      sourceSemanticFingerprint: link?.sourceSemanticFingerprint ?? null,
      sourceAcceptanceDependencyFingerprint: link?.sourceAcceptanceDependencyFingerprint ?? null };
    const declaredPeriod = { from: temporalKey(selected.businessValidFrom),
      to: selected.businessValidTo === null ? null : temporalKey(selected.businessValidTo) };
    const coverage = assignmentDeclaredCoverage(declaredPeriod, { from: query.requestedFrom, to: query.requestedTo });
    let structuralDependencies: AssignmentWindowDependencyObservation = { result: 'NOT_EVALUATED', components: [],
      engagementSegments: [], boundedReasons: ['REQUEST_OUTSIDE_DECLARED_PERIOD'] };
    let observedEvidenceRefs = emptyReferences();
    if (coverage.declaredCoverage === 'FULL' && link) {
      if (query.requestedTo === null) throw new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
      const evaluated = await evaluateTemporaryAssignmentWindow(database, dependencies, core,
        { governanceObjectId: query.governanceObjectId, targetAssignmentId: query.assignmentId,
          assignmentVersionId: selected.assignmentVersionId, recordAsOf: query.recordAsOf }, link,
        { from: query.requestedFrom, to: query.requestedTo });
      const observed = evaluated.observedSourceEvidence;
      structuralDependencies = { result: evaluated.constraintResult,
        components: (Object.keys(evaluated.componentResults) as (keyof typeof evaluated.componentResults)[]).sort()
          .map(component => ({ component, result: evaluated.componentResults[component] })),
        engagementSegments: observed.engagement?.stateSegments ?? [], boundedReasons: assignmentWindowReasons(evaluated.reasons) };
      observedEvidenceRefs = { ...engagementReferences(observed.engagement),
        targetDepartment: departmentReference(observed.targetDepartment), sourceDepartment: departmentReference(observed.sourceDepartment),
        sourceAssignmentVersionId: observed.sourceVersion?.assignmentVersionId ?? null,
        sourceSemanticFingerprint: observed.sourceSemantics ? semanticsReference(observed.sourceSemantics).semanticFingerprint : null,
        candidateVersions: (observed.candidates ?? []).filter(c => temporalKey(c.businessValidFrom) < query.requestedTo!
          && (c.businessValidTo === null || query.requestedFrom < temporalKey(c.businessValidTo)))
          .map(c => ({ assignmentId: c.assignmentId, assignmentVersionId: c.assignmentVersionId })).sort((a,b) => a.assignmentId.localeCompare(b.assignmentId)) };
    } else if (coverage.declaredCoverage === 'FULL') {
      const reasons: string[] = [];
      const { engagement, department } = await evaluateOrdinaryAssignmentWindow(dependencies, selected, relation.engagement_id, placement,
        { from: query.requestedFrom, to: query.requestedTo }, query.recordAsOf, error => {
          if (!(error instanceof Error) || !UNKNOWN_REASONS.has(error.message)) throw error;
          reasons.push(error.message);
        });
      const engagementReason = engagement ? assignmentEngagementConstraint(engagement) : null;
      if (engagementReason) reasons.push(engagementReason);
      const engagementResult: AssignmentWindowResult = !engagement ? 'UNKNOWN' : !engagementReason ? 'SATISFIED'
        : engagementReason === 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED'
          : engagementReason === 'ASSIGNMENT_DEPENDENCY_UNKNOWN' ? 'UNKNOWN' : 'NOT_SATISFIED';
      const departmentReason = !department ? null : department.businessStatus !== 'ACTIVE' ? 'ASSIGNMENT_PLACEMENT_NOT_ACTIVE'
        : !assignmentPeriodCovered(department.businessValidFrom, department.businessValidTo, query.requestedFrom, query.requestedTo)
          ? 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED' : null;
      if (departmentReason) reasons.push(departmentReason);
      const departmentResult = !department ? 'UNKNOWN' : departmentReason ? 'NOT_SATISFIED' : 'SATISFIED';
      structuralDependencies = { result: aggregate([engagementResult, departmentResult]),
        components: [{ component: 'engagement', result: engagementResult }, { component: 'targetDepartment', result: departmentResult }],
        engagementSegments: engagement?.stateSegments ?? [], boundedReasons: assignmentWindowReasons(reasons) };
      observedEvidenceRefs = { ...emptyReferences(), ...engagementReferences(engagement), targetDepartment: departmentReference(department) };
    }
    const value = { ...query, semanticRole: 'ASSIGNMENT_EFFECTIVE_PERIOD_CONTEXT' as const, contractVersion: 1 as const,
      observationScope: 'STRUCTURAL_DEPENDENCIES_ONLY' as const, personId: relation.person_id, engagementId: relation.engagement_id, placement,
      selectedAssignmentVersionId: selected.assignmentVersionId, selectedVersionNo: selected.versionNo,
      selectedRecordedFrom: temporalKey(selected.recordedFrom), selectedRecordKind: selected.recordKind === 'CLOSURE' ? 'CLOSURE' as const : 'ADMISSION' as const,
      declaredPeriod, ...coverage, explicitClosureKnown: closure !== null, assignmentSemantics, originalEvidenceRefs,
      structuralDependencies, observedEvidenceRefs };
    const result = { ...value, contextFingerprint: canonicalSha256(value).toString('hex') };
    if (result.structuralDependencies.engagementSegments.length > 128 || result.observedEvidenceRefs.candidateVersions.length > 64 ||
      Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536) throw new Error('ASSIGNMENT_EFFECTIVE_PERIOD_EVALUATION_LIMIT');
    return result;
  } };
}
