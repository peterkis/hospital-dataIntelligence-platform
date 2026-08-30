import type { ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { redactSensitiveText } from '../evidence/recorder.js';
import { RUNTIME_OUTCOME_SCHEMA_VERSION } from '../verification-contract-versions.js';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
  errorMessage,
  formalRuntimeLabels,
  localNowInAsiaShanghai,
  type FormalRunIdentity,
  type FormalRunSeed,
} from './formal-runtime-contract.js';
import {
  createDefaultFormalPreflightDependencies,
  runFormalPreflight,
  type FormalPreflightReport,
} from './formal-preflight.js';
import {
  captureFormalRuntimeResources,
  createDefaultFormalTeardownDependencies,
  performFormalTeardown,
  type FormalCleanupReport,
  type FormalTeardownDependencies,
  type RuntimeResourceSnapshot,
} from './formal-teardown.js';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';
import type {
  LoadedPodmanRuntimeAuthority,
  PodmanRuntimeAuthority,
} from './podman-runtime-authority-schema.js';

export interface FormalRuntimeContext {
  readonly identity: FormalRunIdentity;
  readonly runtimeAuthority: LoadedPodmanRuntimeAuthority;
  readonly outputDirectory: string;
  readonly runtimeEventDirectory: string;
  readonly signal: AbortSignal;
  trackChild(child: ChildProcess): () => void;
  throwIfAborted(): void;
}

export interface FormalExecutionResult<T> {
  readonly passed: boolean;
  readonly value: T;
  readonly failureCode?: string;
}

export interface FormalRuntimeFinalOutcome<T> {
  readonly status: 'PASSED' | 'FAILED';
  readonly failureCodes: readonly string[];
  readonly preflight: FormalPreflightReport;
  readonly execution: FormalExecutionResult<T> | null;
  readonly startedResources: RuntimeResourceSnapshot;
  readonly cleanup: FormalCleanupReport;
  readonly finalResources: RuntimeResourceSnapshot;
  readonly producerEvidencePersistedBeforeCleanup: boolean;
  readonly outputDirectoryExclusive: boolean;
  readonly runtimeAuthoritySha256: string;
  readonly runtimeAuthoritySemanticDigest: string;
  readonly runtimeAuthorityStableAfterCleanup: boolean;
}

export interface FormalRuntimePreCleanupOutcome<T> {
  readonly status: 'PASSED' | 'FAILED';
  readonly failureCodes: readonly string[];
  readonly preflight: FormalPreflightReport;
  readonly execution: FormalExecutionResult<T> | null;
  readonly startedResources: RuntimeResourceSnapshot;
}

export interface FormalRuntimeFinalizationResult<T> {
  readonly status: 'PASSED' | 'FAILED';
  readonly terminalConclusionStatus: 'PASSED' | 'FAILED';
  readonly sealEligibilityStatus: 'PASSED' | 'FAILED';
  readonly producerSourceManifestSha256: string | null;
  readonly failureCodes: readonly string[];
  readonly value: T;
}

export interface FormalRuntimeLifecycleCallbacks<TExecution, TFinal = unknown> {
  executeBeforeCleanup(context: FormalRuntimeContext): Promise<FormalExecutionResult<TExecution>>;
  persistEvidenceBeforeCleanup(
    context: FormalRuntimeContext,
    outcome: FormalRuntimePreCleanupOutcome<TExecution>,
  ): Promise<void>;
  finalizeAfterCleanup(
    context: FormalRuntimeContext,
    outcome: FormalRuntimeFinalOutcome<TExecution>,
  ): Promise<FormalRuntimeFinalizationResult<TFinal>>;
  sealEvidence(context: FormalRuntimeContext): Promise<void>;
}

export interface FormalRuntimeFileSystem {
  reserveOutputDirectory(path: string): Promise<void>;
  writeJsonExclusive(root: string, relativePath: string, value: unknown): Promise<void>;
}

export interface FormalRuntimeLifecycleDependencies {
  readonly fileSystem: FormalRuntimeFileSystem;
  readonly preflight: (input: {
    readonly repositoryRoot: string;
    readonly outputDirectory: string;
    readonly run: FormalRunSeed;
    readonly producerSourceManifestSha256: string;
  }) => Promise<FormalPreflightReport>;
  readonly sha256: (path: string) => Promise<string>;
  readonly loadRuntimeAuthority: (
    repositoryRoot: string,
  ) => LoadedPodmanRuntimeAuthority | Promise<LoadedPodmanRuntimeAuthority>;
  readonly teardownDependencies: FormalTeardownDependencies;
  readonly now: () => string;
  readonly createController: () => FormalRuntimeController;
}

export interface FormalRuntimeLifecycleResult<TExecution, TFinal = unknown> {
  readonly status: 'PASSED' | 'FAILED';
  readonly identity: FormalRunIdentity;
  readonly preflight: FormalPreflightReport;
  readonly execution: FormalExecutionResult<TExecution> | null;
  readonly finalization: FormalRuntimeFinalizationResult<TFinal> | null;
  readonly cleanup: FormalCleanupReport | null;
  readonly finalResources: RuntimeResourceSnapshot | null;
  readonly outputDirectoryCreated: boolean;
  readonly sealFailureCode: string | null;
  readonly runtimeAuthorityFailureCode: string | null;
  readonly runtimeAuthoritySha256: string | null;
  readonly runtimeAuthoritySemanticDigest: string | null;
  readonly runtimeAuthorityStableAfterCleanup: boolean;
}

export interface FormalRuntimeProcessEvents {
  once(event: string, listener: (value?: unknown) => void): void;
  removeListener(event: string, listener: (value?: unknown) => void): void;
}

export class FormalRuntimeController {
  private readonly abortController = new AbortController();
  private readonly activeChildren = new Set<ChildProcess>();
  private failureCode: string | null = null;
  private failure: unknown;
  private removeHandlers: (() => void) | undefined;
  private readonly processEvents: FormalRuntimeProcessEvents;

  constructor(processEvents: FormalRuntimeProcessEvents = nodeProcessEvents) {
    this.processEvents = processEvents;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  installProcessHandlers(): void {
    if (this.removeHandlers !== undefined) return;
    const onSigint = () => this.handleSignal('SIGINT');
    const onSigterm = () => this.handleSignal('SIGTERM');
    const onUncaught = (error?: unknown) => this.abort('FORMAL_RUNTIME_UNCAUGHT_EXCEPTION', error);
    const onUnhandled = (reason?: unknown) => this.abort('FORMAL_RUNTIME_UNHANDLED_REJECTION', reason);
    this.processEvents.once('SIGINT', onSigint);
    this.processEvents.once('SIGTERM', onSigterm);
    this.processEvents.once('uncaughtException', onUncaught);
    this.processEvents.once('unhandledRejection', onUnhandled);
    this.removeHandlers = () => {
      this.processEvents.removeListener('SIGINT', onSigint);
      this.processEvents.removeListener('SIGTERM', onSigterm);
      this.processEvents.removeListener('uncaughtException', onUncaught);
      this.processEvents.removeListener('unhandledRejection', onUnhandled);
      this.removeHandlers = undefined;
    };
  }

  handleSignal(signal: 'SIGINT' | 'SIGTERM'): void {
    this.abort('FORMAL_RUNTIME_SIGNAL_' + signal, new Error(signal));
  }

  dispose(): void {
    this.removeHandlers?.();
  }

  abort(code: string, error: unknown = new Error(code)): void {
    if (this.failureCode !== null) return;
    this.failureCode = code;
    this.failure = error;
    this.abortController.abort(error);
    for (const child of this.activeChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
  }

  trackChild(child: ChildProcess): () => void {
    this.activeChildren.add(child);
    const remove = () => this.activeChildren.delete(child);
    child.once('close', remove);
    return () => {
      child.removeListener('close', remove);
      remove();
    };
  }

  throwIfAborted(): void {
    if (this.failureCode !== null) {
      const error = new Error(this.failureCode);
      (error as Error & { cause?: unknown }).cause = this.failure;
      throw error;
    }
  }

  currentFailureCode(): string | null {
    return this.failureCode;
  }
}

const nodeProcessEvents: FormalRuntimeProcessEvents = {
  once(event, listener) {
    process.once(event, listener);
  },
  removeListener(event, listener) {
    process.removeListener(event, listener);
  },
};

export function createDefaultFormalRuntimeLifecycleDependencies(): FormalRuntimeLifecycleDependencies {
  const preflightDependencies = createDefaultFormalPreflightDependencies();
  return {
    fileSystem: new NodeFormalRuntimeFileSystem(),
    preflight: (input) => runFormalPreflight(input, preflightDependencies),
    sha256: (path) => preflightDependencies.fileSystem.sha256(path),
    loadRuntimeAuthority: loadPodmanRuntimeAuthority,
    teardownDependencies: createDefaultFormalTeardownDependencies(),
    now: localNowInAsiaShanghai,
    createController: () => new FormalRuntimeController(),
  };
}

export async function runFormalRuntimeLifecycle<TExecution, TFinal = unknown>(
  input: {
    readonly repositoryRoot: string;
    readonly outputDirectory: string;
    readonly run: FormalRunSeed;
    readonly producerSourceManifestSha256: string;
  },
  callbacks: FormalRuntimeLifecycleCallbacks<TExecution, TFinal>,
  dependencies: FormalRuntimeLifecycleDependencies = createDefaultFormalRuntimeLifecycleDependencies(),
): Promise<FormalRuntimeLifecycleResult<TExecution, TFinal>> {
  const controller = dependencies.createController();
  controller.installProcessHandlers();
  let outputDirectoryCreated = false;
  let cleanup: FormalCleanupReport | null = null;
  let execution: FormalExecutionResult<TExecution> | null = null;
  let finalization: FormalRuntimeFinalizationResult<TFinal> | null = null;
  let finalResources: RuntimeResourceSnapshot | null = null;
  let sealFailureCode: string | null = null;
  let runtimeAuthorityStableAfterCleanup = false;
  let preflight: FormalPreflightReport;
  try {
    preflight = await dependencies.preflight({
      repositoryRoot: input.repositoryRoot,
      outputDirectory: input.outputDirectory,
      run: input.run,
      producerSourceManifestSha256: input.producerSourceManifestSha256,
    });
    const outputExists = preflight.checks.some((check) =>
      check.errorCode === 'FORMAL_PREFLIGHT_OUTPUT_ALREADY_EXISTS',
    );
    if (outputExists) {
      const authorityUnavailable = preflight.runtimeAuthoritySha256 === null ||
        preflight.runtimeAuthoritySemanticDigest === null;
      return {
        status: 'FAILED',
        identity: preflight.runIdentity,
        preflight,
        execution: null,
        finalization: null,
        cleanup: null,
        finalResources: null,
        outputDirectoryCreated: false,
        sealFailureCode: null,
        runtimeAuthorityFailureCode: authorityUnavailable
          ? 'FORMAL_RUNTIME_AUTHORITY_UNAVAILABLE'
          : null,
        runtimeAuthoritySha256: preflight.runtimeAuthoritySha256,
        runtimeAuthoritySemanticDigest: preflight.runtimeAuthoritySemanticDigest,
        runtimeAuthorityStableAfterCleanup: false,
      };
    }

    let runtimeAuthority: LoadedPodmanRuntimeAuthority;
    try {
      runtimeAuthority = await dependencies.loadRuntimeAuthority(input.repositoryRoot);
    } catch (error) {
      await dependencies.fileSystem.reserveOutputDirectory(input.outputDirectory);
      outputDirectoryCreated = true;
      const authorityFailureCode = 'FORMAL_RUNTIME_AUTHORITY_UNAVAILABLE';
      const failureCodes: string[] = [authorityFailureCode];
      const preflightPersisted = await writeLifecycleJson(
        dependencies.fileSystem,
        input.outputDirectory,
        'runtime/preflight.json',
        preflight,
        'FORMAL_PREFLIGHT_EVIDENCE_WRITE_FAILED',
        failureCodes,
      );
      await writeLifecycleJson(
        dependencies.fileSystem,
        input.outputDirectory,
        'runtime/authority-failure.json',
        {
          schemaVersion: 'phase-01.formal-runtime-authority-failure.v1',
          runIdentity: preflight.runIdentity,
          status: 'FAILED',
          failureCode: authorityFailureCode,
          observedErrorCode: stableFailureCode(error),
          recordedAt: dependencies.now(),
        },
        'FORMAL_RUNTIME_AUTHORITY_FAILURE_EVIDENCE_WRITE_FAILED',
        failureCodes,
      );
      await writeLifecycleJson(
        dependencies.fileSystem,
        input.outputDirectory,
        'runtime/failure-summary.json',
        {
          schemaVersion: 'phase-01.formal-failure-summary.v1',
          runIdentity: preflight.runIdentity,
          statusBeforeCleanup: 'FAILED',
          failureCodes: uniqueFailureCodes(failureCodes),
          failureMessage: null,
          evidencePersistedBeforeCleanup: preflightPersisted,
          evidencePersistence: {
            preflight: preflightPersisted,
            resources: false,
            producer: false,
          },
          evidenceDirectoryRetention: 'PERMANENT',
          recordedAt: dependencies.now(),
        },
        'FORMAL_FAILURE_SUMMARY_WRITE_FAILED',
        failureCodes,
      );
      await writeLifecycleJson(
        dependencies.fileSystem,
        input.outputDirectory,
        'runtime/final-outcome.json',
        {
          schemaVersion: RUNTIME_OUTCOME_SCHEMA_VERSION,
          runIdentity: preflight.runIdentity,
          status: 'FAILED',
          failureCodes: uniqueFailureCodes(failureCodes),
          cleanupStatus: 'FAILED',
          terminalConclusionStatus: 'FAILED',
          sealEligibilityStatus: 'FAILED',
          producerSourceManifestSha256: input.producerSourceManifestSha256,
          runtimeAuthoritySha256: null,
          runtimeAuthoritySemanticDigest: null,
          runtimeAuthorityStableAfterCleanup: false,
          sealPendingAtWrite: false,
          completedEvidenceAt: dependencies.now(),
        },
        'FORMAL_FINAL_OUTCOME_WRITE_FAILED',
        failureCodes,
      );
      return {
        status: 'FAILED',
        identity: preflight.runIdentity,
        preflight,
        execution: null,
        finalization: null,
        cleanup: null,
        finalResources: null,
        outputDirectoryCreated,
        sealFailureCode: null,
        runtimeAuthorityFailureCode: authorityFailureCode,
        runtimeAuthoritySha256: null,
        runtimeAuthoritySemanticDigest: null,
        runtimeAuthorityStableAfterCleanup: false,
      };
    }

    await dependencies.fileSystem.reserveOutputDirectory(input.outputDirectory);
    outputDirectoryCreated = true;
    const runtimeEventDirectory = join(input.outputDirectory, 'runtime', 'events');
    await mkdir(runtimeEventDirectory, { recursive: true, mode: 0o700 });
    const failureCodes: string[] = [];
    if (
      preflight.runtimeAuthoritySha256 !== runtimeAuthority.runtimeAuthoritySha256 ||
      preflight.runtimeAuthoritySemanticDigest !== runtimeAuthority.runtimeAuthoritySemanticDigest
    ) failureCodes.push('FORMAL_PREFLIGHT_RUNTIME_AUTHORITY_IDENTITY_MISMATCH');
    const preflightPersisted = await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/preflight.json',
      preflight,
      'FORMAL_PREFLIGHT_EVIDENCE_WRITE_FAILED',
      failureCodes,
    );
    const context: FormalRuntimeContext = {
      identity: preflight.runIdentity,
      runtimeAuthority,
      outputDirectory: input.outputDirectory,
      runtimeEventDirectory,
      signal: controller.signal,
      trackChild: (child) => controller.trackChild(child),
      throwIfAborted: () => controller.throwIfAborted(),
    };
    let executionError: unknown;
    if (preflight.status !== 'PASSED') {
      failureCodes.push('FORMAL_PREFLIGHT_FAILED');
    } else if (failureCodes.includes('FORMAL_PREFLIGHT_RUNTIME_AUTHORITY_IDENTITY_MISMATCH')) {
      failureCodes.push('FORMAL_EXECUTION_SKIPPED_AUTHORITY_IDENTITY_MISMATCH');
    } else if (!preflightPersisted) {
      failureCodes.push('FORMAL_EXECUTION_SKIPPED_EVIDENCE_UNAVAILABLE');
    } else {
      try {
        controller.throwIfAborted();
        execution = await callbacks.executeBeforeCleanup(context);
        if (!execution.passed) failureCodes.push(execution.failureCode ?? 'FORMAL_EXECUTION_FAILED');
        controller.throwIfAborted();
      } catch (error) {
        executionError = error;
        failureCodes.push(controller.currentFailureCode() ?? stableFailureCode(error));
      }
    }
    if (preflight.status === 'PASSED') {
      const expectedLockDigest = preflightLockDigest(preflight);
      try {
        const actualLockDigest = await dependencies.sha256(
          resolve(input.repositoryRoot, 'package-lock.json'),
        );
        if (expectedLockDigest === null || actualLockDigest !== expectedLockDigest) {
          failureCodes.push('FORMAL_RUNTIME_LOCKFILE_MUTATED');
        }
      } catch {
        failureCodes.push('FORMAL_RUNTIME_LOCKFILE_RECHECK_FAILED');
      }
    }

    let startedResources: RuntimeResourceSnapshot;
    try {
      startedResources = await captureFormalRuntimeResources({
        identity: preflight.runIdentity,
        runtimeEventDirectory,
        runtimeAuthority,
      }, dependencies.teardownDependencies);
    } catch (error) {
      failureCodes.push('FORMAL_RUNTIME_RESOURCE_SNAPSHOT_FAILED');
      startedResources = unavailableSnapshot(preflight.runIdentity, dependencies.now(), error);
    }
    if (
      startedResources.environmentCaptureFailure !== null &&
      startedResources.environmentCaptureFailure !== undefined
    ) failureCodes.push('FORMAL_RUNTIME_ENVIRONMENT_SNAPSHOT_FAILED');
    if (startedResources.environment?.status === 'FAILED') {
      failureCodes.push(...startedResources.environment.failureCodes);
    }
    const resourcesPersisted = await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/resources-started.json',
      startedResources,
      'FORMAL_RESOURCE_EVIDENCE_WRITE_FAILED',
      failureCodes,
    );
    let producerEvidencePersisted = false;
    try {
      await callbacks.persistEvidenceBeforeCleanup(context, {
        status: failureCodes.length === 0 ? 'PASSED' : 'FAILED',
        failureCodes: uniqueFailureCodes(failureCodes),
        preflight,
        execution,
        startedResources,
      });
      producerEvidencePersisted = true;
    } catch (error) {
      failureCodes.push('FORMAL_PRE_CLEANUP_EVIDENCE_WRITE_FAILED');
      await writeBestEffortFailure(
        dependencies.fileSystem,
        input.outputDirectory,
        'runtime/pre-cleanup-evidence-failure.json',
        error,
        dependencies.now(),
      );
    }
    await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/failure-summary.json',
      {
        schemaVersion: 'phase-01.formal-failure-summary.v1',
        runIdentity: preflight.runIdentity,
        statusBeforeCleanup: failureCodes.length === 0 ? 'PASSED' : 'FAILED',
        failureCodes: uniqueFailureCodes(failureCodes),
        failureMessage: executionError === undefined ? null : sanitizeFailure(executionError),
        evidencePersistedBeforeCleanup:
          preflightPersisted && resourcesPersisted && producerEvidencePersisted,
        evidencePersistence: {
          preflight: preflightPersisted,
          resources: resourcesPersisted,
          producer: producerEvidencePersisted,
        },
        evidenceDirectoryRetention: 'PERMANENT',
        recordedAt: dependencies.now(),
      },
      'FORMAL_FAILURE_SUMMARY_WRITE_FAILED',
      failureCodes,
    );

    try {
      const teardown = await performFormalTeardown({
        identity: preflight.runIdentity,
        repositoryRoot: input.repositoryRoot,
        runtimeEventDirectory,
        runtimeAuthority,
      }, dependencies.teardownDependencies);
      cleanup = teardown.cleanup;
      finalResources = teardown.finalResources;
      runtimeAuthorityStableAfterCleanup = cleanup.runtimeAuthority?.stable ?? false;
    } catch (error) {
      failureCodes.push('FORMAL_CLEANUP_UNCAUGHT_FAILURE');
      cleanup = unavailableCleanup(preflight.runIdentity, dependencies.now(), error, runtimeAuthority);
      finalResources = unavailableSnapshot(preflight.runIdentity, dependencies.now(), error);
    }
    if (!runtimeAuthorityStableAfterCleanup) {
      failureCodes.push('FORMAL_RUNTIME_AUTHORITY_MUTATED');
    }
    if (cleanup.status !== 'PASSED') failureCodes.push('FORMAL_CLEANUP_FAILED');
    await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/resources-final.json',
      finalResources,
      'FORMAL_FINAL_RESOURCE_EVIDENCE_WRITE_FAILED',
      failureCodes,
    );
    await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/cleanup.json',
      cleanup,
      'FORMAL_CLEANUP_EVIDENCE_WRITE_FAILED',
      failureCodes,
    );

    const outcomeBeforeManifest: FormalRuntimeFinalOutcome<TExecution> = {
      status: failureCodes.length === 0 ? 'PASSED' : 'FAILED',
      failureCodes: uniqueFailureCodes(failureCodes),
      preflight,
      execution,
      startedResources,
      cleanup,
      finalResources,
      producerEvidencePersistedBeforeCleanup: producerEvidencePersisted,
      outputDirectoryExclusive: outputDirectoryCreated,
      runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
      runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
      runtimeAuthorityStableAfterCleanup,
    };
    try {
      finalization = await callbacks.finalizeAfterCleanup(context, outcomeBeforeManifest);
      failureCodes.push(...finalization.failureCodes);
      if (finalization.status !== 'PASSED' && finalization.failureCodes.length === 0) {
        failureCodes.push('FORMAL_TERMINAL_FINALIZATION_FAILED');
      }
    } catch (error) {
      failureCodes.push('FORMAL_FINAL_EVIDENCE_WRITE_FAILED');
      await writeBestEffortFailure(dependencies.fileSystem, input.outputDirectory,
        'runtime/final-evidence-failure.json', error, dependencies.now());
    }
    const terminalConclusionStatus = finalization?.terminalConclusionStatus ?? 'FAILED';
    const sealEligibilityStatus = finalization?.sealEligibilityStatus ?? 'FAILED';
    const finalOutcomePersisted = await writeLifecycleJson(
      dependencies.fileSystem,
      input.outputDirectory,
      'runtime/final-outcome.json',
      {
        schemaVersion: RUNTIME_OUTCOME_SCHEMA_VERSION,
        runIdentity: preflight.runIdentity,
        status: failureCodes.length === 0 && finalization?.status === 'PASSED' ? 'PASSED' : 'FAILED',
        failureCodes: uniqueFailureCodes(failureCodes),
        cleanupStatus: cleanup.status,
        terminalConclusionStatus,
        sealEligibilityStatus,
        producerSourceManifestSha256:
          finalization?.producerSourceManifestSha256 ?? input.producerSourceManifestSha256,
        runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
        runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
        runtimeAuthorityStableAfterCleanup,
        sealPendingAtWrite: true,
        completedEvidenceAt: dependencies.now(),
      },
      'FORMAL_FINAL_OUTCOME_WRITE_FAILED',
      failureCodes,
    );
    if (failureCodes.length === 0 && finalization?.status === 'PASSED' && finalOutcomePersisted) {
      try {
        await callbacks.sealEvidence(context);
      } catch (error) {
        sealFailureCode = 'FORMAL_MANIFEST_GENERATION_FAILED';
        failureCodes.push(sealFailureCode);
        await writeBestEffortManifestFailure(
          dependencies.fileSystem,
          input.outputDirectory,
          preflight.runIdentity,
          uniqueFailureCodes(failureCodes),
          error,
          dependencies.now(),
        );
      }
    }
    return {
      status: failureCodes.length === 0 && finalization?.status === 'PASSED' ? 'PASSED' : 'FAILED',
      identity: preflight.runIdentity,
      preflight,
      execution,
      finalization,
      cleanup,
      finalResources,
      outputDirectoryCreated,
      sealFailureCode,
      runtimeAuthorityFailureCode: null,
      runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
      runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
      runtimeAuthorityStableAfterCleanup,
    };
  } finally {
    controller.dispose();
  }
}

async function writeLifecycleJson(
  fileSystem: FormalRuntimeFileSystem,
  root: string,
  relativePath: string,
  value: unknown,
  failureCode: string,
  failureCodes: string[],
): Promise<boolean> {
  try {
    await fileSystem.writeJsonExclusive(root, relativePath, value);
    return true;
  } catch {
    failureCodes.push(failureCode);
    return false;
  }
}

function uniqueFailureCodes(failureCodes: readonly string[]): readonly string[] {
  return [...new Set(failureCodes)];
}

export async function writeFormalRuntimeEvent(
  eventDirectory: string,
  input: {
    readonly identity: FormalRunSeed;
    readonly runtimeAuthority: PodmanRuntimeAuthority;
    readonly event: 'STARTED' | 'STOPPED';
    readonly resourceType: 'process' | 'container';
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly occurredAt?: string;
    readonly pid?: number;
    readonly imageReference?: string;
    readonly imageId?: string;
    readonly imageDigest?: string;
    readonly stage?: string;
    readonly status?: 'PASSED' | 'FAILED';
    readonly actualLabels?: Readonly<Record<string, string>>;
    readonly restartPolicy?: string | null;
    readonly errorCode?: string | null;
    readonly ports?: readonly {
      readonly containerPort: string;
      readonly hostIp: string | null;
      readonly hostPort: number | null;
    }[];
    readonly exitStatus?: number | string | null;
  },
): Promise<void> {
  await mkdir(eventDirectory, { recursive: true, mode: 0o700 });
  const safeId = input.id.replaceAll(/[^A-Za-z0-9._-]/gu, '_').slice(0, 128);
  const safeRole = input.role.replaceAll(/[^A-Za-z0-9._-]/gu, '_').slice(0, 64);
  const path = join(
    eventDirectory,
    `${input.resourceType}-${safeRole}-${safeId}-${input.event.toLowerCase()}.json`,
  );
  await writeFile(path, JSON.stringify({
    schemaVersion: 'phase-01.formal-runtime-event.v1',
    runId: input.identity.runId,
    runSequence: input.identity.runSequence,
    runtimeNamespace: input.identity.runtimeNamespace,
    event: input.event,
    resourceType: input.resourceType,
    id: input.id,
    name: input.name,
    resourceId: input.id,
    resourceName: input.name,
    role: input.role,
    stage: input.stage ?? `RESOURCE_${input.event}`,
    status: input.status ?? 'PASSED',
    labels: formalRuntimeLabels(input.identity, input.runtimeAuthority),
    expectedLabels: formalRuntimeLabels(input.identity, input.runtimeAuthority),
    actualLabels: projectFormalRuntimeLabels(
      input.actualLabels ?? formalRuntimeLabels(input.identity, input.runtimeAuthority),
      input.identity,
      input.runtimeAuthority,
    ),
    restartPolicy: input.restartPolicy ?? null,
    errorCode: input.errorCode ?? null,
    occurredAt: input.occurredAt ?? localNowInAsiaShanghai(),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    ...(input.imageReference === undefined ? {} : { imageReference: input.imageReference }),
    ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
    ...(input.imageDigest === undefined ? {} : { imageDigest: input.imageDigest }),
    ...(input.ports === undefined ? {} : { ports: input.ports }),
    ...(input.exitStatus === undefined ? {} : { exitStatus: input.exitStatus }),
  }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

class NodeFormalRuntimeFileSystem implements FormalRuntimeFileSystem {
  async reserveOutputDirectory(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path, { recursive: false, mode: 0o700 });
  }

  async writeJsonExclusive(root: string, relativePath: string, value: unknown): Promise<void> {
    const output = join(root, relativePath);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify(value, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
}

function unavailableSnapshot(
  identity: FormalRunIdentity,
  capturedAt: string,
  error: unknown,
): RuntimeResourceSnapshot {
  return {
    schemaVersion: 'phase-01.formal-runtime-resources.v1',
    runIdentity: identity,
    capturedAt,
    resources: [],
    ports: [],
    captureFailure: stableFailureCode(error),
  };
}

function unavailableCleanup(
  identity: FormalRunIdentity,
  completedAt: string,
  error: unknown,
  runtimeAuthority: LoadedPodmanRuntimeAuthority,
): FormalCleanupReport {
  const code = stableFailureCode(error);
  return {
    schemaVersion: 'phase-01.formal-cleanup.v1',
    runIdentity: identity,
    startedAt: completedAt,
    completedAt,
    status: 'FAILED',
    actions: [],
    failedItems: [{
      resourceType: 'runtime',
      resourceId: identity.runId,
      resourceName: identity.runtimeNamespace,
      errorCode: code,
    }],
    residualResources: [],
    occupiedPorts: [],
    pruneCommandsInvoked: false,
    runtimeAuthority: {
      expectedSha256: runtimeAuthority.runtimeAuthoritySha256,
      observedAfterSha256: null,
      expectedSemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
      observedAfterSemanticDigest: null,
      stable: false,
    },
    restartPolicyFindings: [],
    dockerSecondAuthorityFindings: [],
    partialStartupRecoveryFindings: [],
    persistenceFindings: [],
    residualCounts: { process: 0, container: 0, volume: 0, network: 0 },
  };
}

async function writeBestEffortFailure(
  fileSystem: FormalRuntimeFileSystem,
  root: string,
  relativePath: string,
  error: unknown,
  occurredAt: string,
): Promise<void> {
  try {
    await fileSystem.writeJsonExclusive(root, relativePath, {
      schemaVersion: 'phase-01.formal-finalization-failure.v1',
      errorCode: stableFailureCode(error),
      error: sanitizeFailure(error),
      occurredAt,
    });
  } catch {
    // The original failure remains authoritative; never delete or overwrite evidence to report it.
  }
}

async function writeBestEffortManifestFailure(
  fileSystem: FormalRuntimeFileSystem,
  root: string,
  identity: FormalRunIdentity,
  failureCodes: readonly string[],
  error: unknown,
  occurredAt: string,
): Promise<void> {
  try {
    await fileSystem.writeJsonExclusive(root, 'runtime/manifest-failure.json', {
      schemaVersion: 'phase-01.formal-runtime-terminal-failure.v1',
      runIdentity: identity,
      status: 'FAILED',
      failureCodes,
      errorCode: stableFailureCode(error),
      error: sanitizeFailure(error),
      supersedesPreSealOutcome: 'runtime/final-outcome.json',
      occurredAt,
    });
  } catch {
    // A failed seal cannot be made valid by overwriting or deleting partial evidence.
  }
}

function sanitizeFailure(error: unknown): string {
  let value = redactSensitiveText(errorMessage(error));
  for (const name of FORMAL_REQUIRED_SECRET_NAMES) {
    const secret = process.env[name];
    if (secret !== undefined && secret.length > 0) value = value.replaceAll(secret, '[REDACTED]');
  }
  return value.slice(0, 2_000);
}

function projectFormalRuntimeLabels(
  labels: object,
  identity: FormalRunSeed,
  authority: PodmanRuntimeAuthority,
): Readonly<Record<string, string>> {
  const values = labels as Readonly<Record<string, unknown>>;
  return Object.fromEntries(Object.keys(formalRuntimeLabels(identity, authority)).flatMap((name) =>
    typeof values[name] === 'string' ? [[name, values[name]]] : [],
  ));
}

function stableFailureCode(error: unknown): string {
  const message = errorMessage(error);
  return (/^[A-Z0-9_:-]+$/u.test(message) ? message : 'FORMAL_RUNTIME_OPERATION_FAILED').slice(0, 200);
}

function preflightLockDigest(preflight: FormalPreflightReport): string | null {
  const check = preflight.checks.find((candidate) => candidate.id === 'npm-lockfile');
  if (check === undefined || typeof check.observed !== 'object' || check.observed === null) return null;
  const digest = (check.observed as Readonly<Record<string, unknown>>)['sha256'];
  return typeof digest === 'string' && /^[0-9a-f]{64}$/u.test(digest) ? digest : null;
}
