import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
} from '../verification-contract-versions.js';
import { canonicalJson } from '../evidence/recorder.js';
import type { JsonValue } from '../evidence/protocol.js';
import { VERIFICATION_SOURCE_FILES } from './source-manifest-files.js';
import { parseVerificationSourceManifest } from './source-manifest-schema.js';
import {
  buildProducerSourceManifest,
  buildReviewerSourceManifest,
  canonicalVerificationSourceManifestBytes,
  sourceManifestSha256,
  verifyProducerSourceManifestStable,
  writeProducerSourceManifest,
  type GitObjectReader,
  type RepositoryStateReader,
  type WorkspaceSourceReader,
} from './source-manifest.js';

const COMMIT = '1'.repeat(40);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('verification source manifest public seam', () => {
  it('registers the AR-12 workspace, history contract, and orchestrator as ordered authority sources', () => {
    expect(VERIFICATION_SOURCE_FILES).toHaveLength(47);
    expect(VERIFICATION_SOURCE_FILES).toEqual(expect.arrayContaining([
      {
        path: 'tooling/verification/src/rebaseline/ar-12-execution-workspace.ts',
        role: 'ORCHESTRATOR',
      },
      {
        path: 'tooling/verification/src/rebaseline/ar-12-history-evidence-contract.ts',
        role: 'AR12_HISTORY_EVIDENCE_CONTRACT',
      },
      {
        path: 'tooling/verification/src/rebaseline/ar-12-orchestrator.ts',
        role: 'ORCHESTRATOR',
      },
    ]));
    expect(VERIFICATION_SOURCE_FILES.map(({ path }) => path)).toEqual(
      [...VERIFICATION_SOURCE_FILES.map(({ path }) => path)].sort(),
    );
  });

  it('builds a deterministic producer identity from clean workspace bytes and the same commit blobs', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);

    expect(manifest.schemaVersion).toBe(VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION);
    expect(manifest.manifestRole).toBe('PRODUCER');
    expect(manifest.producerGitCommitSha).toBe(COMMIT);
    expect(manifest.producerWorktreeState).toBe('CLEAN');
    expect(manifest.contractIdentity).toEqual(CURRENT_EVIDENCE_CONTRACT_IDENTITY);
    expect(manifest.sourceFileCount).toBe(VERIFICATION_SOURCE_FILES.length);
    expect(manifest.sourceFiles.map((entry) => entry.path)).toEqual(
      [...VERIFICATION_SOURCE_FILES.map((entry) => entry.path)].sort(),
    );
    expect(manifest.sourceFiles[0]).toMatchObject({
      byteLength: expect.any(Number),
      gitBlobOid: expect.stringMatching(/^[0-9a-f]{40}$/u),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });

    const firstBytes = canonicalVerificationSourceManifestBytes(manifest);
    const second = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    expect(canonicalVerificationSourceManifestBytes(second)).toEqual(firstBytes);
    expect(sourceManifestSha256(manifest)).toMatch(/^[0-9a-f]{64}$/u);
    expect(fixture.executedPaths).toEqual([
      ...VERIFICATION_SOURCE_FILES.map((entry) => entry.path),
      ...VERIFICATION_SOURCE_FILES.map((entry) => entry.path),
    ]);
  });

  it('fails closed when Git reports a blob OID that does not identify the returned bytes', async () => {
    const fixture = fixtureDependencies();
    const original = fixture.dependencies.git.readBlob;
    fixture.dependencies.git.readBlob = async (...args) => {
      const blob = await original(...args);
      return blob === null ? null : { ...blob, oid: 'f'.repeat(40) };
    };

    await expect(buildProducerSourceManifest('repository-root', fixture.dependencies)).rejects.toThrow(
      'PRODUCER_SOURCE_BLOB_ID_MISMATCH',
    );
  });

  it('strictly rejects a sourceFiles digest that does not bind the declared entries', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    const tampered = { ...manifest, sourceFilesDigest: '0'.repeat(64) };

    expect(() => parseVerificationSourceManifest(tampered)).toThrow(
      'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH',
    );
  });

  it('strictly rejects authority identity that disagrees with the source file entries', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    const tampered = {
      ...manifest,
      authorityIdentity: { ...manifest.authorityIdentity, coverageMatrixDigest: '0'.repeat(64) },
    };

    expect(() => parseVerificationSourceManifest(tampered)).toThrow(
      'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
    );
  });

  it('rejects a manifest that omits a registered verification source even after its digests are rebuilt', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    const sourceFiles = manifest.sourceFiles.filter((entry) =>
      entry.path !== 'tooling/verification/src/run-shared-abg-verification.ts'
    );
    const tampered = {
      ...manifest,
      sourceFiles,
      sourceFileCount: sourceFiles.length,
      sourceFilesDigest: createHash('sha256')
        .update(Buffer.from(canonicalJson(sourceFiles as unknown as JsonValue), 'utf8'))
        .digest('hex'),
    };

    expect(() => parseVerificationSourceManifest(tampered)).toThrow(
      'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
    );
  });

  it('requires a clean producer but still records a dirty reviewer for fail-closed review output', async () => {
    const fixture = fixtureDependencies({ worktreeStatus: 'DIRTY' });

    await expect(buildProducerSourceManifest('repository-root', fixture.dependencies)).rejects.toThrow(
      'PRODUCER_WORKTREE_NOT_CLEAN_AT_PRODUCTION',
    );
    expect(fixture.executedPaths).toEqual([]);

    const reviewer = await buildReviewerSourceManifest('repository-root', fixture.dependencies);
    expect(reviewer.manifestRole).toBe('REVIEWER');
    expect(reviewer.reviewerWorktreeState).toBe('DIRTY');
    expect(reviewer.sourceFileCount).toBe(VERIFICATION_SOURCE_FILES.length);
  });

  it('records current reviewer bytes when a dirty authority file differs from the HEAD blob', async () => {
    const fixture = fixtureDependencies({ worktreeStatus: 'DIRTY' });
    const original = fixture.dependencies.workspace.readSourceFile;
    const driftedPath = VERIFICATION_SOURCE_FILES[0]!.path;
    const driftedBytes = Buffer.from('reviewer-workspace-drift', 'utf8');
    fixture.dependencies.workspace.readSourceFile = async (...args) =>
      args[1] === driftedPath ? { kind: 'REGULAR', bytes: driftedBytes } : original(...args);

    const reviewer = await buildReviewerSourceManifest('repository-root', fixture.dependencies);
    expect(reviewer.reviewerWorktreeState).toBe('DIRTY');
    expect(reviewer.sourceFiles[0]).toMatchObject({
      path: driftedPath,
      sha256: createHash('sha256').update(driftedBytes).digest('hex'),
      gitBlobOid: expect.stringMatching(/^[0-9a-f]{40}$/u),
    });
  });

  it('fails closed for unavailable commits, missing blobs, non-regular modes, and workspace drift', async () => {
    const unavailable = fixtureDependencies();
    unavailable.dependencies.git.commitExists = async () => false;
    await expect(buildProducerSourceManifest('repository-root', unavailable.dependencies)).rejects.toThrow(
      'PRODUCER_COMMIT_UNAVAILABLE',
    );

    const missing = fixtureDependencies();
    missing.dependencies.git.readBlob = async () => null;
    await expect(buildProducerSourceManifest('repository-root', missing.dependencies)).rejects.toThrow(
      'PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT',
    );

    const nonRegular = fixtureDependencies();
    const originalBlob = nonRegular.dependencies.git.readBlob;
    nonRegular.dependencies.git.readBlob = async (...args) => {
      const blob = await originalBlob(...args);
      return blob === null ? null : { ...blob, mode: '120000' };
    };
    await expect(buildProducerSourceManifest('repository-root', nonRegular.dependencies)).rejects.toThrow(
      'PRODUCER_SOURCE_GIT_MODE_NOT_REGULAR',
    );

    const drifted = fixtureDependencies();
    drifted.dependencies.workspace.readSourceFile = async () => ({
      kind: 'REGULAR',
      bytes: Buffer.from('drifted', 'utf8'),
    });
    await expect(buildProducerSourceManifest('repository-root', drifted.dependencies)).rejects.toThrow(
      'PRODUCER_SOURCE_WORKSPACE_BLOB_MISMATCH',
    );
  });

  it('rejects unsafe, duplicate, and unsorted manifest paths with stable findings', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    const [first, second, ...rest] = manifest.sourceFiles;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(() => parseVerificationSourceManifest({
      ...manifest,
      sourceFiles: [{ ...first!, path: '../escape.ts' }, second!, ...rest],
    })).toThrow('PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE');
    expect(() => parseVerificationSourceManifest({
      ...manifest,
      sourceFiles: [first!, { ...second!, path: first!.path }, ...rest],
    })).toThrow('PRODUCER_SOURCE_MANIFEST_ENTRY_DUPLICATE');
    expect(() => parseVerificationSourceManifest({
      ...manifest,
      sourceFiles: [second!, first!, ...rest],
    })).toThrow('PRODUCER_SOURCE_MANIFEST_ORDER_INVALID');
  });

  it('writes canonical manifest bytes and sidecar exclusively, then detects persisted byte drift', async () => {
    const fixture = fixtureDependencies();
    const manifest = await buildProducerSourceManifest('repository-root', fixture.dependencies);
    const root = await mkdtemp(join(tmpdir(), 'hdi-source-manifest-'));
    roots.push(root);
    const evidenceDirectory = join(root, 'evidence');
    await mkdir(evidenceDirectory);

    const result = await writeProducerSourceManifest(evidenceDirectory, manifest);
    const manifestPath = join(evidenceDirectory, result.relativePath);
    const sidecarPath = join(evidenceDirectory, result.sha256RelativePath);
    expect(await readFile(manifestPath)).toEqual(canonicalVerificationSourceManifestBytes(manifest));
    expect(await readFile(sidecarPath, 'utf8')).toBe(
      `${result.sha256}  producer-source-manifest.json\n`,
    );
    await expect(writeProducerSourceManifest(evidenceDirectory, manifest)).rejects.toThrow(
      'PRODUCER_SOURCE_MANIFEST_ALREADY_EXISTS',
    );
    await expect(verifyProducerSourceManifestStable(evidenceDirectory, result.sha256)).resolves.toBe(true);

    await writeFile(manifestPath, Buffer.concat([await readFile(manifestPath), Buffer.from(' ', 'utf8')]));
    await expect(verifyProducerSourceManifestStable(evidenceDirectory, result.sha256)).resolves.toBe(false);
  });
});

function fixtureDependencies(options: {
  readonly worktreeStatus?: 'CLEAN' | 'DIRTY' | 'UNAVAILABLE';
} = {}): {
  readonly dependencies: {
    readonly git: GitObjectReader;
    readonly repository: RepositoryStateReader;
    readonly workspace: WorkspaceSourceReader;
    readonly clock: () => string;
  };
  readonly executedPaths: string[];
} {
  const executedPaths: string[] = [];
  const bytesByPath = new Map(VERIFICATION_SOURCE_FILES.map((entry) => [
    entry.path,
    Buffer.from(`source:${entry.path}`, 'utf8'),
  ]));
  return {
    executedPaths,
    dependencies: {
      repository: {
        async readState() {
          return {
            repositoryFullName: 'hospital/Hospital-DataIntelligence-Platform',
            gitCommitSha: COMMIT,
            branch: 'phase-01-acceptance-readiness',
            worktreeStatus: options.worktreeStatus ?? 'CLEAN',
          };
        },
      },
      workspace: {
        async readSourceFile(_repositoryRoot, path) {
          executedPaths.push(path);
          return { kind: 'REGULAR' as const, bytes: bytesByPath.get(path)! };
        },
      },
      git: {
        async commitExists(_repositoryRoot, commitSha) {
          return commitSha === COMMIT;
        },
        async readBlob(_repositoryRoot, commitSha, path) {
          if (commitSha !== COMMIT) return null;
          const bytes = bytesByPath.get(path);
          if (bytes === undefined) return null;
          return { mode: '100644', oid: gitBlobOid(bytes), bytes };
        },
      },
      clock: () => '2026-08-30T00:00:00.000Z',
    },
  };
}

function gitBlobOid(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}
import { createHash } from 'node:crypto';
