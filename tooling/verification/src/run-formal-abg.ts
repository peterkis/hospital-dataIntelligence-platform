import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  assertDistinctGateEvidenceSelectorSets,
  getAbgCoverageMatrixDigest,
  readProducerEvidenceIndex,
  validateAbgGateResult,
  type AbgGateResult,
} from './abg-gate-proof.js';
import { ABG_GATES, type AbgGateDefinition } from './abg-catalog.js';
import {
  buildAuthoritativeRunPlan,
  readFrozenInputs,
  readVerificationAuthorityIdentity,
  type AuthoritativeCommandSpec,
  type FrozenRunPlan,
  type VerificationAuthorityIdentity,
} from './authoritative-abg-plan.js';
import { getAbgCoverageEntry } from './abg-coverage-matrix.js';
import {
  buildMatrixProducerEvidence,
  parseFrozenInputRefs,
} from './evidence/adapters.js';
import {
  createEvidenceItemFromFile,
  environmentReferenceDigest,
  redactSensitiveText,
  sha256,
  writeProducerEvidence,
  writeProducerEvidenceIndex,
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import { PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION } from './evidence/protocol.js';
import {
  createFormalRunSeed,
} from './runtime/formal-runtime-contract.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';
import {
  runFormalRuntimeLifecycle,
  type FormalRuntimeContext,
  type FormalRuntimeFinalizationResult,
  type FormalRuntimeFinalOutcome,
} from './runtime/formal-runtime-controller.js';
import {
  buildFormalTerminalConclusion,
  type FormalTerminalConclusion,
} from './runtime/formal-terminal-conclusion.js';
import { validateFormalAbgSummary } from './formal-summary-validator.js';
import {
  buildProducerSourceManifest,
  sourceManifestSha256,
  verifyProducerSourceManifestStable,
  writeProducerSourceManifest,
} from './provenance/source-manifest.js';
import {
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  RUN_SUMMARY_SCHEMA_VERSION,
} from './verification-contract-versions.js';

type GateStatus = 'PASSED' | 'FAILED';

interface FormalGateResult extends AbgGateDefinition {
  readonly ordinal: number;
  readonly runId: string;
  readonly status: GateStatus;
  readonly producerExitCode: number | null;
  readonly producerCommandDigest: string;
  readonly elapsedMilliseconds: number;
  readonly proofPath: string | null;
  readonly proof: AbgGateResult | null;
  readonly failureCode?: string;
  readonly error?: string;
}

interface SetupResult {
  readonly ordinal: number;
  readonly commandDigest: string;
  readonly exitCode: number | null;
  readonly elapsedMilliseconds: number;
}

interface PreCleanupExecutionState {
  readonly startedAt: string;
  readonly planDigest: string;
  readonly frozenInputsDigest: string;
  readonly setupStatus: GateStatus;
  readonly setupResults: readonly SetupResult[];
  readonly nonFormalResults: readonly FormalGateResult[];
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';
const runSequence = parsePositiveInteger(requireEnvironment('ABG_RUN_SEQUENCE'), 'ABG_RUN_SEQUENCE_INVALID');
const requestedOutputDirectory = resolve(requireEnvironment('EVIDENCE_OUTPUT_DIR'));
const run = createFormalRunSeed(runSequence);
let outputDirectory = requestedOutputDirectory;
let plan: FrozenRunPlan | undefined;
let runId = run.runId;
let startedAt = '';
let frozenInputsDigest = '';
let activeContext: FormalRuntimeContext | undefined;
const producerSourceManifest = await buildProducerSourceManifest(repositoryRoot);
const producerSourceManifestSha256 = sourceManifestSha256(producerSourceManifest);

const lifecycle = await runFormalRuntimeLifecycle<PreCleanupExecutionState, Record<string, unknown>>({
  repositoryRoot,
  outputDirectory: requestedOutputDirectory,
  run,
  producerSourceManifestSha256,
}, {
  executeBeforeCleanup: executeFormalAbgBeforeCleanup,
  async persistEvidenceBeforeCleanup(context, outcome) {
    const names = (await collectFiles(context.outputDirectory))
      .map((name) => name.replaceAll('\\', '/'))
      .filter(isProducerOrCommandEvidence)
      .sort((left, right) => left.localeCompare(right));
    const files = await Promise.all(names.map(async (name) => {
      const bytes = await readFile(join(context.outputDirectory, name));
      return { path: name, byteLength: bytes.byteLength, sha256: sha256(bytes) };
    }));
    const producerProtocolEvidence = files.filter((file) =>
      file.path.endsWith('/producer-evidence.json') ||
      file.path.endsWith('/producer-evidence-index.json') ||
      file.path === 'producer-evidence-index.json',
    );
    await writeExclusive(join(context.outputDirectory, 'runtime', 'producer-evidence-snapshot.json'), {
      schemaVersion: 'phase-01.formal-producer-evidence-snapshot.v1',
      runIdentity: context.identity,
      statusBeforeCleanup: outcome.status,
      failureCodes: outcome.failureCodes,
      discoveredEvidence: files,
      discoveredEvidenceCount: files.length,
      producerProtocolEvidence,
      producerProtocolEvidenceCount: producerProtocolEvidence.length,
      absenceIsNotSuccess: producerProtocolEvidence.length === 0,
      recordedAt: localNow(),
    });
    if (producerProtocolEvidence.length === 0) {
      throw new Error('FORMAL_PRODUCER_EVIDENCE_UNAVAILABLE_BEFORE_CLEANUP');
    }
  },
  finalizeAfterCleanup: finalizeFormalAbgAfterCleanup,
  async sealEvidence(context) {
    await writeManifest(context.outputDirectory);
  },
});

process.stdout.write(`${JSON.stringify({
  runId: lifecycle.identity.runId,
  runSequence: lifecycle.identity.runSequence,
  gitCommitSha: lifecycle.identity.gitCommitSha,
  runtimeNamespace: lifecycle.identity.runtimeNamespace,
  status: lifecycle.status,
  evidenceDirectory: lifecycle.outputDirectoryCreated ? requestedOutputDirectory : null,
})}\n`);
if (lifecycle.status !== 'PASSED') throw new Error('FORMAL_ABG_RUN_FAILED');

async function executeFormalAbgBeforeCleanup(
  context: FormalRuntimeContext,
): Promise<{
  readonly passed: boolean;
  readonly value: PreCleanupExecutionState;
  readonly failureCode?: string;
}> {
  process.env['TZ'] = context.runtimeAuthority.authority.host.timezone;
  process.env['DOCKER_HOST'] =
    context.runtimeAuthority.authority.dockerExclusion.allowedCompatibilityEnvironment.DOCKER_HOST;
  activeContext = context;
  outputDirectory = context.outputDirectory;
  runId = context.identity.runId;
  startedAt = localNow();
  if (producerSourceManifest.producerGitCommitSha !== context.identity.gitCommitSha) {
    throw new Error('FORMAL_PREFLIGHT_GIT_COMMIT_DRIFT');
  }
  const producerSourceManifestWrite = await writeProducerSourceManifest(
    outputDirectory,
    producerSourceManifest,
  );
  if (producerSourceManifestWrite.sha256 !== producerSourceManifestSha256) {
    throw new Error('FORMAL_PREFLIGHT_PRODUCER_SOURCE_MANIFEST_DRIFT');
  }
  const frozenPlan = await buildAuthoritativeRunPlan(
    repositoryRoot,
    context.identity.runSequence,
    {
      path: producerSourceManifestWrite.relativePath,
      sha256: producerSourceManifestWrite.sha256,
      producerGitCommitSha: producerSourceManifest.producerGitCommitSha,
    },
  );
  plan = frozenPlan;
  if (
    frozenPlan.runtimeAuthoritySha256 !== context.runtimeAuthority.runtimeAuthoritySha256 ||
    frozenPlan.runtimeAuthoritySemanticDigest !==
      context.runtimeAuthority.runtimeAuthoritySemanticDigest
  ) {
    throw new Error('FORMAL_RUNTIME_AUTHORITY_DRIFT_BEFORE_EXECUTION');
  }
  if (frozenPlan.frozenInputs['gitCommitSha'] !== context.identity.gitCommitSha) {
    throw new Error('FORMAL_PREFLIGHT_GIT_COMMIT_DRIFT');
  }
  const planBytes = Buffer.from(`${JSON.stringify(frozenPlan, null, 2)}\n`, 'utf8');
  const planDigest = sha256(planBytes);
  frozenInputsDigest = sha256(Buffer.from(canonicalJson(frozenPlan.frozenInputs), 'utf8'));
  await writeExclusiveBytes(join(outputDirectory, 'run-plan.json'), planBytes);

  const setupResults: SetupResult[] = [];
  let setupFailure: string | null = null;
  for (const [index, command] of frozenPlan.setupCommands.entries()) {
    context.throwIfAborted();
    const execution = await executeCommand(
      command,
      join(outputDirectory, 'setup', String(index + 1).padStart(2, '0')),
      {
        ABG_RUN_ID: runId,
        ABG_RUN_SEQUENCE: String(frozenPlan.runSequence),
        ABG_RUNTIME_NAMESPACE: context.identity.runtimeNamespace,
        DOCKER_HOST:
          context.runtimeAuthority.authority.dockerExclusion.allowedCompatibilityEnvironment.DOCKER_HOST,
        TESTCONTAINERS_RYUK_DISABLED: 'true',
        ABG_FROZEN_INPUTS_DIGEST: frozenInputsDigest,
        ABG_FROZEN_INPUTS_JSON: canonicalJson(frozenPlan.frozenInputs),
        ABG_SHARED_EVIDENCE_DIR: join(outputDirectory, 'shared'),
        ABG_RUNTIME_EVENT_DIR: context.runtimeEventDirectory,
      },
    );
    setupResults.push({
      ordinal: index + 1,
      commandDigest: commandDigest(command),
      exitCode: execution.exitCode,
      elapsedMilliseconds: execution.elapsedMilliseconds,
    });
    if (execution.exitCode !== 0) {
      setupFailure = 'SETUP_COMMAND_FAILED:' + String(index + 1);
      break;
    }
  }

  if (setupFailure === null) {
    try {
      assertFrozenInputsEqual(
        frozenPlan.frozenInputs,
        await readFrozenInputs(repositoryRoot, frozenPlan.producerSourceManifestSha256),
      );
      assertAuthorityIdentityEqual(
        frozenPlan.authorityIdentity,
        await readVerificationAuthorityIdentity(repositoryRoot),
      );
      if (!await verifyProducerSourceManifestStable(
        outputDirectory,
        frozenPlan.producerSourceManifestSha256,
      )) throw new Error('FORMAL_SETUP_PRODUCER_SOURCE_MANIFEST_DRIFT');
    } catch (error) {
      setupFailure = errorMessage(error);
    }
  }

  const results: FormalGateResult[] = [];
  const nonFormalGates = ABG_GATES.filter((gate) => gate.gateId !== 'ABG-40');
  for (const gate of nonFormalGates) {
    const ordinal = ordinalFor(gate);
    if (setupFailure !== null) {
      results.push(failedGate(gate, ordinal, runId, commandDigestForGate(gate), setupFailure));
      continue;
    }
    context.throwIfAborted();
    results.push(await executeGate({
      gate,
      ordinal,
      runId,
      runSequence: frozenPlan.runSequence,
      producerEvidenceIndexRelativePath: 'shared/producer-evidence-index.json',
      coverageMatrixDigest: frozenPlan.authorityIdentity.coverageMatrixDigest,
    }));
  }
  results.sort((left, right) => left.ordinal - right.ordinal);
  const passed = setupFailure === null && results.length === 39 &&
    results.every((result) => result.status === 'PASSED');
  return {
    passed,
    value: {
      startedAt,
      planDigest,
      frozenInputsDigest,
      setupStatus: setupFailure === null ? 'PASSED' : 'FAILED',
      setupResults,
      nonFormalResults: results,
    },
    ...(passed ? {} : { failureCode: 'FORMAL_NON_TERMINAL_GATE_OR_SETUP_FAILED' }),
  };
}

async function finalizeFormalAbgAfterCleanup(
  context: FormalRuntimeContext,
  outcome: FormalRuntimeFinalOutcome<PreCleanupExecutionState>,
): Promise<FormalRuntimeFinalizationResult<Record<string, unknown>>> {
  const frozenPlan = plan;
  const execution = outcome.execution?.value;
  let frozenInputsStableAfterCleanup = false;
  let authorityIdentityStableAfterCleanup = false;
  let runtimeAuthorityStableAfterCleanup = false;
  let producerSourceManifestStableAfterCleanup = false;
  if (frozenPlan !== undefined) {
    try {
      assertFrozenInputsEqual(
        frozenPlan.frozenInputs,
        await readFrozenInputs(repositoryRoot, frozenPlan.producerSourceManifestSha256),
      );
      frozenInputsStableAfterCleanup = true;
    } catch {
      frozenInputsStableAfterCleanup = false;
    }
    try {
      assertAuthorityIdentityEqual(
        frozenPlan.authorityIdentity,
        await readVerificationAuthorityIdentity(repositoryRoot),
      );
      authorityIdentityStableAfterCleanup = true;
    } catch {
      authorityIdentityStableAfterCleanup = false;
    }
    try {
      const observedRuntimeAuthority = loadPodmanRuntimeAuthority(repositoryRoot);
      runtimeAuthorityStableAfterCleanup =
        outcome.runtimeAuthorityStableAfterCleanup &&
        observedRuntimeAuthority.runtimeAuthoritySha256 === frozenPlan.runtimeAuthoritySha256 &&
        observedRuntimeAuthority.runtimeAuthoritySemanticDigest ===
          frozenPlan.runtimeAuthoritySemanticDigest;
    } catch {
      runtimeAuthorityStableAfterCleanup = false;
    }
    producerSourceManifestStableAfterCleanup = await verifyProducerSourceManifestStable(
      context.outputDirectory,
      frozenPlan.producerSourceManifestSha256,
    );
  }

  const producerProtocolEvidenceCount = await readProducerProtocolEvidenceCount(context.outputDirectory);
  const nonFormalResults = execution?.nonFormalResults ?? ABG_GATES.slice(0, 39).map((gate) =>
    failedGate(
      gate,
      ordinalFor(gate),
      context.identity.runId,
      safeCommandDigestForGate(gate),
      'FORMAL_NON_TERMINAL_EXECUTION_MISSING',
    ),
  );
  const terminalConclusion = buildFormalTerminalConclusion({
    runIdentity: context.identity,
    startedAt: execution?.startedAt ?? outcome.preflight.startedAt,
    completedAt: localNow(),
    preflightStatus: outcome.preflight.status,
    setupStatus: execution?.setupStatus ?? 'FAILED',
    nonFormalGateResults: nonFormalResults,
    producerEvidencePersistedBeforeCleanup: outcome.producerEvidencePersistedBeforeCleanup,
    producerProtocolEvidenceCount,
    cleanup: outcome.cleanup,
    finalResources: outcome.finalResources,
    frozenInputsStableAfterCleanup,
    authorityIdentityStableAfterCleanup,
    runtimeAuthoritySha256:
      frozenPlan?.runtimeAuthoritySha256 ?? context.runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest:
      frozenPlan?.runtimeAuthoritySemanticDigest ??
        context.runtimeAuthority.runtimeAuthoritySemanticDigest,
    runtimeAuthorityStableAfterCleanup,
    producerSourceManifestSha256:
      frozenPlan?.producerSourceManifestSha256 ?? producerSourceManifestSha256,
    producerSourceManifestStableAfterCleanup,
    outputDirectoryExclusive: outcome.outputDirectoryExclusive,
    failureCodes: outcome.failureCodes,
  });
  await writeExclusive(
    join(context.outputDirectory, 'runtime', 'terminal-conclusion.json'),
    terminalConclusion,
  );

  const formalGate = ABG_GATES.find((gate) => gate.gateId === 'ABG-40');
  if (formalGate === undefined) throw new Error('ABG_FORMAL_GATE_MISSING');
  let formalResult: FormalGateResult;
  if (frozenPlan === undefined || execution === undefined) {
    formalResult = failedGate(
      formalGate,
      ordinalFor(formalGate),
      context.identity.runId,
      safeCommandDigestForGate(formalGate),
      'FORMAL_TERMINAL_PREREQUISITE_MISSING',
    );
  } else {
    try {
      await writeFormalProducerEvidence(
        terminalConclusion,
        nonFormalResults,
        frozenPlan.authorityIdentity,
      );
      formalResult = await executeGate({
        gate: formalGate,
        ordinal: ordinalFor(formalGate),
        runId: context.identity.runId,
        runSequence: frozenPlan.runSequence,
        producerEvidenceIndexRelativePath: 'producer-evidence-index.json',
        coverageMatrixDigest: frozenPlan.authorityIdentity.coverageMatrixDigest,
      });
    } catch (error) {
      formalResult = failedGate(
        formalGate,
        ordinalFor(formalGate),
        context.identity.runId,
        safeCommandDigestForGate(formalGate),
        'FORMAL_TERMINAL_EVIDENCE_FAILED',
        error,
      );
    }
  }

  const results = [...nonFormalResults, formalResult]
    .sort((left, right) => left.ordinal - right.ordinal);
  let selectorSetsDistinct = false;
  try {
    const proofs = results.map((result) => result.proof).filter(
      (proof): proof is AbgGateResult => proof !== null,
    );
    if (proofs.length === ABG_GATES.length) {
      assertDistinctGateEvidenceSelectorSets(proofs);
      selectorSetsDistinct = true;
    }
  } catch {
    selectorSetsDistinct = false;
  }

  const nonFormalGateStatus = nonFormalResults.length === 39 &&
    nonFormalResults.every((result) => result.status === 'PASSED')
    ? 'PASSED'
    : 'FAILED';
  const producerEvidenceStatus = terminalConclusion.producerEvidencePersistedBeforeCleanup &&
    terminalConclusion.producerProtocolEvidenceCount > 0
    ? 'PASSED'
    : 'FAILED';
  const lifecycleStatus = terminalConclusion.status;
  const passed = lifecycleStatus === 'PASSED' &&
    selectorSetsDistinct &&
    results.length === ABG_GATES.length &&
    results.every((result) => result.status === 'PASSED');
  const summaryStatus: GateStatus = passed ? 'PASSED' : 'FAILED';
  const summaryFailureCodes = passed ? [] : unique([
    ...terminalConclusion.failureCodes,
    ...(selectorSetsDistinct ? [] : ['FORMAL_GATE_SELECTOR_SETS_NOT_DISTINCT']),
    ...results.flatMap((result) => result.status === 'FAILED'
      ? [result.failureCode ?? 'FORMAL_GATE_FAILED']
      : []),
  ]);
  const summary = {
    schemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
    runId: context.identity.runId,
    runSequence: context.identity.runSequence,
    gitCommitSha: context.identity.gitCommitSha,
    runtimeNamespace: context.identity.runtimeNamespace,
    planDigest: execution?.planDigest ?? null,
    frozenInputs: frozenPlan?.frozenInputs ?? {},
    frozenInputsDigest: execution?.frozenInputsDigest ?? null,
    coverageMatrixDigest: frozenPlan?.authorityIdentity.coverageMatrixDigest ?? null,
    producerProtocolIdentityDigest:
      frozenPlan?.authorityIdentity.producerProtocolIdentityDigest ?? null,
    authorityIdentity: frozenPlan?.authorityIdentity ?? null,
    runtimeAuthoritySha256:
      frozenPlan?.runtimeAuthoritySha256 ?? context.runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest:
      frozenPlan?.runtimeAuthoritySemanticDigest ??
        context.runtimeAuthority.runtimeAuthoritySemanticDigest,
    producerSourceManifestSha256:
      frozenPlan?.producerSourceManifestSha256 ?? producerSourceManifestSha256,
    preflightStatus: outcome.preflight.status,
    setupStatus: execution?.setupStatus ?? 'FAILED',
    nonFormalGateStatus,
    producerEvidenceStatus,
    producerEvidencePersistedBeforeCleanup:
      terminalConclusion.producerEvidencePersistedBeforeCleanup,
    producerProtocolEvidenceCount: terminalConclusion.producerProtocolEvidenceCount,
    cleanupStatus: terminalConclusion.cleanupStatus,
    residualResourceCount: terminalConclusion.residualResourceCount,
    residualContainerCount: terminalConclusion.residualContainerCount,
    residualVolumeCount: terminalConclusion.residualVolumeCount,
    residualNetworkCount: terminalConclusion.residualNetworkCount,
    occupiedRequiredPorts: terminalConclusion.occupiedRequiredPorts,
    requiredPortsObserved: terminalConclusion.requiredPortsObserved,
    pruneCommandsInvoked: terminalConclusion.pruneCommandsInvoked,
    frozenInputsStableAfterCleanup,
    authorityIdentityStableAfterCleanup,
    runtimeAuthorityStableAfterCleanup,
    producerSourceManifestStableAfterCleanup,
    outputDirectoryExclusive: outcome.outputDirectoryExclusive,
    terminalConclusionStatus: terminalConclusion.status,
    sealEligibilityStatus: terminalConclusion.assertions.sealEligibility.status,
    lifecycleStatus,
    selectorSetsDistinct,
    status: summaryStatus,
    failureCodes: summaryFailureCodes,
    startedAt: execution?.startedAt ?? outcome.preflight.startedAt,
    completedAt: localNow(),
    timezone: 'Asia/Shanghai',
    setupResults: execution?.setupResults ?? [],
    gateCount: results.length,
    passedCount: results.filter((result) => result.status === 'PASSED').length,
    failedCount: results.filter((result) => result.status === 'FAILED').length,
    conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
    results,
  };
  if (passed && frozenPlan !== undefined && execution !== undefined) {
    validateFormalAbgSummary(summary, {
      runSequence: frozenPlan.runSequence,
      planDigest: execution.planDigest,
      frozenInputs: frozenPlan.frozenInputs,
      frozenInputsDigest: execution.frozenInputsDigest,
      coverageMatrixDigest: frozenPlan.authorityIdentity.coverageMatrixDigest,
      producerProtocolIdentityDigest: frozenPlan.authorityIdentity.producerProtocolIdentityDigest,
      producerSourceManifestSha256: frozenPlan.producerSourceManifestSha256,
      setupCommandDigests: frozenPlan.setupCommands.map(commandDigest),
    });
  }
  await writeExclusive(join(context.outputDirectory, 'abg-results.json'), summary);
  return {
    status: summaryStatus,
    terminalConclusionStatus: terminalConclusion.status,
    sealEligibilityStatus: terminalConclusion.assertions.sealEligibility.status,
    producerSourceManifestSha256: terminalConclusion.producerSourceManifestSha256,
    failureCodes: summaryFailureCodes,
    value: summary,
  };
}

async function executeGate(input: {
  readonly gate: AbgGateDefinition;
  readonly ordinal: number;
  readonly runId: string;
  readonly runSequence: number;
  readonly producerEvidenceIndexRelativePath: string;
  readonly coverageMatrixDigest: string;
}): Promise<FormalGateResult> {
  const command = commandForGate(input.gate);
  const producerCommandDigest = commandDigest(command);
  const gateDirectory = join(outputDirectory, 'gates', input.gate.gateId);
  const resultRelativePath = 'gates/' + input.gate.gateId + '/producer/result.json';
  const resultPath = join(outputDirectory, resultRelativePath);
  const execution = await executeCommand(command, gateDirectory, {
    ABG_RUN_ID: input.runId,
    ABG_RUN_SEQUENCE: String(input.runSequence),
    ABG_GATE_ID: input.gate.gateId,
    ABG_GATE_RESULT_PATH: resultPath,
    ABG_FORMAL_EVIDENCE_ROOT: outputDirectory,
    ABG_PRODUCER_EVIDENCE_INDEX_PATH: input.producerEvidenceIndexRelativePath,
  });
  try {
    if (execution.exitCode !== 0) {
      throw new Error('PRODUCER_EXIT_' + String(execution.exitCode ?? 'SIGNAL'));
    }
    const proof = await validateAbgGateResult({
      value: JSON.parse(await readFile(resultPath, 'utf8')) as unknown,
      evidenceRoot: outputDirectory,
      expectedGateId: input.gate.gateId,
      expectedRunId: input.runId,
      expectedRunSequence: input.runSequence,
      expectedCoverageMatrixDigest: input.coverageMatrixDigest,
    });
    return {
      ...input.gate,
      ordinal: input.ordinal,
      runId: input.runId,
      status: 'PASSED',
      producerExitCode: execution.exitCode,
      producerCommandDigest,
      elapsedMilliseconds: execution.elapsedMilliseconds,
      proofPath: resultRelativePath,
      proof,
    };
  } catch (error) {
    return failedGate(
      input.gate,
      input.ordinal,
      input.runId,
      producerCommandDigest,
      'GATE_EXECUTION_FAILED',
      error,
      execution.exitCode,
      execution.elapsedMilliseconds,
    );
  }
}

async function writeFormalProducerEvidence(
  terminalConclusion: FormalTerminalConclusion,
  priorResults: readonly FormalGateResult[],
  authorityIdentity: VerificationAuthorityIdentity,
): Promise<void> {
  const formalEntry = getAbgCoverageEntry('ABG-40');
  const scenarioId = formalEntry.scenarioIds[0];
  const terminalLifecycleAssertionId = formalEntry.assertionIds.find((assertionId) =>
    assertionId === 'ABG-40:formal-terminal-lifecycle-complete',
  );
  const sealEligibilityAssertionId = formalEntry.assertionIds.find((assertionId) =>
    assertionId === 'ABG-40:formal-evidence-seal-eligible',
  );
  if (
    scenarioId === undefined ||
    terminalLifecycleAssertionId === undefined ||
    sealEligibilityAssertionId === undefined
  ) {
    throw new Error('FORMAL_TERMINAL_MATRIX_INVALID');
  }
  const terminalLifecycleItem = await createEvidenceItemFromFile(outputDirectory, {
    artifactId: 'phase-01-formal-terminal-lifecycle-conclusion',
    relativePath: 'runtime/terminal-conclusion.json',
    mediaType: 'application/json',
    jsonPointer: '/assertions/terminalLifecycle/status',
    claim: {
      runIdentity: { ...terminalConclusion.runIdentity },
      assertionId: terminalLifecycleAssertionId,
      status: terminalConclusion.assertions.terminalLifecycle.status,
    },
  });
  const sealEligibilityItem = await createEvidenceItemFromFile(outputDirectory, {
    artifactId: 'phase-01-formal-evidence-seal-eligibility',
    relativePath: 'runtime/terminal-conclusion.json',
    mediaType: 'application/json',
    jsonPointer: '/assertions/sealEligibility/status',
    claim: {
      runIdentity: { ...terminalConclusion.runIdentity },
      assertionId: sealEligibilityAssertionId,
      status: terminalConclusion.assertions.sealEligibility.status,
    },
  });
  const terminalItems = [terminalLifecycleItem, sealEligibilityItem] as const;
  const references = aggregateFormalReferences(
    priorResults,
    unique(terminalItems.map((item) => item.sha256)),
  );
  const evidence = buildMatrixProducerEvidence({
    producerId: 'formal-run',
    runId,
    runSequence: terminalConclusion.runIdentity.runSequence,
    startedAt,
    completedAt: localNow(),
    processStatus: terminalConclusion.status,
    commandIdentity: {
      executable: 'node',
      arguments: ['tooling/verification/src/run-formal-abg.ts'],
      workingDirectory: 'repository-root',
      commandDigest: sha256(Buffer.from('tooling/verification/src/run-formal-abg.ts', 'utf8')),
    },
    environmentRefs: environmentReferenceDigest(process.env, ['CI', 'NODE_ENV', 'TZ']),
    frozenInputRefs: parseFrozenInputRefs(plan?.frozenInputs),
    defaultEvidenceItems: terminalItems,
    scenarioReferences: { [scenarioId]: references },
    outcomes: {
      [terminalLifecycleAssertionId]: {
        status: terminalConclusion.assertions.terminalLifecycle.status,
        description: 'The formal run reached a complete post-cleanup terminal lifecycle state.',
        expected: terminalConclusion.assertions.terminalLifecycle.expected,
        actual: terminalConclusion.assertions.terminalLifecycle.actual,
        ...(terminalConclusion.assertions.terminalLifecycle.status === 'PASSED'
          ? {}
          : {
            failureCode: terminalConclusion.assertions.terminalLifecycle.failureCodes[0] ??
              'FORMAL_TERMINAL_LIFECYCLE_FAILED',
          }),
        evidenceItems: [terminalLifecycleItem],
      },
      [sealEligibilityAssertionId]: {
        status: terminalConclusion.assertions.sealEligibility.status,
        description: 'The post-cleanup evidence package is eligible for runner-side manifest sealing.',
        expected: terminalConclusion.assertions.sealEligibility.expected,
        actual: terminalConclusion.assertions.sealEligibility.actual,
        ...(terminalConclusion.assertions.sealEligibility.status === 'PASSED'
          ? {}
          : {
            failureCode: terminalConclusion.assertions.sealEligibility.failureCodes[0] ??
              'FORMAL_SEAL_ELIGIBILITY_FAILED',
          }),
        evidenceItems: [sealEligibilityItem],
      },
    },
  });
  const formalIndexEntry = await writeProducerEvidence(
    outputDirectory,
    'formal-run/producer-evidence.json',
    evidence,
  );
  const sharedIndex = await readProducerEvidenceIndex(
    outputDirectory,
    'shared/producer-evidence-index.json',
  );
  if (
    sharedIndex.index.runId !== runId ||
    sharedIndex.index.runSequence !== terminalConclusion.runIdentity.runSequence
  ) {
    throw new Error('FORMAL_TERMINAL_SHARED_INDEX_RUN_MISMATCH');
  }
  await writeProducerEvidenceIndex(outputDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId,
    runSequence: terminalConclusion.runIdentity.runSequence,
    producers: [
      ...sharedIndex.index.producers.map((entry) => ({
        ...entry,
        relativePath: 'shared/' + entry.relativePath,
      })),
      formalIndexEntry,
    ],
  });
}

async function executeCommand(
  command: AuthoritativeCommandSpec,
  evidenceDirectory: string,
  injectedEnvironment: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number | null; readonly elapsedMilliseconds: number }> {
  await mkdir(evidenceDirectory, { recursive: true });
  const started = performance.now();
  const workingDirectory = resolveInsideRepository(command.workingDirectory ?? '.');
  const child = spawn(command.executable, [...command.args], {
    cwd: workingDirectory,
    env: { ...process.env, ...command.environment, ...injectedEnvironment },
    shell: false,
    windowsHide: true,
  });
  const untrack = activeContext?.trackChild(child);
  let forceKill: NodeJS.Timeout | undefined;
  const abort = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      forceKill.unref();
    }
  };
  activeContext?.signal.addEventListener('abort', abort, { once: true });
  if (activeContext?.signal.aborted === true) abort();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const completion = await new Promise<{
    readonly exitCode: number | null;
    readonly spawnError: Error | null;
  }>((resolveExit) => {
    child.once('error', (error) => resolveExit({ exitCode: null, spawnError: error }));
    child.once('close', (exitCode) => resolveExit({ exitCode, spawnError: null }));
  });
  try {
    await Promise.all([
      writeRedactedTextArtifact(evidenceDirectory, 'stdout.log', Buffer.concat(stdout).toString('utf8')),
      writeRedactedTextArtifact(evidenceDirectory, 'stderr.log', Buffer.concat(stderr).toString('utf8')),
    ]);
  } finally {
    if (forceKill !== undefined) clearTimeout(forceKill);
    activeContext?.signal.removeEventListener('abort', abort);
    untrack?.();
  }
  if (completion.spawnError !== null) throw completion.spawnError;
  activeContext?.throwIfAborted();
  return {
    exitCode: completion.exitCode,
    elapsedMilliseconds: Math.round(performance.now() - started),
  };
}

function commandForGate(gate: AbgGateDefinition): AuthoritativeCommandSpec {
  const command = plan?.gates.find((candidate) => candidate.gateId === gate.gateId);
  if (command === undefined) throw new Error('ABG_PLAN_GATE_MISSING:' + gate.gateId);
  return command;
}

function commandDigestForGate(gate: AbgGateDefinition): string {
  return commandDigest(commandForGate(gate));
}

function safeCommandDigestForGate(gate: AbgGateDefinition): string {
  try {
    return commandDigestForGate(gate);
  } catch {
    return sha256(Buffer.from(`unavailable-formal-command:${gate.gateId}`, 'utf8'));
  }
}

function ordinalFor(gate: AbgGateDefinition): number {
  const ordinal = ABG_GATES.findIndex((candidate) => candidate.gateId === gate.gateId);
  if (ordinal === -1) throw new Error('ABG_CATALOG_GATE_MISSING:' + gate.gateId);
  return ordinal + 1;
}

function failedGate(
  gate: AbgGateDefinition,
  ordinal: number,
  failedRunId: string,
  producerCommandDigest: string,
  failureCode: string,
  error?: unknown,
  producerExitCode: number | null = null,
  elapsedMilliseconds = 0,
): FormalGateResult {
  const message = error === undefined ? undefined : redactSensitiveText(errorMessage(error));
  return {
    ...gate,
    ordinal,
    runId: failedRunId,
    status: 'FAILED',
    producerExitCode,
    producerCommandDigest,
    elapsedMilliseconds,
    proofPath: null,
    proof: null,
    failureCode,
    ...(message === undefined ? {} : { error: message }),
  };
}

async function writeManifest(directory: string): Promise<void> {
  const names = (await collectFiles(directory))
    .filter((name) => !['manifest.json', 'manifest.sha256'].includes(name))
    .sort((left, right) => left.localeCompare(right));
  for (const requiredProvenancePath of [
    'provenance/producer-source-manifest.json',
    'provenance/producer-source-manifest.sha256',
  ]) {
    if (!names.map((name) => name.replaceAll('\\', '/')).includes(requiredProvenancePath)) {
      throw new Error('ABG_MANIFEST_REQUIRED_PROVENANCE_MISSING:' + requiredProvenancePath);
    }
  }
  const files = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(directory, name));
    return {
      path: name.replaceAll('\\', '/'),
      mediaType: mediaType(name),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }));
  await writeExclusive(join(directory, 'manifest.json'), {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    files,
  });
  const digest = sha256(await readFile(join(directory, 'manifest.json')));
  await writeFile(join(directory, 'manifest.sha256'), `${digest}  manifest.json\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o400,
  });
}

async function collectFiles(directory: string, prefix = ''): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('ABG_MANIFEST_SYMLINK_FORBIDDEN:' + relativePath);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function writeExclusiveBytes(path: string, value: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: 'wx', mode: 0o400 });
}

function commandDigest(command: AuthoritativeCommandSpec): string {
  return sha256(Buffer.from(canonicalJson(command), 'utf8'));
}

function resolveInsideRepository(path: string): string {
  const resolved = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('ABG_COMMAND_WORKDIR_OUTSIDE_REPOSITORY');
  }
  return resolved;
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.xml': return 'application/xml';
    case '.html': return 'text/html; charset=utf-8';
    case '.png': return 'image/png';
    case '.zip': return 'application/zip';
    default: return 'text/plain; charset=utf-8';
  }
}

function isProducerOrCommandEvidence(path: string): boolean {
  const name = path.replaceAll('\\', '/');
  return name.startsWith('setup/') ||
    name.startsWith('shared/raw/') ||
    name.includes('/producer/') ||
    name.endsWith('/stdout.log') ||
    name.endsWith('/stderr.log') ||
    name.endsWith('/producer-evidence.json') ||
    name.endsWith('/producer-evidence-index.json');
}

function localNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function parsePositiveInteger(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function assertFrozenInputsEqual(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new Error('ABG_FROZEN_INPUT_DRIFT');
}

function assertAuthorityIdentityEqual(
  expected: VerificationAuthorityIdentity,
  actual: VerificationAuthorityIdentity,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error('ABG_AUTHORITY_IDENTITY_DRIFT');
  }
  if (actual.coverageMatrixDigest !== getAbgCoverageMatrixDigest()) {
    throw new Error('ABG_COVERAGE_MATRIX_RUNTIME_DIGEST_DRIFT');
  }
}

function aggregateFormalReferences(
  results: readonly FormalGateResult[],
  artifactDigests: readonly string[],
): {
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly artifactDigests: readonly string[];
} {
  const proofs = results.map((result) => result.proof).filter(
    (proof): proof is AbgGateResult => proof !== null,
  );
  return {
    requestIds: unique(proofs.flatMap((proof) => proof.requestIds)),
    principalIds: unique(proofs.flatMap((proof) => proof.principalIds)),
    governanceObjectIds: unique(proofs.flatMap((proof) => proof.governanceObjectIds)),
    versionIds: unique(proofs.flatMap((proof) => proof.versionIds)),
    ruleVersions: unique(proofs.flatMap((proof) => proof.ruleVersions)),
    artifactDigests,
  };
}

async function readProducerProtocolEvidenceCount(directory: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(
      join(directory, 'runtime', 'producer-evidence-snapshot.json'),
      'utf8',
    )) as unknown;
    if (!isRecord(value)) return 0;
    const count = value['producerProtocolEvidenceCount'];
    return Number.isSafeInteger(count) && Number(count) > 0 ? Number(count) : 0;
  } catch {
    return 0;
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
