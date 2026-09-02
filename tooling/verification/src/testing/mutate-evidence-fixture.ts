import {
  access,
  cp,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  ABG_COVERAGE_MATRIX,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  validateAbgGateResult,
  writeAbgGateProof,
} from '../abg-gate-proof.js';
import {
  createEvidenceOutputDirectory,
  createEvidenceSubdirectory,
  sha256,
  writeRedactedTextArtifact,
} from '../evidence/recorder.js';
import type { ProducerEvidence } from '../evidence/protocol.js';
import { validateProducerEvidence } from '../evidence/validate-producer-evidence.js';
import { validateFormalAbgSummary } from '../formal-summary-validator.js';
import {
  reviewFormalAbgEvidence,
  type ReviewFormalAbgEvidenceDependencies,
} from '../review-formal-abg-evidence.js';
import {
  assertFormalRuntimeResourceOwned,
  assertSafeFormalCleanupCommand,
  type RuntimeResourceRecord,
} from '../runtime/formal-teardown.js';
import {
  formalRuntimeLabels,
  type FormalRunIdentity,
  type RuntimeCommandResult,
  type RuntimeCommandRunner,
} from '../runtime/formal-runtime-contract.js';
import {
  assertEquivalentPodmanMachineInspections,
  inspectPodmanMachineState,
  type PodmanMachineInspectionResult,
} from '../runtime/podman-machine-inspection.js';
import { createSourceManifestBuilder } from '../provenance/source-manifest.js';
import {
  rebuildFixtureManifest,
  type ValidEvidenceFixture,
} from './build-valid-evidence-fixture.js';
import {
  assertContainerRestartPolicy,
  assertRuntimeAuthoritySecondSourceMatches,
  assertRuntimeAuthoritySnapshot,
  assertRuntimeAuthorityStableAfterCleanup,
  assertSyntheticFailureCleanup,
  cloneRuntimeAuthorityDocument,
  runSyntheticPreflightPolicyMutation,
  validRuntimeAuthorityMutationFixture,
} from './ar11-runtime-mutation-support.js';
import { parsePodmanRuntimeAuthority } from '../runtime/podman-runtime-authority.js';
import {
  assertAr12CommandPlanSafety,
  createAr12CommandSpecs,
} from '../rebaseline/ar-12-orchestrator.js';
import {
  AR12_HISTORY_EVIDENCE_CONTRACT,
  assertAr12HistoryEvidenceStable,
  captureAr12HistoryEvidenceBaseline,
  validateAr12HistoryEvidenceContract,
  type Ar12HistoryClassification,
  type Ar12HistoryEvidenceContract,
} from '../rebaseline/ar-12-history-evidence-contract.js';
import {
  AR12_EXECUTION_WORKSPACE_MARKER,
  AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION,
  cleanupAr12ExecutionWorkspace,
  defaultAr12ExecutionWorkspaceDependencies,
  relocateStaleAr12ExecutionWorkspace,
  resolveAr12ExecutionWorkspace,
  verifyAr12ExecutionWorkspace,
  type Ar12ExecutionWorkspaceMarker,
} from '../rebaseline/ar-12-execution-workspace.js';
import {
  assertAuthoritativeCommandPlanSafety,
  buildAuthoritativeCommandPlan,
} from '../authoritative-abg-plan.js';
import {
  assertSharedAbgCommandPlanSafety,
  buildSharedAbgCommandPlan,
  type SharedCommand,
} from '../shared-abg-command-plan.js';
import {
  createDeterministicChildEnvironment,
  REPOSITORY_NODE_LOADER_PATH,
} from '../runtime/node-command-boundary.js';
import { databaseAuthorityChildEnvironment } from '../check-database-authority.js';

export type MutationDetectionLayer =
  | 'producer-evidence-validator'
  | 'gate-proof-validator'
  | 'formal-summary-validator'
  | 'independent-reviewer'
  | 'exclusive-output-guard'
  | 'runtime-teardown-guard'
  | 'runtime-authority-validator'
  | 'formal-preflight-policy'
  | 'runtime-lifecycle-guard'
  | 'ar12-workspace-guard'
  | 'ar12-clone-identity-guard'
  | 'ar12-relocation-guard'
  | 'ar12-command-plan-guard'
  | 'ar12-history-evidence-guard'
  | 'evidence-recorder-guard'
  | 'podman-machine-inspection'
  | 'formal-command-boundary'
  | 'shared-command-boundary'
  | 'database-authority-boundary';

export interface EvidenceMutationCase {
  readonly mutationId: string;
  readonly description: string;
  readonly detectionLayer: MutationDetectionLayer;
  readonly expectedErrorCode: string;
}

export interface MutationExecutionContext {
  readonly fixture: ValidEvidenceFixture;
  readonly mutationRootDirectory: string;
}

export interface MutationExecutionResult {
  readonly mutationId: string;
  readonly detectionLayer: MutationDetectionLayer;
  readonly expectedErrorCode: string;
  readonly actualErrorCode: string | null;
  readonly detected: boolean;
}

const mutation = (
  mutationId: string,
  description: string,
  detectionLayer: MutationDetectionLayer,
  expectedErrorCode: string,
): EvidenceMutationCase => ({ mutationId, description, detectionLayer, expectedErrorCode });

export const PRE_AR12_ADVERSARIAL_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  mutation('AR06-M001-MISSING-ABG-01', 'Delete ABG-01.', 'formal-summary-validator', 'GATE_RESULT_COUNT_INVALID'),
  mutation('AR06-M002-MISSING-ABG-40', 'Delete ABG-40.', 'formal-summary-validator', 'GATE_RESULT_COUNT_INVALID'),
  mutation('AR06-M003-DUPLICATE-ABG-10', 'Duplicate ABG-10.', 'formal-summary-validator', 'GATE_ID_DUPLICATE'),
  mutation('AR06-M004-ABG-10-MASQUERADES-AS-ABG-11', 'Make the ABG-10 proof claim ABG-11.', 'gate-proof-validator', 'ABG_GATE_RESULT_ID_MISMATCH'),
  mutation('AR06-M005-GATE-ORDER-SHUFFLED', 'Shuffle gate order.', 'formal-summary-validator', 'GATE_ORDER_OR_ID_MISMATCH'),
  mutation('AR06-M006-GATE-COUNT-FORGED-40', 'Claim gateCount 40 for 39 results.', 'formal-summary-validator', 'GATE_RESULT_COUNT_INVALID'),
  mutation('AR06-M007-PASSED-COUNT-FORGED', 'Forge passedCount.', 'formal-summary-validator', 'PASSED_COUNT_MISMATCH'),
  mutation('AR06-M008-OVERALL-STATUS-FORGED-PASSED', 'Keep overall PASSED with a failed gate.', 'formal-summary-validator', 'RUN_STATUS_MISMATCH'),
  mutation('AR06-M009-SCENARIO-ID-MISSING', 'Remove gate-specific scenarioId.', 'gate-proof-validator', 'ABG_GATE_RESULT_SCENARIOS_MISMATCH'),
  mutation('AR06-M010-ASSERTION-ID-MISSING', 'Remove gate-specific assertionId.', 'gate-proof-validator', 'ABG_GATE_RESULT_ASSERTIONS_MISMATCH'),
  mutation('AR06-M011-CROSS-GATE-ASSERTION-ID', 'Use an assertionId owned by another gate.', 'gate-proof-validator', 'ABG_GATE_RESULT_ASSERTIONS_MISMATCH'),
  mutation('AR06-M012-ASSERTION-FAILED', 'Change a producer assertion to FAILED.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_SCENARIO_PASSED_WITH_NON_PASSED_ASSERTION'),
  mutation('AR06-M013-ASSERTION-BLOCKED', 'Change a producer assertion to BLOCKED.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_SCENARIO_PASSED_WITH_NON_PASSED_ASSERTION'),
  mutation('AR06-M014-REQUEST-IDS-MISSING', 'Remove requestIds.', 'gate-proof-validator', 'ABG_GATE_RESULT_REQUEST_IDS_MISMATCH'),
  mutation('AR06-M015-PRINCIPAL-IDS-MISSING', 'Remove principalIds.', 'gate-proof-validator', 'ABG_GATE_RESULT_PRINCIPAL_IDS_MISMATCH'),
  mutation('AR06-M016-GOVERNANCE-OBJECT-IDS-MISSING', 'Remove governanceObjectIds.', 'gate-proof-validator', 'ABG_GATE_RESULT_GOVERNANCE_OBJECT_IDS_MISMATCH'),
  mutation('AR06-M017-VERSION-IDS-MISSING', 'Remove versionIds.', 'gate-proof-validator', 'ABG_GATE_RESULT_VERSION_IDS_MISMATCH'),
  mutation('AR06-M018-RULE-VERSIONS-MISSING', 'Remove ruleVersions.', 'gate-proof-validator', 'ABG_GATE_RESULT_RULE_VERSIONS_MISMATCH'),
  mutation('AR06-M019-FROZEN-INPUT-DIGESTS-MISSING', 'Remove frozenInputDigests.', 'gate-proof-validator', 'ABG_GATE_RESULT_FROZEN_INPUT_DIGESTS_MISMATCH'),
  mutation('AR06-M020A-PLACEHOLDER-REFERENCE', 'Use placeholder as a reference.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_REFERENCE_INVALID'),
  mutation('AR06-M020B-UNKNOWN-REFERENCE', 'Use UNKNOWN as a reference.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_REFERENCE_INVALID'),
  mutation('AR06-M020C-NA-REFERENCE', 'Use N/A as a reference.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_REFERENCE_INVALID'),
  mutation('AR06-M020D-EMPTY-REFERENCE', 'Use an empty reference.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_REFERENCE_INVALID'),
  mutation('AR06-M021-JSON-POINTER-MISSING-PATH', 'Point a selector at a missing JSON path.', 'gate-proof-validator', 'ABG_GATE_RESULT_EVIDENCE_SELECTOR_MISSING'),
  mutation('AR06-M022-JSON-POINTER-WRONG-ASSERTION', 'Point a selector at another assertion.', 'gate-proof-validator', 'ABG_GATE_RESULT_EVIDENCE_SELECTOR_MISSING'),
  mutation('AR06-M023-SOURCE-ARTIFACT-SHA256-TAMPERED', 'Tamper source artifact bytes.', 'independent-reviewer', 'PRODUCER_EVIDENCE_ITEM_SHA256_MISMATCH'),
  mutation('AR06-M024-SELECTED-CLAIM-DIGEST-TAMPERED', 'Tamper selectedClaimDigest.', 'independent-reviewer', 'SELECTED_CLAIM_DIGEST_MISMATCH'),
  mutation('AR06-M025-EVIDENCE-BYTE-LENGTH-TAMPERED', 'Tamper evidence byteLength.', 'independent-reviewer', 'EVIDENCE_REFERENCE_BYTE_LENGTH_MISMATCH'),
  mutation('AR06-M026-EVIDENCE-MEDIA-TYPE-TAMPERED', 'Tamper evidence mediaType.', 'independent-reviewer', 'EVIDENCE_REFERENCE_MEDIA_TYPE_INVALID'),
  mutation('AR06-M027-MANIFEST-FILE-REMOVED', 'Remove one file from manifest.', 'independent-reviewer', 'MANIFEST_UNLISTED_FILE'),
  mutation('AR06-M028-UNLISTED-FILE-ADDED', 'Add an unlisted file.', 'independent-reviewer', 'MANIFEST_UNLISTED_FILE'),
  mutation('AR06-M029-MANIFEST-DIGEST-TAMPERED', 'Tamper manifest.sha256.', 'independent-reviewer', 'MANIFEST_SHA256_MISMATCH'),
  mutation('AR06-M030-RUN-ID-MISMATCH', 'Make runId differ across files.', 'independent-reviewer', 'PRODUCER_EVIDENCE_RUN_ID_MISMATCH'),
  mutation('AR06-M031-RUN-SEQUENCE-MISMATCH', 'Make runSequence differ.', 'formal-summary-validator', 'RUN_SEQUENCE_MISMATCH'),
  mutation('AR06-M032-PLAN-DIGEST-MISMATCH', 'Tamper planDigest.', 'formal-summary-validator', 'RUN_PLAN_DIGEST_MISMATCH'),
  mutation('AR06-M033-FROZEN-INPUTS-DIGEST-MISMATCH', 'Tamper frozenInputsDigest.', 'formal-summary-validator', 'FROZEN_INPUTS_DIGEST_MISMATCH'),
  mutation('AR06-M034-COVERAGE-MATRIX-DIGEST-MISMATCH', 'Tamper coverageMatrixDigest.', 'formal-summary-validator', 'COVERAGE_MATRIX_DIGEST_MISMATCH'),
  mutation('AR06-M035-PRODUCER-PROTOCOL-DIGEST-MISMATCH', 'Tamper producer protocol digest.', 'formal-summary-validator', 'PRODUCER_PROTOCOL_DIGEST_MISMATCH'),
  mutation('AR06-M036-PRODUCER-ID-WRONG', 'Use an unknown producerId.', 'producer-evidence-validator', 'PRODUCER_EVIDENCE_PRODUCER_ID_UNKNOWN'),
  mutation('AR06-M037-PASSED-MASKS-MISSING-GATE-ASSERTION', 'Keep PASSED while a gate assertion is absent.', 'formal-summary-validator', 'GATE_ASSERTIONS_MISMATCH'),
  mutation('AR06-M038-ALL-GATES-SHARE-SELECTORS', 'Reuse one selector set across 40 gates.', 'independent-reviewer', 'GATE_SELECTOR_SETS_NOT_DISTINCT'),
  mutation('AR06-M039-EVIDENCE-PATH-TRAVERSAL', 'Use ../ in evidenceRef.', 'gate-proof-validator', 'ABG_GATE_RESULT_EVIDENCE_PATH_INVALID'),
  mutation('AR06-M040-EVIDENCE-ABSOLUTE-PATH', 'Use an absolute evidenceRef path.', 'gate-proof-validator', 'ABG_GATE_RESULT_EVIDENCE_PATH_INVALID'),
  mutation('AR06-M041-EVIDENCE-SYMLINK', 'Point evidenceRef through a symbolic link.', 'independent-reviewer', 'EVIDENCE_SYMLINK_FORBIDDEN'),
  mutation('AR06-M042-OUTPUT-DIRECTORY-EXISTS', 'Reuse an existing review output directory.', 'exclusive-output-guard', 'REVIEW_OUTPUT_ALREADY_EXISTS'),
  mutation('AR06-M043-RESULT-OVERWRITE', 'Attempt to overwrite result.json.', 'exclusive-output-guard', 'ABG_GATE_RESULT_ALREADY_EXISTS'),
  mutation('AR06-M044-SCREENSHOT-ONLY', 'Keep a screenshot but remove machine-readable assertions.', 'independent-reviewer', 'PRODUCER_INDEX_ASSERTION_COUNT_MISMATCH'),
  mutation('AR06-M045-PRODUCER-EVIDENCE-REMOVED', 'Remove original producer evidence and retain summaries.', 'independent-reviewer', 'PRODUCER_EVIDENCE_MISSING'),
  mutation('AR06-M046-PODMAN-SYSTEM-PRUNE', 'Attempt podman system prune.', 'runtime-teardown-guard', 'FORMAL_CLEANUP_PODMAN_PRUNE_FORBIDDEN'),
  mutation('AR06-M047-UNRELATED-CONTAINER-IN-CLEANUP', 'Attempt to remove an unrelated container.', 'runtime-teardown-guard', 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH'),
  mutation('AR06-M048-SECRET-IN-STDOUT', 'Leak a secret value in stdout.', 'independent-reviewer', 'EVIDENCE_STDOUT_SECRET_EXPOSED'),
  mutation('AR06-M049-SECRET-IN-STDERR', 'Leak a secret value in stderr.', 'independent-reviewer', 'EVIDENCE_STDERR_SECRET_EXPOSED'),
  mutation('AR06-M050-SECRET-IN-EVIDENCE-JSON', 'Leak a secret value in evidence JSON.', 'independent-reviewer', 'EVIDENCE_JSON_SECRET_EXPOSED'),
  mutation('AR06-M050B-MALFORMED-JSON-SECRET', 'Leak a configured secret in malformed JSON.', 'independent-reviewer', 'EVIDENCE_JSON_SECRET_EXPOSED'),
  mutation('AR06-M051-SETUP-FAILED-BUT-PASSED', 'Forge 40/40 PASSED after setup failure.', 'formal-summary-validator', 'SETUP_EXIT_CODE_INVALID'),
  mutation('AR06-M052-FROZEN-INPUTS-UNSTABLE-BUT-PASSED', 'Keep PASSED with frozenInputsStable=false.', 'formal-summary-validator', 'FROZEN_INPUTS_NOT_STABLE'),
  mutation('AR06-M053-NONZERO-PRODUCER-EXIT-BUT-PASSED', 'Keep a gate PASSED with nonzero producerExitCode.', 'formal-summary-validator', 'GATE_PRODUCER_EXIT_CODE_INVALID'),
  mutation('AR06-M054-FAILURE-CODE-CONTRADICTS-PASSED', 'Attach failureCode to a PASSED gate.', 'formal-summary-validator', 'GATE_PASSED_WITH_FAILURE_CODE'),
  mutation('AR06-M055-POST-MANIFEST-BYTE-TAMPER', 'Modify evidence bytes after manifest generation.', 'independent-reviewer', 'MANIFEST_FILE_SHA256_MISMATCH'),
  mutation('CLEANUP_FAILED_BUT_RUN_PASSED', 'Keep the run PASSED while cleanup is FAILED.', 'independent-reviewer', 'FORMAL_CLEANUP_STATUS_NOT_PASSED'),
  mutation('PREFLIGHT_FAILED_BUT_GATES_PASSED', 'Keep all gates PASSED while preflight is FAILED.', 'independent-reviewer', 'FORMAL_PREFLIGHT_STATUS_NOT_PASSED'),
  mutation('TERMINAL_CONCLUSION_MISSING', 'Remove the terminal conclusion.', 'independent-reviewer', 'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING'),
  mutation('TERMINAL_CONCLUSION_FAILED', 'Change the terminal conclusion to FAILED.', 'independent-reviewer', 'FORMAL_TERMINAL_CONCLUSION_STATUS_NOT_PASSED'),
  mutation('SEAL_ELIGIBLE_FALSE', 'Keep ABG-40 PASSED while sealEligible is false.', 'independent-reviewer', 'FORMAL_TERMINAL_SEAL_NOT_ELIGIBLE'),
  mutation('RESIDUAL_CONTAINER_PRESENT', 'Leave a current-run container present after cleanup.', 'independent-reviewer', 'FORMAL_RESIDUAL_CONTAINER_PRESENT'),
  mutation('RESIDUAL_VOLUME_PRESENT', 'Leave a current-run volume present after cleanup.', 'independent-reviewer', 'FORMAL_RESIDUAL_VOLUME_PRESENT'),
  mutation('RESIDUAL_NETWORK_PRESENT', 'Leave a current-run network present after cleanup.', 'independent-reviewer', 'FORMAL_RESIDUAL_NETWORK_PRESENT'),
  mutation('REQUIRED_PORT_OCCUPIED', 'Leave a required port occupied after cleanup.', 'independent-reviewer', 'FORMAL_REQUIRED_PORT_OCCUPIED'),
  mutation('FINAL_OUTCOME_MISMATCH', 'Contradict abg-results from final-outcome.', 'independent-reviewer', 'FORMAL_FINAL_OUTCOME_STATUS_MISMATCH'),
  mutation('ABG40_PRELIMINARY_CONCLUSION_SOURCE', 'Point ABG-40 at the retired preliminary conclusion.', 'independent-reviewer', 'ABG40_TERMINAL_EVIDENCE_REFERENCE_INVALID'),
  mutation('ABG40_MISSING_SEAL_ASSERTION', 'Remove the ABG-40 seal assertion.', 'independent-reviewer', 'ABG40_SEAL_ASSERTION_MISSING'),
  mutation('FROZEN_INPUT_DRIFT_AFTER_CLEANUP', 'Mark frozen inputs unstable after cleanup.', 'independent-reviewer', 'FORMAL_TERMINAL_FROZEN_INPUTS_DRIFT'),
  mutation('AUTHORITY_DRIFT_AFTER_CLEANUP', 'Mark verification authority unstable after cleanup.', 'independent-reviewer', 'FORMAL_TERMINAL_AUTHORITY_IDENTITY_DRIFT'),
  mutation('OUTPUT_DIRECTORY_NOT_EXCLUSIVE', 'Mark the evidence output directory non-exclusive.', 'independent-reviewer', 'FORMAL_TERMINAL_OUTPUT_DIRECTORY_NOT_EXCLUSIVE'),
  mutation('CLEANUP_RESIDUALS_MALFORMED', 'Replace cleanup residualResources with a non-array.', 'independent-reviewer', 'FORMAL_CLEANUP_RESIDUAL_RESOURCES_INVALID'),
  mutation('FINAL_RESOURCES_MALFORMED', 'Replace final resources with a non-array.', 'independent-reviewer', 'FORMAL_FINAL_RESOURCES_INVALID'),
  mutation('PRODUCER_SNAPSHOT_IDENTITY_MISMATCH', 'Forge a pre-cleanup producer snapshot digest.', 'independent-reviewer', 'FORMAL_PRODUCER_SNAPSHOT_FILE_IDENTITY_MISMATCH'),
  mutation('FINAL_OUTCOME_SEAL_STATUS_MISMATCH', 'Contradict seal eligibility in final-outcome.', 'independent-reviewer', 'FORMAL_FINAL_OUTCOME_SEAL_STATUS_MISMATCH'),
  mutation('RUN_PLAN_GIT_IDENTITY_MISMATCH', 'Make summary Git identity differ from the frozen run plan.', 'independent-reviewer', 'FORMAL_SUMMARY_GIT_COMMIT_MISMATCH'),
  mutation('TERMINAL_ASSERTION_BODY_MISMATCH', 'Forge the terminal lifecycle assertion actual body.', 'independent-reviewer', 'FORMAL_TERMINAL_LIFECYCLE_ASSERTION_INCONSISTENT'),
  mutation('PRODUCER_SOURCE_MANIFEST_MISSING', 'Remove the producer source manifest.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_MISSING'),
  mutation('PRODUCER_SOURCE_MANIFEST_DIGEST_TAMPERED', 'Tamper a producer source manifest entry digest.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH'),
  mutation('PRODUCER_SOURCE_MANIFEST_SHA_FILE_TAMPERED', 'Tamper the producer source manifest digest sidecar.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_SHA256_MISMATCH'),
  mutation('PRODUCER_SOURCE_MANIFEST_DUPLICATE_PATH', 'Duplicate a producer source manifest path.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_ENTRY_DUPLICATE'),
  mutation('PRODUCER_SOURCE_MANIFEST_UNSORTED', 'Put producer source manifest entries out of order.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_ORDER_INVALID'),
  mutation('PRODUCER_SOURCE_MANIFEST_PATH_TRAVERSAL', 'Use a parent traversal source path.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE'),
  mutation('PRODUCER_SOURCE_MANIFEST_ABSOLUTE_PATH', 'Use an absolute producer source path.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE'),
  mutation('PRODUCER_SOURCE_MANIFEST_SYMLINK', 'Replace the producer source manifest with a symlink.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE'),
  mutation('PRODUCER_COMMIT_UNAVAILABLE', 'Reference a producer commit unavailable from the local object database.', 'independent-reviewer', 'PRODUCER_COMMIT_UNAVAILABLE'),
  mutation('PRODUCER_SOURCE_BLOB_MISMATCH', 'Make a producer source blob identity disagree with Git.', 'independent-reviewer', 'PRODUCER_SOURCE_BLOB_ID_MISMATCH'),
  mutation('PRODUCER_SOURCE_SHA_MISMATCH', 'Make a producer source digest disagree with the Git blob bytes.', 'independent-reviewer', 'PRODUCER_SOURCE_SHA256_MISMATCH'),
  mutation('PRODUCER_SOURCE_FILE_MISSING_AT_COMMIT', 'Reference a source path absent at the producer commit.', 'independent-reviewer', 'PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT'),
  mutation('RUN_PLAN_SOURCE_MANIFEST_DIGEST_MISMATCH', 'Make run-plan source manifest identity disagree.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH'),
  mutation('TERMINAL_SOURCE_MANIFEST_DIGEST_MISMATCH', 'Make terminal conclusion source manifest identity disagree.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH'),
  mutation('SUMMARY_SOURCE_MANIFEST_DIGEST_MISMATCH', 'Make run summary source manifest identity disagree.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH'),
  mutation('FINAL_OUTCOME_SOURCE_MANIFEST_DIGEST_MISMATCH', 'Make final outcome source manifest identity disagree.', 'independent-reviewer', 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH'),
  mutation('MIXED_PRODUCER_EVIDENCE_SCHEMA_VERSIONS', 'Mix producer evidence schema versions.', 'independent-reviewer', 'REVIEWER_CONTRACT_VERSION_MIXED'),
  mutation('MIXED_GATE_RESULT_SCHEMA_VERSIONS', 'Mix gate result schema versions.', 'independent-reviewer', 'REVIEWER_CONTRACT_VERSION_MIXED'),
  mutation('UNKNOWN_RUN_SUMMARY_SCHEMA_VERSION', 'Use an unknown run summary schema version.', 'independent-reviewer', 'REVIEWER_CONTRACT_VERSION_UNKNOWN'),
  mutation('UNKNOWN_TERMINAL_CONCLUSION_SCHEMA_VERSION', 'Use an unknown terminal conclusion schema version.', 'independent-reviewer', 'REVIEWER_CONTRACT_VERSION_UNKNOWN'),
  mutation('REVIEWER_CONTRACT_INCOMPATIBLE', 'Present an incompatible evidence contract tuple.', 'independent-reviewer', 'REVIEWER_CONTRACT_INCOMPATIBLE'),
  mutation('REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED', 'Keep schemas parseable while producer definitions drift.', 'independent-reviewer', 'REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED'),
  mutation('REVIEWER_WORKTREE_DIRTY', 'Report the reviewer checkout as dirty.', 'independent-reviewer', 'REVIEWER_WORKTREE_DIRTY'),
  mutation('COVERAGE_MATRIX_DEFINITION_DRIFT', 'Drift the producer coverage matrix definition.', 'independent-reviewer', 'COVERAGE_MATRIX_DEFINITION_DRIFT'),
  mutation('PRODUCER_PROTOCOL_DEFINITION_DRIFT', 'Drift the producer evidence protocol definition.', 'independent-reviewer', 'PRODUCER_PROTOCOL_DEFINITION_DRIFT'),
  mutation('GATE_PROOF_DEFINITION_DRIFT', 'Drift the gate proof definition.', 'independent-reviewer', 'GATE_PROOF_DEFINITION_DRIFT'),
  mutation('TERMINAL_CONTRACT_DEFINITION_DRIFT', 'Drift the terminal contract definition.', 'independent-reviewer', 'TERMINAL_CONTRACT_DEFINITION_DRIFT'),
  mutation('REVIEWER_SOURCE_MANIFEST_TAMPERED', 'Tamper the independently written reviewer source manifest.', 'independent-reviewer', 'REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH'),
  mutation('REVIEW_OUTPUT_DIRECTORY_EXISTS', 'Reuse an existing provenance review output directory.', 'exclusive-output-guard', 'REVIEW_OUTPUT_ALREADY_EXISTS'),
  mutation('EVIDENCE_EMBEDDED_SCRIPT_NOT_EXECUTED', 'Add an embedded script whose sentinel side effect must never execute.', 'independent-reviewer', 'MANIFEST_UNLISTED_FILE'),
  mutation('RUNTIME_AUTHORITY_MISSING', 'Remove the sole runtime authority input.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_MISSING'),
  mutation('RUNTIME_AUTHORITY_SHA_MISMATCH', 'Make the runtime authority byte digest disagree.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_SHA_MISMATCH'),
  mutation('RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH', 'Make the runtime authority semantic digest disagree.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH'),
  mutation('RUNTIME_AUTHORITY_ROOTLESS', 'Enable rootless Podman in runtime authority.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_ROOTLESS_FORBIDDEN'),
  mutation('RUNTIME_AUTHORITY_RESTART_POLICY_INVALID', 'Set an authority restart policy other than no.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_RESTART_POLICY_INVALID'),
  mutation('RUNTIME_AUTHORITY_IMAGE_FLOATING_TAG', 'Replace a digest-pinned image with a floating tag.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_IMAGE_DIGEST_REQUIRED'),
  mutation('RUNTIME_AUTHORITY_PORT_DUPLICATE', 'Assign the same host port to two services.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_PORT_DUPLICATE'),
  mutation('RUNTIME_AUTHORITY_SECOND_SOURCE_DRIFT', 'Make a second runtime source disagree with the authority digest.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_SECOND_SOURCE_DRIFT'),
  mutation('DOCKER_SOCKET_ALIAS_PRESENT', 'Expose a Docker socket alias to the Podman socket.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT'),
  mutation('DOCKER_SERVICE_ACTIVE', 'Leave docker.service active.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_DOCKER_SYSTEMD_UNIT_PRESENT'),
  mutation('DOCKER_DAEMON_PRESENT', 'Leave a dockerd process running.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_DOCKER_PROCESS_PRESENT'),
  mutation('DOCKER_TCP_API_PRESENT', 'Expose the Docker TCP API.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_CONTAINER_API_TCP_PRESENT'),
  mutation('PODMAN_TCP_API_PRESENT', 'Expose an additional Podman TCP API.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT'),
  mutation('DOCKER_HOST_REMOTE', 'Point DOCKER_HOST at a remote Docker endpoint.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_DOCKER_HOST_INVALID'),
  mutation('PODMAN_REMOTE_CONNECTION_PRESENT', 'Configure a remote Podman connection.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT'),
  mutation('ROOTLESS_PODMAN_SOCKET_PRESENT', 'Expose a rootless Podman socket.', 'formal-preflight-policy', 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'),
  mutation('CONTAINER_RESTART_UNLESS_STOPPED', 'Create a managed container with unless-stopped.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_CONTAINER_RESTART_POLICY_INVALID'),
  mutation('CONTAINER_RESTART_POLICY_DRIFT', 'Observe a managed container restart policy that drifted.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_CONTAINER_RESTART_POLICY_INVALID'),
  mutation('PARTIAL_STARTUP_POSTGRES_VOLUME_RESIDUE', 'Leave a PostgreSQL volume after partial startup.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_PARTIAL_STARTUP_RESIDUE'),
  mutation('PARTIAL_STARTUP_KEYCLOAK_VOLUME_RESIDUE', 'Leave a Keycloak volume after partial startup.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_PARTIAL_STARTUP_RESIDUE'),
  mutation('PARTIAL_STARTUP_POSTGRES_CONTAINER_RESIDUE', 'Leave a PostgreSQL container after partial startup.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_PARTIAL_STARTUP_RESIDUE'),
  mutation('PARTIAL_STARTUP_KEYCLOAK_CONTAINER_RESIDUE', 'Leave a Keycloak container after partial startup.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_PARTIAL_STARTUP_RESIDUE'),
  mutation('PARTIAL_STARTUP_OWNERSHIP_MISMATCH', 'Present a partial-startup resource with mismatched ownership.', 'runtime-teardown-guard', 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH'),
  mutation('PARTIAL_STARTUP_CLEANUP_FAILED', 'Fail cleanup after partial startup.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_PARTIAL_STARTUP_CLEANUP_FAILED'),
  mutation('BOOTSTRAP_READINESS_FAILURE_RESIDUE', 'Leave owned resources after bootstrap readiness failure.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_BOOTSTRAP_FAILURE_RESIDUE'),
  mutation('BOOTSTRAP_MIGRATION_FAILURE_RESIDUE', 'Leave owned resources after bootstrap migration failure.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_BOOTSTRAP_FAILURE_RESIDUE'),
  mutation('BOOTSTRAP_SEED_FAILURE_RESIDUE', 'Leave owned resources after bootstrap seed failure.', 'runtime-lifecycle-guard', 'FORMAL_RUNTIME_BOOTSTRAP_FAILURE_RESIDUE'),
  mutation('UNRELATED_PODMAN_RESOURCE_REMOVED', 'Attempt cleanup of an unrelated Podman resource.', 'runtime-teardown-guard', 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH'),
  mutation('PODMAN_PRUNE_ATTEMPT', 'Attempt a Podman prune during targeted cleanup.', 'runtime-teardown-guard', 'FORMAL_CLEANUP_PODMAN_PRUNE_FORBIDDEN'),
  mutation('RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP', 'Change runtime authority identity after cleanup.', 'runtime-authority-validator', 'RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP'),
] as const;

export const AR12_EXECUTION_WORKSPACE_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  mutation('AR12_EXECUTION_CLONE_INSIDE_REPOSITORY', 'Place the execution clone inside the repository.', 'ar12-workspace-guard', 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'),
  mutation('AR12_EXECUTION_CLONE_INSIDE_RUNTIME', 'Place the execution clone below the repository runtime directory.', 'ar12-workspace-guard', 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'),
  mutation('AR12_EXECUTION_CLONE_SYMLINK_ESCAPE', 'Resolve an apparently external root back into the repository through a reparse point.', 'ar12-workspace-guard', 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE'),
  mutation('AR12_EXECUTION_CLONE_ALREADY_EXISTS', 'Reuse an existing execution clone directory.', 'ar12-workspace-guard', 'AR12_EXECUTION_WORKSPACE_ALREADY_EXISTS'),
  mutation('AR12_EXECUTION_CLONE_HEAD_MISMATCH', 'Observe a clone HEAD different from the opening commit.', 'ar12-clone-identity-guard', 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'),
  mutation('AR12_EXECUTION_CLONE_BRANCH_MISMATCH', 'Observe a clone branch different from the target branch.', 'ar12-clone-identity-guard', 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'),
  mutation('AR12_EXECUTION_CLONE_ORIGIN_MISMATCH', 'Observe a clone origin different from the source repository origin.', 'ar12-clone-identity-guard', 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'),
  mutation('AR12_STALE_CLONE_IDENTITY_MISMATCH', 'Attempt stale clone relocation with a mismatched identity.', 'ar12-relocation-guard', 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'),
  mutation('AR12_FAILED_EVIDENCE_DIRECTORY_DELETE_ATTEMPT', 'Attempt to clean up a failed evidence directory as an execution workspace.', 'ar12-workspace-guard', 'AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE'),
  mutation('AR12_REPO_LAYOUT_GATE_BYPASS_ATTEMPT', 'Remove the repository layout gate from the AR-12 command plan.', 'ar12-command-plan-guard', 'AR12_REPO_LAYOUT_GATE_BYPASS_FORBIDDEN'),
] as const;

export const AR12_HISTORY_EVIDENCE_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  mutation('AR12_REQUIRED_HISTORY_SIXTH_DIRECTORY_MISSING', 'Remove the required sixth history directory.', 'ar12-history-evidence-guard', 'AR12_HISTORY_REQUIRED_DIRECTORY_MISSING'),
  mutation('AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_MISSING', 'Remove the required sixth historical Summary.', 'ar12-history-evidence-guard', 'AR12_HISTORY_REQUIRED_ARTIFACT_MISSING'),
  mutation('AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_SHA_MISMATCH', 'Change the required sixth historical Summary bytes.', 'ar12-history-evidence-guard', 'AR12_HISTORY_REQUIRED_ARTIFACT_SHA256_MISMATCH'),
  mutation('AR12_REQUIRED_HISTORY_SIXTH_CLASSIFICATION_MISMATCH', 'Reclassify the rejected sixth history as passed.', 'ar12-history-evidence-guard', 'AR12_HISTORY_CLASSIFICATION_MISMATCH'),
  mutation('AR12_REQUIRED_HISTORY_SUBSTITUTED_BY_EXTRA_DIRECTORY', 'Replace the sixth required history with an extra directory.', 'ar12-history-evidence-guard', 'AR12_HISTORY_EXTRA_DIRECTORY_CANNOT_SUBSTITUTE_REQUIRED'),
  mutation('AR12_REQUIRED_HISTORY_TREE_DRIFT', 'Change a required history tree after opening capture.', 'ar12-history-evidence-guard', 'AR12_HISTORY_REQUIRED_DIRECTORY_TREE_DRIFT'),
  mutation('AR12_REQUIRED_HISTORY_RECOVERY_SHA_MISMATCH', 'Change the fixed recovery artifact bytes.', 'ar12-history-evidence-guard', 'AR12_RECOVERY_ARTIFACT_SHA256_MISMATCH'),
  mutation('AR12_REQUIRED_HISTORY_STALE_CLONE_REAPPEARED', 'Recreate the forbidden stale execution clone path.', 'ar12-history-evidence-guard', 'AR12_STALE_EXECUTION_CLONE_REAPPEARED'),
] as const;

export const AR07R01_ADVERSARIAL_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  mutation('EVIDENCE_PARENT_DIRECTORY_CONCURRENT_CREATE', 'Regress concurrent creation of one evidence parent.', 'evidence-recorder-guard', 'EVIDENCE_PARENT_DIRECTORY_CONCURRENT_CREATE'),
  mutation('EVIDENCE_PARENT_DIRECTORY_EEXIST_FILE', 'Replace an evidence parent directory with a file.', 'evidence-recorder-guard', 'PRODUCER_EVIDENCE_DIRECTORY_EXISTING_NOT_DIRECTORY'),
  mutation('EVIDENCE_PARENT_DIRECTORY_EEXIST_SYMLINK', 'Replace an evidence parent directory with a symlink.', 'evidence-recorder-guard', 'PRODUCER_EVIDENCE_DIRECTORY_SYMLINK_FORBIDDEN'),
  mutation('EVIDENCE_SAME_FILE_CONCURRENT_WRITE', 'Race two immutable writes to the same evidence file.', 'evidence-recorder-guard', 'PRODUCER_EVIDENCE_WRITE_ALREADY_EXISTS'),
  mutation('PODMAN_MACHINE_NATIVE_ROOTFUL_NOT_APPLICABLE', 'Misclassify native rootful Podman Machine as an inspection failure.', 'podman-machine-inspection', 'PODMAN_MACHINE_NATIVE_ROOTFUL_NOT_APPLICABLE'),
  mutation('PODMAN_MACHINE_REGISTERED_PRESENT', 'Hide a registered stopped Podman Machine.', 'podman-machine-inspection', 'PODMAN_MACHINE_REGISTERED_PRESENT'),
  mutation('PODMAN_MACHINE_RUNNING_PRESENT', 'Hide a running Podman Machine.', 'podman-machine-inspection', 'PODMAN_MACHINE_RUNNING_PRESENT'),
  mutation('PODMAN_MACHINE_REMOTE_CONNECTION_PRESENT', 'Hide a remote Podman connection.', 'podman-machine-inspection', 'PODMAN_MACHINE_REMOTE_CONNECTION_PRESENT'),
  mutation('PODMAN_MACHINE_MALFORMED_RESULT', 'Accept malformed Podman Machine JSON.', 'podman-machine-inspection', 'PODMAN_MACHINE_RESULT_MALFORMED'),
  mutation('PODMAN_MACHINE_UNKNOWN_INSPECTION_FAILURE', 'Accept an unknown nonzero Podman Machine inspection failure.', 'podman-machine-inspection', 'PODMAN_MACHINE_COMMAND_FAILED'),
  mutation('CLEANUP_NATIVE_ROOTFUL_MACHINE_FALSE_FAILURE', 'Fail cleanup solely because native rootful Machine is not applicable.', 'podman-machine-inspection', 'CLEANUP_NATIVE_ROOTFUL_MACHINE_FALSE_FAILURE'),
  mutation('PREFLIGHT_CLEANUP_MACHINE_CLASSIFICATION_DRIFT', 'Classify the same Machine fixture differently in preflight and cleanup.', 'podman-machine-inspection', 'PREFLIGHT_CLEANUP_MACHINE_CLASSIFICATION_DRIFT'),
] as const;

export const AR07R03_ADVERSARIAL_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  mutation('FORMAL_SETUP_RELATIVE_NODE_OPTIONS_LEAK', 'Reintroduce relative NODE_OPTIONS in formal setup.', 'formal-command-boundary', 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN'),
  mutation('FORMAL_GATE_RELATIVE_NODE_OPTIONS_LEAK', 'Reintroduce relative NODE_OPTIONS in a gate producer.', 'formal-command-boundary', 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN'),
  mutation('SHARED_DATABASE_AUTHORITY_NODE_OPTIONS_LEAK', 'Leak NODE_OPTIONS into database authority.', 'shared-command-boundary', 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN'),
  mutation('SHARED_INTEGRATION_NODE_OPTIONS_LEAK', 'Leak NODE_OPTIONS into workspace Vitest.', 'shared-command-boundary', 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN'),
  mutation('WORKSPACE_LOADER_RESOLVED_FROM_CHILD_CWD', 'Allow a workspace child cwd to resolve the repository loader.', 'shared-command-boundary', 'WORKSPACE_LOADER_RESOLVED_FROM_CHILD_CWD'),
  mutation('TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER', 'Launch a registered TypeScript entry without explicit loader argv.', 'shared-command-boundary', 'REPOSITORY_TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER'),
  mutation('LOADER_ABSOLUTE_HOST_PATH_IN_FROZEN_PLAN', 'Write an absolute host loader path into the frozen plan.', 'formal-command-boundary', 'REPOSITORY_NODE_LOADER_PATH_INVALID'),
  mutation('DATABASE_AUTHORITY_KYSELY_LOADER_CONTAMINATION', 'Pass the repository loader into Kysely verification.', 'database-authority-boundary', 'DATABASE_AUTHORITY_KYSELY_LOADER_CONTAMINATION'),
] as const;

export const ADVERSARIAL_MUTATION_CASES: readonly EvidenceMutationCase[] = [
  ...PRE_AR12_ADVERSARIAL_MUTATION_CASES,
  ...AR12_EXECUTION_WORKSPACE_MUTATION_CASES,
  ...AR12_HISTORY_EVIDENCE_MUTATION_CASES,
  ...AR07R01_ADVERSARIAL_MUTATION_CASES,
  ...AR07R03_ADVERSARIAL_MUTATION_CASES,
] as const;

export async function executeEvidenceMutation(
  mutationCase: EvidenceMutationCase,
  context: MutationExecutionContext,
): Promise<MutationExecutionResult> {
  let codes: readonly string[];
  try {
    codes = await executeMutation(mutationCase.mutationId, context);
  } catch (error) {
    codes = [stableErrorCode(error)];
  }
  const detected = codes.includes(mutationCase.expectedErrorCode);
  return {
    mutationId: mutationCase.mutationId,
    detectionLayer: mutationCase.detectionLayer,
    expectedErrorCode: mutationCase.expectedErrorCode,
    actualErrorCode: detected ? mutationCase.expectedErrorCode : codes[0] ?? null,
    detected,
  };
}

async function executeMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  switch (mutationId) {
    case 'AR06-M001-MISSING-ABG-01':
      return summaryMutation(context.fixture, (summary) => { summaryResults(summary).shift(); });
    case 'AR06-M002-MISSING-ABG-40':
      return summaryMutation(context.fixture, (summary) => { summaryResults(summary).pop(); });
    case 'AR06-M003-DUPLICATE-ABG-10':
      return summaryMutation(context.fixture, (summary) => { summaryResults(summary)[10]!['gateId'] = 'ABG-10'; });
    case 'AR06-M004-ABG-10-MASQUERADES-AS-ABG-11':
      return gateProofMutation(context.fixture, 'ABG-10', (proof) => { proof['gateId'] = 'ABG-11'; });
    case 'AR06-M005-GATE-ORDER-SHUFFLED':
      return summaryMutation(context.fixture, (summary) => {
        const results = summaryResults(summary);
        [results[9], results[10]] = [results[10]!, results[9]!];
      });
    case 'AR06-M006-GATE-COUNT-FORGED-40':
      return summaryMutation(context.fixture, (summary) => { summaryResults(summary).splice(19, 1); });
    case 'AR06-M007-PASSED-COUNT-FORGED':
      return summaryMutation(context.fixture, (summary) => { summary['passedCount'] = 39; });
    case 'AR06-M008-OVERALL-STATUS-FORGED-PASSED':
      return summaryMutation(context.fixture, (summary) => {
        const result = summaryResults(summary)[19]!;
        result['status'] = 'FAILED';
        result['producerExitCode'] = 1;
        result['failureCode'] = 'AR06_MUTATED_GATE_FAILURE';
        result['proofPath'] = null;
        result['proof'] = null;
        summary['passedCount'] = 39;
        summary['failedCount'] = 1;
      });
    case 'AR06-M009-SCENARIO-ID-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['scenarioIds'] = []; });
    case 'AR06-M010-ASSERTION-ID-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['assertionIds'] = []; });
    case 'AR06-M011-CROSS-GATE-ASSERTION-ID':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => {
        proof['assertionIds'] = [...coverageEntry('ABG-17').assertionIds];
      });
    case 'AR06-M012-ASSERTION-FAILED':
      return producerAssertionStatusMutation(context.fixture, 'FAILED');
    case 'AR06-M013-ASSERTION-BLOCKED':
      return producerAssertionStatusMutation(context.fixture, 'BLOCKED');
    case 'AR06-M014-REQUEST-IDS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['requestIds'] = []; });
    case 'AR06-M015-PRINCIPAL-IDS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['principalIds'] = []; });
    case 'AR06-M016-GOVERNANCE-OBJECT-IDS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['governanceObjectIds'] = []; });
    case 'AR06-M017-VERSION-IDS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['versionIds'] = []; });
    case 'AR06-M018-RULE-VERSIONS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['ruleVersions'] = []; });
    case 'AR06-M019-FROZEN-INPUT-DIGESTS-MISSING':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => { proof['frozenInputDigests'] = []; });
    case 'AR06-M020A-PLACEHOLDER-REFERENCE': return invalidProducerReference(context.fixture, 'placeholder');
    case 'AR06-M020B-UNKNOWN-REFERENCE': return invalidProducerReference(context.fixture, 'UNKNOWN');
    case 'AR06-M020C-NA-REFERENCE': return invalidProducerReference(context.fixture, 'N/A');
    case 'AR06-M020D-EMPTY-REFERENCE': return invalidProducerReference(context.fixture, '');
    case 'AR06-M021-JSON-POINTER-MISSING-PATH':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => {
        firstEvidenceReference(proof)['jsonPointer'] = '/missing/path';
      });
    case 'AR06-M022-JSON-POINTER-WRONG-ASSERTION':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => {
        firstEvidenceReference(proof)['jsonPointer'] = coverageEntry('ABG-17').evidenceSelectors[0]!.jsonPointer;
      });
    case 'AR06-M023-SOURCE-ARTIFACT-SHA256-TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateJsonFile(copy.evidenceDirectory, 'shared/raw/fault.json', (artifact) => {
          artifact['status'] = 'FAILED';
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M024-SELECTED-CLAIM-DIGEST-TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateGateProofFile(copy.evidenceDirectory, 'ABG-16', (proof) => {
          firstEvidenceReference(proof)['selectedClaimDigest'] = '0'.repeat(64);
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M025-EVIDENCE-BYTE-LENGTH-TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateGateProofFile(copy.evidenceDirectory, 'ABG-16', (proof) => {
          const reference = firstEvidenceReference(proof);
          reference['byteLength'] = Number(reference['byteLength']) + 1;
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M026-EVIDENCE-MEDIA-TYPE-TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateGateProofFile(copy.evidenceDirectory, 'ABG-16', (proof) => {
          firstEvidenceReference(proof)['mediaType'] = 'text/plain';
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M027-MANIFEST-FILE-REMOVED':
      return reviewerMutation(mutationId, context, async (copy) => {
        const manifest = await readJsonRecord(copy.evidenceDirectory, 'manifest.json');
        const files = recordArray(manifest['files']);
        const index = files.findIndex((entry) => entry['path'] === 'setup/01/stdout.log');
        if (index === -1) throw new Error('MUTATION_MANIFEST_ENTRY_MISSING');
        files.splice(index, 1);
        await writeManifestAndDigest(copy.evidenceDirectory, manifest);
      });
    case 'AR06-M028-UNLISTED-FILE-ADDED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(join(copy.evidenceDirectory, 'unlisted.log'), 'mutation\n', { flag: 'wx' });
      });
    case 'AR06-M029-MANIFEST-DIGEST-TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(
          join(copy.evidenceDirectory, 'manifest.sha256'),
          `${'0'.repeat(64)}  manifest.json\n`,
          { flag: 'w' },
        );
      });
    case 'AR06-M030-RUN-ID-MISMATCH':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateJsonFile(copy.evidenceDirectory, 'shared/fault/producer-evidence.json', (evidence) => {
          evidence['runId'] = 'different-validator-test-run';
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M031-RUN-SEQUENCE-MISMATCH':
      return summaryMutation(context.fixture, (summary) => { summary['runSequence'] = 18; });
    case 'AR06-M032-PLAN-DIGEST-MISMATCH':
      return summaryMutation(context.fixture, (summary) => { summary['planDigest'] = '0'.repeat(64); });
    case 'AR06-M033-FROZEN-INPUTS-DIGEST-MISMATCH':
      return summaryMutation(context.fixture, (summary) => { summary['frozenInputsDigest'] = '0'.repeat(64); });
    case 'AR06-M034-COVERAGE-MATRIX-DIGEST-MISMATCH':
      return summaryMutation(context.fixture, (summary) => { summary['coverageMatrixDigest'] = '0'.repeat(64); });
    case 'AR06-M035-PRODUCER-PROTOCOL-DIGEST-MISMATCH':
      return summaryMutation(context.fixture, (summary) => { summary['producerProtocolIdentityDigest'] = '0'.repeat(64); });
    case 'AR06-M036-PRODUCER-ID-WRONG':
      return producerMutation(context.fixture, 'static', (evidence) => {
        (evidence as unknown as Record<string, unknown>)['producerId'] = 'forged-producer';
      });
    case 'AR06-M037-PASSED-MASKS-MISSING-GATE-ASSERTION':
      return summaryMutation(context.fixture, (summary) => {
        summaryGateProof(summary, 'ABG-16')['assertionIds'] = [];
      });
    case 'AR06-M038-ALL-GATES-SHARE-SELECTORS':
      return reviewerMutation(mutationId, context, async (copy) => {
        const summary = await readJsonRecord(copy.evidenceDirectory, 'abg-results.json');
        const results = summaryResults(summary);
        const sharedReferences = clone(record(results[0]!['proof'])['evidenceRefs']);
        for (const result of results) {
          const proof = record(result['proof']);
          proof['evidenceRefs'] = clone(sharedReferences);
          await writeJsonFile(copy.evidenceDirectory, String(result['proofPath']), proof);
        }
        await writeJsonFile(copy.evidenceDirectory, 'abg-results.json', summary);
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M039-EVIDENCE-PATH-TRAVERSAL':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => {
        firstEvidenceReference(proof)['relativePath'] = '../producer-evidence.json';
      });
    case 'AR06-M040-EVIDENCE-ABSOLUTE-PATH':
      return gateProofMutation(context.fixture, 'ABG-16', (proof) => {
        firstEvidenceReference(proof)['relativePath'] = 'C:/validator-test/producer-evidence.json';
      });
    case 'AR06-M041-EVIDENCE-SYMLINK':
      return reviewerMutation(mutationId, context, async (copy) => {
        const external = join(copy.caseDirectory, 'external-producer');
        await mkdir(external, { recursive: false });
        await cp(
          join(copy.evidenceDirectory, 'shared/static/producer-evidence.json'),
          join(external, 'producer-evidence.json'),
        );
        await symlink(
          external,
          join(copy.evidenceDirectory, 'linked-producer'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        await mutateGateProofFile(copy.evidenceDirectory, 'ABG-01', (proof) => {
          firstEvidenceReference(proof)['relativePath'] = 'linked-producer/producer-evidence.json';
        });
      });
    case 'AR06-M042-OUTPUT-DIRECTORY-EXISTS': {
      const copy = await copyFixtureForMutation(mutationId, context);
      await mkdir(copy.reviewOutputDirectory, { recursive: false });
      return captureErrorCodes(() => reviewFormalAbgEvidence({
        evidenceDirectory: copy.evidenceDirectory,
        reviewOutputDirectory: copy.reviewOutputDirectory,
        dependencies: context.fixture.reviewerDependencies,
      }));
    }
    case 'AR06-M043-RESULT-OVERWRITE':
      return captureErrorCodes(() => writeAbgGateProof({
        gateId: 'ABG-16',
        runId: context.fixture.runId,
        runSequence: context.fixture.runSequence,
        evidenceRoot: context.fixture.evidenceDirectory,
        producerEvidenceIndexRelativePath: 'shared/producer-evidence-index.json',
        resultRelativePath: 'gates/ABG-16/producer/result.json',
      }));
    case 'AR06-M044-SCREENSHOT-ONLY':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mkdir(join(copy.evidenceDirectory, 'screenshots'), { recursive: false });
        await writeFile(
          join(copy.evidenceDirectory, 'screenshots/only.png'),
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          { flag: 'wx' },
        );
        await mutateJsonFile(copy.evidenceDirectory, 'shared/static/producer-evidence.json', (evidence) => {
          const scenario = scenarioForGate(evidence, 'ABG-01');
          scenario['assertions'] = {};
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M045-PRODUCER-EVIDENCE-REMOVED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await unlink(join(copy.evidenceDirectory, 'shared/fault/producer-evidence.json'));
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'AR06-M046-PODMAN-SYSTEM-PRUNE':
      return captureErrorCodes(() => Promise.resolve(
        assertSafeFormalCleanupCommand('podman', ['system', 'prune', '--all', '--force']),
      ));
    case 'AR06-M047-UNRELATED-CONTAINER-IN-CLEANUP':
      return unrelatedCleanupMutation();
    case 'AR06-M048-SECRET-IN-STDOUT':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(
          join(copy.evidenceDirectory, 'setup/01/stdout.log'),
          'password=ar06-stdout-bare-configured-secret\n',
          { flag: 'w' },
        );
        await rebuildFixtureManifest(copy.evidenceDirectory);
      }, {
        name: 'HDI_POSTGRES_PASSWORD',
        value: 'ar06-stdout-bare-configured-secret',
      });
    case 'AR06-M049-SECRET-IN-STDERR':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(
          join(copy.evidenceDirectory, 'setup/01/stderr.log'),
          'client_secret=ar06-stderr-bare-configured-secret\n',
          { flag: 'w' },
        );
        await rebuildFixtureManifest(copy.evidenceDirectory);
      }, {
        name: 'HDI_KEYCLOAK_ADMIN_PASSWORD',
        value: 'ar06-stderr-bare-configured-secret',
      });
    case 'AR06-M050-SECRET-IN-EVIDENCE-JSON':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeJsonFile(copy.evidenceDirectory, 'secret-evidence.json', {
          password: 'ar06-json-bare-configured-secret',
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      }, {
        name: 'HDI_OWNER_PASSWORD',
        value: 'ar06-json-bare-configured-secret',
      });
    case 'AR06-M050B-MALFORMED-JSON-SECRET':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(
          join(copy.evidenceDirectory, 'malformed-secret-evidence.json'),
          'password=ar06-malformed-bare-configured-secret {',
          { flag: 'wx' },
        );
        await rebuildFixtureManifest(copy.evidenceDirectory);
      }, {
        name: 'HDI_BROWSER_CLIENT_SECRET',
        value: 'ar06-malformed-bare-configured-secret',
      });
    case 'AR06-M051-SETUP-FAILED-BUT-PASSED':
      return summaryMutation(context.fixture, (summary) => {
        recordArray(summary['setupResults'])[0]!['exitCode'] = 1;
      });
    case 'AR06-M052-FROZEN-INPUTS-UNSTABLE-BUT-PASSED':
      return summaryMutation(context.fixture, (summary) => {
        summary['frozenInputsStableAfterCleanup'] = false;
      });
    case 'AR06-M053-NONZERO-PRODUCER-EXIT-BUT-PASSED':
      return summaryMutation(context.fixture, (summary) => {
        summaryResults(summary)[15]!['producerExitCode'] = 1;
      });
    case 'AR06-M054-FAILURE-CODE-CONTRADICTS-PASSED':
      return summaryMutation(context.fixture, (summary) => {
        summaryResults(summary)[15]!['failureCode'] = 'AR06_CONTRADICTORY_FAILURE';
      });
    case 'AR06-M055-POST-MANIFEST-BYTE-TAMPER':
      return reviewerMutation(mutationId, context, async (copy) => {
        const path = join(copy.evidenceDirectory, 'shared/raw/fault.json');
        const before = await readFile(path, 'utf8');
        const after = before.replace('"status": "PASSED"', '"status": "FAILED"');
        if (after === before || Buffer.byteLength(after) !== Buffer.byteLength(before)) {
          throw new Error('MUTATION_SAME_LENGTH_REPLACEMENT_FAILED');
        }
        await writeFile(path, after, { flag: 'w' });
      });
    case 'CLEANUP_FAILED_BUT_RUN_PASSED':
      return lifecycleReviewerMutation(mutationId, context, 'runtime/cleanup.json', (cleanup) => {
        cleanup['status'] = 'FAILED';
      });
    case 'PREFLIGHT_FAILED_BUT_GATES_PASSED':
      return lifecycleReviewerMutation(mutationId, context, 'runtime/preflight.json', (preflight) => {
        preflight['status'] = 'FAILED';
      });
    case 'TERMINAL_CONCLUSION_MISSING':
      return reviewerMutation(mutationId, context, async (copy) => {
        await unlink(join(copy.evidenceDirectory, 'runtime/terminal-conclusion.json'));
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'TERMINAL_CONCLUSION_FAILED':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['status'] = 'FAILED'; },
      );
    case 'SEAL_ELIGIBLE_FALSE':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['sealEligible'] = false; },
      );
    case 'RESIDUAL_CONTAINER_PRESENT':
      return residualResourceMutation(mutationId, context, 'container');
    case 'RESIDUAL_VOLUME_PRESENT':
      return residualResourceMutation(mutationId, context, 'volume');
    case 'RESIDUAL_NETWORK_PRESENT':
      return residualResourceMutation(mutationId, context, 'network');
    case 'REQUIRED_PORT_OCCUPIED':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/resources-final.json',
        (snapshot) => { recordArray(snapshot['ports'])[0]!['occupied'] = true; },
      );
    case 'FINAL_OUTCOME_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/final-outcome.json',
        (outcome) => { outcome['status'] = 'FAILED'; },
      );
    case 'ABG40_PRELIMINARY_CONCLUSION_SOURCE':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeJsonFile(copy.evidenceDirectory, 'formal-run/preliminary-conclusion.json', {
          status: 'PASSED',
        });
        await mutateJsonFile(copy.evidenceDirectory, 'formal-run/producer-evidence.json', (evidence) => {
          for (const scenario of Object.values(record(evidence['scenarios']))) {
            for (const assertion of Object.values(record(record(scenario)['assertions']))) {
              for (const item of recordArray(record(assertion)['evidenceItems'])) {
                item['relativePath'] = 'formal-run/preliminary-conclusion.json';
                item['jsonPointer'] = '/status';
              }
            }
          }
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'ABG40_MISSING_SEAL_ASSERTION':
      return reviewerMutation(mutationId, context, async (copy) => {
        await mutateJsonFile(copy.evidenceDirectory, 'formal-run/producer-evidence.json', (evidence) => {
          for (const scenario of Object.values(record(evidence['scenarios']))) {
            delete record(record(scenario)['assertions'])['ABG-40:formal-evidence-seal-eligible'];
          }
        });
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'FROZEN_INPUT_DRIFT_AFTER_CLEANUP':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['frozenInputsStableAfterCleanup'] = false; },
      );
    case 'AUTHORITY_DRIFT_AFTER_CLEANUP':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['authorityIdentityStableAfterCleanup'] = false; },
      );
    case 'OUTPUT_DIRECTORY_NOT_EXCLUSIVE':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['outputDirectoryExclusive'] = false; },
      );
    case 'CLEANUP_RESIDUALS_MALFORMED':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/cleanup.json',
        (cleanup) => { cleanup['residualResources'] = null; },
      );
    case 'FINAL_RESOURCES_MALFORMED':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/resources-final.json',
        (snapshot) => { snapshot['resources'] = null; },
      );
    case 'PRODUCER_SNAPSHOT_IDENTITY_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/producer-evidence-snapshot.json',
        (snapshot) => {
          recordArray(snapshot['producerProtocolEvidence'])[0]!['sha256'] = 'f'.repeat(64);
        },
      );
    case 'FINAL_OUTCOME_SEAL_STATUS_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/final-outcome.json',
        (outcome) => { outcome['sealEligibilityStatus'] = 'FAILED'; },
      );
    case 'RUN_PLAN_GIT_IDENTITY_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'abg-results.json',
        (summary) => { summary['gitCommitSha'] = 'f'.repeat(40); },
      );
    case 'TERMINAL_ASSERTION_BODY_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => {
          const assertions = record(terminal['assertions']);
          record(assertions['terminalLifecycle'])['actual'] = { cleanupStatus: 'FAILED' };
        },
      );
    case 'PRODUCER_SOURCE_MANIFEST_MISSING':
      return reviewerMutation(mutationId, context, async (copy) => {
        await unlink(join(copy.evidenceDirectory, 'provenance/producer-source-manifest.json'));
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'PRODUCER_SOURCE_MANIFEST_DIGEST_TAMPERED':
      return sourceManifestMutation(mutationId, context, (manifest) => {
        manifest['sourceFilesDigest'] = '0'.repeat(64);
      });
    case 'PRODUCER_SOURCE_MANIFEST_SHA_FILE_TAMPERED':
      return reviewerMutation(mutationId, context, async (copy) => {
        await writeFile(
          join(copy.evidenceDirectory, 'provenance/producer-source-manifest.sha256'),
          `${'0'.repeat(64)}  producer-source-manifest.json\n`,
          { flag: 'w' },
        );
        await rebuildFixtureManifest(copy.evidenceDirectory);
      });
    case 'PRODUCER_SOURCE_MANIFEST_DUPLICATE_PATH':
      return sourceManifestMutation(mutationId, context, (manifest) => {
        const files = recordArray(manifest['sourceFiles']);
        files.splice(1, 0, clone(files[0]!));
        manifest['sourceFileCount'] = files.length;
        manifest['sourceFilesDigest'] = digestCanonical(files);
      });
    case 'PRODUCER_SOURCE_MANIFEST_UNSORTED':
      return sourceManifestMutation(mutationId, context, (manifest) => {
        const files = recordArray(manifest['sourceFiles']);
        [files[0], files[1]] = [files[1]!, files[0]!];
        manifest['sourceFilesDigest'] = digestCanonical(files);
      });
    case 'PRODUCER_SOURCE_MANIFEST_PATH_TRAVERSAL':
      return sourceManifestEntryMutation(mutationId, context, (entry) => {
        entry['path'] = '../verification-contract-versions.ts';
      });
    case 'PRODUCER_SOURCE_MANIFEST_ABSOLUTE_PATH':
      return sourceManifestEntryMutation(mutationId, context, (entry) => {
        entry['path'] = 'C:/validator-fixture/verification-contract-versions.ts';
      });
    case 'PRODUCER_SOURCE_MANIFEST_SYMLINK':
      return reviewerMutation(mutationId, context, async () => undefined, undefined, {
        git: {
          ...context.fixture.reviewerDependencies.git,
          async readBlob(root, commit, path) {
            const blob = await context.fixture.reviewerDependencies.git.readBlob(root, commit, path);
            return path === 'package.json' && blob !== null ? { ...blob, mode: '120000' } : blob;
          },
        },
      });
    case 'PRODUCER_COMMIT_UNAVAILABLE':
      return sourceManifestMutation(mutationId, context, (manifest) => {
        manifest['producerGitCommitSha'] = 'e'.repeat(40);
      });
    case 'PRODUCER_SOURCE_BLOB_MISMATCH':
      return sourceManifestEntryMutation(mutationId, context, (entry) => {
        entry['gitBlobOid'] = 'e'.repeat(40);
      });
    case 'PRODUCER_SOURCE_SHA_MISMATCH':
      return sourceManifestEntryMutation(mutationId, context, (entry) => {
        entry['sha256'] = 'e'.repeat(64);
      });
    case 'PRODUCER_SOURCE_FILE_MISSING_AT_COMMIT':
      return reviewerMutation(
        mutationId,
        context,
        async () => undefined,
        undefined,
        {
          git: {
            ...context.fixture.reviewerDependencies.git,
            readBlob: async (root, commit, path) => path === 'package.json'
              ? null
              : context.fixture.reviewerDependencies.git.readBlob(root, commit, path),
          },
        },
      );
    case 'RUN_PLAN_SOURCE_MANIFEST_DIGEST_MISMATCH':
      return lifecycleReviewerMutation(mutationId, context, 'run-plan.json', (plan) => {
        plan['producerSourceManifestSha256'] = 'e'.repeat(64);
      });
    case 'TERMINAL_SOURCE_MANIFEST_DIGEST_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['producerSourceManifestSha256'] = 'e'.repeat(64); },
      );
    case 'SUMMARY_SOURCE_MANIFEST_DIGEST_MISMATCH':
      return lifecycleReviewerMutation(mutationId, context, 'abg-results.json', (summary) => {
        summary['producerSourceManifestSha256'] = 'e'.repeat(64);
      });
    case 'FINAL_OUTCOME_SOURCE_MANIFEST_DIGEST_MISMATCH':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/final-outcome.json',
        (outcome) => { outcome['producerSourceManifestSha256'] = 'e'.repeat(64); },
      );
    case 'MIXED_PRODUCER_EVIDENCE_SCHEMA_VERSIONS':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'shared/static/producer-evidence.json',
        (evidence) => { evidence['schemaVersion'] = 'phase-01.producer-evidence.v999'; },
      );
    case 'MIXED_GATE_RESULT_SCHEMA_VERSIONS':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'gates/ABG-01/producer/result.json',
        (proof) => { proof['schemaVersion'] = 'phase-01.abg-gate-result.v999'; },
      );
    case 'UNKNOWN_RUN_SUMMARY_SCHEMA_VERSION':
      return lifecycleReviewerMutation(mutationId, context, 'abg-results.json', (summary) => {
        summary['schemaVersion'] = 'phase-01.abg-run.v999';
      });
    case 'UNKNOWN_TERMINAL_CONCLUSION_SCHEMA_VERSION':
      return lifecycleReviewerMutation(
        mutationId,
        context,
        'runtime/terminal-conclusion.json',
        (terminal) => { terminal['schemaVersion'] = 'phase-01.formal-terminal-conclusion.v999'; },
      );
    case 'REVIEWER_CONTRACT_INCOMPATIBLE':
      return lifecycleReviewerMutation(mutationId, context, 'abg-results.json', (summary) => {
        summary['schemaVersion'] = 'phase-01.abg-run.v999';
      });
    case 'REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED':
      return reviewerDefinitionDriftMutation(
        mutationId,
        context,
        'tooling/verification/src/review-formal-abg-evidence.ts',
      );
    case 'REVIEWER_WORKTREE_DIRTY':
      return reviewerWorktreeDirtyMutation(mutationId, context);
    case 'COVERAGE_MATRIX_DEFINITION_DRIFT':
      return reviewerDefinitionDriftMutation(
        mutationId,
        context,
        'tooling/verification/src/abg-coverage-matrix.ts',
      );
    case 'PRODUCER_PROTOCOL_DEFINITION_DRIFT':
      return reviewerDefinitionDriftMutation(
        mutationId,
        context,
        'tooling/verification/src/evidence/protocol.ts',
      );
    case 'GATE_PROOF_DEFINITION_DRIFT':
      return reviewerDefinitionDriftMutation(
        mutationId,
        context,
        'tooling/verification/src/abg-gate-proof.ts',
      );
    case 'TERMINAL_CONTRACT_DEFINITION_DRIFT':
      return reviewerDefinitionDriftMutation(
        mutationId,
        context,
        'tooling/verification/src/runtime/formal-terminal-conclusion.ts',
      );
    case 'REVIEWER_SOURCE_MANIFEST_TAMPERED':
      return reviewerSourceManifestTamperedMutation(mutationId, context);
    case 'REVIEW_OUTPUT_DIRECTORY_EXISTS': {
      const copy = await copyFixtureForMutation(mutationId, context);
      await mkdir(copy.reviewOutputDirectory, { recursive: false });
      return captureErrorCodes(() => reviewFormalAbgEvidence({
        evidenceDirectory: copy.evidenceDirectory,
        reviewOutputDirectory: copy.reviewOutputDirectory,
        dependencies: context.fixture.reviewerDependencies,
      }));
    }
    case 'EVIDENCE_EMBEDDED_SCRIPT_NOT_EXECUTED':
      return embeddedScriptMutation(mutationId, context);
    case 'RUNTIME_AUTHORITY_MISSING': {
      const fixture = validRuntimeAuthorityMutationFixture();
      return captureErrorCodes(() => Promise.resolve(assertRuntimeAuthoritySnapshot({
        bytes: null,
        expectedSha256: fixture.loaded.runtimeAuthoritySha256,
        expectedSemanticDigest: fixture.loaded.runtimeAuthoritySemanticDigest,
      })));
    }
    case 'RUNTIME_AUTHORITY_SHA_MISMATCH': {
      const fixture = validRuntimeAuthorityMutationFixture();
      return captureErrorCodes(() => Promise.resolve(assertRuntimeAuthoritySnapshot({
        bytes: fixture.bytes,
        expectedSha256: '0'.repeat(64),
        expectedSemanticDigest: fixture.loaded.runtimeAuthoritySemanticDigest,
      })));
    }
    case 'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH': {
      const fixture = validRuntimeAuthorityMutationFixture();
      return captureErrorCodes(() => Promise.resolve(assertRuntimeAuthoritySnapshot({
        bytes: fixture.bytes,
        expectedSha256: fixture.loaded.runtimeAuthoritySha256,
        expectedSemanticDigest: '0'.repeat(64),
      })));
    }
    case 'RUNTIME_AUTHORITY_ROOTLESS':
      return runtimeAuthorityParserMutation((document) => {
        record(record(document['authority'])['podman'])['rootless'] = true;
      });
    case 'RUNTIME_AUTHORITY_RESTART_POLICY_INVALID':
      return runtimeAuthorityParserMutation((document) => {
        record(record(document['authority'])['podman'])['restartPolicy'] = 'unless-stopped';
      });
    case 'RUNTIME_AUTHORITY_IMAGE_FLOATING_TAG':
      return runtimeAuthorityParserMutation((document) => {
        record(record(record(document['authority'])['images'])['postgresql'])['runtimeReference'] =
          'docker.io/library/postgres:18.4';
      });
    case 'RUNTIME_AUTHORITY_PORT_DUPLICATE':
      return runtimeAuthorityParserMutation((document) => {
        const ports = record(record(record(document['authority'])['network'])['ports']);
        ports['postgresIntegration'] = ports['postgresRuntime'];
      });
    case 'RUNTIME_AUTHORITY_SECOND_SOURCE_DRIFT': {
      const fixture = validRuntimeAuthorityMutationFixture();
      return captureErrorCodes(() => Promise.resolve(assertRuntimeAuthoritySecondSourceMatches({
        runtimeAuthoritySemanticDigest: fixture.loaded.runtimeAuthoritySemanticDigest,
        secondSourceSemanticDigest: '0'.repeat(64),
      })));
    }
    case 'DOCKER_SOCKET_ALIAS_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.forbiddenSockets).push({
          path: '/var/run/docker.sock',
          kind: 'symbolic-link',
          symbolicLink: true,
          target: '/run/podman/podman.sock',
        });
      });
    case 'DOCKER_SERVICE_ACTIVE':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.systemdUnits).push({
          name: 'docker.service',
          loadState: 'loaded',
          activeState: 'active',
          unitFileState: 'enabled',
          subState: 'running',
        });
      });
    case 'DOCKER_DAEMON_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.forbiddenProcesses).push({ pid: 88, name: 'dockerd' });
      });
    case 'DOCKER_TCP_API_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.forbiddenTcpListeners).push({
          address: '127.0.0.1', port: 2375, process: 'dockerd',
        });
      });
    case 'PODMAN_TCP_API_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.unexpectedContainerApiEndpoints).push('tcp://127.0.0.1:8888');
      });
    case 'DOCKER_HOST_REMOTE':
      return runSyntheticPreflightPolicyMutation(({ environment }) => {
        environment['DOCKER_HOST'] = 'tcp://runtime.example:2376';
      });
    case 'PODMAN_REMOTE_CONNECTION_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        Object.assign(observation, {
          podmanMachineInspection: {
            ...observation.podmanMachineInspection,
            status: 'REMOTE_CONNECTION_PRESENT',
            applicability: 'APPLICABLE',
            machineCommandSupported: null,
            remoteConnectionCount: 1,
            remoteConnections: ['ssh://runtime.example/run/podman/podman.sock'],
          },
        });
      });
    case 'ROOTLESS_PODMAN_SOCKET_PRESENT':
      return runSyntheticPreflightPolicyMutation(({ observation }) => {
        mutableArray(observation.rootlessSocketPaths).push('/run/user/1000/podman/podman.sock');
      });
    case 'CONTAINER_RESTART_UNLESS_STOPPED':
      return captureErrorCodes(() => Promise.resolve(assertContainerRestartPolicy({
        expected: 'no', observed: 'unless-stopped',
      })));
    case 'CONTAINER_RESTART_POLICY_DRIFT':
      return captureErrorCodes(() => Promise.resolve(assertContainerRestartPolicy({
        expected: 'no', observed: 'always',
      })));
    case 'PARTIAL_STARTUP_POSTGRES_VOLUME_RESIDUE':
      return syntheticFailureResidueMutation('partial-startup', 'postgres-volume-created', 'volume', 'postgres-data');
    case 'PARTIAL_STARTUP_KEYCLOAK_VOLUME_RESIDUE':
      return syntheticFailureResidueMutation('partial-startup', 'keycloak-volume-created', 'volume', 'keycloak-data');
    case 'PARTIAL_STARTUP_POSTGRES_CONTAINER_RESIDUE':
      return syntheticFailureResidueMutation('partial-startup', 'postgres-container-created', 'container', 'postgres');
    case 'PARTIAL_STARTUP_KEYCLOAK_CONTAINER_RESIDUE':
      return syntheticFailureResidueMutation('partial-startup', 'keycloak-container-created', 'container', 'keycloak');
    case 'PARTIAL_STARTUP_OWNERSHIP_MISMATCH':
      return syntheticOwnershipMismatchMutation();
    case 'PARTIAL_STARTUP_CLEANUP_FAILED':
      return syntheticCleanupFailureMutation();
    case 'BOOTSTRAP_READINESS_FAILURE_RESIDUE':
      return syntheticFailureResidueMutation('bootstrap', 'readiness', 'container', 'postgres');
    case 'BOOTSTRAP_MIGRATION_FAILURE_RESIDUE':
      return syntheticFailureResidueMutation('bootstrap', 'migration', 'container', 'postgres');
    case 'BOOTSTRAP_SEED_FAILURE_RESIDUE':
      return syntheticFailureResidueMutation('bootstrap', 'seed', 'container', 'postgres');
    case 'UNRELATED_PODMAN_RESOURCE_REMOVED':
      return unrelatedCleanupMutation();
    case 'PODMAN_PRUNE_ATTEMPT':
      return captureErrorCodes(() => Promise.resolve(
        assertSafeFormalCleanupCommand('podman', ['system', 'prune', '--all']),
      ));
    case 'RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP': {
      const fixture = validRuntimeAuthorityMutationFixture();
      return captureErrorCodes(() => Promise.resolve(assertRuntimeAuthorityStableAfterCleanup({
        beforeSha256: fixture.loaded.runtimeAuthoritySha256,
        beforeSemanticDigest: fixture.loaded.runtimeAuthoritySemanticDigest,
        afterSha256: fixture.loaded.runtimeAuthoritySha256,
        afterSemanticDigest: '0'.repeat(64),
      })));
    }
    case 'AR12_EXECUTION_CLONE_INSIDE_REPOSITORY':
      return ar12InsideRepositoryMutation(mutationId, context, false);
    case 'AR12_EXECUTION_CLONE_INSIDE_RUNTIME':
      return ar12InsideRepositoryMutation(mutationId, context, true);
    case 'AR12_EXECUTION_CLONE_SYMLINK_ESCAPE':
      return ar12SymlinkEscapeMutation(mutationId, context);
    case 'AR12_EXECUTION_CLONE_ALREADY_EXISTS':
      return ar12ExistingWorkspaceMutation(mutationId, context);
    case 'AR12_EXECUTION_CLONE_HEAD_MISMATCH':
      return ar12CloneIdentityMutation(mutationId, context, 'head');
    case 'AR12_EXECUTION_CLONE_BRANCH_MISMATCH':
      return ar12CloneIdentityMutation(mutationId, context, 'branch');
    case 'AR12_EXECUTION_CLONE_ORIGIN_MISMATCH':
      return ar12CloneIdentityMutation(mutationId, context, 'origin');
    case 'AR12_STALE_CLONE_IDENTITY_MISMATCH':
      return ar12StaleCloneIdentityMutation(mutationId, context);
    case 'AR12_FAILED_EVIDENCE_DIRECTORY_DELETE_ATTEMPT':
      return ar12FailedEvidenceDeleteMutation(mutationId, context);
    case 'AR12_REPO_LAYOUT_GATE_BYPASS_ATTEMPT': {
      const planWithoutRepositoryLayoutGate = createAr12CommandSpecs().filter(
        (command) => command.id !== 'check-repo-layout',
      );
      return captureErrorCodes(() => Promise.resolve(
        assertAr12CommandPlanSafety(planWithoutRepositoryLayoutGate),
      ));
    }
    case 'AR12_REQUIRED_HISTORY_SIXTH_DIRECTORY_MISSING':
    case 'AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_MISSING':
    case 'AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_SHA_MISMATCH':
    case 'AR12_REQUIRED_HISTORY_SIXTH_CLASSIFICATION_MISMATCH':
    case 'AR12_REQUIRED_HISTORY_SUBSTITUTED_BY_EXTRA_DIRECTORY':
    case 'AR12_REQUIRED_HISTORY_TREE_DRIFT':
    case 'AR12_REQUIRED_HISTORY_RECOVERY_SHA_MISMATCH':
    case 'AR12_REQUIRED_HISTORY_STALE_CLONE_REAPPEARED':
      return ar12HistoryEvidenceMutation(mutationId, context);
    case 'EVIDENCE_PARENT_DIRECTORY_CONCURRENT_CREATE':
    case 'EVIDENCE_PARENT_DIRECTORY_EEXIST_FILE':
    case 'EVIDENCE_PARENT_DIRECTORY_EEXIST_SYMLINK':
    case 'EVIDENCE_SAME_FILE_CONCURRENT_WRITE':
      return evidenceDirectoryMutation(mutationId, context);
    case 'PODMAN_MACHINE_NATIVE_ROOTFUL_NOT_APPLICABLE':
    case 'PODMAN_MACHINE_REGISTERED_PRESENT':
    case 'PODMAN_MACHINE_RUNNING_PRESENT':
    case 'PODMAN_MACHINE_REMOTE_CONNECTION_PRESENT':
    case 'PODMAN_MACHINE_MALFORMED_RESULT':
    case 'PODMAN_MACHINE_UNKNOWN_INSPECTION_FAILURE':
    case 'CLEANUP_NATIVE_ROOTFUL_MACHINE_FALSE_FAILURE':
    case 'PREFLIGHT_CLEANUP_MACHINE_CLASSIFICATION_DRIFT':
      return podmanMachineMutation(mutationId);
    case 'FORMAL_SETUP_RELATIVE_NODE_OPTIONS_LEAK':
    case 'FORMAL_GATE_RELATIVE_NODE_OPTIONS_LEAK':
    case 'LOADER_ABSOLUTE_HOST_PATH_IN_FROZEN_PLAN':
      return formalNodeCommandMutation(mutationId);
    case 'SHARED_DATABASE_AUTHORITY_NODE_OPTIONS_LEAK':
    case 'SHARED_INTEGRATION_NODE_OPTIONS_LEAK':
    case 'TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER':
      return sharedNodeCommandMutation(mutationId);
    case 'WORKSPACE_LOADER_RESOLVED_FROM_CHILD_CWD':
      return workspaceLoaderEnvironmentMutation(mutationId);
    case 'DATABASE_AUTHORITY_KYSELY_LOADER_CONTAMINATION':
      return databaseAuthorityEnvironmentMutation(mutationId);
    default:
      throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
}

const mutationRepositoryRoot = resolve(import.meta.dirname, '../../../..');

async function formalNodeCommandMutation(mutationId: string): Promise<readonly string[]> {
  const plan = await buildAuthoritativeCommandPlan(mutationRepositoryRoot);
  const mutablePlan = {
    setupCommands: [...plan.setupCommands],
    gates: [...plan.gates],
  };
  if (mutationId === 'FORMAL_SETUP_RELATIVE_NODE_OPTIONS_LEAK') {
    mutablePlan.setupCommands[2] = {
      ...mutablePlan.setupCommands[2]!,
      environment: { NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs' },
    };
  } else if (mutationId === 'FORMAL_GATE_RELATIVE_NODE_OPTIONS_LEAK') {
    mutablePlan.gates[0] = {
      ...mutablePlan.gates[0]!,
      environment: { NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs' },
    };
  } else if (mutationId === 'LOADER_ABSOLUTE_HOST_PATH_IN_FROZEN_PLAN') {
    mutablePlan.gates[0] = {
      ...mutablePlan.gates[0]!,
      args: [
        '--loader',
        '/mnt/d/Projects/Hospital-DataIntelligence-Platform/tooling/verification/node-ts-loader.mjs',
        mutablePlan.gates[0]!.args[2]!,
      ],
    };
  } else {
    throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
  return captureErrorCodes(() =>
    assertAuthoritativeCommandPlanSafety(mutationRepositoryRoot, mutablePlan));
}

async function sharedNodeCommandMutation(mutationId: string): Promise<readonly string[]> {
  const commands = [...await buildSharedAbgCommandPlan(mutationRepositoryRoot)];
  const id = mutationId === 'SHARED_DATABASE_AUTHORITY_NODE_OPTIONS_LEAK'
    ? 'database-authority'
    : mutationId === 'SHARED_INTEGRATION_NODE_OPTIONS_LEAK'
      ? 'integration'
      : 'live';
  const index = commands.findIndex((command) => command.id === id);
  const command = commands[index];
  if (command === undefined) throw new Error('SHARED_COMMAND_PLAN_INVALID');
  commands[index] = mutationId === 'TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER'
    ? { ...command, args: [command.args[2]!] }
    : {
      ...command,
      environment: { NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs' },
    };
  return captureErrorCodes(() => assertSharedAbgCommandPlanSafety(
    mutationRepositoryRoot,
    commands as readonly SharedCommand[],
  ));
}

async function workspaceLoaderEnvironmentMutation(
  mutationId: string,
): Promise<readonly string[]> {
  return captureRegressionInvariant(mutationId, () => {
    const environment = createDeterministicChildEnvironment({
      inheritedEnvironment: {
        NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
        PATH: 'controlled-path',
      },
      nodeOptionsForbiddenCode: 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN',
    });
    if (environment['NODE_OPTIONS'] !== undefined) {
      throw new Error('SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN');
    }
    const contaminatedChildTarget = join(
      'apps/governance-api',
      REPOSITORY_NODE_LOADER_PATH,
    ).replaceAll('\\', '/');
    if (!contaminatedChildTarget.endsWith(
      'apps/governance-api/tooling/verification/node-ts-loader.mjs',
    )) throw new Error('WORKSPACE_LOADER_MUTATION_INVALID');
    return Promise.resolve();
  });
}

async function databaseAuthorityEnvironmentMutation(
  mutationId: string,
): Promise<readonly string[]> {
  return captureRegressionInvariant(mutationId, () => {
    const environment = databaseAuthorityChildEnvironment({
      NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
      npm_execpath: 'locked-npm-cli.js',
    });
    if (environment['NODE_OPTIONS'] !== undefined) {
      throw new Error('DATABASE_AUTHORITY_KYSELY_LOADER_CONTAMINATION');
    }
    return Promise.resolve();
  });
}

async function ar12HistoryEvidenceMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId.toLowerCase());
  const outputRoot = join(caseRoot, 'ar-12');
  const currentRun = join(outputRoot, 'current-run');
  const summaryBytes = Buffer.from('{"status":"PASSED","formalAcceptanceEligible":false}\n');
  const recoveryBytes = Buffer.from(JSON.stringify({
    treeDigestBefore: 'a'.repeat(64),
    treeDigestAfter: 'a'.repeat(64),
    failedFinalRunDirectoryPreserved: true,
  }) + '\n');
  const contract = syntheticAr12HistoryContract(summaryBytes, recoveryBytes);
  await mkdir(outputRoot, { recursive: true });
  for (const entry of contract.requiredHistories) {
    await mkdir(join(outputRoot, entry.relativeDirectory));
  }
  const sixth = contract.requiredHistories[5]!;
  const sixthDirectory = join(outputRoot, sixth.relativeDirectory);
  const summaryPath = join(sixthDirectory, 'ar-12-rebaseline-summary.json');
  await writeFile(summaryPath, summaryBytes);
  const recoveryPath = join(outputRoot, contract.recoveryArtifact.relativePath);
  await mkdir(join(outputRoot, 'recovery', '20260830-0267bba'), { recursive: true });
  await writeFile(recoveryPath, recoveryBytes);

  switch (mutationId) {
    case 'AR12_REQUIRED_HISTORY_SIXTH_DIRECTORY_MISSING':
      await unlink(summaryPath);
      await import('node:fs/promises').then(({ rmdir }) => rmdir(sixthDirectory));
      break;
    case 'AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_MISSING':
      await unlink(summaryPath);
      break;
    case 'AR12_REQUIRED_HISTORY_SIXTH_SUMMARY_SHA_MISMATCH':
      await writeFile(summaryPath, '{"status":"PASSED","tampered":true}\n');
      break;
    case 'AR12_REQUIRED_HISTORY_SIXTH_CLASSIFICATION_MISMATCH':
      mutableHistoryEntry(contract, 5).classification = 'INITIAL_REBASELINE_PASSED_HISTORY';
      return captureErrorCodes(() => Promise.resolve(validateAr12HistoryEvidenceContract(contract)));
    case 'AR12_REQUIRED_HISTORY_SUBSTITUTED_BY_EXTRA_DIRECTORY':
      await unlink(summaryPath);
      await import('node:fs/promises').then(({ rmdir }) => rmdir(sixthDirectory));
      await mkdir(join(outputRoot, '20260831-extra-history'));
      break;
    case 'AR12_REQUIRED_HISTORY_TREE_DRIFT': {
      const opening = await captureAr12HistoryEvidenceBaseline(outputRoot, currentRun, contract);
      await writeFile(join(sixthDirectory, 'drift.json'), '{}\n');
      const ending = await captureAr12HistoryEvidenceBaseline(outputRoot, currentRun, contract);
      return captureErrorCodes(() => Promise.resolve(assertAr12HistoryEvidenceStable(opening, ending)));
    }
    case 'AR12_REQUIRED_HISTORY_RECOVERY_SHA_MISMATCH':
      await writeFile(recoveryPath, '{"tampered":true}\n');
      break;
    case 'AR12_REQUIRED_HISTORY_STALE_CLONE_REAPPEARED':
      await mkdir(join(outputRoot, contract.staleCloneRelativePath), { recursive: true });
      break;
    default:
      throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
  return captureErrorCodes(() => captureAr12HistoryEvidenceBaseline(outputRoot, currentRun, contract));
}

async function evidenceDirectoryMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId.toLowerCase());
  const evidenceRoot = join(caseRoot, 'evidence');
  await mkdir(caseRoot, { recursive: true });
  await createEvidenceOutputDirectory(evidenceRoot);
  switch (mutationId) {
    case 'EVIDENCE_PARENT_DIRECTORY_CONCURRENT_CREATE':
      return captureRegressionInvariant(mutationId, async () => {
        await Promise.all(Array.from({ length: 32 }, () =>
          createEvidenceSubdirectory(evidenceRoot, 'shared/raw/commands')));
      });
    case 'EVIDENCE_PARENT_DIRECTORY_EEXIST_FILE':
      await writeFile(join(evidenceRoot, 'shared'), 'not-a-directory', { flag: 'wx' });
      return captureErrorCodes(() => createEvidenceSubdirectory(evidenceRoot, 'shared/raw'));
    case 'EVIDENCE_PARENT_DIRECTORY_EEXIST_SYMLINK': {
      const external = join(caseRoot, 'external');
      await mkdir(external, { recursive: false });
      await symlink(external, join(evidenceRoot, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
      return captureErrorCodes(() => createEvidenceSubdirectory(evidenceRoot, 'shared/raw'));
    }
    case 'EVIDENCE_SAME_FILE_CONCURRENT_WRITE':
      return captureErrorCodes(() => Promise.all([
        writeRedactedTextArtifact(evidenceRoot, 'shared/raw/exclusive.log', 'first'),
        writeRedactedTextArtifact(evidenceRoot, 'shared/raw/exclusive.log', 'second'),
      ]));
    default:
      throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
}

async function podmanMachineMutation(mutationId: string): Promise<readonly string[]> {
  switch (mutationId) {
    case 'PODMAN_MACHINE_NATIVE_ROOTFUL_NOT_APPLICABLE': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(
          125,
          '',
          'Error: cannot run command "podman machine list" as root\n',
        ),
      });
      return captureRegressionInvariant(mutationId, () => Promise.resolve(
        assertMachineStatus(inspection, 'NOT_APPLICABLE_NATIVE_ROOTFUL'),
      ));
    }
    case 'PODMAN_MACHINE_REGISTERED_PRESENT': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(0, '[{"Name":"stopped","Running":false}]', ''),
      });
      return captureRegressionInvariant(mutationId, () => Promise.resolve(
        assertMachineStatus(inspection, 'REGISTERED_MACHINE_PRESENT'),
      ));
    }
    case 'PODMAN_MACHINE_RUNNING_PRESENT': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(0, '[{"Name":"running","Running":true}]', ''),
      });
      return captureRegressionInvariant(mutationId, () => Promise.resolve(
        assertMachineStatus(inspection, 'RUNNING_MACHINE_PRESENT'),
      ));
    }
    case 'PODMAN_MACHINE_REMOTE_CONNECTION_PRESENT': {
      const inspection = await inspectMutationMachine({
        connections: mutationCommandResult(
          0,
          '[{"URI":"ssh://remote/run/podman/podman.sock"}]',
          '',
        ),
      });
      return captureRegressionInvariant(mutationId, () => Promise.resolve(
        assertMachineStatus(inspection, 'REMOTE_CONNECTION_PRESENT'),
      ));
    }
    case 'PODMAN_MACHINE_MALFORMED_RESULT': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(0, '{broken', ''),
      });
      return [inspection.failureCode ?? 'PODMAN_MACHINE_MALFORMED_RESULT_NOT_DETECTED'];
    }
    case 'PODMAN_MACHINE_UNKNOWN_INSPECTION_FAILURE': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(42, '', 'unknown failure'),
      });
      return [inspection.failureCode ?? 'PODMAN_MACHINE_UNKNOWN_FAILURE_NOT_DETECTED'];
    }
    case 'CLEANUP_NATIVE_ROOTFUL_MACHINE_FALSE_FAILURE': {
      const inspection = await inspectMutationMachine({
        machine: mutationCommandResult(
          125,
          '',
          'Error: cannot run command "podman machine list" as root\n',
        ),
      });
      return captureRegressionInvariant(mutationId, () => Promise.resolve(
        assertMachineStatus(inspection, 'NOT_APPLICABLE_NATIVE_ROOTFUL'),
      ));
    }
    case 'PREFLIGHT_CLEANUP_MACHINE_CLASSIFICATION_DRIFT': {
      const preflight = await inspectMutationMachine({});
      const cleanup: PodmanMachineInspectionResult = {
        ...preflight,
        status: 'INSPECTION_FAILED',
        applicability: 'UNKNOWN',
        failureCode: 'PODMAN_MACHINE_COMMAND_FAILED',
      };
      return captureErrorCodes(() => Promise.resolve(
        assertEquivalentPodmanMachineInspections(preflight, cleanup),
      ));
    }
    default:
      throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
}

interface MutationMachineRunnerOptions {
  readonly connections?: RuntimeCommandResult;
  readonly machine?: RuntimeCommandResult;
}

async function inspectMutationMachine(
  options: MutationMachineRunnerOptions,
): Promise<PodmanMachineInspectionResult> {
  return inspectPodmanMachineState(
    mutationMachineRunner(options),
    validRuntimeAuthorityMutationFixture().loaded.authority,
    () => '2026-09-01T12:04:15',
  );
}

function mutationMachineRunner(options: MutationMachineRunnerOptions): RuntimeCommandRunner {
  const authority = validRuntimeAuthorityMutationFixture().loaded.authority;
  return {
    async run(command) {
      if (command.args[0] === 'info') {
        return mutationCommandResult(0, JSON.stringify({
          host: {
            remoteSocket: { path: authority.podman.socketPath },
            security: { rootless: false },
          },
        }), '');
      }
      if (command.args[0] === 'system') {
        return options.connections ?? mutationCommandResult(0, '[]', '');
      }
      if (command.args[0] === 'machine') {
        return options.machine ?? mutationCommandResult(0, '[]', '');
      }
      throw new Error('MUTATION_MACHINE_COMMAND_UNEXPECTED');
    },
  };
}

function mutationCommandResult(
  exitCode: number,
  stdout: string,
  stderr: string,
): RuntimeCommandResult {
  return { exitCode, signal: null, stdout, stderr };
}

function assertMachineStatus(
  inspection: PodmanMachineInspectionResult,
  expected: PodmanMachineInspectionResult['status'],
): void {
  if (inspection.status !== expected) {
    throw new Error('PODMAN_MACHINE_CLASSIFICATION_INCONSISTENT');
  }
}

async function captureRegressionInvariant(
  detectionCode: string,
  action: () => Promise<unknown>,
): Promise<readonly string[]> {
  try {
    await action();
    return [detectionCode];
  } catch (error) {
    return [stableErrorCode(error)];
  }
}

type MutableAr12HistoryContract = {
  schemaVersion: Ar12HistoryEvidenceContract['schemaVersion'];
  requiredHistories: Array<{
    historyId: string;
    relativeDirectory: string;
    classification: Ar12HistoryClassification;
    required: true;
    formalAcceptanceEligible: false;
    requiredArtifacts: Array<{ relativePath: string; sha256?: string }>;
  }>;
  recoveryArtifact: { relativePath: string; sha256: string };
  staleCloneRelativePath: string;
};

function syntheticAr12HistoryContract(
  summaryBytes: Uint8Array,
  recoveryBytes: Uint8Array,
): MutableAr12HistoryContract {
  const contract = JSON.parse(JSON.stringify(AR12_HISTORY_EVIDENCE_CONTRACT)) as MutableAr12HistoryContract;
  for (const entry of contract.requiredHistories) entry.requiredArtifacts = [];
  contract.requiredHistories[5]!.requiredArtifacts = [{
    relativePath: 'ar-12-rebaseline-summary.json',
    sha256: sha256(summaryBytes),
  }];
  contract.recoveryArtifact.sha256 = sha256(recoveryBytes);
  return contract;
}

function mutableHistoryEntry(
  contract: MutableAr12HistoryContract,
  index: number,
): MutableAr12HistoryContract['requiredHistories'][number] {
  const entry = contract.requiredHistories[index];
  if (entry === undefined) throw new Error('AR12_HISTORY_CONTRACT_INVALID');
  return entry;
}

async function ar12InsideRepositoryMutation(
  mutationId: string,
  context: MutationExecutionContext,
  insideRuntime: boolean,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const repositoryRoot = join(caseRoot, 'repository');
  await mkdir(repositoryRoot, { recursive: true });
  const configuredRoot = insideRuntime
    ? join(repositoryRoot, '.runtime', 'execution')
    : join(repositoryRoot, 'execution');
  return captureErrorCodes(() => resolveAr12ExecutionWorkspace({
    repositoryRoot,
    runIdentity: 'mutation-run',
    environment: { AR12_EXECUTION_WORKSPACE_ROOT: configuredRoot },
  }));
}

async function ar12SymlinkEscapeMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const repositoryRoot = join(caseRoot, 'repository');
  const reportedExternalRoot = join(caseRoot, 'reported-external');
  await mkdir(repositoryRoot, { recursive: true });
  const dependencies = defaultAr12ExecutionWorkspaceDependencies();
  const filesystem = {
    ...dependencies.filesystem,
    canonicalize: async (path: string) => {
      if (path === reportedExternalRoot) return join(repositoryRoot, '.runtime');
      if (path === join(reportedExternalRoot, 'mutation-run')) {
        return join(repositoryRoot, '.runtime', 'mutation-run');
      }
      return dependencies.filesystem.canonicalize(path);
    },
  };
  return captureErrorCodes(() => resolveAr12ExecutionWorkspace({
    repositoryRoot,
    runIdentity: 'mutation-run',
    environment: { AR12_EXECUTION_WORKSPACE_ROOT: reportedExternalRoot },
  }, { ...dependencies, filesystem }));
}

async function ar12ExistingWorkspaceMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const repositoryRoot = join(caseRoot, 'repository');
  const externalRoot = join(caseRoot, 'external');
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(join(externalRoot, 'mutation-run'), { recursive: true });
  return captureErrorCodes(() => resolveAr12ExecutionWorkspace({
    repositoryRoot,
    runIdentity: 'mutation-run',
    environment: { AR12_EXECUTION_WORKSPACE_ROOT: externalRoot },
  }));
}

async function ar12CloneIdentityMutation(
  mutationId: string,
  context: MutationExecutionContext,
  mismatch: 'head' | 'branch' | 'origin',
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const externalRoot = join(caseRoot, 'external');
  const workspacePath = join(externalRoot, 'mutation-run');
  await mkdir(workspacePath, { recursive: true });
  const marker: Ar12ExecutionWorkspaceMarker = {
    schemaVersion: AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION,
    repositoryIdentity: 'example/hospital-data-intelligence-platform',
    sourceRepositoryRootDigest: '0'.repeat(64),
    openingGitCommitSha: '1'.repeat(40),
    targetBranch: 'phase-01-acceptance-readiness',
    runPurpose: 'AR-12 adversarial mutation',
    createdAt: '2026-08-30T12:00:00.000Z',
    externalWorkspaceRoot: externalRoot,
    formalAcceptanceEligible: false,
  };
  await writeFile(
    join(workspacePath, AR12_EXECUTION_WORKSPACE_MARKER),
    `${JSON.stringify(marker)}\n`,
    { flag: 'wx' },
  );
  const dependencies = defaultAr12ExecutionWorkspaceDependencies();
  const observedIdentityOperations = new Set<string>();
  const git = {
    run: async (_cwd: string, arguments_: readonly string[]) => {
      const command = arguments_.join(' ');
      if (arguments_.includes('rev-parse') && arguments_.includes('HEAD')) {
        observedIdentityOperations.add('head');
        return { stdout: mismatch === 'head' ? `${'2'.repeat(40)}\n` : `${marker.openingGitCommitSha}\n`, stderr: '' };
      }
      if (arguments_.includes('branch') && arguments_.includes('--show-current')) {
        observedIdentityOperations.add('branch');
        return { stdout: mismatch === 'branch' ? 'wrong-branch\n' : `${marker.targetBranch}\n`, stderr: '' };
      }
      if (arguments_.includes('config') && arguments_.includes('remote.origin.url')) {
        observedIdentityOperations.add('origin');
        return {
          stdout: mismatch === 'origin'
            ? 'https://github.com/example/wrong-repository.git\n'
            : 'https://github.com/example/hospital-data-intelligence-platform.git\n',
          stderr: '',
        };
      }
      if (arguments_.includes('status') && arguments_.includes('--porcelain=v1')) {
        observedIdentityOperations.add('status');
        return { stdout: '', stderr: '' };
      }
      throw new Error('AR12_MUTATION_UNEXPECTED_GIT_COMMAND:' + command);
    },
  };
  const detected = await captureErrorCodes(() => verifyAr12ExecutionWorkspace(
    workspacePath,
    marker,
    { ...dependencies, git },
  ));
  if (
    observedIdentityOperations.size !== 4 ||
    !observedIdentityOperations.has(mismatch === 'head' ? 'head' : mismatch)
  ) {
    throw new Error('AR12_MUTATION_GIT_IDENTITY_SEAM_NOT_EXERCISED:' + mismatch);
  }
  return detected;
}

async function ar12StaleCloneIdentityMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const repositoryRoot = join(caseRoot, 'repository');
  const staleWorktreesRoot = join(repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
  const sourcePath = join(staleWorktreesRoot, 'known-stale');
  const destinationPath = join(caseRoot, 'external-archive', 'known-stale');
  await mkdir(join(sourcePath, '.git'), { recursive: true });
  await writeFile(join(sourcePath, 'package-lock.json'), '{}\n', { flag: 'wx' });
  const dependencies = defaultAr12ExecutionWorkspaceDependencies();
  const filesystem = {
    ...dependencies.filesystem,
    rename: async () => {
      throw new Error('AR12_MUTATION_UNEXPECTED_RENAME');
    },
  };
  const observedIdentityOperations = new Map<string, number>();
  const git = {
    run: async (_cwd: string, arguments_: readonly string[]) => {
      const command = arguments_.join(' ');
      if (arguments_.includes('rev-parse') && arguments_.includes('HEAD')) {
        observedIdentityOperations.set('head', (observedIdentityOperations.get('head') ?? 0) + 1);
        return { stdout: `${'2'.repeat(40)}\n`, stderr: '' };
      }
      if (arguments_.includes('branch') && arguments_.includes('--show-current')) {
        observedIdentityOperations.set('branch', (observedIdentityOperations.get('branch') ?? 0) + 1);
        return { stdout: 'phase-01-acceptance-readiness\n', stderr: '' };
      }
      if (arguments_.includes('config') && arguments_.includes('remote.origin.url')) {
        observedIdentityOperations.set('origin', (observedIdentityOperations.get('origin') ?? 0) + 1);
        return { stdout: 'https://github.com/example/hospital-data-intelligence-platform.git\n', stderr: '' };
      }
      if (arguments_.includes('status') && arguments_.includes('--porcelain=v1')) {
        observedIdentityOperations.set('status', (observedIdentityOperations.get('status') ?? 0) + 1);
        return { stdout: '', stderr: '' };
      }
      throw new Error('AR12_MUTATION_UNEXPECTED_GIT_COMMAND:' + command);
    },
  };
  const detected = await captureErrorCodes(() => relocateStaleAr12ExecutionWorkspace({
    repositoryRoot,
    sourcePath,
    allowedStaleWorktreesRoot: staleWorktreesRoot,
    destinationPath,
    expectedHead: '1'.repeat(40),
    expectedBranch: 'phase-01-acceptance-readiness',
    failedFinalRunDirectory: join(
      repositoryRoot,
      '.runtime',
      'rebaseline',
      'ar-12',
      '20260830-0267bba-final',
    ),
    initialRunEvidenceDirectories: [],
    relocatedAt: '2026-08-30T12:30:00.000Z',
  }, { ...dependencies, filesystem, git }));
  if (
    observedIdentityOperations.get('head') !== 2 ||
    observedIdentityOperations.get('branch') !== 2 ||
    observedIdentityOperations.get('origin') !== 2 ||
    observedIdentityOperations.get('status') !== 2
  ) {
    throw new Error('AR12_MUTATION_STALE_IDENTITY_SEAM_NOT_EXERCISED');
  }
  return detected;
}

async function ar12FailedEvidenceDeleteMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const caseRoot = join(context.mutationRootDirectory, mutationId);
  const repositoryRoot = join(caseRoot, 'repository');
  const evidenceDirectory = join(caseRoot, 'failed-evidence');
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  const dependencies = defaultAr12ExecutionWorkspaceDependencies();
  const filesystem = {
    ...dependencies.filesystem,
    removeDirectory: async (_path: string) => {
      throw new Error('AR12_MUTATION_UNEXPECTED_REMOVE');
    },
  };
  const marker: Ar12ExecutionWorkspaceMarker = {
    schemaVersion: AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION,
    repositoryIdentity: 'example/hospital-data-intelligence-platform',
    sourceRepositoryRootDigest: '0'.repeat(64),
    openingGitCommitSha: '1'.repeat(40),
    targetBranch: 'phase-01-acceptance-readiness',
    runPurpose: 'AR-12 adversarial cleanup mutation',
    createdAt: '2026-08-30T12:00:00.000Z',
    externalWorkspaceRoot: caseRoot,
    formalAcceptanceEligible: false,
  };
  const git = {
    run: async () => {
      throw new Error('AR12_MUTATION_UNEXPECTED_GIT_COMMAND');
    },
  };
  return captureErrorCodes(() => cleanupAr12ExecutionWorkspace(
    evidenceDirectory,
    marker,
    {
      repositoryRoot,
      evidenceDirectories: [evidenceDirectory],
    },
    { ...dependencies, filesystem, git },
  ));
}

async function summaryMutation(
  fixture: ValidEvidenceFixture,
  mutate: (summary: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  const summary = record(clone(fixture.summary));
  mutate(summary);
  return captureErrorCodes(() => Promise.resolve(
    validateFormalAbgSummary(summary, fixture.summaryValidationExpectations),
  ));
}

async function gateProofMutation(
  fixture: ValidEvidenceFixture,
  gateId: string,
  mutate: (proof: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  const summary = record(clone(fixture.summary));
  const proof = summaryGateProof(summary, gateId);
  mutate(proof);
  return captureErrorCodes(() => validateAbgGateResult({
    value: proof,
    evidenceRoot: fixture.evidenceDirectory,
    expectedGateId: gateId,
    expectedRunId: fixture.runId,
    expectedRunSequence: fixture.runSequence,
    expectedCoverageMatrixDigest: fixture.authorityIdentity.coverageMatrixDigest,
  }));
}

async function producerAssertionStatusMutation(
  fixture: ValidEvidenceFixture,
  status: 'FAILED' | 'BLOCKED',
): Promise<readonly string[]> {
  return producerMutation(fixture, 'fault', (evidence) => {
    const assertion = assertionForGate(evidence as unknown as Record<string, unknown>, 'ABG-16');
    assertion['status'] = status;
    assertion['failureCode'] = `AR06_MUTATED_${status}`;
  });
}

async function invalidProducerReference(
  fixture: ValidEvidenceFixture,
  value: string,
): Promise<readonly string[]> {
  return producerMutation(fixture, 'static', (evidence) => {
    scenarioForGate(evidence as unknown as Record<string, unknown>, 'ABG-01')['requestIds'] = [value];
  });
}

async function producerMutation(
  fixture: ValidEvidenceFixture,
  producerId: AbgProducerId,
  mutate: (evidence: ProducerEvidence) => void,
): Promise<readonly string[]> {
  const relativePath = producerId === 'formal-run'
    ? 'formal-run/producer-evidence.json'
    : `shared/${producerId}/producer-evidence.json`;
  const evidence = JSON.parse(await readFile(
    join(fixture.evidenceDirectory, relativePath),
    'utf8',
  )) as ProducerEvidence;
  mutate(evidence);
  return captureErrorCodes(() => Promise.resolve(validateProducerEvidence(evidence)));
}

interface PhysicalFixtureCopy {
  readonly caseDirectory: string;
  readonly evidenceDirectory: string;
  readonly reviewOutputDirectory: string;
}

async function lifecycleReviewerMutation(
  mutationId: string,
  context: MutationExecutionContext,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  return reviewerMutation(mutationId, context, async (copy) => {
    await mutateJsonFile(copy.evidenceDirectory, relativePath, mutate);
    await rebuildFixtureManifest(copy.evidenceDirectory);
  });
}

async function residualResourceMutation(
  mutationId: string,
  context: MutationExecutionContext,
  resourceType: 'container' | 'volume' | 'network',
): Promise<readonly string[]> {
  return lifecycleReviewerMutation(
    mutationId,
    context,
    'runtime/resources-final.json',
    (snapshot) => {
      snapshot['resources'] = [{
        resourceType,
        id: `mutation-${resourceType}`,
        name: `mutation-${resourceType}`,
        labels: {},
        source: 'podman-inspect',
        present: true,
        active: true,
        state: 'PRESENT',
        imageReference: null,
        imageId: null,
        imageDigest: null,
        ports: [],
        startedAt: null,
        stoppedAt: null,
        exitStatus: null,
        metrics: null,
      }];
    },
  );
}

async function sourceManifestMutation(
  mutationId: string,
  context: MutationExecutionContext,
  mutate: (manifest: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  return reviewerMutation(mutationId, context, async (copy) => {
    const manifest = await readJsonRecord(
      copy.evidenceDirectory,
      'provenance/producer-source-manifest.json',
    );
    mutate(manifest);
    const bytes = Buffer.from(`${canonicalJsonValue(manifest)}\n`, 'utf8');
    await writeFile(
      join(copy.evidenceDirectory, 'provenance/producer-source-manifest.json'),
      bytes,
      { flag: 'w' },
    );
    await writeFile(
      join(copy.evidenceDirectory, 'provenance/producer-source-manifest.sha256'),
      `${sha256(bytes)}  producer-source-manifest.json\n`,
      { flag: 'w' },
    );
    await rebuildFixtureManifest(copy.evidenceDirectory);
  });
}

async function sourceManifestEntryMutation(
  mutationId: string,
  context: MutationExecutionContext,
  mutate: (entry: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  return sourceManifestMutation(mutationId, context, (manifest) => {
    const files = recordArray(manifest['sourceFiles']);
    mutate(files[0]!);
    manifest['sourceFilesDigest'] = digestCanonical(files);
  });
}

async function reviewerDefinitionDriftMutation(
  mutationId: string,
  context: MutationExecutionContext,
  driftPath: string,
): Promise<readonly string[]> {
  const base = context.fixture.reviewerDependencies;
  const state = await base.repository.readState(base.repositoryRoot);
  const reviewerCommit = 'd'.repeat(40);
  const driftedBytes = async (path: string): Promise<Uint8Array | null> => {
    const source = await base.workspace.readSourceFile(base.repositoryRoot, path);
    if (source.kind !== 'REGULAR' || source.bytes === undefined) return null;
    return path === driftPath
      ? Buffer.concat([Buffer.from(source.bytes), Buffer.from('\nreviewer-definition-drift\n')])
      : source.bytes;
  };
  return reviewerMutation(mutationId, context, async () => undefined, undefined, {
    repository: {
      async readState() {
        return { ...state, gitCommitSha: reviewerCommit, worktreeStatus: 'CLEAN' as const };
      },
    },
    workspace: {
      async readSourceFile(_root, path) {
        const bytes = await driftedBytes(path);
        return bytes === null
          ? { kind: 'MISSING' as const }
          : { kind: 'REGULAR' as const, bytes };
      },
    },
    git: {
      async commitExists(root, commit) {
        return commit === reviewerCommit || base.git.commitExists(root, commit);
      },
      async readBlob(root, commit, path) {
        if (commit !== reviewerCommit) return base.git.readBlob(root, commit, path);
        const bytes = await driftedBytes(path);
        return bytes === null ? null : { mode: '100644', oid: gitBlobOid(bytes), bytes };
      },
    },
  });
}

async function reviewerWorktreeDirtyMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const base = context.fixture.reviewerDependencies;
  const state = await base.repository.readState(base.repositoryRoot);
  return reviewerMutation(mutationId, context, async () => undefined, undefined, {
    repository: {
      async readState() {
        return { ...state, worktreeStatus: 'DIRTY' as const };
      },
    },
  });
}

async function reviewerSourceManifestTamperedMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const base = context.fixture.reviewerDependencies;
  const builder = createSourceManifestBuilder(base);
  return reviewerMutation(mutationId, context, async () => undefined, undefined, {
    sourceManifestBuilder: {
      buildProducer: (root) => builder.buildProducer(root),
      async buildReviewer(root) {
        const manifest = await builder.buildReviewer(root);
        return { ...manifest, sourceFilesDigest: '0'.repeat(64) };
      },
    },
  });
}

async function embeddedScriptMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<readonly string[]> {
  const unlisted = await copyFixtureForMutation(`${mutationId}-unlisted`, context);
  const unlistedSentinel = join(unlisted.caseDirectory, 'unlisted-script-executed.txt');
  await writeFile(
    join(unlisted.evidenceDirectory, 'embedded-side-effect.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(unlistedSentinel)}, 'executed');\n`,
    { flag: 'wx' },
  );
  const unlistedCodes = await reviewPreparedCopy(
    unlisted,
    context.fixture.reviewerDependencies,
  );
  if (await pathExists(unlistedSentinel)) return ['EVIDENCE_EMBEDDED_SCRIPT_EXECUTED'];

  const listed = await copyFixtureForMutation(`${mutationId}-listed`, context);
  const listedSentinel = join(listed.caseDirectory, 'listed-script-executed.txt');
  await writeFile(
    join(listed.evidenceDirectory, 'embedded-side-effect.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(listedSentinel)}, 'executed');\n`,
    { flag: 'wx' },
  );
  await rebuildFixtureManifest(listed.evidenceDirectory);
  const listedCodes = await reviewPreparedCopy(listed, context.fixture.reviewerDependencies);
  if (await pathExists(listedSentinel)) return ['EVIDENCE_EMBEDDED_SCRIPT_EXECUTED'];
  if (listedCodes.length > 0) return listedCodes;
  return unlistedCodes;
}

async function reviewPreparedCopy(
  copy: PhysicalFixtureCopy,
  dependencies: ReviewFormalAbgEvidenceDependencies,
): Promise<readonly string[]> {
  const review = await reviewFormalAbgEvidence({
    evidenceDirectory: copy.evidenceDirectory,
    reviewOutputDirectory: copy.reviewOutputDirectory,
    dependencies,
  });
  const findings = JSON.parse(await readFile(
    join(copy.reviewOutputDirectory, 'review-findings.json'),
    'utf8',
  )) as { readonly findings: readonly { readonly code: string }[] };
  return review.status === 'PASSED' ? [] : findings.findings.map((finding) => finding.code);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function reviewerMutation(
  mutationId: string,
  context: MutationExecutionContext,
  mutate: (copy: PhysicalFixtureCopy) => Promise<void>,
  configuredSecret?: {
    readonly name: string;
    readonly value: string;
  },
  dependencyOverrides: Partial<ReviewFormalAbgEvidenceDependencies> = {},
): Promise<readonly string[]> {
  const previousSecret = configuredSecret === undefined
    ? undefined
    : process.env[configuredSecret.name];
  if (configuredSecret !== undefined) process.env[configuredSecret.name] = configuredSecret.value;
  try {
    const copy = await copyFixtureForMutation(mutationId, context);
    await mutate(copy);
    return reviewPreparedCopy(copy, {
      ...context.fixture.reviewerDependencies,
      ...dependencyOverrides,
    });
  } finally {
    if (configuredSecret !== undefined) {
      if (previousSecret === undefined) delete process.env[configuredSecret.name];
      else process.env[configuredSecret.name] = previousSecret;
    }
  }
}

async function copyFixtureForMutation(
  mutationId: string,
  context: MutationExecutionContext,
): Promise<PhysicalFixtureCopy> {
  await mkdir(context.mutationRootDirectory, { recursive: true });
  const caseDirectory = join(
    context.mutationRootDirectory,
    mutationId.toLowerCase().replaceAll(/[^a-z0-9-]/gu, '-'),
  );
  await mkdir(caseDirectory, { recursive: false });
  const evidenceDirectory = join(caseDirectory, 'evidence');
  await cp(context.fixture.evidenceDirectory, evidenceDirectory, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  return {
    caseDirectory,
    evidenceDirectory,
    reviewOutputDirectory: join(caseDirectory, 'review'),
  };
}

async function mutateGateProofFile(
  evidenceDirectory: string,
  gateId: string,
  mutate: (proof: Record<string, unknown>) => void,
): Promise<void> {
  const summary = await readJsonRecord(evidenceDirectory, 'abg-results.json');
  const result = summaryResults(summary).find((candidate) => candidate['gateId'] === gateId);
  if (result === undefined) throw new Error(`MUTATION_GATE_RESULT_MISSING:${gateId}`);
  const proof = record(result['proof']);
  mutate(proof);
  await writeJsonFile(evidenceDirectory, String(result['proofPath']), proof);
  await writeJsonFile(evidenceDirectory, 'abg-results.json', summary);
}

async function mutateJsonFile(
  evidenceDirectory: string,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = await readJsonRecord(evidenceDirectory, relativePath);
  mutate(value);
  await writeJsonFile(evidenceDirectory, relativePath, value);
}

async function readJsonRecord(
  evidenceDirectory: string,
  relativePath: string,
): Promise<Record<string, unknown>> {
  return record(JSON.parse(await readFile(join(evidenceDirectory, relativePath), 'utf8')) as unknown);
}

async function writeJsonFile(
  evidenceDirectory: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await writeFile(
    join(evidenceDirectory, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'w' },
  );
}

async function writeManifestAndDigest(
  evidenceDirectory: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(join(evidenceDirectory, 'manifest.json'), bytes, { flag: 'w' });
  await writeFile(
    join(evidenceDirectory, 'manifest.sha256'),
    `${sha256(bytes)}  manifest.json\n`,
    { flag: 'w' },
  );
}

async function runtimeAuthorityParserMutation(
  mutate: (document: Record<string, unknown>) => void,
): Promise<readonly string[]> {
  const fixture = validRuntimeAuthorityMutationFixture();
  const document = cloneRuntimeAuthorityDocument(fixture.document);
  mutate(document);
  return captureErrorCodes(() => Promise.resolve(parsePodmanRuntimeAuthority(document)));
}

async function syntheticFailureResidueMutation(
  failureKind: 'partial-startup' | 'bootstrap',
  failureStage: string,
  resourceType: 'container' | 'volume',
  role: string,
): Promise<readonly string[]> {
  const identity = syntheticRuntimeIdentity();
  const runtimeAuthority = validRuntimeAuthorityMutationFixture().loaded.authority;
  const resource = syntheticRuntimeResource(identity, runtimeAuthority, resourceType, role);
  return captureErrorCodes(() => Promise.resolve(assertSyntheticFailureCleanup({
    failureKind,
    failureStage,
    cleanupSucceeded: true,
    identity,
    runtimeAuthority,
    resources: [resource],
  })));
}

async function syntheticOwnershipMismatchMutation(): Promise<readonly string[]> {
  const identity = syntheticRuntimeIdentity();
  const runtimeAuthority = validRuntimeAuthorityMutationFixture().loaded.authority;
  const resource = syntheticRuntimeResource(identity, runtimeAuthority, 'container', 'postgres', false);
  return captureErrorCodes(() => Promise.resolve(assertSyntheticFailureCleanup({
    failureKind: 'partial-startup',
    failureStage: 'postgres-container-created',
    cleanupSucceeded: true,
    identity,
    runtimeAuthority,
    resources: [resource],
  })));
}

async function syntheticCleanupFailureMutation(): Promise<readonly string[]> {
  const identity = syntheticRuntimeIdentity();
  const runtimeAuthority = validRuntimeAuthorityMutationFixture().loaded.authority;
  return captureErrorCodes(() => Promise.resolve(assertSyntheticFailureCleanup({
    failureKind: 'partial-startup',
    failureStage: 'postgres-container-created',
    cleanupSucceeded: false,
    identity,
    runtimeAuthority,
    resources: [],
  })));
}

function syntheticRuntimeIdentity(): FormalRunIdentity {
  return {
    runId: 'ar11-runtime-mutation-run',
    runSequence: 111,
    runtimeNamespace: 'hdi_phase01_abg_111_ar11runtime',
    gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
  };
}

function syntheticRuntimeResource(
  identity: FormalRunIdentity,
  runtimeAuthority: ReturnType<typeof validRuntimeAuthorityMutationFixture>['loaded']['authority'],
  resourceType: 'container' | 'volume',
  role: string,
  owned = true,
): RuntimeResourceRecord {
  return {
    resourceType,
    id: `ar11-${role}-${resourceType}`,
    name: `${identity.runtimeNamespace}-${role}-${resourceType}`,
    labels: {
      ...formalRuntimeLabels(identity, runtimeAuthority),
      ...(owned ? {} : { 'hdi.run-id': 'unrelated-run-id' }),
    },
    source: 'runtime-event',
    present: true,
    active: resourceType === 'container',
    state: resourceType === 'container' ? 'running' : 'created',
    imageReference: resourceType === 'container' ? 'synthetic@sha256:' + '1'.repeat(64) : null,
    imageId: resourceType === 'container' ? 'sha256:' + '2'.repeat(64) : null,
    imageDigest: resourceType === 'container' ? 'sha256:' + '1'.repeat(64) : null,
    ports: [],
    startedAt: '2026-08-30T12:00:00',
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
    role,
  };
}

function mutableArray<T>(value: readonly T[]): T[] {
  return value as T[];
}

async function unrelatedCleanupMutation(): Promise<readonly string[]> {
  const identity: FormalRunIdentity = {
    runId: 'validator-test-cleanup-run',
    runSequence: 17,
    runtimeNamespace: 'hdi_phase01_abg_17_validatortes',
    gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
  };
  const unrelated: RuntimeResourceRecord = {
    resourceType: 'container',
    id: 'unrelated-container-id',
    name: 'unrelated-container',
    labels: {
      ...formalRuntimeLabels(identity, validRuntimeAuthorityMutationFixture().loaded.authority),
      'hdi.run-id': 'different-run-id',
    },
    source: 'podman-inspect',
    present: true,
    active: true,
    state: 'running',
    imageReference: 'validator-test-only',
    imageId: 'sha256:' + '0'.repeat(64),
    imageDigest: 'sha256:' + '0'.repeat(64),
    ports: [],
    startedAt: '2026-08-28T10:00:00',
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
  };
  return captureErrorCodes(() => Promise.resolve(
    assertFormalRuntimeResourceOwned(
      unrelated,
      identity,
      validRuntimeAuthorityMutationFixture().loaded.authority,
    ),
  ));
}

function coverageEntry(gateId: string) {
  const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === gateId);
  if (entry === undefined) throw new Error(`MUTATION_COVERAGE_ENTRY_MISSING:${gateId}`);
  return entry;
}

function summaryResults(summary: Record<string, unknown>): Record<string, unknown>[] {
  return recordArray(summary['results']);
}

function summaryGateProof(summary: Record<string, unknown>, gateId: string): Record<string, unknown> {
  const result = summaryResults(summary).find((candidate) => candidate['gateId'] === gateId);
  if (result === undefined) throw new Error(`MUTATION_GATE_RESULT_MISSING:${gateId}`);
  return record(result['proof']);
}

function firstEvidenceReference(proof: Record<string, unknown>): Record<string, unknown> {
  const reference = recordArray(proof['evidenceRefs'])[0];
  if (reference === undefined) throw new Error('MUTATION_EVIDENCE_REFERENCE_MISSING');
  return reference;
}

function scenarioForGate(evidence: Record<string, unknown>, gateId: string): Record<string, unknown> {
  const assertionId = coverageEntry(gateId).assertionIds[0];
  if (assertionId === undefined) throw new Error(`MUTATION_ASSERTION_ID_MISSING:${gateId}`);
  for (const scenario of Object.values(record(evidence['scenarios']))) {
    const candidate = record(scenario);
    if (Object.hasOwn(record(candidate['assertions']), assertionId)) return candidate;
  }
  throw new Error(`MUTATION_SCENARIO_MISSING:${gateId}`);
}

function assertionForGate(evidence: Record<string, unknown>, gateId: string): Record<string, unknown> {
  const assertionId = coverageEntry(gateId).assertionIds[0];
  if (assertionId === undefined) throw new Error(`MUTATION_ASSERTION_ID_MISSING:${gateId}`);
  return record(record(scenarioForGate(evidence, gateId)['assertions'])[assertionId]);
}

async function captureErrorCodes(action: () => Promise<unknown>): Promise<readonly string[]> {
  try {
    await action();
    return [];
  } catch (error) {
    return [stableErrorCode(error)];
  }
}

function stableErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.split(':', 1)[0] ?? value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function digestCanonical(value: unknown): string {
  return sha256(Buffer.from(canonicalJsonValue(value), 'utf8'));
}

function gitBlobOid(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buffer.byteLength}\0`, 'utf8'), buffer]))
    .digest('hex');
}

function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(',')}]`;
  if (typeof value === 'object') {
    const valueRecord = value as Record<string, unknown>;
    return `{${Object.keys(valueRecord).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonValue(valueRecord[key])}`,
    ).join(',')}}`;
  }
  throw new Error('MUTATION_CANONICAL_JSON_VALUE_INVALID');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MUTATION_RECORD_EXPECTED');
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('MUTATION_RECORD_ARRAY_EXPECTED');
  for (const item of value) record(item);
  return value as Record<string, unknown>[];
}
