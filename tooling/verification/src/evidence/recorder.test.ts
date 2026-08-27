import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ABG_COVERAGE_MATRIX } from '../abg-coverage-matrix.js';
import { buildProducerFailureEvidence } from './adapters.js';
import {
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  redactSensitiveText,
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
      'PRODUCER_EVIDENCE_PARENT_UNSAFE',
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
});

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
    nodeVersion: 'v24.18.0',
  };
}
