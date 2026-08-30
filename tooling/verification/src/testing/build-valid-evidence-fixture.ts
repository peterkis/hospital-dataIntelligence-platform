import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { ABG_GATES } from '../abg-catalog.js';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  writeAbgGateProof,
  type AbgGateResult,
} from '../abg-gate-proof.js';
import {
  readVerificationAuthorityIdentity,
  type FrozenRunPlan,
  type VerificationAuthorityIdentity,
} from '../authoritative-abg-plan.js';
import { buildMatrixProducerEvidence } from '../evidence/adapters.js';
import {
  canonicalJson,
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  sha256,
  writeProducerEvidence,
  writeProducerEvidenceIndex,
  writeRedactedJsonArtifact,
} from '../evidence/recorder.js';
import { PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION } from '../evidence/protocol.js';
import {
  validateFormalAbgSummary,
  type FormalAbgSummaryValidationExpectations,
} from '../formal-summary-validator.js';
import {
  createFormalRunSeed,
  formalRuntimeAuthority,
  formalRuntimePorts,
  type FormalRunIdentity,
} from '../runtime/formal-runtime-contract.js';
import {
  buildFormalTerminalConclusion,
  type FormalTerminalConclusion,
} from '../runtime/formal-terminal-conclusion.js';
import type {
  FormalCleanupReport,
  RuntimeResourceSnapshot,
} from '../runtime/formal-teardown.js';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  RUN_PLAN_AUTHORITY_ID,
  RUN_PLAN_SCHEMA_VERSION,
  RUN_SUMMARY_SCHEMA_VERSION,
  RUNTIME_OUTCOME_SCHEMA_VERSION,
} from '../verification-contract-versions.js';
import { VERIFICATION_SOURCE_FILES } from '../provenance/source-manifest-files.js';
import {
  buildProducerSourceManifest,
  writeProducerSourceManifest,
  type SourceManifestDependencies,
} from '../provenance/source-manifest.js';

export const VALIDATOR_FIXTURE_RUN_ID = 'validator-test-fixture-run-0001';
export const VALIDATOR_FIXTURE_RUN_SEQUENCE = 17;
export const VALIDATOR_FIXTURE_DIGEST =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface BuildValidEvidenceFixtureInput {
  /** Existing, caller-owned temporary directory. */
  readonly rootDirectory: string;
  /** Optional checkout root for a CLI fixture bound to a real clean HEAD. */
  readonly repositoryRoot?: string;
  /** Optional source adapters; omitted for the deterministic controlled fixture. */
  readonly sourceManifestDependencies?: SourceManifestDependencies;
}

export interface ValidFixtureGateSummary {
  readonly gateId: string;
  readonly status: 'PASSED';
  readonly proofPath: string;
  readonly proof: AbgGateResult;
  readonly [key: string]: unknown;
}

export interface ValidFixtureSummary {
  readonly schemaVersion: typeof RUN_SUMMARY_SCHEMA_VERSION;
  readonly runId: string;
  readonly runSequence: number;
  readonly status: 'PASSED';
  readonly results: readonly ValidFixtureGateSummary[];
  readonly [key: string]: unknown;
}

export interface ValidEvidenceFixture {
  readonly rootDirectory: string;
  readonly evidenceDirectory: string;
  readonly reviewOutputDirectory: string;
  readonly runId: string;
  readonly runSequence: number;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly authorityIdentity: VerificationAuthorityIdentity;
  readonly plan: FrozenRunPlan;
  readonly summary: ValidFixtureSummary;
  readonly summaryValidationExpectations: FormalAbgSummaryValidationExpectations;
  readonly reviewerDependencies: SourceManifestDependencies & { readonly repositoryRoot: string };
}

/**
 * Builds a byte-deterministic package used only to test verification code. It
 * does not start services and is explicitly ineligible for formal acceptance.
 */
export async function buildValidEvidenceFixture(
  input: BuildValidEvidenceFixtureInput,
): Promise<ValidEvidenceFixture> {
  const runtimeAuthority = formalRuntimeAuthority().authority;
  const rootDirectory = resolve(input.rootDirectory);
  const rootStat = await lstat(rootDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('VALIDATOR_FIXTURE_ROOT_UNSAFE');
  }
  const evidenceDirectory = join(rootDirectory, 'validator-test-evidence');
  const reviewOutputDirectory = join(rootDirectory, 'validator-test-review');
  const sharedDirectory = join(evidenceDirectory, 'shared');
  await createEvidenceOutputDirectory(evidenceDirectory);
  await createEvidenceOutputDirectory(sharedDirectory);

  const reviewerDependencies = input.sourceManifestDependencies === undefined
    ? fixtureSourceManifestDependencies()
    : {
        ...input.sourceManifestDependencies,
        repositoryRoot: resolve(input.repositoryRoot ?? repositoryRoot),
      };
  const producerSourceManifest = await buildProducerSourceManifest(
    reviewerDependencies.repositoryRoot,
    reviewerDependencies,
  );
  const producerSourceManifestWrite = await writeProducerSourceManifest(
    evidenceDirectory,
    producerSourceManifest,
  );
  const producerSourceManifestSha256 = producerSourceManifestWrite.sha256;
  const frozenInputs = fixtureFrozenInputs(
    producerSourceManifestSha256,
    producerSourceManifest.producerGitCommitSha,
    runtimeAuthority,
  );
  const sharedEntries = [];
  for (const producerId of ABG_PRODUCER_IDS.filter((candidate) => candidate !== 'formal-run')) {
    sharedEntries.push(await writeFixtureProducer({
      producerId,
      evidenceRoot: sharedDirectory,
      frozenInputs,
      rawArtifactPath: `raw/${producerId}.json`,
      evidencePath: `${producerId}/producer-evidence.json`,
    }));
  }
  await writeProducerEvidenceIndex(sharedDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    producers: sharedEntries,
  });

  const proofs: AbgGateResult[] = [];
  for (const entry of ABG_COVERAGE_MATRIX.filter((candidate) => candidate.gateId !== 'ABG-40')) {
    proofs.push(await writeAbgGateProof({
      gateId: entry.gateId,
      runId: VALIDATOR_FIXTURE_RUN_ID,
      runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
      evidenceRoot: evidenceDirectory,
      producerEvidenceIndexRelativePath: 'shared/producer-evidence-index.json',
      resultRelativePath: `gates/${entry.gateId}/producer/result.json`,
    }));
  }

  const setupCommands = [1, 2, 3].map((ordinal) => ({
    executable: 'validator-test-setup',
    args: [`step-${ordinal}`],
  }));
  const gateCommands = ABG_GATES.map((gate) => ({
    gateId: gate.gateId,
    executable: 'node',
    args: ['tooling/verification/src/produce-abg-gate.ts'],
  }));
  const authorityIdentity = await readVerificationAuthorityIdentity(
    input.repositoryRoot === undefined ? repositoryRoot : resolve(input.repositoryRoot),
  );
  const plan: FrozenRunPlan = {
    schemaVersion: RUN_PLAN_SCHEMA_VERSION,
    authorityId: RUN_PLAN_AUTHORITY_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    producerSourceManifestPath: producerSourceManifestWrite.relativePath,
    producerSourceManifestSha256,
    producerGitCommitSha: producerSourceManifest.producerGitCommitSha,
    contractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    frozenInputs,
    runtimeAuthoritySha256: frozenInputs['runtimeAuthoritySha256']!,
    runtimeAuthoritySemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
    authorityIdentity,
    setupCommands,
    gates: gateCommands,
  };
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await writeFile(join(evidenceDirectory, 'run-plan.json'), planBytes, { flag: 'wx', mode: 0o600 });
  for (const ordinal of [1, 2, 3]) {
    const directory = join(evidenceDirectory, 'setup', String(ordinal).padStart(2, '0'));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'stdout.log'), 'validator test setup passed\n', { flag: 'wx' });
    await writeFile(join(directory, 'stderr.log'), '', { flag: 'wx' });
  }

  const runIdentity: FormalRunIdentity = {
    ...createFormalRunSeed(VALIDATOR_FIXTURE_RUN_SEQUENCE, () => VALIDATOR_FIXTURE_RUN_ID),
    gitCommitSha: frozenInputs['gitCommitSha']!,
  };
  const ports = formalRuntimePorts(runtimeAuthority).map((port) => ({
    port,
    occupied: false,
    verificationError: null,
  }));
  const startedResources: RuntimeResourceSnapshot = {
    schemaVersion: 'phase-01.formal-runtime-resources.v1',
    runIdentity,
    capturedAt: '2026-08-28T10:00:30',
    resources: [],
    ports,
  };
  const finalResources: RuntimeResourceSnapshot = {
    ...startedResources,
    capturedAt: '2026-08-28T10:00:50',
  };
  const cleanup: FormalCleanupReport = {
    schemaVersion: 'phase-01.formal-cleanup.v1',
    runIdentity,
    startedAt: '2026-08-28T10:00:40',
    completedAt: '2026-08-28T10:00:50',
    status: 'PASSED',
    actions: [],
    failedItems: [],
    residualResources: [],
    occupiedPorts: [],
    pruneCommandsInvoked: false,
    runtimeAuthority: {
      expectedSha256: frozenInputs['runtimeAuthoritySha256']!,
      observedAfterSha256: frozenInputs['runtimeAuthoritySha256']!,
      expectedSemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
      observedAfterSemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
      stable: true,
    },
    restartPolicyFindings: [],
    dockerSecondAuthorityFindings: [],
    partialStartupRecoveryFindings: [],
    persistenceFindings: [],
    residualCounts: { process: 0, container: 0, volume: 0, network: 0 },
  };
  await writeFixtureJson(join(evidenceDirectory, 'runtime/preflight.json'), {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: 'PASSED',
    runIdentity,
    startedAt: '2026-08-28T09:59:58',
    completedAt: '2026-08-28T09:59:59',
    timezone: 'Asia/Shanghai',
    runtimeAuthoritySha256: frozenInputs['runtimeAuthoritySha256']!,
    runtimeAuthoritySemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
    checks: [],
    secrets: [],
  });
  await writeFixtureJson(join(evidenceDirectory, 'runtime/resources-started.json'), startedResources);
  const producerProtocolEvidence = [
    ...await Promise.all(sharedEntries.map((entry) =>
      fixtureFileIdentity(evidenceDirectory, `shared/${entry.relativePath}`),
    )),
    await fixtureFileIdentity(evidenceDirectory, 'shared/producer-evidence-index.json'),
  ];
  await writeFixtureJson(join(evidenceDirectory, 'runtime/producer-evidence-snapshot.json'), {
    schemaVersion: 'phase-01.formal-producer-evidence-snapshot.v1',
    runIdentity,
    statusBeforeCleanup: 'PASSED',
    failureCodes: [],
    discoveredEvidence: producerProtocolEvidence,
    discoveredEvidenceCount: producerProtocolEvidence.length,
    producerProtocolEvidence,
    producerProtocolEvidenceCount: producerProtocolEvidence.length,
    absenceIsNotSuccess: false,
    recordedAt: '2026-08-28T10:00:35',
  });
  await writeFixtureJson(join(evidenceDirectory, 'runtime/failure-summary.json'), {
    schemaVersion: 'phase-01.formal-failure-summary.v1',
    runIdentity,
    statusBeforeCleanup: 'PASSED',
    failureCodes: [],
    failureMessage: null,
    evidencePersistedBeforeCleanup: true,
    evidencePersistence: { preflight: true, resources: true, producer: true },
    evidenceDirectoryRetention: 'PERMANENT',
    recordedAt: '2026-08-28T10:00:36',
  });
  await writeFixtureJson(join(evidenceDirectory, 'runtime/resources-final.json'), finalResources);
  await writeFixtureJson(join(evidenceDirectory, 'runtime/cleanup.json'), cleanup);
  const terminalConclusion = buildFormalTerminalConclusion({
    runtimeAuthority,
    runIdentity,
    startedAt: '2026-08-28T10:00:00',
    completedAt: '2026-08-28T10:00:55',
    preflightStatus: 'PASSED',
    setupStatus: 'PASSED',
    nonFormalGateResults: ABG_GATES.slice(0, 39).map((gate) => ({
      gateId: gate.gateId,
      status: 'PASSED',
    })),
    producerEvidencePersistedBeforeCleanup: true,
    producerProtocolEvidenceCount: producerProtocolEvidence.length,
    cleanup,
    finalResources,
    frozenInputsStableAfterCleanup: true,
    authorityIdentityStableAfterCleanup: true,
    runtimeAuthoritySha256: frozenInputs['runtimeAuthoritySha256']!,
    runtimeAuthoritySemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
    runtimeAuthorityStableAfterCleanup: true,
    producerSourceManifestSha256,
    producerSourceManifestStableAfterCleanup: true,
    outputDirectoryExclusive: true,
    failureCodes: [],
  });
  await writeFixtureJson(
    join(evidenceDirectory, 'runtime/terminal-conclusion.json'),
    terminalConclusion,
  );
  const formalEntry = await writeFixtureFormalProducer({
    evidenceRoot: evidenceDirectory,
    frozenInputs,
    terminalConclusion,
  });
  await writeProducerEvidenceIndex(evidenceDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    producers: [
      ...sharedEntries.map((entry) => ({
        ...entry,
        relativePath: `shared/${entry.relativePath}`,
      })),
      formalEntry,
    ],
  });
  proofs.push(await writeAbgGateProof({
    gateId: 'ABG-40',
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    evidenceRoot: evidenceDirectory,
    producerEvidenceIndexRelativePath: 'producer-evidence-index.json',
    resultRelativePath: 'gates/ABG-40/producer/result.json',
  }));

  const results: ValidFixtureGateSummary[] = ABG_GATES.map((gate, index) => ({
    ...gate,
    ordinal: index + 1,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    status: 'PASSED',
    producerExitCode: 0,
    producerCommandDigest: digestJson(gateCommands[index]),
    elapsedMilliseconds: 1,
    proofPath: `gates/${gate.gateId}/producer/result.json`,
    proof: proofs[index]!,
  }));
  const summaryValidationExpectations: FormalAbgSummaryValidationExpectations = {
    runtimeAuthority,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    planDigest: sha256(planBytes),
    frozenInputs,
    frozenInputsDigest: digestJson(frozenInputs),
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    producerSourceManifestSha256,
    setupCommandDigests: setupCommands.map(digestJson),
  };
  const summary: ValidFixtureSummary = {
    schemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    gitCommitSha: runIdentity.gitCommitSha,
    runtimeNamespace: runIdentity.runtimeNamespace,
    planDigest: summaryValidationExpectations.planDigest,
    frozenInputs,
    frozenInputsDigest: summaryValidationExpectations.frozenInputsDigest,
    runtimeAuthoritySha256: frozenInputs['runtimeAuthoritySha256']!,
    runtimeAuthoritySemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    producerSourceManifestSha256,
    authorityIdentity,
    preflightStatus: 'PASSED',
    setupStatus: 'PASSED',
    nonFormalGateStatus: 'PASSED',
    producerEvidenceStatus: 'PASSED',
    producerEvidencePersistedBeforeCleanup: true,
    producerProtocolEvidenceCount: producerProtocolEvidence.length,
    cleanupStatus: 'PASSED',
    residualResourceCount: 0,
    residualContainerCount: 0,
    residualVolumeCount: 0,
    residualNetworkCount: 0,
    occupiedRequiredPorts: [],
    requiredPortsObserved: formalRuntimePorts(runtimeAuthority),
    pruneCommandsInvoked: false,
    frozenInputsStableAfterCleanup: true,
    authorityIdentityStableAfterCleanup: true,
    runtimeAuthorityStableAfterCleanup: true,
    producerSourceManifestStableAfterCleanup: true,
    outputDirectoryExclusive: true,
    terminalConclusionStatus: 'PASSED',
    sealEligibilityStatus: 'PASSED',
    lifecycleStatus: 'PASSED',
    selectorSetsDistinct: true,
    status: 'PASSED',
    failureCodes: [],
    startedAt: '2026-08-28T10:00:00',
    completedAt: '2026-08-28T10:01:00',
    timezone: 'Asia/Shanghai',
    setupResults: setupCommands.map((command, index) => ({
      ordinal: index + 1,
      commandDigest: digestJson(command),
      exitCode: 0,
      elapsedMilliseconds: 1,
    })),
    gateCount: ABG_GATES.length,
    passedCount: ABG_GATES.length,
    failedCount: 0,
    conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
    results,
  };
  validateFormalAbgSummary(summary, summaryValidationExpectations);
  await writeFixtureJson(join(evidenceDirectory, 'abg-results.json'), summary);
  await writeFixtureJson(join(evidenceDirectory, 'runtime/final-outcome.json'), {
    schemaVersion: RUNTIME_OUTCOME_SCHEMA_VERSION,
    runIdentity,
    producerSourceManifestSha256,
    runtimeAuthoritySha256: frozenInputs['runtimeAuthoritySha256']!,
    runtimeAuthoritySemanticDigest: frozenInputs['runtimeAuthoritySemanticDigest']!,
    runtimeAuthorityStableAfterCleanup: true,
    status: 'PASSED',
    failureCodes: [],
    cleanupStatus: 'PASSED',
    terminalConclusionStatus: 'PASSED',
    sealEligibilityStatus: 'PASSED',
    sealPendingAtWrite: true,
    completedEvidenceAt: '2026-08-28T10:01:00',
  });
  await writeFixtureJson(join(evidenceDirectory, 'validator-test-fixture.json'), {
    schemaVersion: 'phase-01.validator-test-fixture.v1',
    fixturePurpose: 'VERIFY_VALIDATORS_FAIL_CLOSED',
    formalAcceptanceEligible: false,
    servicesStarted: false,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
  });
  await rebuildFixtureManifest(evidenceDirectory);

  return {
    rootDirectory,
    evidenceDirectory,
    reviewOutputDirectory,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    frozenInputs,
    authorityIdentity,
    plan,
    summary,
    summaryValidationExpectations,
    reviewerDependencies,
  };
}

export async function rebuildFixtureManifest(evidenceDirectory: string): Promise<void> {
  const names = (await collectFixtureFiles(evidenceDirectory))
    .filter((name) => name !== 'manifest.json' && name !== 'manifest.sha256')
    .sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(evidenceDirectory, name));
    return {
      path: name.replaceAll('\\', '/'),
      mediaType: fixtureMediaType(name),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }));
  const manifestBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    files,
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(evidenceDirectory, 'manifest.json'), manifestBytes, { flag: 'w' });
  await writeFile(
    join(evidenceDirectory, 'manifest.sha256'),
    `${sha256(manifestBytes)}  manifest.json\n`,
    { flag: 'w' },
  );
}

export async function fixtureTreeDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const names = [...await collectFixtureFiles(directory)]
    .sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const path = join(directory, name);
    const bytes = await readFile(path);
    const metadata = await stat(path);
    hash.update(relative(directory, path).replaceAll('\\', '/'));
    hash.update(`\0${metadata.size}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function writeFixtureProducer(input: {
  readonly producerId: AbgProducerId;
  readonly evidenceRoot: string;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly rawArtifactPath: string;
  readonly evidencePath: string;
}) {
  if (input.producerId !== 'formal-run') {
    await writeRedactedJsonArtifact(input.evidenceRoot, input.rawArtifactPath, {
      producerId: input.producerId,
      status: 'PASSED',
    });
  }
  const item = await createEvidenceItemFromFile(input.evidenceRoot, {
    artifactId: `validator-fixture-${input.producerId}-source`,
    relativePath: input.rawArtifactPath,
    mediaType: 'application/json',
    jsonPointer: '/status',
    claim: { producerId: input.producerId, status: 'PASSED' },
  });
  const outcomes = Object.fromEntries(ABG_COVERAGE_MATRIX.flatMap((entry) =>
    entry.evidenceSelectors
      .filter((selector) => selector.producerId === input.producerId)
      .map((selector) => [selector.assertionId, {
        status: 'PASSED' as const,
        description: 'Deterministic gate-specific validator-test assertion.',
        expected: { status: 'PASSED' },
        actual: { status: 'PASSED', assertionId: selector.assertionId },
      }]),
  ));
  const evidence = buildMatrixProducerEvidence({
    producerId: input.producerId,
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    startedAt: '2026-08-28T10:00:00',
    completedAt: '2026-08-28T10:00:01',
    processStatus: 'PASSED',
    commandIdentity: {
      executable: 'validator-test-fixture',
      arguments: [input.producerId],
      workingDirectory: 'repository-root',
      commandDigest: sha256(Buffer.from(`validator-test-fixture:${input.producerId}`, 'utf8')),
    },
    environmentRefs: { CI: VALIDATOR_FIXTURE_DIGEST },
    frozenInputRefs: Object.fromEntries(ABG_FROZEN_INPUT_KINDS.map((kind) => [
      kind,
      input.frozenInputs[kind],
    ])),
    defaultEvidenceItems: [item],
    defaultReferences: {
      requestIds: [`request-${input.producerId}`],
      principalIds: [`principal-${input.producerId}`],
      governanceObjectIds: [`governance-object-${input.producerId}`],
      versionIds: [`version-${input.producerId}`],
      ruleVersions: [`rule-version-${input.producerId}`],
      artifactDigests: [item.sha256],
    },
    outcomes,
  });
  return writeProducerEvidence(input.evidenceRoot, input.evidencePath, evidence);
}

async function writeFixtureFormalProducer(input: {
  readonly evidenceRoot: string;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly terminalConclusion: FormalTerminalConclusion;
}) {
  const matrix = ABG_COVERAGE_MATRIX.find((entry) => entry.gateId === 'ABG-40');
  if (matrix === undefined || matrix.assertionIds.length !== 2) {
    throw new Error('VALIDATOR_FIXTURE_ABG40_MATRIX_INVALID');
  }
  const terminalAssertionId = 'ABG-40:formal-terminal-lifecycle-complete';
  const sealAssertionId = 'ABG-40:formal-evidence-seal-eligible';
  const terminalItem = await createEvidenceItemFromFile(input.evidenceRoot, {
    artifactId: 'validator-fixture-formal-terminal-lifecycle',
    relativePath: 'runtime/terminal-conclusion.json',
    mediaType: 'application/json',
    jsonPointer: '/assertions/terminalLifecycle/status',
    claim: { assertionId: terminalAssertionId, status: 'PASSED' },
  });
  const sealItem = await createEvidenceItemFromFile(input.evidenceRoot, {
    artifactId: 'validator-fixture-formal-seal-eligibility',
    relativePath: 'runtime/terminal-conclusion.json',
    mediaType: 'application/json',
    jsonPointer: '/assertions/sealEligibility/status',
    claim: { assertionId: sealAssertionId, status: 'PASSED' },
  });
  const items = [terminalItem, sealItem] as const;
  const evidence = buildMatrixProducerEvidence({
    producerId: 'formal-run',
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    startedAt: '2026-08-28T10:00:55',
    completedAt: '2026-08-28T10:00:56',
    processStatus: 'PASSED',
    commandIdentity: {
      executable: 'validator-test-fixture',
      arguments: ['formal-run'],
      workingDirectory: 'repository-root',
      commandDigest: sha256(Buffer.from('validator-test-fixture:formal-run', 'utf8')),
    },
    environmentRefs: { CI: VALIDATOR_FIXTURE_DIGEST },
    frozenInputRefs: Object.fromEntries(ABG_FROZEN_INPUT_KINDS.map((kind) => [
      kind,
      input.frozenInputs[kind],
    ])),
    defaultEvidenceItems: items,
    defaultReferences: {
      requestIds: ['request-formal-run'],
      principalIds: ['principal-formal-run'],
      governanceObjectIds: ['governance-object-formal-run'],
      versionIds: ['version-formal-run'],
      ruleVersions: ['rule-version-formal-run'],
      artifactDigests: [...new Set(items.map((item) => item.sha256))],
    },
    outcomes: {
      [terminalAssertionId]: {
        status: 'PASSED',
        description: 'Synthetic complete post-cleanup terminal lifecycle assertion.',
        expected: input.terminalConclusion.assertions.terminalLifecycle.expected,
        actual: input.terminalConclusion.assertions.terminalLifecycle.actual,
        evidenceItems: [terminalItem],
      },
      [sealAssertionId]: {
        status: 'PASSED',
        description: 'Synthetic pre-seal eligibility assertion.',
        expected: input.terminalConclusion.assertions.sealEligibility.expected,
        actual: input.terminalConclusion.assertions.sealEligibility.actual,
        evidenceItems: [sealItem],
      },
    },
  });
  return writeProducerEvidence(
    input.evidenceRoot,
    'formal-run/producer-evidence.json',
    evidence,
  );
}

async function fixtureFileIdentity(
  evidenceDirectory: string,
  relativePath: string,
): Promise<{ readonly path: string; readonly byteLength: number; readonly sha256: string }> {
  const bytes = await readFile(join(evidenceDirectory, relativePath));
  return { path: relativePath, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function fixtureFrozenInputs(
  producerSourceManifestSha256: string,
  producerGitCommitSha: string,
  runtimeAuthority: ReturnType<typeof formalRuntimeAuthority>['authority'],
): Readonly<Record<string, string>> {
  return {
    gitCommitSha: producerGitCommitSha,
    workingTreeState: 'CLEAN',
    lockfileSha256: VALIDATOR_FIXTURE_DIGEST,
    openapiSha256: VALIDATOR_FIXTURE_DIGEST,
    migrationManifestSha256: VALIDATOR_FIXTURE_DIGEST,
    fixtureIdentity: VALIDATOR_FIXTURE_DIGEST,
    runtimeAuthoritySha256: VALIDATOR_FIXTURE_DIGEST,
    runtimeAuthoritySemanticDigest: VALIDATOR_FIXTURE_DIGEST,
    nodeVersion: 'v24.18.0',
    podmanVersion: runtimeAuthority.podman.version,
    podmanSocketPath: runtimeAuthority.podman.socketPath,
    podmanStorageDriver: runtimeAuthority.podman.storageDriver,
    podmanGraphRoot: runtimeAuthority.podman.graphRoot,
    podmanOciRuntime: runtimeAuthority.podman.ociRuntime,
    podmanNetworkBackend: runtimeAuthority.podman.networkBackend,
    podmanLogDriver: runtimeAuthority.podman.logDriver,
    podmanRestartPolicy: runtimeAuthority.podman.restartPolicy,
    postgresImage: runtimeAuthority.images.postgresql.runtimeReference,
    keycloakImage: runtimeAuthority.images.keycloak.runtimeReference,
    browserVersion: '1.61.0',
    producerSourceManifestSha256,
  } satisfies Record<(typeof ABG_FROZEN_INPUT_KINDS)[number] | 'workingTreeState', string>;
}

function fixtureSourceManifestDependencies(): SourceManifestDependencies & {
  readonly repositoryRoot: string;
} {
  const bytesByPath = new Map(VERIFICATION_SOURCE_FILES.map((entry) => [
    entry.path,
    Buffer.from(`source:${entry.path}`, 'utf8'),
  ]));
  return {
    repositoryRoot: 'validator-fixture-repository',
    repository: {
      async readState() {
        return {
          repositoryFullName: 'hospital/Hospital-DataIntelligence-Platform',
          gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
          branch: 'phase-01-acceptance-readiness',
          worktreeStatus: 'CLEAN' as const,
        };
      },
    },
    workspace: {
      async readSourceFile(_repositoryRoot, path) {
        const bytes = bytesByPath.get(path);
        return bytes === undefined
          ? { kind: 'MISSING' as const }
          : { kind: 'REGULAR' as const, bytes };
      },
    },
    git: {
      async commitExists(_repositoryRoot, commitSha) {
        return commitSha === '0123456789abcdef0123456789abcdef01234567';
      },
      async readBlob(_repositoryRoot, commitSha, path) {
        const bytes = bytesByPath.get(path);
        if (commitSha !== '0123456789abcdef0123456789abcdef01234567' || bytes === undefined) {
          return null;
        }
        return { mode: '100644', oid: fixtureGitBlobOid(bytes), bytes };
      },
    },
    clock: () => '2026-08-30T00:00:00.000Z',
  };
}

function fixtureGitBlobOid(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const header = Buffer.from(`blob ${buffer.byteLength}\0`, 'utf8');
  return createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

async function collectFixtureFiles(directory: string, prefix = ''): Promise<readonly string[]> {
  const names: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`VALIDATOR_FIXTURE_SYMLINK_FORBIDDEN:${relativePath}`);
    if (entry.isDirectory()) {
      names.push(...await collectFixtureFiles(join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      names.push(relativePath);
    }
  }
  return names;
}

async function writeFixtureJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function digestJson(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value as never), 'utf8'));
}

function fixtureMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.xml': return 'application/xml';
    case '.html': return 'text/html; charset=utf-8';
    case '.png': return 'image/png';
    case '.zip': return 'application/zip';
    default: return 'text/plain; charset=utf-8';
  }
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
