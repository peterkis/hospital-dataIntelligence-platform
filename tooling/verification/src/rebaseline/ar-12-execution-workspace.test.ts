import { execFileSync } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AR12_EXECUTION_WORKSPACE_MARKER,
  Ar12ExecutionWorkspaceCreationError,
  assertRepositoryNotContaminatedByExecutionWorkspace,
  cleanupAr12ExecutionWorkspace,
  createAr12ExecutionWorkspace,
  defaultAr12ExecutionWorkspaceDependencies,
  loadAr12ExecutionWorkspaceMarker,
  relocateStaleAr12ExecutionWorkspace,
  resolveAr12ExecutionWorkspace,
  retainAr12ExecutionWorkspaceAfterFailure,
  verifyAr12ExecutionWorkspace,
  type Ar12ExecutionWorkspaceDependencies,
} from './ar-12-execution-workspace.js';

const BRANCH = 'phase-01-acceptance-readiness';
const GITHUB_ORIGIN = 'https://github.com/example/hospital-data-intelligence-platform.git';
const temporaryRoots: string[] = [];

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AR-12 execution workspace resolver', () => {
  it('places the deterministic default root outside the repository', async () => {
    const fixture = await createRepositoryFixture();
    const resolvedWorkspace = await resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'opening-head',
      environment: {},
    });

    expect(resolvedWorkspace.externalWorkspaceRoot).toBe(join(
      dirname(fixture.repositoryRoot),
      '.hdi-ar12-execution-workspaces',
      basename(fixture.repositoryRoot).toLowerCase(),
    ));
    expect(isWithin(resolvedWorkspace.canonicalRepositoryRoot, resolvedWorkspace.canonicalWorkspacePath)).toBe(false);
  });

  it.each([
    ['repository', (fixture: RepositoryFixture) => join(fixture.repositoryRoot, 'execution'), 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'],
    ['runtime', (fixture: RepositoryFixture) => join(fixture.repositoryRoot, '.runtime', 'execution'), 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'],
    ['git', (fixture: RepositoryFixture) => join(fixture.repositoryRoot, '.git', 'execution'), 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'],
  ] as const)('rejects an explicit root inside %s', async (_label, rootFor, code) => {
    const fixture = await createRepositoryFixture();
    await expect(resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: rootFor(fixture) },
    })).rejects.toMatchObject({ code });
  });

  it('rejects a root inside an evidence output with the evidence-specific code', async () => {
    const fixture = await createRepositoryFixture();
    const evidence = join(fixture.root, 'evidence-output');
    await mkdir(evidence);

    await expect(resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: join(evidence, 'execution') },
      evidenceDirectories: [evidence],
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE' });
  });

  it('rejects a symlink or junction whose canonical path returns into the repository', async () => {
    const fixture = await createRepositoryFixture();
    const linkedRoot = join(fixture.root, 'linked-execution');
    await symlink(
      join(fixture.repositoryRoot, '.runtime'),
      linkedRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: linkedRoot },
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE' });
  });

  it('exposes a filesystem adapter seam for Windows reparse-point canonicalization', async () => {
    const fixture = await createRepositoryFixture();
    const dependencies = defaultAr12ExecutionWorkspaceDependencies();
    const lexicalExternal = join(fixture.root, 'reported-reparse-point');
    const filesystem = {
      ...dependencies.filesystem,
      canonicalize: async (path: string) => path === resolve(lexicalExternal)
        ? join(fixture.repositoryRoot, '.runtime')
        : dependencies.filesystem.canonicalize(path),
    };

    await expect(resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: lexicalExternal },
    }, { ...dependencies, filesystem })).rejects.toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE',
    });
  });

  it('accepts a safe external root and rejects an existing run directory', async () => {
    const fixture = await createRepositoryFixture();
    const externalRoot = join(fixture.root, 'external');
    const first = await resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run-1',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: externalRoot },
    });
    expect(first.workspacePath).toBe(join(externalRoot, 'run-1'));
    await mkdir(first.workspacePath, { recursive: true });

    await expect(resolveAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'run-1',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: externalRoot },
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_ALREADY_EXISTS' });
  });
});

describe('AR-12 local clone lifecycle', () => {
  it('creates a local-only exact clone, restores origin, excludes marker, and does not copy untracked runtime', async () => {
    const fixture = await createRepositoryFixture();
    await mkdir(join(fixture.repositoryRoot, '.runtime'), { recursive: true });
    await writeFile(join(fixture.repositoryRoot, '.runtime', 'must-not-copy.txt'), 'private runtime\n');
    const observedGitArguments: string[][] = [];
    const dependencies = withObservedGitArguments(observedGitArguments);

    const created = await createAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'clone-run',
      runPurpose: 'AR-12 synthetic rebaseline',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: join(fixture.root, 'external') },
      createdAt: '2026-08-30T12:00:00.000Z',
    }, dependencies);

    expect(git(created.workspacePath, 'rev-parse', 'HEAD')).toBe(fixture.head);
    expect(git(created.workspacePath, 'branch', '--show-current')).toBe(BRANCH);
    expect(git(created.workspacePath, 'config', '--get', 'remote.origin.url')).toBe(GITHUB_ORIGIN);
    expect(git(created.workspacePath, 'status', '--porcelain=v1')).toBe('');
    await expect(access(join(created.workspacePath, '.runtime', 'must-not-copy.txt'))).rejects.toThrow();
    const marker = JSON.parse(await readFile(join(created.workspacePath, AR12_EXECUTION_WORKSPACE_MARKER), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      schemaVersion: 'phase-01.ar12-execution-workspace.v1',
      repositoryIdentity: 'example/hospital-data-intelligence-platform',
      openingGitCommitSha: fixture.head,
      targetBranch: BRANCH,
      runPurpose: 'AR-12 synthetic rebaseline',
      formalAcceptanceEligible: false,
    });
    const cloneInvocation = observedGitArguments.find((arguments_) => arguments_.includes('clone'));
    expect(cloneInvocation).toContain('--local');
    expect(observedGitArguments.some((arguments_) => arguments_.includes('fetch'))).toBe(false);
    expect(JSON.stringify(cloneInvocation)).not.toContain('github.com');
  });

  it('rejects a dirty source before invoking clone or creating the target', async () => {
    const fixture = await createRepositoryFixture();
    await writeFile(join(fixture.repositoryRoot, 'uncommitted-source.ts'), 'export const dirty = true;\n');
    const externalRoot = join(fixture.root, 'external');
    const target = join(externalRoot, 'dirty-source-run');
    const observedGitArguments: string[][] = [];

    await expect(createAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: 'dirty-source-run',
      runPurpose: 'AR-12 dirty source rejection',
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: externalRoot },
      createdAt: '2026-08-30T12:00:00.000Z',
    }, withObservedGitArguments(observedGitArguments))).rejects.toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    });

    expect(observedGitArguments.some((arguments_) => arguments_[0] === 'clone')).toBe(false);
    await expect(access(target)).rejects.toThrow();
  });

  it('overrides host Git config injection, disables hooks, and permits only local file transport', async () => {
    const fixture = await createRepositoryFixture();
    const hookSentinel = join(fixture.root, 'host-hook-ran.txt');
    const fsmonitorSentinel = join(fixture.root, 'host-fsmonitor-ran.txt');
    const hostileHooks = join(fixture.root, 'hostile-hooks');
    const hostileTemplate = join(fixture.root, 'hostile-template');
    const hostileGlobalConfig = join(fixture.root, 'hostile-global.gitconfig');
    const postCheckoutHook = join(hostileHooks, 'post-checkout');
    const templatePostCheckoutHook = join(hostileTemplate, 'hooks', 'post-checkout');
    const fsmonitorHook = join(fixture.root, 'hostile-fsmonitor');
    await mkdir(hostileHooks, { recursive: true });
    await mkdir(join(hostileTemplate, 'hooks'), { recursive: true });
    await writeExecutableShellScript(postCheckoutHook, hookSentinel);
    await writeExecutableShellScript(templatePostCheckoutHook, hookSentinel);
    await writeExecutableShellScript(fsmonitorHook, fsmonitorSentinel);
    await writeFile(hostileGlobalConfig, [
      '[core]',
      `\thooksPath = ${toGitConfigPath(hostileHooks)}`,
      `\tfsmonitor = ${toGitConfigPath(fsmonitorHook)}`,
      '[init]',
      `\ttemplateDir = ${toGitConfigPath(hostileTemplate)}`,
      '',
    ].join('\n'));
    git(fixture.repositoryRoot, 'config', 'core.hooksPath', toGitConfigPath(hostileHooks));
    git(fixture.repositoryRoot, 'config', 'core.fsmonitor', toGitConfigPath(fsmonitorHook));
    try {
      git(fixture.repositoryRoot, 'status', '--porcelain=v1');
    } catch {
      // The hostile hook intentionally does not implement the fsmonitor protocol.
    }
    await expect(access(fsmonitorSentinel)).resolves.toBeUndefined();
    await rm(fsmonitorSentinel);
    const invocations: Array<{
      readonly arguments: readonly string[];
      readonly environment: Readonly<Record<string, string>> | undefined;
    }> = [];
    const base = defaultAr12ExecutionWorkspaceDependencies();
    const dependencies: Ar12ExecutionWorkspaceDependencies = {
      ...base,
      git: {
        run: async (cwd, arguments_, environment) => {
          invocations.push({ arguments: [...arguments_], environment });
          return base.git.run(cwd, arguments_, environment);
        },
      },
    };

    const hostileGitEnvironment = {
      GIT_DIR: join(fixture.root, 'hostile-git-dir'),
      GiT_CEILING_DIRECTORIES: fixture.root,
      GIT_WORK_TREE: join(fixture.root, 'hostile-work-tree'),
      GIT_OBJECT_DIRECTORY: join(fixture.root, 'hostile-objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(fixture.root, 'hostile-alternates'),
      GIT_CONFIG_GLOBAL: hostileGlobalConfig,
      GIT_CONFIG_SYSTEM: hostileGlobalConfig,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: hostileHooks,
      GIT_TEMPLATE_DIR: hostileTemplate,
    } as const;
    const originalValues = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(hostileGitEnvironment)) {
      originalValues.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      await createAr12ExecutionWorkspace({
        repositoryRoot: fixture.repositoryRoot,
        runIdentity: 'isolated-git-run',
        runPurpose: 'AR-12 isolated Git configuration test',
        environment: { AR12_EXECUTION_WORKSPACE_ROOT: join(fixture.root, 'external') },
        createdAt: '2026-08-30T12:00:00.000Z',
      }, dependencies);
    } finally {
      for (const [key, value] of originalValues) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const clone = invocations.find((invocation) => invocation.arguments.includes('clone'));
    const checkout = invocations.find((invocation) => invocation.arguments.includes('checkout'));
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    expect(clone?.arguments).toEqual(expect.arrayContaining([
      '-c',
      `core.hooksPath=${nullDevice}`,
      'clone',
      '--template=',
      '--local',
    ]));
    expect(checkout?.arguments).toEqual(expect.arrayContaining([
      '-c',
      `core.hooksPath=${nullDevice}`,
      'checkout',
    ]));
    for (const invocation of invocations) {
      expect(invocation.environment).toMatchObject({
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_CONFIG_COUNT: '0',
        GIT_CONFIG_GLOBAL: nullDevice,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_PARAMETERS: '',
        GIT_CONFIG_SYSTEM: nullDevice,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TEMPLATE_DIR: '',
        GIT_TERMINAL_PROMPT: '0',
      });
      if (
        invocation.arguments.includes('rev-parse') ||
        invocation.arguments.includes('branch') ||
        invocation.arguments.includes('config') ||
        invocation.arguments.includes('status')
      ) {
        expect(invocation.arguments).toEqual(expect.arrayContaining([
          '-c',
          `core.hooksPath=${nullDevice}`,
          '-c',
          'core.fsmonitor=false',
        ]));
      }
    }
    expect(invocations.some((invocation) => invocation.arguments.includes('fetch'))).toBe(false);
    await expect(access(hookSentinel)).rejects.toThrow();
    await expect(access(fsmonitorSentinel)).rejects.toThrow();
  });

  it.each([
    ['checkout', 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED', 'CHECKOUT'],
    ['origin', 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED', 'ORIGIN_RESTORE'],
    ['marker', 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED', 'MARKER'],
    ['verify', 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'VERIFY'],
  ] as const)('retains a typed partial workspace when %s fails', async (failurePoint, failureCode, failureStage) => {
    const fixture = await createRepositoryFixture();
    const target = join(fixture.root, 'external', `partial-${failurePoint}`);
    const base = defaultAr12ExecutionWorkspaceDependencies();
    let cloneStatusReads = 0;
    const dependencies: Ar12ExecutionWorkspaceDependencies = {
      ...base,
      filesystem: failurePoint === 'marker'
        ? {
            ...base.filesystem,
            writeExclusive: async () => {
              throw new Error('AR12_TEST_MARKER_WRITE_FAILED');
            },
          }
        : base.filesystem,
      git: {
        run: async (cwd, arguments_, environment) => {
          if (failurePoint === 'checkout' && arguments_.includes('checkout')) {
            throw new Error('AR12_TEST_CHECKOUT_FAILED');
          }
          if (
            failurePoint === 'origin' &&
            arguments_.includes('remote') &&
            arguments_.includes('set-url')
          ) {
            throw new Error('AR12_TEST_ORIGIN_RESTORE_FAILED');
          }
          if (
            failurePoint === 'verify' &&
            cwd === target &&
            arguments_.includes('status') &&
            arguments_.includes('--porcelain=v1') &&
            ++cloneStatusReads === 1
          ) {
            return { stdout: '?? injected-dirty-state\n', stderr: '' };
          }
          return base.git.run(cwd, arguments_, environment);
        },
      },
    };

    const error = await captureCreationFailure(() => createAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      runIdentity: `partial-${failurePoint}`,
      runPurpose: `AR-12 ${failurePoint} failure retention test`,
      environment: { AR12_EXECUTION_WORKSPACE_ROOT: join(fixture.root, 'external') },
      createdAt: '2026-08-30T12:00:00.000Z',
    }, dependencies));

    expect(error).toBeInstanceOf(Ar12ExecutionWorkspaceCreationError);
    expect(error).toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      failureCode,
      failureStage,
      workspacePath: target,
      partialRetained: true,
    });
    expect(error.workspacePathDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(error.terminalIdentity !== null || error.identityFailureCode !== null).toBe(true);
    if (failurePoint === 'verify') {
      expect(error.identityFailureCode).toBe('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH');
    }
    await expect(access(target)).resolves.toBeUndefined();
  }, 30_000);

  it('compares mixed-case GitHub origins by canonical repository identity', async () => {
    const fixture = await createRepositoryFixture(
      'https://github.com/Example/Hospital-DataIntelligence-Platform.git',
    );
    const created = await createWorkspace(fixture);

    await expect(verifyAr12ExecutionWorkspace(created.workspacePath, created.marker)).resolves.toMatchObject({
      originUrl: 'https://github.com/Example/Hospital-DataIntelligence-Platform.git',
    });
    expect(created.marker.repositoryIdentity).toBe('example/hospital-dataintelligence-platform');
  });

  it.each([
    ['HEAD', async (workspace: string) => git(workspace, 'commit', '--allow-empty', '-m', 'drift')],
    ['branch', async (workspace: string) => git(workspace, 'switch', '-c', 'wrong-branch')],
    ['origin', async (workspace: string) => git(workspace, 'remote', 'set-url', 'origin', 'https://github.com/example/wrong.git')],
    ['clean state', async (workspace: string) => writeFile(join(workspace, 'dirty.txt'), 'dirty\n')],
  ] as const)('fails closed when clone %s changes', async (_label, mutate) => {
    const fixture = await createRepositoryFixture();
    const created = await createWorkspace(fixture);
    await mutate(created.workspacePath);

    await expect(verifyAr12ExecutionWorkspace(created.workspacePath, created.marker)).rejects.toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    });
  }, 30_000);

  it('cleans only an exactly marked and identity-matched external clone', async () => {
    const fixture = await createRepositoryFixture();
    const created = await createWorkspace(fixture);
    await cleanupAr12ExecutionWorkspace(created.workspacePath, created.marker, {
      repositoryRoot: fixture.repositoryRoot,
      evidenceDirectories: [],
    });
    await expect(access(created.workspacePath)).rejects.toThrow();
  });

  it('never deletes an unmarked external directory', async () => {
    const fixture = await createRepositoryFixture();
    const unsafeDirectory = join(fixture.root, 'external', 'unmarked');
    await mkdir(unsafeDirectory, { recursive: true });
    await writeFile(join(unsafeDirectory, 'owner.txt'), 'do not delete\n');
    const created = await createWorkspace(fixture);

    await expect(cleanupAr12ExecutionWorkspace(unsafeDirectory, created.marker, {
      repositoryRoot: fixture.repositoryRoot,
      evidenceDirectories: [],
    })).rejects.toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    });
    expect(await readFile(join(unsafeDirectory, 'owner.txt'), 'utf8')).toBe('do not delete\n');
  });

  it('retains a failed external clone and records terminal identity', async () => {
    const fixture = await createRepositoryFixture();
    const created = await createWorkspace(fixture);
    const retained = await retainAr12ExecutionWorkspaceAfterFailure(created.workspacePath, created.marker);

    expect(retained).toMatchObject({
      retained: true,
      terminalIdentity: {
        gitCommitSha: fixture.head,
        branch: BRANCH,
        originUrl: GITHUB_ORIGIN,
        worktreeState: 'CLEAN',
      },
    });
    await expect(access(created.workspacePath)).resolves.toBeUndefined();
  });

  it('retains and records a dirty failed clone instead of requiring a successful clean terminal state', async () => {
    const fixture = await createRepositoryFixture();
    const created = await createWorkspace(fixture);
    await writeFile(join(created.workspacePath, 'failure-debug.txt'), 'retained failure state\n');

    const retained = await retainAr12ExecutionWorkspaceAfterFailure(created.workspacePath, created.marker);
    expect(retained.terminalIdentity.worktreeState).toBe('DIRTY');
    await expect(access(join(created.workspacePath, 'failure-debug.txt'))).resolves.toBeUndefined();
  });

  it('rejects an evidence cleanup target before any lifecycle deletion', async () => {
    const fixture = await createRepositoryFixture();
    const evidence = join(fixture.root, 'external-evidence');
    await mkdir(evidence);
    const created = await createWorkspace(fixture);
    const base = defaultAr12ExecutionWorkspaceDependencies();
    let removed = false;

    await expect(cleanupAr12ExecutionWorkspace(evidence, created.marker, {
      repositoryRoot: fixture.repositoryRoot,
      evidenceDirectories: [evidence],
    }, {
      ...base,
      filesystem: {
        ...base.filesystem,
        removeDirectory: async () => {
          removed = true;
        },
      },
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE' });
    expect(removed).toBe(false);
    await expect(access(evidence)).resolves.toBeUndefined();
  });

  it('loads a marker through the strict public CLI seam and rejects extra fields', async () => {
    const fixture = await createRepositoryFixture();
    const created = await createWorkspace(fixture);
    await expect(loadAr12ExecutionWorkspaceMarker(created.workspacePath)).resolves.toEqual(created.marker);

    await writeFile(
      join(created.workspacePath, AR12_EXECUTION_WORKSPACE_MARKER),
      JSON.stringify({ ...created.marker, unsafeExtraField: true }) + '\n',
    );
    await expect(loadAr12ExecutionWorkspaceMarker(created.workspacePath)).rejects.toMatchObject({
      code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    });
  });
});

describe('AR-12 repository contamination preflight', () => {
  it('detects an internal full checkout and uses one stable code', async () => {
    const fixture = await createRepositoryFixture();
    const internal = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees', 'clone');
    await mkdir(dirname(internal), { recursive: true });
    execFileSync('git', ['clone', '--local', fixture.repositoryRoot, internal], { stdio: 'ignore' });

    await expect(assertRepositoryNotContaminatedByExecutionWorkspace(fixture.repositoryRoot)).rejects.toMatchObject({
      code: 'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE',
    });
  });

  it('detects a nested marker, nested git checkout, and second lockfile', async () => {
    for (const contaminant of ['marker', 'git', 'lockfile'] as const) {
      const fixture = await createRepositoryFixture();
      const nested = join(fixture.repositoryRoot, 'unexpected-' + contaminant);
      await mkdir(nested, { recursive: true });
      if (contaminant === 'marker') await writeFile(join(nested, AR12_EXECUTION_WORKSPACE_MARKER), '{}');
      if (contaminant === 'git') await mkdir(join(nested, '.git'));
      if (contaminant === 'lockfile') await writeFile(join(nested, 'package-lock.json'), '{}\n');

      await expect(assertRepositoryNotContaminatedByExecutionWorkspace(fixture.repositoryRoot)).rejects.toMatchObject({
        code: 'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE',
      });
    }
  });

  it('does not misclassify an explicitly protected failure evidence directory', async () => {
    const fixture = await createRepositoryFixture();
    const evidenceDirectory = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', '20260830-final');
    await mkdir(join(evidenceDirectory, '.git'), { recursive: true });
    await writeFile(join(evidenceDirectory, 'package-lock.json'), '{}\n');

    await expect(assertRepositoryNotContaminatedByExecutionWorkspace(fixture.repositoryRoot, {
      evidenceDirectories: [evidenceDirectory],
      executionWorkspacePath: join(fixture.root, 'external', 'run'),
    })).resolves.toBeUndefined();
  });

  it('rejects an execution workspace path that canonicalizes inside the repository', async () => {
    const fixture = await createRepositoryFixture();
    await expect(assertRepositoryNotContaminatedByExecutionWorkspace(fixture.repositoryRoot, {
      executionWorkspacePath: join(fixture.repositoryRoot, '.runtime', 'run'),
    })).rejects.toMatchObject({ code: 'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE' });
  });
});

describe('controlled stale execution clone relocation', () => {
  it('moves the exact stale clone externally without changing its tree or protected evidence', async () => {
    const fixture = await createRepositoryFixture();
    const staleRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
    const staleClone = join(staleRoot, 'known-stale');
    await mkdir(staleRoot, { recursive: true });
    createCleanStaleClone(fixture, staleClone);
    const evidence = await createRelocationEvidence(fixture);
    const destination = join(fixture.root, 'external-archive', 'known-stale');

    const result = await relocateStaleAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      sourcePath: staleClone,
      allowedStaleWorktreesRoot: staleRoot,
      destinationPath: destination,
      expectedHead: fixture.head,
      expectedBranch: BRANCH,
      failedFinalRunDirectory: evidence.failedFinal,
      initialRunEvidenceDirectories: [evidence.initial],
      relocatedAt: '2026-08-30T12:30:00.000Z',
    });

    expect(result.treeDigestBefore).toBe(result.treeDigestAfter);
    expect(result.relocationStatus).toBe('RELOCATED');
    expect(result.failedFinalRunDirectoryPreserved).toBe(true);
    expect(result.failedFinalRunDirectory).toBe('.runtime/rebaseline/ar-12/20260830-deadbee-final');
    expect(result.initialRunEvidenceDirectoriesPreserved).toEqual([
      '.runtime/rebaseline/ar-12/20260830-deadbee-precloseout-r4',
    ]);
    expect(await readFile(join(evidence.failedFinal, 'failure.json'), 'utf8')).toBe('{"immutable":true}\n');
    await expect(access(staleClone)).rejects.toThrow();
    await expect(access(join(destination, 'package-lock.json'))).resolves.toBeUndefined();
  });

  it('does not move a stale clone whose HEAD identity differs', async () => {
    const fixture = await createRepositoryFixture();
    const staleRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
    const staleClone = join(staleRoot, 'known-stale');
    await mkdir(staleRoot, { recursive: true });
    createCleanStaleClone(fixture, staleClone);
    const destination = join(fixture.root, 'external-archive', 'known-stale');
    const evidence = await createRelocationEvidence(fixture);

    await expect(relocateStaleAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      sourcePath: staleClone,
      allowedStaleWorktreesRoot: staleRoot,
      destinationPath: destination,
      expectedHead: '0'.repeat(40),
      expectedBranch: BRANCH,
      failedFinalRunDirectory: evidence.failedFinal,
      initialRunEvidenceDirectories: [evidence.initial],
      relocatedAt: '2026-08-30T12:30:00.000Z',
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' });
    await expect(access(staleClone)).resolves.toBeUndefined();
    await expect(access(destination)).rejects.toThrow();
  });

  it('revalidates destination canonical identity after creating its parent and before rename', async () => {
    const fixture = await createRepositoryFixture();
    const staleRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
    const staleClone = join(staleRoot, 'known-stale');
    await mkdir(staleRoot, { recursive: true });
    createCleanStaleClone(fixture, staleClone);
    const destination = join(fixture.root, 'external-archive', 'known-stale');
    const evidence = await createRelocationEvidence(fixture);
    const base = defaultAr12ExecutionWorkspaceDependencies();
    let destinationCanonicalizations = 0;
    let renamed = false;
    const dependencies: Ar12ExecutionWorkspaceDependencies = {
      ...base,
      filesystem: {
        ...base.filesystem,
        canonicalize: async (path) => {
          if (resolve(path) === resolve(destination) && ++destinationCanonicalizations >= 2) {
            return join(fixture.repositoryRoot, '.runtime', 'escaped');
          }
          return base.filesystem.canonicalize(path);
        },
        rename: async (source, target) => {
          renamed = true;
          return base.filesystem.rename(source, target);
        },
      },
    };

    await expect(relocateStaleAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      sourcePath: staleClone,
      allowedStaleWorktreesRoot: staleRoot,
      destinationPath: destination,
      expectedHead: fixture.head,
      expectedBranch: BRANCH,
      failedFinalRunDirectory: evidence.failedFinal,
      initialRunEvidenceDirectories: [evidence.initial],
      relocatedAt: '2026-08-30T12:30:00.000Z',
    }, dependencies)).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE' });
    expect(renamed).toBe(false);
    await expect(access(staleClone)).resolves.toBeUndefined();
  });

  it.each([
    ['wrong origin', async (workspace: string) => git(workspace, 'remote', 'set-url', 'origin', 'https://github.com/example/wrong.git')],
    ['dirty worktree', async (workspace: string) => writeFile(join(workspace, 'dirty.txt'), 'dirty\n')],
  ] as const)('does not move a stale clone with %s', async (_label, mutate) => {
    const fixture = await createRepositoryFixture();
    const staleRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
    const staleClone = join(staleRoot, 'known-stale');
    await mkdir(staleRoot, { recursive: true });
    createCleanStaleClone(fixture, staleClone);
    await mutate(staleClone);
    const destination = join(fixture.root, 'external-archive', 'known-stale');
    const evidence = await createRelocationEvidence(fixture);

    await expect(relocateStaleAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      sourcePath: staleClone,
      allowedStaleWorktreesRoot: staleRoot,
      destinationPath: destination,
      expectedHead: fixture.head,
      expectedBranch: BRANCH,
      failedFinalRunDirectory: evidence.failedFinal,
      initialRunEvidenceDirectories: [evidence.initial],
      relocatedAt: '2026-08-30T12:30:00.000Z',
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' });
    await expect(access(staleClone)).resolves.toBeUndefined();
    await expect(access(destination)).rejects.toThrow();
  }, 30_000);

  it('does not move or claim preservation when the failed-final evidence path is not an exact final run directory', async () => {
    const fixture = await createRepositoryFixture();
    const staleRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'worktrees');
    const staleClone = join(staleRoot, 'known-stale');
    await mkdir(staleRoot, { recursive: true });
    createCleanStaleClone(fixture, staleClone);
    const invalidFinal = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12', 'not-a-final-run');
    await mkdir(invalidFinal, { recursive: true });
    const destination = join(fixture.root, 'external-archive', 'known-stale');

    await expect(relocateStaleAr12ExecutionWorkspace({
      repositoryRoot: fixture.repositoryRoot,
      sourcePath: staleClone,
      allowedStaleWorktreesRoot: staleRoot,
      destinationPath: destination,
      expectedHead: fixture.head,
      expectedBranch: BRANCH,
      failedFinalRunDirectory: invalidFinal,
      initialRunEvidenceDirectories: [],
      relocatedAt: '2026-08-30T12:30:00.000Z',
    })).rejects.toMatchObject({ code: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' });
    await expect(access(staleClone)).resolves.toBeUndefined();
    await expect(access(destination)).rejects.toThrow();
  });
});

interface RepositoryFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly head: string;
}

async function createRepositoryFixture(origin = GITHUB_ORIGIN): Promise<RepositoryFixture> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-ar12-workspace-'));
  temporaryRoots.push(root);
  const repositoryRoot = join(root, 'hospital-data-intelligence-platform');
  await mkdir(repositoryRoot);
  git(repositoryRoot, 'init', '-b', BRANCH);
  git(repositoryRoot, 'config', 'user.email', 'ar12@example.invalid');
  git(repositoryRoot, 'config', 'user.name', 'AR-12 Test');
  await writeFile(join(repositoryRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(repositoryRoot, 'README.md'), 'fixture\n');
  await writeFile(join(repositoryRoot, '.gitignore'), '.runtime/\n');
  git(repositoryRoot, 'add', 'package-lock.json', 'README.md', '.gitignore');
  git(repositoryRoot, 'commit', '-m', 'fixture');
  git(repositoryRoot, 'remote', 'add', 'origin', origin);
  return { root, repositoryRoot, head: git(repositoryRoot, 'rev-parse', 'HEAD') };
}

async function createWorkspace(fixture: RepositoryFixture) {
  return createAr12ExecutionWorkspace({
    repositoryRoot: fixture.repositoryRoot,
    runIdentity: 'lifecycle-run-' + Math.random().toString(16).slice(2),
    runPurpose: 'AR-12 lifecycle test',
    environment: { AR12_EXECUTION_WORKSPACE_ROOT: join(fixture.root, 'external') },
    createdAt: '2026-08-30T12:00:00.000Z',
  });
}

async function createRelocationEvidence(fixture: RepositoryFixture): Promise<{
  readonly failedFinal: string;
  readonly initial: string;
}> {
  const runRoot = join(fixture.repositoryRoot, '.runtime', 'rebaseline', 'ar-12');
  const failedFinal = join(runRoot, '20260830-deadbee-final');
  const initial = join(runRoot, '20260830-deadbee-precloseout-r4');
  await mkdir(failedFinal, { recursive: true });
  await mkdir(initial, { recursive: true });
  await writeFile(join(failedFinal, 'failure.json'), '{"immutable":true}\n');
  await writeFile(join(initial, 'summary.json'), '{"immutable":true}\n');
  return { failedFinal, initial };
}

function createCleanStaleClone(fixture: RepositoryFixture, staleClone: string): void {
  execFileSync('git', [
    '-c',
    'core.autocrlf=false',
    'clone',
    '--local',
    fixture.repositoryRoot,
    staleClone,
  ], { stdio: 'ignore' });
  git(staleClone, 'config', 'core.autocrlf', 'false');
  git(staleClone, 'reset', '--hard', fixture.head);
  git(staleClone, 'remote', 'set-url', 'origin', GITHUB_ORIGIN);
  git(staleClone, 'switch', '-C', BRANCH, fixture.head);
  expect(git(staleClone, 'status', '--porcelain=v1')).toBe('');
}

function withObservedGitArguments(observed: string[][]): Ar12ExecutionWorkspaceDependencies {
  const dependencies = defaultAr12ExecutionWorkspaceDependencies();
  return {
    ...dependencies,
    git: {
      run: async (cwd, arguments_, environment) => {
        observed.push([...arguments_]);
        return dependencies.git.run(cwd, arguments_, environment);
      },
    },
  };
}

function git(cwd: string, ...arguments_: string[]): string {
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function captureCreationFailure(
  operation: () => Promise<unknown>,
): Promise<Ar12ExecutionWorkspaceCreationError> {
  try {
    await operation();
  } catch (error: unknown) {
    if (error instanceof Ar12ExecutionWorkspaceCreationError) return error;
    throw error;
  }
  throw new Error('AR12_TEST_EXPECTED_CREATION_FAILURE');
}

async function writeExecutableShellScript(path: string, sentinel: string): Promise<void> {
  await writeFile(path, [
    '#!/bin/sh',
    `printf invoked > "${toGitConfigPath(sentinel)}"`,
    'exit 0',
    '',
  ].join('\n'));
  await chmod(path, 0o755);
}

function toGitConfigPath(path: string): string {
  return resolve(path).replaceAll('\\', '/');
}

function isWithin(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent).toLowerCase();
  const normalizedChild = resolve(child).toLowerCase();
  return normalizedChild === normalizedParent || normalizedChild.startsWith(normalizedParent + '\\') || normalizedChild.startsWith(normalizedParent + '/');
}
