/**
 * Single authority for the machine-readable Phase 01 verification contract.
 * Existing contract versions are deliberately preserved; only AR-10 structures
 * receive new versions.
 */
export const RUN_PLAN_SCHEMA_VERSION = 'phase-01.abg-run-plan.v3' as const;
export const RUN_PLAN_AUTHORITY_ID = 'phase-01.repository-authoritative-plan.v2' as const;
export const PRODUCER_EVIDENCE_SCHEMA_VERSION = 'phase-01.producer-evidence.v2' as const;
export const PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION =
  'phase-01.producer-evidence-index.v2' as const;
export const GATE_RESULT_SCHEMA_VERSION = 'phase-01.abg-gate-result.v3' as const;
export const RUN_SUMMARY_SCHEMA_VERSION = 'phase-01.abg-run.v4' as const;
export const TERMINAL_CONCLUSION_SCHEMA_VERSION =
  'phase-01.formal-terminal-conclusion.v1' as const;
export const RUNTIME_OUTCOME_SCHEMA_VERSION = 'phase-01.formal-runtime-outcome.v2' as const;
export const EVIDENCE_MANIFEST_SCHEMA_VERSION = 'phase-01.evidence-manifest.v1' as const;

export const VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION =
  'phase-01.verification-source-manifest.v1' as const;
export const REVIEW_SCHEMA_VERSION = 'phase-01.formal-abg-evidence-review.v2' as const;
export const REVIEW_FINDINGS_SCHEMA_VERSION =
  'phase-01.formal-abg-evidence-review-findings.v2' as const;
export const REVIEW_MANIFEST_SCHEMA_VERSION =
  'phase-01.formal-abg-evidence-review-manifest.v1' as const;
export const REVIEWER_TOOL_SCHEMA_VERSION =
  'phase-01.formal-abg-evidence-reviewer.v1' as const;
export const REVIEWER_COMPATIBILITY_POLICY_VERSION =
  'phase-01.reviewer-compatibility-policy.v1' as const;

export interface EvidenceContractIdentity {
  readonly runPlanSchemaVersion: typeof RUN_PLAN_SCHEMA_VERSION;
  readonly runPlanAuthorityId: typeof RUN_PLAN_AUTHORITY_ID;
  readonly producerEvidenceSchemaVersion: typeof PRODUCER_EVIDENCE_SCHEMA_VERSION;
  readonly producerEvidenceIndexSchemaVersion: typeof PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION;
  readonly gateResultSchemaVersion: typeof GATE_RESULT_SCHEMA_VERSION;
  readonly runSummarySchemaVersion: typeof RUN_SUMMARY_SCHEMA_VERSION;
  readonly terminalConclusionSchemaVersion: typeof TERMINAL_CONCLUSION_SCHEMA_VERSION;
  readonly runtimeOutcomeSchemaVersion: typeof RUNTIME_OUTCOME_SCHEMA_VERSION;
  readonly evidenceManifestSchemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
}

export const CURRENT_EVIDENCE_CONTRACT_IDENTITY = Object.freeze({
  runPlanSchemaVersion: RUN_PLAN_SCHEMA_VERSION,
  runPlanAuthorityId: RUN_PLAN_AUTHORITY_ID,
  producerEvidenceSchemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
  producerEvidenceIndexSchemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  gateResultSchemaVersion: GATE_RESULT_SCHEMA_VERSION,
  runSummarySchemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
  terminalConclusionSchemaVersion: TERMINAL_CONCLUSION_SCHEMA_VERSION,
  runtimeOutcomeSchemaVersion: RUNTIME_OUTCOME_SCHEMA_VERSION,
  evidenceManifestSchemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
}) satisfies EvidenceContractIdentity;
