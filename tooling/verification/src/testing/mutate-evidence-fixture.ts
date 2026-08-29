import {
  cp,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  ABG_COVERAGE_MATRIX,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  validateAbgGateResult,
  writeAbgGateProof,
} from '../abg-gate-proof.js';
import { sha256 } from '../evidence/recorder.js';
import type { ProducerEvidence } from '../evidence/protocol.js';
import { validateProducerEvidence } from '../evidence/validate-producer-evidence.js';
import { validateFormalAbgSummary } from '../formal-summary-validator.js';
import { reviewFormalAbgEvidence } from '../review-formal-abg-evidence.js';
import {
  assertFormalRuntimeResourceOwned,
  assertSafeFormalCleanupCommand,
  type RuntimeResourceRecord,
} from '../runtime/formal-teardown.js';
import {
  formalRuntimeLabels,
  type FormalRunIdentity,
} from '../runtime/formal-runtime-contract.js';
import {
  rebuildFixtureManifest,
  type ValidEvidenceFixture,
} from './build-valid-evidence-fixture.js';

export type MutationDetectionLayer =
  | 'producer-evidence-validator'
  | 'gate-proof-validator'
  | 'formal-summary-validator'
  | 'independent-reviewer'
  | 'exclusive-output-guard'
  | 'runtime-teardown-guard';

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

export const ADVERSARIAL_MUTATION_CASES: readonly EvidenceMutationCase[] = [
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
          'ar06-stdout-bare-configured-secret\n',
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
          'ar06-stderr-bare-configured-secret\n',
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
          '{"diagnostic":"ar06-malformed-bare-configured-secret",',
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
      return summaryMutation(context.fixture, (summary) => { summary['frozenInputsStable'] = false; });
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
    default:
      throw new Error(`MUTATION_NOT_IMPLEMENTED:${mutationId}`);
  }
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

async function reviewerMutation(
  mutationId: string,
  context: MutationExecutionContext,
  mutate: (copy: PhysicalFixtureCopy) => Promise<void>,
  configuredSecret?: {
    readonly name: string;
    readonly value: string;
  },
): Promise<readonly string[]> {
  const previousSecret = configuredSecret === undefined
    ? undefined
    : process.env[configuredSecret.name];
  if (configuredSecret !== undefined) process.env[configuredSecret.name] = configuredSecret.value;
  try {
    const copy = await copyFixtureForMutation(mutationId, context);
    await mutate(copy);
    const review = await reviewFormalAbgEvidence({
      evidenceDirectory: copy.evidenceDirectory,
      reviewOutputDirectory: copy.reviewOutputDirectory,
    });
    const findings = JSON.parse(await readFile(
      join(copy.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    )) as { readonly findings: readonly { readonly code: string }[] };
    if (review.status === 'PASSED') return [];
    return findings.findings.map((finding) => finding.code);
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
      ...formalRuntimeLabels(identity),
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
    assertFormalRuntimeResourceOwned(unrelated, identity),
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
