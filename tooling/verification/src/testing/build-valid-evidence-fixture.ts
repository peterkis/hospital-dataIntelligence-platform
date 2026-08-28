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
  getAbgCoverageMatrixDigest,
  getAbgProducerProtocolIdentityDigest,
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

export const VALIDATOR_FIXTURE_RUN_ID = 'validator-test-fixture-run-0001';
export const VALIDATOR_FIXTURE_RUN_SEQUENCE = 17;
export const VALIDATOR_FIXTURE_DIGEST =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface BuildValidEvidenceFixtureInput {
  /** Existing, caller-owned temporary directory. */
  readonly rootDirectory: string;
}

export interface ValidFixtureGateSummary {
  readonly gateId: string;
  readonly status: 'PASSED';
  readonly proofPath: string;
  readonly proof: AbgGateResult;
  readonly [key: string]: unknown;
}

export interface ValidFixtureSummary {
  readonly schemaVersion: 'phase-01.abg-run.v3';
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
}

/**
 * Builds a byte-deterministic package used only to test verification code. It
 * does not start services and is explicitly ineligible for formal acceptance.
 */
export async function buildValidEvidenceFixture(
  input: BuildValidEvidenceFixtureInput,
): Promise<ValidEvidenceFixture> {
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

  const frozenInputs = fixtureFrozenInputs();
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

  await writeFixtureJson(join(evidenceDirectory, 'formal-run/preliminary-conclusion.json'), {
    schemaVersion: 'phase-01.abg-preconclusion.v1',
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    status: 'PASSED',
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    gates: ABG_GATES.slice(0, 39).map((gate) => ({ gateId: gate.gateId, status: 'PASSED' })),
  });
  const formalEntry = await writeFixtureProducer({
    producerId: 'formal-run',
    evidenceRoot: evidenceDirectory,
    frozenInputs,
    rawArtifactPath: 'formal-run/preliminary-conclusion.json',
    evidencePath: 'formal-run/producer-evidence.json',
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

  const proofs: AbgGateResult[] = [];
  for (const entry of ABG_COVERAGE_MATRIX) {
    proofs.push(await writeAbgGateProof({
      gateId: entry.gateId,
      runId: VALIDATOR_FIXTURE_RUN_ID,
      runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
      evidenceRoot: evidenceDirectory,
      producerEvidenceIndexRelativePath: entry.gateId === 'ABG-40'
        ? 'producer-evidence-index.json'
        : 'shared/producer-evidence-index.json',
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
  const authorityIdentity = await readVerificationAuthorityIdentity(repositoryRoot);
  const plan: FrozenRunPlan = {
    schemaVersion: 'phase-01.abg-run-plan.v3',
    authorityId: 'phase-01.repository-authoritative-plan.v2',
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    frozenInputs,
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
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    planDigest: sha256(planBytes),
    frozenInputs,
    frozenInputsDigest: digestJson(frozenInputs),
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    setupCommandDigests: setupCommands.map(digestJson),
  };
  const summary: ValidFixtureSummary = {
    schemaVersion: 'phase-01.abg-run.v3',
    runId: VALIDATOR_FIXTURE_RUN_ID,
    runSequence: VALIDATOR_FIXTURE_RUN_SEQUENCE,
    planDigest: summaryValidationExpectations.planDigest,
    frozenInputs,
    frozenInputsDigest: summaryValidationExpectations.frozenInputsDigest,
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    authorityIdentity,
    frozenInputsStable: true,
    authorityIdentityStable: true,
    selectorSetsDistinct: true,
    status: 'PASSED',
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
    schemaVersion: 'phase-01.evidence-manifest.v1',
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

function fixtureFrozenInputs(): Readonly<Record<string, string>> {
  return {
    gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
    workingTreeState: 'CLEAN',
    lockfileSha256: VALIDATOR_FIXTURE_DIGEST,
    openapiSha256: VALIDATOR_FIXTURE_DIGEST,
    migrationManifestSha256: VALIDATOR_FIXTURE_DIGEST,
    fixtureIdentity: VALIDATOR_FIXTURE_DIGEST,
    nodeVersion: 'v24.18.0',
    postgresImage: 'postgres:18.4',
    keycloakImage: 'quay.io/keycloak/keycloak:26.7.0',
    browserVersion: '1.61.0',
  } satisfies Record<(typeof ABG_FROZEN_INPUT_KINDS)[number] | 'workingTreeState', string>;
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
