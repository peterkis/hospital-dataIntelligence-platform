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
import {
  runFormalRuntimeLifecycle,
  type FormalRuntimeContext,
} from './runtime/formal-runtime-controller.js';
import { validateFormalAbgSummary } from './formal-summary-validator.js';

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

process.env['TZ'] = 'Asia/Shanghai';
process.env['DOCKER_HOST'] = 'unix:///run/podman/podman.sock';
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const runSequence = parsePositiveInteger(requireEnvironment('ABG_RUN_SEQUENCE'), 'ABG_RUN_SEQUENCE_INVALID');
const requestedOutputDirectory = resolve(requireEnvironment('EVIDENCE_OUTPUT_DIR'));
const run = createFormalRunSeed(runSequence);
let outputDirectory = requestedOutputDirectory;
let plan: FrozenRunPlan;
let runId = run.runId;
let startedAt = '';
let frozenInputsDigest = '';
let activeContext: FormalRuntimeContext | undefined;

const lifecycle = await runFormalRuntimeLifecycle<Record<string, unknown>>({
  repositoryRoot,
  outputDirectory: requestedOutputDirectory,
  run,
}, {
  execute: executeFormalAbg,
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
  async writeFinalEvidence(context, outcome) {
    const base = outcome.execution?.value ?? {
      schemaVersion: 'phase-01.abg-run.v3',
      runId: context.identity.runId,
      runSequence: context.identity.runSequence,
      planDigest: null,
      frozenInputs: {},
      frozenInputsDigest: null,
      coverageMatrixDigest: null,
      producerProtocolIdentityDigest: null,
      authorityIdentity: null,
      frozenInputsStable: false,
      authorityIdentityStable: false,
      selectorSetsDistinct: false,
      status: 'FAILED',
      startedAt: outcome.preflight.startedAt,
      completedAt: localNow(),
      timezone: 'Asia/Shanghai',
      setupResults: [],
      gateCount: 0,
      passedCount: 0,
      failedCount: 0,
      conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
      results: [],
    };
    await writeExclusive(join(context.outputDirectory, 'abg-results.json'), {
      ...base,
      runId: context.identity.runId,
      runSequence: context.identity.runSequence,
      gitCommitSha: context.identity.gitCommitSha,
      runtimeNamespace: context.identity.runtimeNamespace,
      runtimeStatusBeforeManifest: outcome.status,
      runtimeFailureCodesBeforeManifest: outcome.failureCodes,
      cleanupStatus: outcome.cleanup.status,
      completedAt: localNow(),
    });
  },
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

async function executeFormalAbg(
  context: FormalRuntimeContext,
): Promise<{
  readonly passed: boolean;
  readonly value: Record<string, unknown>;
  readonly failureCode?: string;
}> {
  activeContext = context;
  outputDirectory = context.outputDirectory;
  runId = context.identity.runId;
  startedAt = localNow();
  plan = await buildAuthoritativeRunPlan(repositoryRoot, context.identity.runSequence);
  if (plan.frozenInputs['gitCommitSha'] !== context.identity.gitCommitSha) {
    throw new Error('FORMAL_PREFLIGHT_GIT_COMMIT_DRIFT');
  }
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  const planDigest = sha256(planBytes);
  frozenInputsDigest = sha256(Buffer.from(canonicalJson(plan.frozenInputs), 'utf8'));
  await writeExclusiveBytes(join(outputDirectory, 'run-plan.json'), planBytes);

  const setupResults: SetupResult[] = [];
  let setupFailure: string | null = null;
  for (const [index, command] of plan.setupCommands.entries()) {
    context.throwIfAborted();
    const execution = await executeCommand(
      command,
      join(outputDirectory, 'setup', String(index + 1).padStart(2, '0')),
      {
        ABG_RUN_ID: runId,
        ABG_RUN_SEQUENCE: String(plan.runSequence),
        ABG_RUNTIME_NAMESPACE: context.identity.runtimeNamespace,
        DOCKER_HOST: 'unix:///run/podman/podman.sock',
        TESTCONTAINERS_RYUK_DISABLED: 'true',
        ABG_FROZEN_INPUTS_DIGEST: frozenInputsDigest,
        ABG_FROZEN_INPUTS_JSON: canonicalJson(plan.frozenInputs),
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
      assertFrozenInputsEqual(plan.frozenInputs, await readFrozenInputs(repositoryRoot));
      assertAuthorityIdentityEqual(
        plan.authorityIdentity,
        await readVerificationAuthorityIdentity(repositoryRoot),
      );
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
      runSequence: plan.runSequence,
      producerEvidenceIndexRelativePath: 'shared/producer-evidence-index.json',
      coverageMatrixDigest: plan.authorityIdentity.coverageMatrixDigest,
    }));
  }

  const formalGate = ABG_GATES.find((gate) => gate.gateId === 'ABG-40');
  if (formalGate === undefined) throw new Error('ABG_FORMAL_GATE_MISSING');
  if (setupFailure !== null) {
    results.push(failedGate(
      formalGate,
      ordinalFor(formalGate),
      runId,
      commandDigestForGate(formalGate),
      setupFailure,
    ));
  } else if (results.some((result) => result.status !== 'PASSED')) {
    results.push(failedGate(
      formalGate,
      ordinalFor(formalGate),
      runId,
      commandDigestForGate(formalGate),
      'FORMAL_PRECONCLUSION_PREREQUISITE_FAILED',
    ));
  } else {
    try {
      await writeFormalProducerEvidence(results, plan.authorityIdentity);
      results.push(await executeGate({
        gate: formalGate,
        ordinal: ordinalFor(formalGate),
        runId,
        runSequence: plan.runSequence,
        producerEvidenceIndexRelativePath: 'producer-evidence-index.json',
        coverageMatrixDigest: plan.authorityIdentity.coverageMatrixDigest,
      }));
    } catch (error) {
      results.push(failedGate(
        formalGate,
        ordinalFor(formalGate),
        runId,
        commandDigestForGate(formalGate),
        'FORMAL_PRECONCLUSION_EVIDENCE_FAILED',
        error,
      ));
    }
  }
  results.sort((left, right) => left.ordinal - right.ordinal);

  let frozenInputsStable = true;
  let authorityIdentityStable = true;
  try {
    assertFrozenInputsEqual(plan.frozenInputs, await readFrozenInputs(repositoryRoot));
  } catch {
    frozenInputsStable = false;
  }
  try {
    assertAuthorityIdentityEqual(
      plan.authorityIdentity,
      await readVerificationAuthorityIdentity(repositoryRoot),
    );
  } catch {
    authorityIdentityStable = false;
  }

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

  const passed =
    frozenInputsStable &&
    authorityIdentityStable &&
    selectorSetsDistinct &&
    results.length === ABG_GATES.length &&
    results.every((result) => result.status === 'PASSED');
  const summary = {
    schemaVersion: 'phase-01.abg-run.v3',
    runId,
    runSequence: plan.runSequence,
    planDigest,
    frozenInputs: plan.frozenInputs,
    frozenInputsDigest,
    coverageMatrixDigest: plan.authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: plan.authorityIdentity.producerProtocolIdentityDigest,
    authorityIdentity: plan.authorityIdentity,
    frozenInputsStable,
    authorityIdentityStable,
    selectorSetsDistinct,
    status: passed ? 'PASSED' : 'FAILED',
    startedAt,
    completedAt: localNow(),
    timezone: 'Asia/Shanghai',
    setupResults,
    gateCount: results.length,
    passedCount: results.filter((result) => result.status === 'PASSED').length,
    failedCount: results.filter((result) => result.status === 'FAILED').length,
    conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
    results,
  };
  if (passed) {
    validateFormalAbgSummary(summary, {
      runSequence: plan.runSequence,
      planDigest,
      frozenInputs: plan.frozenInputs,
      frozenInputsDigest,
      coverageMatrixDigest: plan.authorityIdentity.coverageMatrixDigest,
      producerProtocolIdentityDigest: plan.authorityIdentity.producerProtocolIdentityDigest,
      setupCommandDigests: plan.setupCommands.map(commandDigest),
    });
  }
  return {
    passed,
    value: summary,
    ...(passed ? {} : { failureCode: 'FORMAL_ABG_GATE_OR_SETUP_FAILED' }),
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
  priorResults: readonly FormalGateResult[],
  authorityIdentity: VerificationAuthorityIdentity,
): Promise<void> {
  const formalEntry = getAbgCoverageEntry('ABG-40');
  const scenarioId = formalEntry.scenarioIds[0];
  const assertionId = formalEntry.assertionIds[0];
  if (scenarioId === undefined || assertionId === undefined) {
    throw new Error('FORMAL_PRECONCLUSION_MATRIX_INVALID');
  }
  const preliminary = {
    schemaVersion: 'phase-01.abg-preconclusion.v1',
    runId,
    runSequence: plan.runSequence,
    status: priorResults.every((result) => result.status === 'PASSED') ? 'PASSED' : 'FAILED',
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    gates: priorResults.map((result) => ({
      gateId: result.gateId,
      status: result.status,
      proofPath: result.proofPath,
      assertionIds: result.proof?.assertionIds ?? [],
    })),
  };
  await writeExclusive(join(outputDirectory, 'formal-run/preliminary-conclusion.json'), preliminary);
  const preliminaryItem = await createEvidenceItemFromFile(outputDirectory, {
    artifactId: 'phase-01-formal-abg-preliminary-conclusion',
    relativePath: 'formal-run/preliminary-conclusion.json',
    mediaType: 'application/json',
    jsonPointer: '/status',
    claim: {
      runId,
      runSequence: plan.runSequence,
      status: preliminary.status,
      coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    },
  });
  const references = aggregateFormalReferences(priorResults, preliminaryItem.sha256);
  const evidence = buildMatrixProducerEvidence({
    producerId: 'formal-run',
    runId,
    runSequence: plan.runSequence,
    startedAt,
    completedAt: localNow(),
    processStatus: preliminary.status === 'PASSED' ? 'PASSED' : 'FAILED',
    commandIdentity: {
      executable: 'node',
      arguments: ['tooling/verification/src/run-formal-abg.ts'],
      workingDirectory: 'repository-root',
      commandDigest: sha256(Buffer.from('tooling/verification/src/run-formal-abg.ts', 'utf8')),
    },
    environmentRefs: environmentReferenceDigest(process.env, ['CI', 'NODE_ENV', 'TZ']),
    frozenInputRefs: parseFrozenInputRefs(plan.frozenInputs),
    defaultEvidenceItems: [preliminaryItem],
    scenarioReferences: { [scenarioId]: references },
    outcomes: {
      [assertionId]: preliminary.status === 'PASSED'
        ? {
          status: 'PASSED',
          description: 'The frozen run recorded every non-self ABG gate before the immutable ABG-40 proof.',
          expected: { nonSelfGateStatus: 'PASSED' },
          actual: { priorGateCount: priorResults.length, priorPassedCount: priorResults.length },
        }
        : {
          status: 'FAILED',
          description: 'The frozen run did not record a complete passing non-self ABG preconclusion.',
          expected: { nonSelfGateStatus: 'PASSED' },
          actual: { priorGateCount: priorResults.length },
          failureCode: 'FORMAL_PRECONCLUSION_FAILED',
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
  if (sharedIndex.index.runId !== runId || sharedIndex.index.runSequence !== plan.runSequence) {
    throw new Error('FORMAL_PRECONCLUSION_SHARED_INDEX_RUN_MISMATCH');
  }
  await writeProducerEvidenceIndex(outputDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId,
    runSequence: plan.runSequence,
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
  const command = plan.gates.find((candidate) => candidate.gateId === gate.gateId);
  if (command === undefined) throw new Error('ABG_PLAN_GATE_MISSING:' + gate.gateId);
  return command;
}

function commandDigestForGate(gate: AbgGateDefinition): string {
  return commandDigest(commandForGate(gate));
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
    schemaVersion: 'phase-01.evidence-manifest.v1',
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
  artifactDigest: string,
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
    artifactDigests: [artifactDigest],
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
