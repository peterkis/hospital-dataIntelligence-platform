import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  Ar12ExternalExecutionWorkspaceRunError,
  ar12SummaryRepositoryBoundaryFields,
  ar12CliFailurePayload,
  assertAr12CommandPlanSafety,
  createAr12CommandSpecs,
  isAr12OrchestratorDirectInvocation,
  isAr12AdversarialFloorSatisfied,
  parseAr12CliArguments,
  preflightAr12RunOutput,
  runAr12InExternalExecutionWorkspace,
  runAfterAr12ExecutionWorkspaceGate,
  runAr12OrchestratorCli,
  validateAr12RepositoryBoundaryArtifact,
  verifyAr12RepositoryBoundary,
} from './ar-12-orchestrator.js';
import {
  Ar12ExecutionWorkspaceCreationError,
  Ar12ExecutionWorkspaceError,
  assertRepositoryNotContaminatedByExecutionWorkspace,
  createAr12ExecutionWorkspace,
  defaultAr12ExecutionWorkspaceDependencies,
} from './ar-12-execution-workspace.js';

const EXPECTED_COMMAND_IDS = [
  'npm-ci',
  'check-runtime',
  'check-repo-layout',
  'check-module-boundaries',
  'typecheck-root',
  'typecheck-governance-api',
  'typecheck-verification-tooling',
  'build',
  'contract-lint',
  'verify-abg-coverage',
  'verify-source-manifest',
  'verify-podman-authority',
  'e2e-list',
  'bash-syntax-bootstrap-phase-01-runtime',
  'bash-syntax-bootstrap-phase-01',
  'bash-syntax-configure-podman-proxy',
  'bash-syntax-podman-phase-01-runtime',
  'bash-syntax-verify-phase-01-runtime',
  'ar01-coverage-focused',
  'ar02-evidence-focused',
  'ar03-gate-proof-focused',
  'verification-full',
  'verification-lifecycle',
  'verification-adversarial',
  'verification-provenance',
  'verification-podman-runtime',
  'testcontainers-synthetic-guard',
  'standalone-teardown-snapshot',
  'ar09-valid-terminal-fixture',
  'ar09-cleanup-failed-fixture',
  'ar09-terminal-missing-fixture',
  'ar10-exact-contract-fixture',
  'ar10-commit-unavailable-fixture',
  'ar10-compatible-drift-fixture',
  'ar10-incompatible-tuple-fixture',
  'ar10-evidence-tamper-observed',
  'ar11-docker-socket-alias',
  'ar11-persistent-restart',
  'ar11-keycloak-create-failure',
  'ar11-bootstrap-migration-failure',
  'ar11-exact-source-provenance',
  'git-diff-check',
] as const;

function fakeHistoryBaseline(digest = 'a'.repeat(64)) {
  const classifications = [
    'INIT_ONLY_HISTORY',
    'DEPENDENCY_INSTALL_FAILURE_HISTORY',
    'TOOL_DISCOVERY_FAILURE_HISTORY',
    'INITIAL_REBASELINE_PASSED_HISTORY',
    'CLOSEOUT_FINAL_FAILURE_HISTORY',
    'SUMMARY_CONTRACT_FAILED_HISTORY',
  ] as const;
  return {
    schemaVersion: 'phase-01.ar-12-history-evidence-baseline.v1' as const,
    historyContractDigest: 'c'.repeat(64),
    requiredHistoryCount: 6 as const,
    requiredHistoryPassedCount: 6 as const,
    requiredHistories: classifications.map((classification, index) => ({
      historyId: `history-${index + 1}`,
      relativeDirectory: `history-${index + 1}`,
      classification,
      formalAcceptanceEligible: false as const,
      contractDisposition: classification === 'SUMMARY_CONTRACT_FAILED_HISTORY'
        ? 'REJECTED' as const
        : 'ACCEPTED' as const,
      rejectionClassification: classification === 'SUMMARY_CONTRACT_FAILED_HISTORY'
        ? 'SUMMARY_CONTRACT_FAILED_HISTORY' as const
        : null,
      directoryTreeDigest: 'f'.repeat(64),
      fileCount: 1,
      requiredArtifacts: [],
      requiredArtifactStatus: 'PASSED' as const,
    })),
    recoveryArtifact: {
      relativePath: 'recovery/receipt.json',
      sha256: 'd'.repeat(64),
      status: 'PASSED' as const,
      treeDigestBefore: 'e'.repeat(64),
      treeDigestAfter: 'e'.repeat(64),
      failedFinalEvidencePreserved: true as const,
    },
    staleCloneStatus: 'ABSENT' as const,
    requiredEntriesStatus: 'PASSED' as const,
    discoveredAdditionalHistories: [],
    entries: [{
      relativePath: '20260830-deadbee-final',
      kind: 'DIRECTORY' as const,
      fileCount: 1,
      digest: 'b'.repeat(64),
    }],
    historicalEvidenceSetDigest: digest,
    digest,
    capturedAt: '2026-08-31T12:00:00.000Z',
  };
}

describe('AR-12 rebaseline orchestrator', () => {
  it('verifies contamination, layout, and immutable history before finalization', async () => {
    const opening = fakeHistoryBaseline();
    const events: string[] = [];
    const result = await verifyAr12RepositoryBoundary({
      sourceRepositoryRoot: 'D:\\source',
      outputRoot: 'D:\\evidence',
      runDirectory: 'D:\\evidence\\run-01',
      openingHistoryEvidence: opening,
      checkedAt: '2026-08-31T12:00:00.000Z',
    }, {
      assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
        events.push('contamination');
      },
      verifyRepositoryLayout: async () => {
        events.push('layout');
      },
      captureHistoryEvidenceSnapshot: async () => {
        events.push('history');
        return opening;
      },
    });
    expect(events).toEqual(['contamination', 'layout', 'history']);
    expect(result).toEqual({
      schemaVersion: 'phase-01.ar-12-repository-boundary.v1',
      repositoryContaminationGuard: 'PASSED',
      repoLayoutStatus: 'PASSED',
      historyEvidenceStable: true,
      openingHistoryEvidenceDigest: 'a'.repeat(64),
      endingHistoryEvidenceDigest: 'a'.repeat(64),
      protectedHistoryEntryCount: 1,
      historyEvidenceContractDigest: 'c'.repeat(64),
      historicalEvidenceSetDigest: 'a'.repeat(64),
      requiredHistoryCount: 6,
      requiredHistoryPassedCount: 6,
      checkedAt: '2026-08-31T12:00:00.000Z',
    });

    await expect(verifyAr12RepositoryBoundary({
      sourceRepositoryRoot: 'D:\\source',
      outputRoot: 'D:\\evidence',
      runDirectory: 'D:\\evidence\\run-01',
      openingHistoryEvidence: opening,
      checkedAt: '2026-08-31T12:00:00.000Z',
    }, {
      assertRepositoryNotContaminatedByExecutionWorkspace: async () => {},
      verifyRepositoryLayout: async () => {},
      captureHistoryEvidenceSnapshot: async () => ({
        ...opening,
        historicalEvidenceSetDigest: 'b'.repeat(64),
        digest: 'b'.repeat(64),
      }),
    })).rejects.toThrowError('AR12_HISTORY_EVIDENCE_SET_DRIFT');
  });

  it('projects only a fully passed repository boundary into required summary fields', () => {
    expect(ar12SummaryRepositoryBoundaryFields({
      schemaVersion: 'phase-01.ar-12-repository-boundary.v1',
      repositoryContaminationGuard: 'PASSED',
      repoLayoutStatus: 'PASSED',
      historyEvidenceStable: true,
      openingHistoryEvidenceDigest: 'a'.repeat(64),
      endingHistoryEvidenceDigest: 'a'.repeat(64),
      protectedHistoryEntryCount: 6,
      historyEvidenceContractDigest: 'c'.repeat(64),
      historicalEvidenceSetDigest: 'a'.repeat(64),
      requiredHistoryCount: 6,
      requiredHistoryPassedCount: 6,
      checkedAt: '2026-08-31T12:00:00.000Z',
    })).toEqual({
      repositoryContaminationGuard: 'PASSED',
      repoLayoutStatus: 'PASSED',
      historyEvidenceStable: true,
    });

    expect(() => ar12SummaryRepositoryBoundaryFields({
      schemaVersion: 'phase-01.ar-12-repository-boundary.v1',
      repositoryContaminationGuard: 'PASSED',
      repoLayoutStatus: 'PASSED',
      historyEvidenceStable: false,
      openingHistoryEvidenceDigest: 'a'.repeat(64),
      endingHistoryEvidenceDigest: 'b'.repeat(64),
      protectedHistoryEntryCount: 6,
      historyEvidenceContractDigest: 'c'.repeat(64),
      historicalEvidenceSetDigest: 'a'.repeat(64),
      requiredHistoryCount: 6,
      requiredHistoryPassedCount: 6,
      checkedAt: '2026-08-31T12:00:00.000Z',
    })).toThrowError('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
  });

  it('rejects a repository boundary artifact whose bytes changed after command execution', () => {
    const openingHistoryEvidence = fakeHistoryBaseline();
    const result = {
      schemaVersion: 'phase-01.ar-12-repository-boundary.v1' as const,
      repositoryContaminationGuard: 'PASSED' as const,
      repoLayoutStatus: 'PASSED' as const,
      historyEvidenceStable: true,
      openingHistoryEvidenceDigest: openingHistoryEvidence.digest,
      endingHistoryEvidenceDigest: openingHistoryEvidence.digest,
      protectedHistoryEntryCount: openingHistoryEvidence.entries.length,
      historyEvidenceContractDigest: openingHistoryEvidence.historyContractDigest,
      historicalEvidenceSetDigest: openingHistoryEvidence.historicalEvidenceSetDigest,
      requiredHistoryCount: openingHistoryEvidence.requiredHistoryCount,
      requiredHistoryPassedCount: openingHistoryEvidence.requiredHistoryPassedCount,
      checkedAt: '2026-08-31T12:00:00.000Z',
    };
    const artifactBytes = Buffer.from(JSON.stringify(result, null, 2) + '\n', 'utf8');
    const expectedSha256 = createHash('sha256').update(artifactBytes).digest('hex');
    expect(validateAr12RepositoryBoundaryArtifact({
      result,
      artifactBytes,
      expectedSha256,
      openingHistoryEvidence,
    })).toEqual({
      repositoryContaminationGuard: 'PASSED',
      repoLayoutStatus: 'PASSED',
      historyEvidenceStable: true,
    });
    expect(() => validateAr12RepositoryBoundaryArtifact({
      result,
      artifactBytes: Buffer.from(
        JSON.stringify({ ...result, checkedAt: '2026-08-31T12:00:01.000Z' }, null, 2) + '\n',
      ),
      expectedSha256,
      openingHistoryEvidence,
    })).toThrowError('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
  });

  it('freezes all 42 commands and keeps repository layout as command 03', () => {
    const commands = createAr12CommandSpecs();

    expect(commands.map((command) => command.id)).toEqual(EXPECTED_COMMAND_IDS);
    expect(commands[2]).toMatchObject({
      id: 'check-repo-layout',
      executable: 'npm',
      args: ['run', 'check:repo:layout'],
      cwd: '.',
      expectedExitCodes: [0],
    });
    expect(new Set(commands.map((command) => command.id)).size).toBe(42);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(commands.every((command) => Object.isFrozen(command))).toBe(true);
  });

  it('requires at least 158 detected adversarial mutations with zero survivors', () => {
    expect(isAr12AdversarialFloorSatisfied({
      mutationCount: 157,
      detectedCount: 157,
      survivedCount: 0,
    })).toBe(false);
    expect(isAr12AdversarialFloorSatisfied({
      mutationCount: 158,
      detectedCount: 158,
      survivedCount: 0,
    })).toBe(true);
    expect(isAr12AdversarialFloorSatisfied({
      mutationCount: 158,
      detectedCount: 157,
      survivedCount: 1,
    })).toBe(false);
  });

  it('rejects removing, moving, or changing the repository layout gate', () => {
    const commands = createAr12CommandSpecs();
    const withoutGate = commands.filter((command) => command.id !== 'check-repo-layout');
    const movedGate = [commands[0]!, commands[2]!, commands[1]!, ...commands.slice(3)];
    const changedGate = commands.map((command, index) => index === 2
      ? { ...command, args: ['run', 'check:module-boundaries'] }
      : command);

    for (const unsafePlan of [withoutGate, movedGate, changedGate]) {
      expect(() => assertAr12CommandPlanSafety(unsafePlan)).toThrowError(
        /^AR12_REPO_LAYOUT_GATE_BYPASS_FORBIDDEN/u,
      );
    }
  });

  it('checks the execution workspace before command 01 and fails closed', async () => {
    const events: string[] = [];
    await runAfterAr12ExecutionWorkspaceGate(
      'D:\\repository',
      async () => {
        events.push('command-01');
      },
      async () => {
        events.push('execution-workspace-gate');
      },
    );
    expect(events).toEqual(['execution-workspace-gate', 'command-01']);

    await expect(runAfterAr12ExecutionWorkspaceGate(
      'D:\\repository',
      async () => {
        events.push('must-not-run');
      },
      async () => {
        throw new Error('AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE');
      },
    )).rejects.toThrowError('AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE');
    expect(events).not.toContain('must-not-run');
  });

  it('parses the production mode and three recovery CLI modes without executing them', () => {
    const execute = parseAr12CliArguments([
      'execute-in-workspace',
      '--source-repository-root', 'D:\\source',
      '--output-root', 'D:\\evidence',
      '--run-dir', 'D:\\evidence\\run-01',
      '--expected-branch', 'phase-01-acceptance-readiness',
      '--expected-commit', '0123456789012345678901234567890123456789',
      '--run-kind', 'initial',
    ]);
    const init = parseAr12CliArguments([
      'init',
      '--repository-root', 'D:\\repository',
      '--source-repository-root', 'D:\\source',
      '--output-root', 'D:\\evidence',
      '--run-directory', 'D:\\evidence\\run-01',
      '--expected-branch', 'phase-01-acceptance-readiness',
      '--expected-commit', '0123456789012345678901234567890123456789',
      '--kind', 'initial',
    ]);
    const run = parseAr12CliArguments([
      'run-commands', '--repository-root', 'D:\\repository', '--run-dir', 'D:\\run',
    ]);
    const finalize = parseAr12CliArguments([
      'finalize', '--repository-root', 'D:\\repository', '--run-dir', 'D:\\run',
    ]);

    expect(execute.mode).toBe('execute-in-workspace');
    expect(execute.options.get('--source-repository-root')).toBe('D:\\source');
    expect(init.mode).toBe('init');
    expect(init.options.get('--run-dir')).toBe('D:\\evidence\\run-01');
    expect(init.options.get('--run-kind')).toBe('initial');
    expect(run.mode).toBe('run-commands');
    expect(finalize.mode).toBe('finalize');
    expect(() => parseAr12CliArguments(['execute'])).toThrowError('AR12_MODE_INVALID');
  });

  it('dispatches the production CLI through the integrated external-workspace entry', async () => {
    const openingGitCommitSha = 'b'.repeat(40);
    const observedInputs: unknown[] = [];
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await runAr12OrchestratorCli([
        'execute-in-workspace',
        '--source-repository-root', 'D:\\source',
        '--output-root', 'D:\\evidence',
        '--run-dir', 'D:\\evidence\\run-01',
        '--expected-branch', 'phase-01-acceptance-readiness',
        '--expected-commit', openingGitCommitSha,
        '--run-kind', 'final',
      ], {
        runAr12InExternalExecutionWorkspace: async (input) => {
          observedInputs.push(input);
          return {
            status: 'PASSED',
            workspacePathDigest: 'c'.repeat(64),
            terminalIdentity: {
              gitCommitSha: openingGitCommitSha,
              branch: 'phase-01-acceptance-readiness',
              originUrl: 'https://github.com/hospital/platform.git',
              worktreeState: 'CLEAN',
            },
            cleanupStatus: 'CLEANED',
            runDirectory: 'D:\\evidence\\run-01',
          };
        },
      });
    } finally {
      stdout.mockRestore();
    }

    expect(observedInputs).toEqual([expect.objectContaining({
      sourceRepositoryRoot: 'D:\\source',
      outputRoot: 'D:\\evidence',
      runDirectory: 'D:\\evidence\\run-01',
      expectedBranch: 'phase-01-acceptance-readiness',
      expectedCommit: openingGitCommitSha,
      runKind: 'final',
    })]);
    expect(JSON.parse(writes.join('').trim())).toMatchObject({
      status: 'PASSED',
      mode: 'execute-in-workspace',
      workspacePathDigest: 'c'.repeat(64),
      cleanupStatus: 'CLEANED',
    });
  });

  it('requires an explicit source repository for recovery commands in a marked clone', async () => {
    const events: string[] = [];
    const marker = {
      schemaVersion: 'phase-01.ar12-execution-workspace.v1' as const,
      repositoryIdentity: 'hospital/platform',
      sourceRepositoryRootDigest: 'a'.repeat(64),
      openingGitCommitSha: 'b'.repeat(40),
      targetBranch: 'phase-01-acceptance-readiness',
      runPurpose: 'AR-12_REBASELINE',
      createdAt: '2026-08-31T00:00:00.000Z',
      externalWorkspaceRoot: 'E:\\external',
      formalAcceptanceEligible: false as const,
    };
    const dependencies = {
      repositoryContainsExecutionWorkspaceMarker: async () => true,
      loadAr12ExecutionWorkspaceMarker: async (repositoryRoot: string) => {
        events.push(`load-marker:${repositoryRoot}`);
        return marker;
      },
      runCommands: async (
        repositoryRoot: string,
        _runDirectory: string,
        options: { readonly contaminationRepositoryRoot: string },
      ) => {
        events.push(`run:${repositoryRoot}:${options.contaminationRepositoryRoot}`);
      },
    };

    await expect(runAr12OrchestratorCli([
      'run-commands',
      '--repository-root', 'E:\\external\\run-01',
      '--run-dir', 'D:\\evidence\\run-01',
    ], dependencies)).rejects.toThrowError('AR12_SOURCE_REPOSITORY_ROOT_REQUIRED');
    expect(events).toEqual(['load-marker:E:\\external\\run-01']);

    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runAr12OrchestratorCli([
        'run-commands',
        '--repository-root', 'E:\\external\\run-01',
        '--source-repository-root', 'D:\\source',
        '--run-dir', 'D:\\evidence\\run-01',
      ], dependencies);
    } finally {
      stdout.mockRestore();
    }
    expect(events).toEqual([
      'load-marker:E:\\external\\run-01',
      'load-marker:E:\\external\\run-01',
      'run:E:\\external\\run-01:D:\\source',
    ]);
  });

  it('rejects every recovery mode when the repository has no execution marker', async () => {
    const events: string[] = [];
    const dependencies = {
      repositoryContainsExecutionWorkspaceMarker: async (repositoryRoot: string) => {
        events.push(`probe:${repositoryRoot}`);
        return false;
      },
      initialize: async () => {
        events.push('must-not-init');
      },
      runCommands: async () => {
        events.push('must-not-run');
      },
      finalize: async () => {
        events.push('must-not-finalize');
      },
    };
    const repositoryRoot = 'D:\\source';
    const runDirectory = 'D:\\evidence\\run-01';
    const cases = [
      [
        'init',
        '--repository-root', repositoryRoot,
        '--output-root', 'D:\\evidence',
        '--run-dir', runDirectory,
        '--expected-branch', 'phase-01-acceptance-readiness',
        '--expected-commit', 'b'.repeat(40),
        '--run-kind', 'final',
      ],
      [
        'run-commands',
        '--repository-root', repositoryRoot,
        '--source-repository-root', repositoryRoot,
        '--run-dir', runDirectory,
      ],
      [
        'finalize',
        '--repository-root', repositoryRoot,
        '--run-dir', runDirectory,
      ],
    ];

    for (const args of cases) {
      await expect(runAr12OrchestratorCli(args, dependencies)).rejects.toThrowError(
        'AR12_RECOVERY_EXECUTION_WORKSPACE_MARKER_REQUIRED',
      );
    }
    expect(events).toEqual([
      'probe:D:\\source',
      'probe:D:\\source',
      'probe:D:\\source',
    ]);
  });

  it('recognizes only direct CLI invocation', () => {
    const modulePath = resolve('tooling/verification/src/rebaseline/ar-12-orchestrator.ts');
    const moduleUrl = pathToFileURL(modulePath).href;

    expect(isAr12OrchestratorDirectInvocation(modulePath, moduleUrl)).toBe(true);
    expect(isAr12OrchestratorDirectInvocation(resolve('another-module.ts'), moduleUrl)).toBe(false);
    expect(isAr12OrchestratorDirectInvocation(undefined, moduleUrl)).toBe(false);
  });

  it('preserves stable workspace error codes and retained terminal receipts for CLI output', () => {
    expect(ar12CliFailurePayload(new Ar12ExecutionWorkspaceError(
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
      'terminal identity differs with detail',
    ))).toEqual({
      status: 'FAILED',
      code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    });

    const terminalIdentity = {
      gitCommitSha: 'b'.repeat(40),
      branch: 'phase-01-acceptance-readiness',
      originUrl: 'https://github.com/hospital/platform.git',
      worktreeState: 'DIRTY' as const,
    };
    const retainedWorkspace = {
      schemaVersion: 'phase-01.ar-12-retained-workspace.v1' as const,
      status: 'RETAINED' as const,
      failureCode: 'AR12_COMMAND_SEQUENCE_FAILED',
      workspacePathDigest: 'c'.repeat(64),
      terminalIdentity,
      evidenceRecordStatus: 'RECORDED' as const,
    };
    expect(ar12CliFailurePayload(new Ar12ExternalExecutionWorkspaceRunError({
      code: 'AR12_COMMAND_SEQUENCE_FAILED',
      cause: new Error('AR12_COMMAND_SEQUENCE_FAILED'),
      retainedWorkspace,
    }))).toEqual({
      status: 'FAILED',
      code: 'AR12_COMMAND_SEQUENCE_FAILED',
      retainedWorkspace,
    });
  });

  it('runs the full production lifecycle in the external clone and then cleans it', async () => {
    const sourceRepositoryRoot = 'D:\\source';
    const workspacePath = 'E:\\external\\run-01';
    const runDirectory = 'D:\\evidence\\run-01';
    const openingGitCommitSha = 'b'.repeat(40);
    const marker = {
      schemaVersion: 'phase-01.ar12-execution-workspace.v1' as const,
      repositoryIdentity: 'hospital/platform',
      sourceRepositoryRootDigest: 'a'.repeat(64),
      openingGitCommitSha,
      targetBranch: 'phase-01-acceptance-readiness',
      runPurpose: 'AR-12_REBASELINE',
      createdAt: '2026-08-31T00:00:00.000Z',
      externalWorkspaceRoot: 'E:\\external',
      formalAcceptanceEligible: false as const,
    };
    const terminalIdentity = {
      gitCommitSha: openingGitCommitSha,
      branch: marker.targetBranch,
      originUrl: 'https://github.com/hospital/platform.git',
      worktreeState: 'CLEAN' as const,
    };
    const events: string[] = [];
    let recordedTerminal: unknown;

    const result = await runAr12InExternalExecutionWorkspace({
      sourceRepositoryRoot,
      outputRoot: 'D:\\evidence',
      runDirectory,
      expectedBranch: marker.targetBranch,
      expectedCommit: openingGitCommitSha,
      runKind: 'final',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: 'E:\\external' },
    }, {
      assertRepositoryNotContaminatedByExecutionWorkspace: async (repositoryRoot) => {
        events.push(`source-gate:${repositoryRoot}`);
      },
      preflightAr12RunOutput: async (repositoryRoot) => {
        events.push(`output-preflight:${repositoryRoot}`);
      },
      validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
      createAr12ExecutionWorkspace: async (input) => {
        events.push(`create:${input.repositoryRoot}`);
        return {
          workspacePath,
          resolved: {
            repositoryRoot: sourceRepositoryRoot,
            canonicalRepositoryRoot: sourceRepositoryRoot,
            repositoryId: 'source',
            externalWorkspaceRoot: 'E:\\external',
            canonicalExternalWorkspaceRoot: 'E:\\external',
            workspacePath,
            canonicalWorkspacePath: workspacePath,
            runIdentity: 'run-01',
          },
          marker,
        };
      },
      loadAr12ExecutionWorkspaceMarker: async (path) => {
        events.push(`load-marker:${path}`);
        return marker;
      },
      initialize: async (input) => {
        events.push(`init:${input.repositoryRoot}`);
      },
      runCommands: async (repositoryRoot, _runDirectory, options) => {
        events.push(`command-gate:${options.contaminationRepositoryRoot}`);
        events.push(`run-42:${repositoryRoot}`);
      },
      finalize: async (repositoryRoot) => {
        events.push(`finalize:${repositoryRoot}`);
      },
      verifyAr12ExecutionWorkspace: async (path) => {
        events.push(`verify:${path}`);
        return terminalIdentity;
      },
      recordSuccessfulWorkspace: async (repositoryRoot, _runDirectory, receipt) => {
        events.push(`record-terminal:${repositoryRoot}`);
        recordedTerminal = receipt;
      },
      cleanupAr12ExecutionWorkspace: async (path, _marker, options) => {
        events.push(`cleanup:${path}:${options.repositoryRoot}`);
      },
      retainAr12ExecutionWorkspaceAfterFailure: async () => {
        throw new Error('retain must not run after success');
      },
      recordRetainedWorkspace: async () => {
        throw new Error('retention record must not be written after success');
      },
    });

    expect(events).toEqual([
      'source-gate:D:\\source',
      'output-preflight:D:\\source',
      'create:D:\\source',
      'load-marker:E:\\external\\run-01',
      'init:E:\\external\\run-01',
      'command-gate:D:\\source',
      'run-42:E:\\external\\run-01',
      'finalize:E:\\external\\run-01',
      'verify:E:\\external\\run-01',
      'record-terminal:D:\\source',
      'cleanup:E:\\external\\run-01:D:\\source',
    ]);
    expect(recordedTerminal).toEqual({
      schemaVersion: 'phase-01.ar-12-workspace-terminal.v1',
      status: 'VERIFIED_FOR_CLEANUP',
      workspacePathDigest: '2b1942e3e923a9cc60cbd1e6170379c97bc767ccec72381491c8f6d6bbb90eb9',
      terminalIdentity,
      cleanupStatus: 'PENDING',
    });
    expect(result).toEqual({
      status: 'PASSED',
      workspacePathDigest: '2b1942e3e923a9cc60cbd1e6170379c97bc767ccec72381491c8f6d6bbb90eb9',
      terminalIdentity,
      cleanupStatus: 'CLEANED',
      runDirectory,
    });
  });

  it('retains the external clone and records terminal identity when a phase fails', async () => {
    const sourceRepositoryRoot = 'D:\\source';
    const workspacePath = 'E:\\external\\run-01';
    const runDirectory = 'D:\\evidence\\run-01';
    const openingGitCommitSha = 'b'.repeat(40);
    const marker = {
      schemaVersion: 'phase-01.ar12-execution-workspace.v1' as const,
      repositoryIdentity: 'hospital/platform',
      sourceRepositoryRootDigest: 'a'.repeat(64),
      openingGitCommitSha,
      targetBranch: 'phase-01-acceptance-readiness',
      runPurpose: 'AR-12_REBASELINE',
      createdAt: '2026-08-31T00:00:00.000Z',
      externalWorkspaceRoot: 'E:\\external',
      formalAcceptanceEligible: false as const,
    };
    const terminalIdentity = {
      gitCommitSha: openingGitCommitSha,
      branch: marker.targetBranch,
      originUrl: 'https://github.com/hospital/platform.git',
      worktreeState: 'DIRTY' as const,
    };
    const events: string[] = [];
    let recordedReceipt: unknown;
    let observedError: unknown;

    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot,
        outputRoot: 'D:\\evidence',
        runDirectory,
        expectedBranch: marker.targetBranch,
        expectedCommit: openingGitCommitSha,
        runKind: 'final',
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
          events.push('source-gate');
        },
        preflightAr12RunOutput: async () => {
          events.push('output-preflight');
        },
        validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
        createAr12ExecutionWorkspace: async () => {
          events.push('create');
          return {
            workspacePath,
            resolved: {
              repositoryRoot: sourceRepositoryRoot,
              canonicalRepositoryRoot: sourceRepositoryRoot,
              repositoryId: 'source',
              externalWorkspaceRoot: 'E:\\external',
              canonicalExternalWorkspaceRoot: 'E:\\external',
              workspacePath,
              canonicalWorkspacePath: workspacePath,
              runIdentity: 'run-01',
            },
            marker,
          };
        },
        loadAr12ExecutionWorkspaceMarker: async () => {
          events.push('load-marker');
          return marker;
        },
        initialize: async () => {
          events.push('init');
        },
        runCommands: async () => {
          events.push('run-42');
          throw new Error('AR12_COMMAND_SEQUENCE_FAILED');
        },
        finalize: async () => {
          events.push('must-not-finalize');
        },
        verifyAr12ExecutionWorkspace: async () => {
          throw new Error('success verification must not run');
        },
        recordSuccessfulWorkspace: async () => {
          events.push('must-not-record-success');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          events.push('must-not-cleanup');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          events.push('retain');
          return { retained: true, terminalIdentity };
        },
        recordRetainedWorkspace: async (repositoryRoot, _runDirectory, receipt) => {
          events.push(`record-retention:${repositoryRoot}`);
          recordedReceipt = receipt;
        },
      });
    } catch (error) {
      observedError = error;
    }

    expect(events).toEqual([
      'source-gate',
      'output-preflight',
      'create',
      'load-marker',
      'init',
      'run-42',
      'retain',
      'record-retention:D:\\source',
    ]);
    expect(recordedReceipt).toEqual({
      schemaVersion: 'phase-01.ar-12-retained-workspace.v1',
      status: 'RETAINED',
      failureCode: 'AR12_COMMAND_SEQUENCE_FAILED',
      workspacePathDigest: '2b1942e3e923a9cc60cbd1e6170379c97bc767ccec72381491c8f6d6bbb90eb9',
      terminalIdentity,
      evidenceRecordStatus: 'RECORDED',
    });
    expect(observedError).toBeInstanceOf(Ar12ExternalExecutionWorkspaceRunError);
    expect(observedError).toMatchObject({
      code: 'AR12_COMMAND_SEQUENCE_FAILED',
      retainedWorkspace: recordedReceipt,
    });
  });

  it('reports a retained partial clone without writing into an unowned run directory', async () => {
    const partialError = new Ar12ExecutionWorkspaceCreationError({
      workspacePath: 'E:\\external\\run-01',
      workspacePathDigest: 'd'.repeat(64),
      partialRetained: true,
      terminalIdentity: {
        gitCommitSha: 'b'.repeat(40),
        branch: 'phase-01-acceptance-readiness',
        originUrl: 'D:\\source',
        worktreeState: 'CLEAN',
      },
      identityFailureCode: null,
      failureCode: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      failureStage: 'CHECKOUT',
    });
    const events: string[] = [];
    let observedError: unknown;

    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot: 'D:\\source',
        outputRoot: 'D:\\evidence',
        runDirectory: 'D:\\evidence\\run-01',
        expectedBranch: 'phase-01-acceptance-readiness',
        expectedCommit: 'b'.repeat(40),
        runKind: 'final',
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
          events.push('source-gate');
        },
        preflightAr12RunOutput: async () => {
          events.push('output-preflight');
        },
        validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
        createAr12ExecutionWorkspace: async () => {
          events.push('create');
          throw partialError;
        },
        loadAr12ExecutionWorkspaceMarker: async () => {
          throw new Error('marker must not load after partial creation');
        },
        initialize: async () => {
          events.push('must-not-init');
        },
        runCommands: async () => {
          events.push('must-not-run');
        },
        finalize: async () => {
          events.push('must-not-finalize');
        },
        verifyAr12ExecutionWorkspace: async () => {
          throw new Error('must not verify unmarked partial clone');
        },
        recordSuccessfulWorkspace: async () => {
          events.push('must-not-record-success');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          events.push('must-not-cleanup');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          events.push('must-not-retain-without-marker');
          throw new Error('must not retain through marker authority');
        },
        recordRetainedWorkspace: async () => {
          events.push('must-not-record-phase-retention');
        },
      });
    } catch (error) {
      observedError = error;
    }

    expect(events).toEqual(['source-gate', 'output-preflight', 'create']);
    const outputOnlyReceipt = {
      schemaVersion: 'phase-01.ar-12-partial-creation.v1',
      status: 'PARTIAL_RETAINED',
      failureCode: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      failureStage: 'CHECKOUT',
      workspacePathDigest: 'd'.repeat(64),
      partialRetained: true,
      terminalIdentity: {
        gitCommitSha: 'b'.repeat(40),
        branch: 'phase-01-acceptance-readiness',
        worktreeState: 'CLEAN',
      },
      identityUnavailable: false,
      identityFailureCode: null,
      evidenceRecordStatus: 'OUTPUT_ONLY',
    };
    expect(observedError).toBeInstanceOf(Ar12ExternalExecutionWorkspaceRunError);
    expect(observedError).toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      partialCreation: outputOnlyReceipt,
    });
    expect((observedError as Error).cause).toMatchObject({
      message: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
    });
    expect((observedError as Error).cause).not.toHaveProperty('workspacePath');
    const cliPayload = ar12CliFailurePayload(observedError);
    expect(cliPayload).toMatchObject({
      status: 'FAILED',
      code: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      partialCreation: outputOnlyReceipt,
    });
    expect(JSON.stringify(cliPayload)).not.toContain('D:\\source');
    expect(JSON.stringify(cliPayload)).not.toContain('E:\\external\\run-01');
  });

  it('propagates a real origin-restore partial failure as an output-only redacted receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hdi-ar12-wrapper-partial-'));
    const sourceRepositoryRoot = join(root, 'source');
    const outputRoot = join(root, 'evidence');
    const runDirectory = join(outputRoot, 'fresh-origin-failure');
    const externalRoot = join(root, 'external');
    const workspacePath = join(externalRoot, 'fresh-origin-failure');
    await mkdir(sourceRepositoryRoot);
    await mkdir(outputRoot);
    gitForTest(sourceRepositoryRoot, 'init', '-b', 'phase-01-acceptance-readiness');
    gitForTest(sourceRepositoryRoot, 'config', 'user.email', 'ar12@example.invalid');
    gitForTest(sourceRepositoryRoot, 'config', 'user.name', 'AR-12 Test');
    await writeFile(join(sourceRepositoryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    await writeFile(join(sourceRepositoryRoot, 'README.md'), 'fixture\n');
    gitForTest(sourceRepositoryRoot, 'add', 'package-lock.json', 'README.md');
    gitForTest(sourceRepositoryRoot, 'commit', '-m', 'fixture');
    gitForTest(
      sourceRepositoryRoot,
      'remote',
      'add',
      'origin',
      'https://github.com/example/hospital-data-intelligence-platform.git',
    );
    const openingCommit = gitForTest(sourceRepositoryRoot, 'rev-parse', 'HEAD');
    const base = defaultAr12ExecutionWorkspaceDependencies();
    let observedError: unknown;

    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot,
        outputRoot,
        runDirectory,
        expectedBranch: 'phase-01-acceptance-readiness',
        expectedCommit: openingCommit,
        runKind: 'final',
        environment: { AR12_EXECUTION_WORKSPACE_ROOT: externalRoot },
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace,
        preflightAr12RunOutput,
        validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
        createAr12ExecutionWorkspace: async (input) => createAr12ExecutionWorkspace(input, {
          ...base,
          git: {
            run: async (cwd, arguments_, environment) => {
              if (arguments_.includes('remote') && arguments_.includes('set-url')) {
                throw new Error('AR12_TEST_ORIGIN_RESTORE_FAILED');
              }
              return base.git.run(cwd, arguments_, environment);
            },
          },
        }),
        loadAr12ExecutionWorkspaceMarker: async () => {
          throw new Error('must not load a marker after origin restore failed');
        },
        initialize: async () => {
          throw new Error('must not initialize after partial creation');
        },
        runCommands: async () => {
          throw new Error('must not run commands after partial creation');
        },
        finalize: async () => {
          throw new Error('must not finalize after partial creation');
        },
        verifyAr12ExecutionWorkspace: async () => {
          throw new Error('must not verify an unmarked partial workspace');
        },
        recordSuccessfulWorkspace: async () => {
          throw new Error('must not record success after partial creation');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          throw new Error('must not clean an unmarked partial workspace');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          throw new Error('must not retain through marker authority after partial creation');
        },
        recordRetainedWorkspace: async () => {
          throw new Error('must not write retention evidence after partial creation');
        },
      });
    } catch (error) {
      observedError = error;
    }

    try {
      expect(observedError).toBeInstanceOf(Ar12ExternalExecutionWorkspaceRunError);
      const payload = ar12CliFailurePayload(observedError);
      expect(payload).toMatchObject({
        status: 'FAILED',
        code: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
        partialCreation: {
          status: 'PARTIAL_RETAINED',
          failureCode: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
          failureStage: 'ORIGIN_RESTORE',
          partialRetained: true,
          terminalIdentity: {
            gitCommitSha: openingCommit,
            branch: 'phase-01-acceptance-readiness',
            worktreeState: 'CLEAN',
          },
          identityUnavailable: false,
          identityFailureCode: null,
          evidenceRecordStatus: 'OUTPUT_ONLY',
        },
      });
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(sourceRepositoryRoot);
      expect(serialized).not.toContain(workspacePath);
      expect(serialized).not.toContain('originUrl');
      await expect(access(workspacePath)).resolves.toBeUndefined();
      await expect(access(runDirectory)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a reused evidence run before creating or recording an external clone', async () => {
    const events: string[] = [];
    let observedError: unknown;
    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot: 'D:\\source',
        outputRoot: 'D:\\evidence',
        runDirectory: 'D:\\evidence\\run-01',
        expectedBranch: 'phase-01-acceptance-readiness',
        expectedCommit: 'b'.repeat(40),
        runKind: 'final',
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
          events.push('source-gate');
        },
        preflightAr12RunOutput: async () => {
          events.push('output-preflight');
          throw new Error('AR12_RUN_DIRECTORY_ALREADY_EXISTS');
        },
        validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
        createAr12ExecutionWorkspace: async () => {
          events.push('must-not-create');
          throw new Error('create must not run');
        },
        loadAr12ExecutionWorkspaceMarker: async () => {
          throw new Error('must not load marker');
        },
        initialize: async () => {
          events.push('must-not-init');
        },
        runCommands: async () => {
          events.push('must-not-run');
        },
        finalize: async () => {
          events.push('must-not-finalize');
        },
        verifyAr12ExecutionWorkspace: async () => {
          throw new Error('must not verify');
        },
        recordSuccessfulWorkspace: async () => {
          events.push('must-not-record-success');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          events.push('must-not-cleanup');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          events.push('must-not-retain');
          throw new Error('must not retain');
        },
        recordRetainedWorkspace: async () => {
          events.push('must-not-record-retention');
        },
      });
    } catch (error) {
      observedError = error;
    }

    expect(events).toEqual(['source-gate', 'output-preflight']);
    expect(observedError).toMatchObject({ message: 'AR12_RUN_DIRECTORY_ALREADY_EXISTS' });
  });

  it('rejects an invalid required-history contract before creating the run directory or external clone', async () => {
    const events: string[] = [];
    let observedError: unknown;
    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot: 'D:\\source',
        outputRoot: 'D:\\evidence',
        runDirectory: 'D:\\evidence\\run-01',
        expectedBranch: 'phase-01-acceptance-readiness',
        expectedCommit: 'b'.repeat(40),
        runKind: 'initial',
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
          events.push('source-gate');
        },
        preflightAr12RunOutput: async () => {
          events.push('output-preflight');
        },
        validateHistoryEvidencePreflight: async () => {
          events.push('history-contract');
          throw new Error('AR12_HISTORY_REQUIRED_DIRECTORY_MISSING');
        },
        createAr12ExecutionWorkspace: async () => {
          events.push('must-not-create-clone');
          throw new Error('clone must not be created');
        },
        loadAr12ExecutionWorkspaceMarker: async () => {
          throw new Error('marker must not load');
        },
        initialize: async () => {
          events.push('must-not-create-run-directory');
        },
        runCommands: async () => {
          events.push('must-not-run-commands');
        },
        finalize: async () => {
          events.push('must-not-finalize');
        },
        verifyAr12ExecutionWorkspace: async () => {
          throw new Error('must not verify');
        },
        recordSuccessfulWorkspace: async () => {
          events.push('must-not-record-success');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          events.push('must-not-clean');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          throw new Error('must not retain');
        },
        recordRetainedWorkspace: async () => {
          events.push('must-not-record-retention');
        },
      });
    } catch (error) {
      observedError = error;
    }
    expect(events).toEqual(['source-gate', 'output-preflight', 'history-contract']);
    expect(observedError).toBeInstanceOf(Error);
    expect(observedError).toMatchObject({ message: 'AR12_HISTORY_REQUIRED_DIRECTORY_MISSING' });
  });

  it('does not write retention evidence when the run directory appears after preflight', async () => {
    const openingGitCommitSha = 'b'.repeat(40);
    const workspacePath = 'E:\\external\\run-01';
    const marker = {
      schemaVersion: 'phase-01.ar12-execution-workspace.v1' as const,
      repositoryIdentity: 'hospital/platform',
      sourceRepositoryRootDigest: 'a'.repeat(64),
      openingGitCommitSha,
      targetBranch: 'phase-01-acceptance-readiness',
      runPurpose: 'AR-12_REBASELINE',
      createdAt: '2026-08-31T00:00:00.000Z',
      externalWorkspaceRoot: 'E:\\external',
      formalAcceptanceEligible: false as const,
    };
    const terminalIdentity = {
      gitCommitSha: openingGitCommitSha,
      branch: marker.targetBranch,
      originUrl: 'https://github.com/hospital/platform.git',
      worktreeState: 'CLEAN' as const,
    };
    const events: string[] = [];
    let observedError: unknown;

    try {
      await runAr12InExternalExecutionWorkspace({
        sourceRepositoryRoot: 'D:\\source',
        outputRoot: 'D:\\evidence',
        runDirectory: 'D:\\evidence\\run-01',
        expectedBranch: marker.targetBranch,
        expectedCommit: openingGitCommitSha,
        runKind: 'final',
      }, {
        assertRepositoryNotContaminatedByExecutionWorkspace: async () => {
          events.push('source-gate');
        },
        preflightAr12RunOutput: async () => {
          events.push('output-preflight-missing');
        },
        validateHistoryEvidencePreflight: async () => fakeHistoryBaseline(),
        createAr12ExecutionWorkspace: async () => {
          events.push('create');
          return {
            workspacePath,
            resolved: {
              repositoryRoot: 'D:\\source',
              canonicalRepositoryRoot: 'D:\\source',
              repositoryId: 'source',
              externalWorkspaceRoot: 'E:\\external',
              canonicalExternalWorkspaceRoot: 'E:\\external',
              workspacePath,
              canonicalWorkspacePath: workspacePath,
              runIdentity: 'run-01',
            },
            marker,
          };
        },
        loadAr12ExecutionWorkspaceMarker: async () => marker,
        initialize: async () => {
          events.push('init-race-detected');
          throw new Error('AR12_RUN_DIRECTORY_ALREADY_EXISTS');
        },
        runCommands: async () => {
          events.push('must-not-run');
        },
        finalize: async () => {
          events.push('must-not-finalize');
        },
        verifyAr12ExecutionWorkspace: async () => terminalIdentity,
        recordSuccessfulWorkspace: async () => {
          events.push('must-not-record-success');
        },
        cleanupAr12ExecutionWorkspace: async () => {
          events.push('must-not-cleanup');
        },
        retainAr12ExecutionWorkspaceAfterFailure: async () => {
          events.push('retain-external');
          return { retained: true, terminalIdentity };
        },
        recordRetainedWorkspace: async () => {
          events.push('must-not-write-unowned-run');
        },
      });
    } catch (error) {
      observedError = error;
    }

    expect(events).toEqual([
      'source-gate',
      'output-preflight-missing',
      'create',
      'init-race-detected',
      'retain-external',
    ]);
    expect(observedError).toBeInstanceOf(Ar12ExternalExecutionWorkspaceRunError);
    expect(observedError).toMatchObject({
      code: 'AR12_RUN_DIRECTORY_ALREADY_EXISTS',
      retainedWorkspace: {
        status: 'RETAINED',
        evidenceRecordStatus: 'OUTPUT_ONLY',
        terminalIdentity,
      },
    });
  });

  it('preflights a direct, safe, never-used evidence child without writing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hdi-ar12-output-preflight-'));
    const repositoryRoot = join(root, 'source');
    const outputRoot = join(root, 'evidence');
    const existingRun = join(outputRoot, 'run-01');
    try {
      await mkdir(repositoryRoot);
      await mkdir(outputRoot);
      await mkdir(existingRun);

      await expect(preflightAr12RunOutput(
        repositoryRoot,
        outputRoot,
        existingRun,
      )).rejects.toThrowError('AR12_RUN_DIRECTORY_ALREADY_EXISTS');
      await expect(preflightAr12RunOutput(
        repositoryRoot,
        outputRoot,
        join(outputRoot, 'invalid name'),
      )).rejects.toThrowError('AR12_RUN_DIRECTORY_NAME_INVALID');
      await expect(preflightAr12RunOutput(
        repositoryRoot,
        outputRoot,
        join(outputRoot, 'fresh-run'),
      )).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function gitForTest(cwd: string, ...arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
