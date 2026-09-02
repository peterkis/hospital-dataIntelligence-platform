import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ABG_PRODUCER_IDS,
  type AbgProducerId,
} from './abg-coverage-matrix.js';
import {
  buildLiveProducerEvidence,
  buildMatrixProducerEvidence,
  buildObservedProducerEvidence,
  buildProducerFailureEvidence,
  parseFrozenInputRefs,
  type MatrixAssertionOutcome,
  type ProducerAssertionObservation,
} from './evidence/adapters.js';
import {
  canonicalJson,
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  environmentReferenceDigest,
  sha256,
  writeBinaryArtifact,
  writeProducerEvidence,
  writeProducerEvidenceIndex,
  writeRedactedJsonArtifact,
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import {
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  type ProducerEvidenceItem,
} from './evidence/protocol.js';
import { writeFormalRuntimeEvent } from './runtime/formal-runtime-controller.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';
import {
  assertFormalRuntimeDatabaseTarget,
  buildFormalRuntimeDatabaseUrl,
} from './runtime/formal-runtime-database-connection.js';
import { createDeterministicChildEnvironment } from './runtime/node-command-boundary.js';
import {
  executeSharedCommand,
  type SharedRuntimeEnvironmentBindings,
  type SharedCommandResult,
} from './shared-command-executor.js';
import {
  buildSharedAbgCommandPlan,
} from './shared-abg-command-plan.js';

interface RunningApplication {
  readonly child: ChildProcess;
  readonly stdout: Buffer[];
  readonly stderr: Buffer[];
  readonly startupMilliseconds: number;
  readonly databaseUrl: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const runtimeAuthority = loadPodmanRuntimeAuthority(repositoryRoot).authority;
const runtimeBindAddress = runtimeAuthority.network.bindAddress;
const runtimePorts = runtimeAuthority.network.ports;
const sharedDirectory = resolve(requireEnvironment('ABG_SHARED_EVIDENCE_DIR'));
const runId = process.env['ABG_RUN_ID'] ?? randomUUID();
const runSequence = parsePositiveInteger(process.env['ABG_RUN_SEQUENCE'] ?? '1');
const runtimeNamespace = process.env['ABG_RUNTIME_NAMESPACE'];
const runtimeEventDirectory = process.env['ABG_RUNTIME_EVENT_DIR'];
const commands = await buildSharedAbgCommandPlan(repositoryRoot);
const canonicalDatabaseUrl = buildFormalRuntimeDatabaseUrl(
  runtimeAuthority,
  process.env['HDI_POSTGRES_PASSWORD'] ?? '',
);
assertFormalRuntimeDatabaseTarget(canonicalDatabaseUrl, runtimeAuthority);
const realmImportPath = join(
  repositoryRoot,
  '.runtime/abg-runtime',
  runId,
  'keycloak-import/hdi-phase01-realm.json',
);
const notificationTargets = buildNotificationTargets();
const runtimeEnvironmentBindings: SharedRuntimeEnvironmentBindings = Object.freeze({
  FORMAL_RUNTIME_DATABASE_URL: Object.freeze({
    DATABASE_URL: canonicalDatabaseUrl,
  }),
  FORMAL_LIVE_RUNTIME: Object.freeze({
    KEYCLOAK_ISSUER_URL:
      `http://${runtimeBindAddress}:${runtimePorts.keycloakHttp}/realms/hdi-phase01`,
    KEYCLOAK_REALM_IMPORT_PATH: realmImportPath,
    GOVERNANCE_API_BASE_URL:
      `http://${runtimeBindAddress}:${runtimePorts.governanceApi}`,
    SIM_CONSUMER_NOTIFICATION_TARGETS_JSON: notificationTargets,
  }),
  FORMAL_BROWSER_RUNTIME: Object.freeze({
    PHASE01_E2E_BASE_URL:
      `http://${runtimeBindAddress}:${runtimePorts.governanceApi}`,
    PHASE01_E2E_PASSWORD: requireEnvironment('HDI_OWNER_PASSWORD'),
  }),
});

await createEvidenceOutputDirectory(sharedDirectory);
const stagingDirectory = await mkdtemp(join(tmpdir(), 'hdi-phase01-shared-'));
const commandResults: SharedCommandResult[] = [];
let application: RunningApplication | undefined;
let orchestrationFailure: string | null = null;

try {
  for (const command of commands) {
    if (command.id === 'live') {
      try {
        application = await startApplication(canonicalDatabaseUrl, notificationTargets);
        commandResults.push({
          id: 'application',
          producerIds: ['live'],
          exitCode: 0,
          elapsedMilliseconds: application.startupMilliseconds,
          error: null,
        });
      } catch (error) {
        orchestrationFailure = errorMessage(error);
        commandResults.push({
          id: 'application',
          producerIds: ['live'],
          exitCode: null,
          elapsedMilliseconds: 0,
          error: orchestrationFailure,
        });
        break;
      }
    }
    const result = await executeSharedCommand({
      command,
      repositoryRoot,
      stagingDirectory,
      sharedDirectory,
      runId,
      inheritedEnvironment: process.env,
      runtimeEnvironmentBindings,
      recordRuntimeProcess,
    });
    commandResults.push(result);
    if (command.id === 'integration') {
      await preserveIntegrationAttachments(stagingDirectory);
    }
    if (command.id === 'live') {
      await preserveLiveAttachments(stagingDirectory);
    }
    if (command.id === 'browser') {
      try {
        await preserveBrowserAttachments();
      } catch (error) {
        orchestrationFailure = 'BROWSER_EVIDENCE_PRESERVATION_FAILED:' + errorMessage(error);
      }
    }
    if (result.exitCode !== 0) {
      orchestrationFailure = result.error ?? ('COMMAND_EXIT_' + (result.exitCode ?? 'SIGNAL'));
      break;
    }
  }
} finally {
  try {
    await stopApplication(application);
  } catch (error) {
    orchestrationFailure ??= 'APPLICATION_STOP_FAILED:' + errorMessage(error);
  }
  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    orchestrationFailure ??= 'STAGING_CLEANUP_FAILED:' + errorMessage(error);
  }
}

await writeRedactedJsonArtifact(sharedDirectory, 'raw/command-results.json', {
  schemaVersion: 'phase-01.shared-command-results.v2',
  runId,
  runSequence,
  commands: commandResults,
}, { sensitiveValues: [canonicalDatabaseUrl] });

const frozenInputRefs = parseFrozenInputRefs(parseJsonEnvironment('ABG_FROZEN_INPUTS_JSON'));
const producerStatuses = Object.fromEntries(
  ABG_PRODUCER_IDS.filter((producerId) => producerId !== 'formal-run').map((producerId) => [
    producerId,
    producerProcessStatus(producerId, commandResults),
  ]),
) as Readonly<Record<Exclude<AbgProducerId, 'formal-run'>, 'PASSED' | 'FAILED'>>;
await writeRedactedJsonArtifact(sharedDirectory, 'raw/producer-command-summary.json', {
  schemaVersion: 'phase-01.producer-command-summary.v2',
  runId,
  runSequence,
  orchestrationStatus: orchestrationFailure === null ? 'PASSED' : 'FAILED',
  producers: producerStatuses,
});

const evidenceIndex = [];
for (const producerId of ABG_PRODUCER_IDS.filter(
  (candidate): candidate is Exclude<AbgProducerId, 'formal-run'> => candidate !== 'formal-run',
)) {
  const sourceItem = await createEvidenceItemFromFile(sharedDirectory, {
    artifactId: 'phase-01-' + producerId + '-command-summary',
    relativePath: 'raw/producer-command-summary.json',
    mediaType: 'application/json',
    jsonPointer: '/producers/' + producerId + '/status',
    claim: { producerId, status: producerStatuses[producerId] },
  });
  const defaultEvidenceItems = await producerEvidenceItems(producerId, sourceItem);
  const input = {
    producerId,
    runId,
    runSequence,
    startedAt: nowInAsiaShanghai(),
    completedAt: nowInAsiaShanghai(),
    processStatus: producerStatuses[producerId],
    commandIdentity: producerCommandIdentity(producerId, commandResults),
    environmentRefs: environmentReferenceDigest(process.env, [
      'CI',
      'NODE_ENV',
      'TZ',
      'GOVERNANCE_API_BASE_URL',
      'KEYCLOAK_ISSUER_URL',
    ]),
    frozenInputRefs,
    defaultEvidenceItems,
  } as const;
  const evidence = await buildProducerEvidence(producerId, input, sourceItem, orchestrationFailure);
  evidenceIndex.push(await writeProducerEvidence(
    sharedDirectory,
    producerId + '/producer-evidence.json',
    evidence,
  ));
}

await writeProducerEvidenceIndex(sharedDirectory, 'producer-evidence-index.json', {
  schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  runId,
  runSequence,
  producers: evidenceIndex,
});

const status = orchestrationFailure === null && commandResults.length === commands.length + 1
  ? 'PASSED'
  : 'FAILED';
await writeRedactedJsonArtifact(sharedDirectory, 'shared-verification.json', {
  schemaVersion: 'phase-01.shared-abg-verification.v2',
  runId,
  runSequence,
  status,
  commands: commandResults,
  producerEvidenceIndex: 'producer-evidence-index.json',
  conclusion: 'Orchestration result only; every ABG gate is decided from matrix-selected producer evidence.',
});
process.stdout.write(JSON.stringify({
  runId,
  runSequence,
  status,
  evidenceDirectory: sharedDirectory,
}) + '\n');
if (status !== 'PASSED') throw new Error('SHARED_ABG_VERIFICATION_FAILED');

async function buildProducerEvidence(
  producerId: Exclude<AbgProducerId, 'formal-run'>,
  input: {
    readonly producerId: Exclude<AbgProducerId, 'formal-run'>;
    readonly runId: string;
    readonly runSequence: number;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly processStatus: 'PASSED' | 'FAILED';
    readonly commandIdentity: ReturnType<typeof producerCommandIdentity>;
    readonly environmentRefs: Readonly<Record<string, string>>;
    readonly frozenInputRefs: ReturnType<typeof parseFrozenInputRefs>;
    readonly defaultEvidenceItems: readonly ProducerEvidenceItem[];
  },
  sourceItem: ProducerEvidenceItem,
  failure: string | null,
) {
  if (input.processStatus === 'FAILED') {
    return buildProducerFailureEvidence({
      ...input,
      defaultReferences: defaultReferencesForProducer(producerId, sourceItem),
      failureCode: 'SHARED_PRODUCER_COMMAND_FAILED',
      failureMessage: failure ?? ('Producer command failed: ' + producerId),
    });
  }
  switch (producerId) {
    case 'static':
      return buildMatrixProducerEvidence({
        ...input,
        defaultReferences: defaultReferencesForProducer(producerId, sourceItem),
        outcomes: staticOutcomes(commandResults),
      });
    case 'live': {
      const verification = await readJsonIfPresent('raw/live/live-verification.json');
      if (verification === undefined) {
        return buildProducerFailureEvidence({
          ...input,
          defaultReferences: defaultReferencesForProducer(producerId, sourceItem),
          failureCode: 'LIVE_VERIFICATION_ARTIFACT_MISSING',
          failureMessage: 'Live verification did not write a machine-readable result.',
        });
      }
      return buildLiveProducerEvidence({ ...input, verification });
    }
    case 'browser':
      return buildObservedProducerEvidence({
        ...input,
        defaultReferences: defaultReferencesForProducer(producerId, sourceItem),
        observations: await browserObservations(),
      });
    case 'database':
    case 'integration':
    case 'fault':
    case 'consumer':
    case 'capacity':
      return buildObservedProducerEvidence({
        ...input,
        defaultReferences: defaultReferencesForProducer(producerId, sourceItem),
        observations: await integrationObservations(),
      });
  }
}

async function producerEvidenceItems(
  producerId: Exclude<AbgProducerId, 'formal-run'>,
  commandSummary: ProducerEvidenceItem,
): Promise<readonly ProducerEvidenceItem[]> {
  const supplementary = producerId === 'live'
    ? await createEvidenceItemIfPresent({
      artifactId: 'phase-01-live-verification-summary',
      relativePath: 'raw/live/live-verification.json',
      jsonPointer: '/status',
      claim: { producerId, source: 'live-verification' },
    })
    : producerId === 'browser'
      ? await createEvidenceItemIfPresent({
        artifactId: 'phase-01-browser-observations',
        relativePath: 'raw/browser/browser-observations.json',
        jsonPointer: '/assertions',
        claim: { producerId, source: 'browser-observations' },
      })
      : ['database', 'integration', 'fault', 'consumer', 'capacity'].includes(producerId)
        ? await createEvidenceItemIfPresent({
          artifactId: 'phase-01-integration-observations',
          relativePath: 'raw/integration/integration-observations.json',
          jsonPointer: '/observations',
          claim: { producerId, source: 'integration-observations' },
        })
        : undefined;
  return supplementary === undefined ? [commandSummary] : [commandSummary, supplementary];
}

async function createEvidenceItemIfPresent(input: {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly jsonPointer: string;
  readonly claim: { readonly producerId: string; readonly source: string };
}): Promise<ProducerEvidenceItem | undefined> {
  try {
    return await createEvidenceItemFromFile(sharedDirectory, {
      ...input,
      mediaType: 'application/json',
    });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function staticOutcomes(
  results: readonly SharedCommandResult[],
): Readonly<Record<string, MatrixAssertionOutcome>> {
  const passed = (id: string) => results.find((result) => result.id === id)?.exitCode === 0;
  return {
    'ABG-01:repository-runtime-lockfile-topology': outcome(
      passed('runtime') && passed('repo-layout'),
      'Runtime, lockfile, and repository topology checks.',
    ),
    'ABG-38:typebox-openapi-generated-client-single-authority': outcome(
      passed('typecheck') && passed('build') && passed('contract-lint'),
      'Type checking, build, and frozen OpenAPI lint checks.',
    ),
    'ABG-39:deep-module-table-ownership-forbidden-bypass': outcome(
      passed('module-boundaries'),
      'Deep-module boundary check.',
    ),
  };
}

function outcome(passed: boolean, description: string): MatrixAssertionOutcome {
  return passed
    ? {
      status: 'PASSED',
      description,
      expected: { status: 'PASSED' },
      actual: { status: 'PASSED' },
    }
    : {
      status: 'BLOCKED',
      description,
      expected: { status: 'PASSED' },
      actual: { status: 'NOT_RECORDED' },
      failureCode: 'COMMAND_ASSERTION_NOT_PASSED',
    };
}

function defaultReferencesForProducer(
  producerId: Exclude<AbgProducerId, 'formal-run'>,
  sourceItem: ProducerEvidenceItem,
) {
  return producerId === 'static'
    ? {
      requestIds: ['command-run:' + runId + ':' + producerId],
      ruleVersions: ['phase-01.verification-toolchain.v2'],
      artifactDigests: [sourceItem.sha256],
    }
    : {
      artifactDigests: [sourceItem.sha256],
    };
}

async function integrationObservations(): Promise<readonly ProducerAssertionObservation[]> {
  const value = await readJsonIfPresent('raw/integration/integration-observations.json');
  if (!isRecord(value) || value['schemaVersion'] !== 'phase-01.integration-observations.v1') return [];
  return parseObservations(value['observations']);
}

async function browserObservations(): Promise<readonly ProducerAssertionObservation[]> {
  const value = await readJsonIfPresent('raw/browser/browser-observations.json');
  if (!isRecord(value) || value['schemaVersion'] !== 'phase-01.browser-observations.v1') return [];
  const scenarios = stringArray(value['scenarios']);
  const assertionIds = stringArray(value['assertions']);
  const gateIds = stringArray(value['gateIds']);
  const requestIds = stringArray(value['requestIds']);
  const principalIds = stringArray(value['principalIds']);
  const governanceObjectIds = stringArray(value['governanceObjectIds']);
  const versionIds = stringArray(value['versionIds']);
  const ruleVersions = stringArray(value['ruleVersions']);
  return assertionIds.map((assertionId) => {
    const gateId = gateIds.find((candidate) => assertionId.startsWith(candidate + ':')) ?? '';
    const scenarioId = assertionId.startsWith('ABG-07:')
      ? 'BROWSER-CHARGE-DRAFT-CRUD-AND-CSRF'
      : 'BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION';
    return {
      producerId: 'browser',
      scenarioId: scenarios.includes(scenarioId) ? scenarioId : '',
      assertionId,
      gateId,
      description: 'Playwright browser observation with server-side mutation references.',
      requestIds,
      principalIds,
      governanceObjectIds,
      versionIds,
      ruleVersions,
    };
  });
}

function parseObservations(value: unknown): readonly ProducerAssertionObservation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObservation);
}

function isObservation(value: unknown): value is ProducerAssertionObservation {
  return isRecord(value) &&
    typeof value['producerId'] === 'string' &&
    typeof value['scenarioId'] === 'string' &&
    typeof value['assertionId'] === 'string' &&
    typeof value['gateId'] === 'string' &&
    typeof value['description'] === 'string' &&
    Array.isArray(value['requestIds']) &&
    Array.isArray(value['principalIds']) &&
    Array.isArray(value['governanceObjectIds']) &&
    Array.isArray(value['versionIds']) &&
    Array.isArray(value['ruleVersions']);
}

async function preserveIntegrationAttachments(stagingDirectory: string): Promise<void> {
  await copyRedactedJsonIfPresent(
    join(stagingDirectory, 'vitest-results.json'),
    'raw/integration/vitest-results.json',
  );
  await copyRedactedJsonIfPresent(
    join(stagingDirectory, 'integration-observations.json'),
    'raw/integration/integration-observations.json',
  );
}

async function preserveLiveAttachments(stagingDirectory: string): Promise<void> {
  await copyRedactedDirectory(join(stagingDirectory, 'live'), 'raw/live');
}

async function preserveBrowserAttachments(): Promise<void> {
  const browserDirectory = join(repositoryRoot, '.runtime/e2e', 'abg-' + runId);
  await copyRedactedJsonIfPresent(
    join(browserDirectory, 'playwright-results.json'),
    'raw/browser/playwright-results.json',
  );
  const observationPath = await findFile(browserDirectory, 'phase-01-browser-observation.json');
  if (observationPath) {
    await copyRedactedJsonIfPresent(observationPath, 'raw/browser/browser-observations.json');
  }
  const screenshotPath = await findFile(browserDirectory, 'phase-01-browser-final-page.png');
  if (screenshotPath) {
    await copyBinaryIfPresent(screenshotPath, 'raw/browser/browser-final-page.png');
  }
}

async function copyRedactedDirectory(sourceDirectory: string, targetDirectory: string): Promise<void> {
  try {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const source = join(sourceDirectory, entry.name);
      const target = targetDirectory + '/' + entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error('SHARED_EVIDENCE_SYMLINK_FORBIDDEN:' + entry.name);
      }
      if (entry.isDirectory()) {
        await copyRedactedDirectory(source, target);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = await readFile(source, 'utf8');
      if (entry.name.endsWith('.json')) {
        await writeRedactedJsonArtifact(
          sharedDirectory,
          target,
          JSON.parse(text) as unknown,
          { sensitiveValues: [canonicalDatabaseUrl] },
        );
      } else {
        await writeRedactedTextArtifact(sharedDirectory, target, text, {
          sensitiveValues: [canonicalDatabaseUrl],
        });
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function copyRedactedJsonIfPresent(source: string, relativePath: string): Promise<void> {
  try {
    await writeRedactedJsonArtifact(
      sharedDirectory,
      relativePath,
      JSON.parse(await readFile(source, 'utf8')) as unknown,
      { sensitiveValues: [canonicalDatabaseUrl] },
    );
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function copyBinaryIfPresent(source: string, relativePath: string): Promise<void> {
  try {
    await writeBinaryArtifact(sharedDirectory, relativePath, await readFile(source));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function readJsonIfPresent(relativePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(join(sharedDirectory, relativePath), 'utf8')) as unknown;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function findFile(directory: string, targetName: string): Promise<string | undefined> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('SHARED_EVIDENCE_SYMLINK_FORBIDDEN:' + entry.name);
      }
      if (entry.isFile() && entry.name === targetName) return path;
      if (entry.isDirectory()) {
        const nested = await findFile(path, targetName);
        if (nested) return nested;
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return undefined;
}

async function startApplication(
  databaseUrl: string,
  notificationTargets: string,
): Promise<RunningApplication> {
  const started = performance.now();
  assertFormalRuntimeDatabaseTarget(databaseUrl, runtimeAuthority);
  const child = spawn(process.execPath, ['apps/governance-api/dist/main.js'], {
    cwd: repositoryRoot,
    env: createDeterministicChildEnvironment({
      inheritedEnvironment: process.env,
      injectedEnvironment: {
      DATABASE_URL: databaseUrl,
      KEYCLOAK_ISSUER_URL: `http://${runtimeBindAddress}:${runtimePorts.keycloakHttp}/realms/hdi-phase01`,
      KEYCLOAK_BROWSER_CLIENT_ID: 'hdi-governance-browser',
      KEYCLOAK_BROWSER_CLIENT_SECRET: requireEnvironment('HDI_BROWSER_CLIENT_SECRET'),
      KEYCLOAK_SERVICE_AUDIENCE: 'hdi-governance-api',
      PUBLIC_ORIGIN: `http://${runtimeBindAddress}:${runtimePorts.governanceApi}`,
      SESSION_CSRF_SECRET: requireEnvironment('SESSION_CSRF_SECRET'),
      SIM_CONSUMER_NOTIFICATION_TARGETS_JSON: notificationTargets,
      ADMIN_STATIC_ROOT: join(repositoryRoot, 'apps/admin-web/dist'),
      HOST: runtimeBindAddress,
      PORT: String(runtimePorts.governanceApi),
      },
      nodeOptionsForbiddenCode: 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN',
      databaseUrlDeclarationForbiddenCode:
        'SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN',
      databaseUrlInjectionAuthorized: true,
      databaseUrlInjectionUnauthorizedCode:
        'SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const running: RunningApplication = {
    child,
    stdout,
    stderr,
    startupMilliseconds: 0,
    databaseUrl,
  };
  try {
    await recordRuntimeProcess('STARTED', child, 'governance-api');
    await waitForPort(runtimePorts.governanceApi, child);
  } catch (error) {
    await stopApplication(running).catch(() => undefined);
    throw error;
  }
  return {
    ...running,
    startupMilliseconds: Math.round(performance.now() - started),
  };
}

async function stopApplication(application: RunningApplication | undefined): Promise<void> {
  if (!application) return;
  const failures: unknown[] = [];
  try {
    await Promise.all([
      writeRedactedTextArtifact(
        sharedDirectory,
        'raw/application.stdout.log',
      Buffer.concat(application.stdout).toString('utf8'),
      { sensitiveValues: [application.databaseUrl] },
      ),
      writeRedactedTextArtifact(
        sharedDirectory,
        'raw/application.stderr.log',
      Buffer.concat(application.stderr).toString('utf8'),
      { sensitiveValues: [application.databaseUrl] },
      ),
    ]);
  } catch (error) {
    failures.push(error);
  }
  try {
    if (application.child.exitCode === null && application.child.signalCode === null) {
      application.child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((resolveClose) => application.child.once('close', () => resolveClose())),
        delay(5_000).then(() => { application.child.kill('SIGKILL'); }),
      ]);
    }
    await recordRuntimeProcess('STOPPED', application.child, 'governance-api');
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, 'GOVERNANCE_APPLICATION_STOP_FAILED');
}

function buildNotificationTargets(): string {
  const notificationAuthorization = requireEnvironment(
    'HDI_SIM_CONSUMER_NOTIFICATION_AUTHORIZATION',
  );
  return JSON.stringify([
    {
      servicePrincipalId: '40000000-0000-7000-8000-000000000002',
      url: `http://${runtimeBindAddress}:${runtimePorts.consumerA}/v1/release-notifications`,
      authorizationHeader: notificationAuthorization,
    },
    {
      servicePrincipalId: '40000000-0000-7000-8000-000000000003',
      url: `http://${runtimeBindAddress}:${runtimePorts.consumerB}/v1/release-notifications`,
      authorizationHeader: notificationAuthorization,
    },
  ]);
}

async function recordRuntimeProcess(
  event: 'STARTED' | 'STOPPED',
  child: ChildProcess,
  role: string,
): Promise<void> {
  if (runtimeEventDirectory === undefined) return;
  if (runtimeNamespace === undefined) {
    throw new Error('FORMAL_RUNTIME_NAMESPACE_MISSING');
  }
  if (child.pid === undefined) throw new Error('FORMAL_RUNTIME_PROCESS_PID_MISSING');
  await writeFormalRuntimeEvent(runtimeEventDirectory, {
    runtimeAuthority,
    identity: { runId, runSequence, runtimeNamespace },
    event,
    resourceType: 'process',
    id: String(child.pid),
    name: role,
    role,
    pid: child.pid,
    exitStatus: event === 'STOPPED' ? child.exitCode ?? child.signalCode : null,
  });
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('GOVERNANCE_API_EXITED:' + child.exitCode);
    const ready = await new Promise<boolean>((resolveReady) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolveReady(true); });
      socket.once('error', () => resolveReady(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error('GOVERNANCE_API_START_TIMEOUT');
}

function producerProcessStatus(
  producerId: Exclude<AbgProducerId, 'formal-run'>,
  results: readonly SharedCommandResult[],
): 'PASSED' | 'FAILED' {
  const relevant = results.filter((result) => result.producerIds.includes(producerId));
  if (relevant.length === 0 || relevant.some((result) => result.exitCode !== 0)) return 'FAILED';
  const expected = commands.filter((command) => command.producerIds.includes(producerId));
  const executedCommands = relevant.filter((result) => result.id !== 'application');
  return executedCommands.length === expected.length ? 'PASSED' : 'FAILED';
}

function producerCommandIdentity(
  producerId: Exclude<AbgProducerId, 'formal-run'>,
  results: readonly SharedCommandResult[],
) {
  const commandIds = results
    .filter((result) => result.producerIds.includes(producerId))
    .map((result) => result.id);
  return {
    executable: 'phase-01-shared-runner',
    arguments: commandIds,
    workingDirectory: 'repository-root',
    commandDigest: sha256(Buffer.from(canonicalJson({
      producerId,
      commandIds,
    }), 'utf8')),
  };
}

function parseJsonEnvironment(name: string): unknown {
  const value = process.env[name];
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('ABG_RUN_SEQUENCE_INVALID');
  return parsed;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as readonly string[]
    : [];
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowInAsiaShanghai(): string {
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
  return String(part('year')) + '-' + String(part('month')) + '-' + String(part('day')) +
    'T' + String(part('hour')) + ':' + String(part('minute')) + ':' + String(part('second'));
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('REQUIRED_ENVIRONMENT_MISSING:' + name);
  return value;
}
