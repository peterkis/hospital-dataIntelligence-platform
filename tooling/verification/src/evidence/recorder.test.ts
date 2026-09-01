import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ABG_COVERAGE_MATRIX } from '../abg-coverage-matrix.js';
import { buildProducerFailureEvidence } from './adapters.js';
import {
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  createEvidenceSubdirectory,
  ensureSafeDirectoryConcurrent,
  redactSensitiveText,
  writeBinaryArtifact,
  writeProducerEvidence,
  writeRedactedJsonArtifact,
  writeRedactedTextArtifact,
} from './recorder.js';
import {
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
  type ProducerEvidence,
  type ProducerEvidenceItem,
} from './protocol.js';

const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('producer evidence recorder', () => {
  it('creates an absent output directory and writes immutable evidence using actual artifact bytes', async () => {
    const root = await createRoot();
    const source = await writeRedactedJsonArtifact(root, 'raw/command-summary.json', {
      commands: { runtime: { status: 'PASSED' } },
    });
    const item = await createEvidenceItemFromFile(root, {
      artifactId: 'static-command-summary',
      relativePath: source.relativePath,
      mediaType: 'application/json',
      jsonPointer: '/commands/runtime/status',
      claim: { status: 'PASSED' },
    });
    const result = await writeProducerEvidence(root, 'static/producer-evidence.json', buildStaticEvidence(item));
    expect(result.relativePath).toBe('static/producer-evidence.json');
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    await expect(
      writeProducerEvidence(root, 'static/producer-evidence.json', buildStaticEvidence(item)),
    ).rejects.toThrow('PRODUCER_EVIDENCE_WRITE_ALREADY_EXISTS');
  });

  it('rejects output reuse, path traversal, absolute paths, and symlink escapes', async () => {
    const root = await createRoot();
    await expect(createEvidenceOutputDirectory(root)).rejects.toThrow(
      'PRODUCER_EVIDENCE_OUTPUT_ALREADY_EXISTS',
    );
    await expect(writeRedactedTextArtifact(root, '../escape.log', 'blocked')).rejects.toThrow(
      'PRODUCER_EVIDENCE_WRITE_PATH_INVALID',
    );
    await expect(writeRedactedTextArtifact(root, 'C:/escape.log', 'blocked')).rejects.toThrow(
      'PRODUCER_EVIDENCE_WRITE_PATH_INVALID',
    );

    const external = await mkdtemp(join(tmpdir(), 'hdi-evidence-external-'));
    roots.push(external);
    try {
      await symlink(external, join(root, 'linked'), 'junction');
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      expect(code).toBe('EPERM');
      return;
    }
    await expect(writeRedactedTextArtifact(root, 'linked/escape.log', 'blocked')).rejects.toThrow(
      'PRODUCER_EVIDENCE_DIRECTORY_SYMLINK_FORBIDDEN',
    );
  });

  it('redacts secrets from text, JSON, and failure descriptions before evidence is persisted', async () => {
    const root = await createRoot();
    const unsafe = 'Authorization: Bearer top-secret-token password=top-secret-value';
    expect(redactSensitiveText(unsafe)).not.toContain('top-secret-token');
    expect(redactSensitiveText(unsafe)).not.toContain('top-secret-value');

    await writeRedactedTextArtifact(root, 'raw/failure.log', unsafe);
    await writeRedactedJsonArtifact(root, 'raw/failure.json', {
      authorization: 'Bearer top-secret-token',
      nested: { clientSecret: 'top-secret-value' },
    });
    const text = await readFile(join(root, 'raw/failure.log'), 'utf8');
    const json = await readFile(join(root, 'raw/failure.json'), 'utf8');
    expect(text).not.toContain('top-secret-token');
    expect(text).not.toContain('top-secret-value');
    expect(json).not.toContain('top-secret-token');
    expect(json).not.toContain('top-secret-value');

    const item = await createEvidenceItemFromFile(root, {
      artifactId: 'orchestration-failure',
      relativePath: 'raw/failure.log',
      mediaType: 'text/plain; charset=utf-8',
      jsonPointer: '/failure/status',
      claim: { status: 'FAILED' },
    });
    const evidence = buildProducerFailureEvidence({
      producerId: 'static',
      runId: 'failure-run-0001',
      runSequence: 1,
      startedAt: '2026-08-27T10:00:00',
      completedAt: '2026-08-27T10:00:01',
      commandIdentity: {
        executable: 'npm',
        arguments: ['run', 'check:runtime'],
        workingDirectory: 'repository-root',
        commandDigest: SHA256,
      },
      environmentRefs: {},
      frozenInputRefs: staticFrozenInputs(),
      defaultEvidenceItems: [item],
      defaultReferences: {
        requestIds: ['command-run-failure-0001'],
        ruleVersions: ['phase-01.verification-toolchain.v2'],
        artifactDigests: [item.sha256],
      },
      failureCode: 'CHILD_PROCESS_FAILED',
      failureMessage: unsafe,
    });
    expect(evidence.status).toBe('FAILED');
    expect(Object.values(evidence.scenarios).flatMap((scenario) =>
      Object.values(scenario.assertions).map((assertion) => assertion.status),
    )).toContain('FAILED');
    const result = await writeProducerEvidence(root, 'static/failure-evidence.json', evidence);
    const persisted = await readFile(join(root, result.relativePath), 'utf8');
    expect(persisted).not.toContain('top-secret-token');
    expect(persisted).not.toContain('top-secret-value');
  });

  it('redacts configured formal secret values even when a log omits a sensitive key name', () => {
    const name = 'HDI_KEYCLOAK_ADMIN_USERNAME';
    const previous = process.env[name];
    const secret = 'low-entropy-formal-admin';
    process.env[name] = secret;
    try {
      const redacted = redactSensitiveText(`login failed for ${secret}`);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain('[REDACTED]');
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it('allows two concurrent tasks to create the same directory layer', async () => {
    const root = await createRoot();
    await expect(Promise.all([
      createEvidenceSubdirectory(root, 'shared'),
      createEvidenceSubdirectory(root, 'shared'),
    ])).resolves.toEqual([join(root, 'shared'), join(root, 'shared')]);
  });

  it('allows many concurrent tasks to create the same multi-level directory', async () => {
    const root = await createRoot();
    const results = await Promise.all(Array.from({ length: 32 }, () =>
      createEvidenceSubdirectory(root, 'shared/raw/commands')));
    expect(new Set(results)).toEqual(new Set([join(root, 'shared/raw/commands')]));
  });

  it('allows concurrent sibling files after racing on one parent directory', async () => {
    const root = await createRoot();
    await Promise.all([
      writeRedactedTextArtifact(root, 'shared/raw/first.log', 'first'),
      writeRedactedTextArtifact(root, 'shared/raw/second.log', 'second'),
    ]);
    await expect(readFile(join(root, 'shared/raw/first.log'), 'utf8')).resolves.toBe('first');
    await expect(readFile(join(root, 'shared/raw/second.log'), 'utf8')).resolves.toBe('second');
  });

  it('keeps same-file concurrent writes exclusive with no partial overwrite', async () => {
    const root = await createRoot();
    const results = await Promise.allSettled([
      writeBinaryArtifact(root, 'shared/raw/exclusive.bin', Buffer.from('first-complete')),
      writeBinaryArtifact(root, 'shared/raw/exclusive.bin', Buffer.from('second-complete')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(String((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason))
      .toContain('PRODUCER_EVIDENCE_WRITE_ALREADY_EXISTS');
    const bytes = await readFile(join(root, 'shared/raw/exclusive.bin'), 'utf8');
    expect(['first-complete', 'second-complete']).toContain(bytes);
  });

  it('fails closed when an EEXIST object is a regular file', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'shared'), 'not-a-directory', { flag: 'wx' });
    await expect(createEvidenceSubdirectory(root, 'shared/raw')).rejects.toThrow(
      'PRODUCER_EVIDENCE_DIRECTORY_EXISTING_NOT_DIRECTORY',
    );
  });

  it('fails closed when an EEXIST object is a symlink or junction', async () => {
    const root = await createRoot();
    const external = await mkdtemp(join(tmpdir(), 'hdi-evidence-external-'));
    roots.push(external);
    if (!await createDirectoryLink(external, join(root, 'shared'))) return;
    await expect(createEvidenceSubdirectory(root, 'shared/raw')).rejects.toThrow(
      'PRODUCER_EVIDENCE_DIRECTORY_SYMLINK_FORBIDDEN',
    );
  });

  it('fails closed when an intermediate parent directory is a symlink or junction', async () => {
    const root = await createRoot();
    await mkdir(join(root, 'shared'));
    const external = await mkdtemp(join(tmpdir(), 'hdi-evidence-external-'));
    roots.push(external);
    if (!await createDirectoryLink(external, join(root, 'shared/raw'))) return;
    await expect(writeRedactedTextArtifact(root, 'shared/raw/escape.log', 'blocked')).rejects.toThrow(
      'PRODUCER_EVIDENCE_DIRECTORY_SYMLINK_FORBIDDEN',
    );
  });

  it('fails closed when a canonical directory path escapes the evidence root', async () => {
    const root = await createRoot();
    const external = await mkdtemp(join(tmpdir(), 'hdi-evidence-external-'));
    roots.push(external);
    await expect(ensureSafeDirectoryConcurrent(root, 'shared', {
      async lstat() { return { isDirectory: () => true, isSymbolicLink: () => false }; },
      async mkdir() { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
      async realpath() { return external; },
    })).rejects.toThrow('PRODUCER_EVIDENCE_DIRECTORY_ESCAPES_ROOT');
  });

  it('accepts an already existing safe directory after canonical verification', async () => {
    const root = await createRoot();
    await mkdir(join(root, 'shared'));
    await expect(createEvidenceSubdirectory(root, 'shared')).resolves.toBe(join(root, 'shared'));
  });

  it('keeps the evidence output root exclusive even after subdirectories become concurrent-safe', async () => {
    const root = await createRoot();
    await expect(createEvidenceOutputDirectory(root)).rejects.toThrow(
      'PRODUCER_EVIDENCE_OUTPUT_ALREADY_EXISTS',
    );
  });

  it('regresses setup 03 shared/raw concurrency without serializing producers', async () => {
    const first = await createRoot();
    const second = await createRoot();
    const firstDigests = await writeSyntheticSetup03Evidence(first);
    const secondDigests = await writeSyntheticSetup03Evidence(second);
    expect(firstDigests).toEqual(secondDigests);
  });

  it('survives 100 repeated concurrent shared/raw directory races without unexpected EEXIST', async () => {
    for (let index = 0; index < 100; index += 1) {
      const root = await createRoot();
      await Promise.all([
        writeRedactedTextArtifact(root, `shared/raw/commands/${index}-stdout.log`, 'stdout'),
        writeRedactedTextArtifact(root, `shared/raw/commands/${index}-stderr.log`, 'stderr'),
        writeRedactedJsonArtifact(root, `shared/raw/${index}-summary.json`, { index }),
        writeRedactedJsonArtifact(root, `shared/producer-${index}/evidence.json`, { index }),
      ]);
    }
  }, 30_000);
});

async function createDirectoryLink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    expect(code).toBe('EPERM');
    return false;
  }
}

async function writeSyntheticSetup03Evidence(root: string): Promise<Readonly<Record<string, string>>> {
  const writes = await Promise.all([
    writeRedactedTextArtifact(root, 'shared/raw/commands/runtime.stdout.log', 'runtime-out'),
    writeRedactedTextArtifact(root, 'shared/raw/commands/runtime.stderr.log', 'runtime-err'),
    writeRedactedJsonArtifact(root, 'shared/raw/command-results.json', { status: 'PASSED' }),
    writeRedactedJsonArtifact(root, 'shared/static/producer-evidence.json', { status: 'PASSED' }),
    writeRedactedJsonArtifact(root, 'shared/database/producer-evidence.json', { status: 'PASSED' }),
  ]);
  return Object.fromEntries(writes.map((write) => [write.relativePath, write.sha256]));
}

async function createRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'hdi-evidence-root-'));
  roots.push(parent);
  const root = join(parent, 'evidence');
  await createEvidenceOutputDirectory(root);
  return root;
}

function buildStaticEvidence(item: ProducerEvidenceItem): ProducerEvidence {
  const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === 'ABG-01')!;
  const assertionId = entry.assertionIds[0]!;
  const scenarioId = entry.scenarioIds[0]!;
  return {
    schemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
    producerId: 'static',
    runId: 'static-run-0001',
    runSequence: 1,
    status: 'PASSED',
    startedAt: '2026-08-27T10:00:00',
    completedAt: '2026-08-27T10:00:01',
    commandIdentity: {
      executable: 'npm',
      arguments: ['run', 'check:runtime'],
      workingDirectory: 'repository-root',
      commandDigest: SHA256,
    },
    environmentRefs: {},
    frozenInputRefs: staticFrozenInputs(),
    scenarios: {
      [scenarioId]: {
        scenarioId,
        title: 'Repository runtime and lockfile topology',
        producerId: 'static',
        status: 'PASSED',
        requestIds: ['command-run-0001'],
        principalIds: [],
        governanceObjectIds: [],
        versionIds: [],
        ruleVersions: ['phase-01.verification-toolchain.v2'],
        artifactDigests: [item.sha256],
        assertions: {
          [assertionId]: {
            assertionId,
            gateId: 'ABG-01',
            status: 'PASSED',
            description: 'Runtime and repository topology checks passed.',
            expected: { status: 'PASSED' },
            actual: { status: 'PASSED' },
            failureCode: null,
            evidenceItems: [item],
          },
        },
      },
    },
  };
}

function staticFrozenInputs(): ProducerEvidence['frozenInputRefs'] {
  return {
    gitCommitSha: SHA256,
    lockfileSha256: SHA256,
    runtimeAuthoritySha256: SHA256,
    runtimeAuthoritySemanticDigest: SHA256,
    nodeVersion: 'v24.18.0',
  };
}
