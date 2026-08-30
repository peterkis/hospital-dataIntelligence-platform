import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ABG_PRODUCER_PROTOCOL_IDENTITY,
  assertDistinctGateEvidenceSelectorSets,
  produceAbgGateProof,
  validateAbgGateResult,
  writeAbgGateProof,
  type AbgGateResult,
} from './abg-gate-proof.js';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  type AbgProducerId,
} from './abg-coverage-matrix.js';
import { buildMatrixProducerEvidence } from './evidence/adapters.js';
import {
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  sha256,
  writeProducerEvidence,
  writeProducerEvidenceIndex,
  writeRedactedJsonArtifact,
} from './evidence/recorder.js';
import { PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION } from './evidence/protocol.js';

const roots: string[] = [];
const RUN_ID = 'abg-gate-proof-fixture-0001';
const RUN_SEQUENCE = 7;
const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ABG gate-specific proof', () => {
  it('identifies the complete current evidence contract without changing accepted versions', () => {
    expect(ABG_PRODUCER_PROTOCOL_IDENTITY).toEqual({
      runPlanSchemaVersion: 'phase-01.abg-run-plan.v4',
      runPlanAuthorityId: 'phase-01.repository-authoritative-plan.v3',
      producerEvidenceSchemaVersion: 'phase-01.producer-evidence.v2',
      producerEvidenceIndexSchemaVersion: 'phase-01.producer-evidence-index.v2',
      gateResultSchemaVersion: 'phase-01.abg-gate-result.v3',
      runSummarySchemaVersion: 'phase-01.abg-run.v5',
      terminalConclusionSchemaVersion: 'phase-01.formal-terminal-conclusion.v2',
      runtimeOutcomeSchemaVersion: 'phase-01.formal-runtime-outcome.v3',
      evidenceManifestSchemaVersion: 'phase-01.evidence-manifest.v1',
    });
  });

  it('generates and validates 40 minimal, distinct gate proofs from explicit assertions', async () => {
    const fixture = await createFixture();
    const proofs: AbgGateResult[] = [];
    for (const entry of ABG_COVERAGE_MATRIX) {
      const resultRelativePath = 'gates/' + entry.gateId + '/producer/result.json';
      const proof = await writeAbgGateProof({
        ...proofInput(fixture, entry.gateId),
        resultRelativePath,
      });
      expect(proof.scenarioIds).toEqual(entry.scenarioIds);
      expect(proof.assertionIds).toEqual(entry.assertionIds);
      expect(proof.evidenceRefs).toHaveLength(entry.evidenceSelectors.length);
      expect(proof.evidenceRefs.every((reference) => reference.relativePath.startsWith('shared/')))
        .toBe(true);
      await expect(validateProof(fixture, proof)).resolves.toEqual(proof);
      const files = await import('node:fs/promises').then(({ readdir }) =>
        readdir(join(fixture.root, 'gates', entry.gateId, 'producer')),
      );
      expect(files).toEqual(['result.json']);
      proofs.push(proof);
    }
    expect(proofs).toHaveLength(40);
    expect(new Set(proofs.map(selectorSignature)).size).toBe(40);
    expect(() => assertDistinctGateEvidenceSelectorSets(proofs)).not.toThrow();
  });

  it('fails the affected gate when ABG-16, ABG-37, or ABG-40 loses its own assertion while shared status remains PASSED', async () => {
    for (const gateId of ['ABG-16', 'ABG-37', 'ABG-40'] as const) {
      const fixture = await createFixture();
      const assertionId = assertionFor(gateId, gateId === 'ABG-37' ? 1 : 0);
      await mutateProducerEvidence(fixture, producerForAssertion(assertionId), (evidence) => {
        const scenario = scenarioContainingAssertion(evidence, assertionId);
        delete record(scenario['assertions'])[assertionId];
        scenario['status'] = 'BLOCKED';
        evidence['status'] = 'BLOCKED';
      });
      await expect(produceAbgGateProof(proofInput(fixture, gateId))).rejects.toThrow(
        'ABG_GATE_ASSERTION_MISSING',
      );
      await expect(produceAbgGateProof(proofInput(fixture, 'ABG-01'))).resolves.toMatchObject({
        gateId: 'ABG-01',
        status: 'PASSED',
      });
      const shared = JSON.parse(await readFile(join(fixture.shared, 'shared-verification.json'), 'utf8')) as {
        readonly status: string;
      };
      expect(shared.status).toBe('PASSED');
    }
  });

  it('fails CLOSED for current assertion FAILED, BLOCKED, missing pointer, wrong assertion, gate, producer, and references', async () => {
    const assertionId = assertionFor('ABG-16');
    const producerId = producerForAssertion(assertionId);
    const cases: readonly {
      readonly name: string;
      readonly mutate: (evidence: MutableRecord) => void;
      readonly error: string;
    }[] = [
      {
        name: 'failed assertion',
        mutate: (evidence) => setAssertionStatus(evidence, assertionId, 'FAILED'),
        error: 'ABG_GATE_ASSERTION_STATUS_INVALID',
      },
      {
        name: 'blocked assertion',
        mutate: (evidence) => setAssertionStatus(evidence, assertionId, 'BLOCKED'),
        error: 'ABG_GATE_ASSERTION_STATUS_INVALID',
      },
      {
        name: 'missing pointer path',
        mutate: (evidence) => {
          const assertion = assertionRecord(evidence, assertionId);
          delete assertion['status'];
        },
        error: 'PRODUCER_EVIDENCE_STATUS_INVALID',
      },
      {
        name: 'wrong assertion identifier',
        mutate: (evidence) => {
          const assertion = assertionRecord(evidence, assertionId);
          assertion['assertionId'] = assertionFor('ABG-01');
        },
        error: 'PRODUCER_EVIDENCE_ASSERTION_DUPLICATE',
      },
      {
        name: 'other gate assertion',
        mutate: (evidence) => {
          const assertion = assertionRecord(evidence, assertionId);
          assertion['gateId'] = 'ABG-01';
        },
        error: 'PRODUCER_EVIDENCE_ASSERTION_GATE_MISMATCH',
      },
      {
        name: 'wrong producer identifier',
        mutate: (evidence) => {
          evidence['producerId'] = 'static';
        },
        error: 'PRODUCER_EVIDENCE_SCENARIO_PRODUCER_MISMATCH',
      },
      {
        name: 'missing request IDs',
        mutate: (evidence) => {
          scenarioContainingAssertion(evidence, assertionId)['requestIds'] = [];
        },
        error: 'PRODUCER_EVIDENCE_REFERENCE_REQUIRED',
      },
      {
        name: 'missing principal object version and rule references',
        mutate: (evidence) => {
          const scenario = scenarioContainingAssertion(evidence, assertionId);
          scenario['principalIds'] = [];
          scenario['governanceObjectIds'] = [];
          scenario['versionIds'] = [];
          scenario['ruleVersions'] = [];
          scenario['artifactDigests'] = [];
        },
        error: 'PRODUCER_EVIDENCE_REFERENCE_REQUIRED',
      },
      {
        name: 'missing frozen input digest',
        mutate: (evidence) => {
          record(evidence['frozenInputRefs'])['lockfileSha256'] = '';
        },
        error: 'PRODUCER_EVIDENCE_FROZEN_INPUT_INVALID',
      },
    ];
    for (const testCase of cases) {
      const fixture = await createFixture();
      await mutateProducerEvidence(fixture, producerId, testCase.mutate);
      await expect(produceAbgGateProof(proofInput(fixture, 'ABG-16'))).rejects.toThrow(testCase.error);
    }
  });

  it('rejects producer artifact digest corruption, traversal, symlink escape, and altered selected claim digest', async () => {
    const fixture = await createFixture();
    await mutateIndex(fixture, (index) => {
      const producer = recordArray(index['producers']).find((candidate) => candidate['producerId'] === 'fault');
      if (producer === undefined) throw new Error('fixture fault index missing');
      producer['sha256'] = SHA256;
    });
    await expect(produceAbgGateProof(proofInput(fixture, 'ABG-16'))).rejects.toThrow(
      'ABG_GATE_PRODUCER_EVIDENCE_DIGEST_MISMATCH',
    );

    const traversalFixture = await createFixture();
    const validProof = await produceAbgGateProof(proofInput(traversalFixture, 'ABG-16'));
    const traversalProof = {
      ...validProof,
      evidenceRefs: [{ ...validProof.evidenceRefs[0]!, relativePath: '../escaped.json' }],
    };
    await expect(validateProof(traversalFixture, traversalProof)).rejects.toThrow(
      'ABG_GATE_RESULT_EVIDENCE_PATH_INVALID',
    );
    const missingPointerProof = {
      ...validProof,
      evidenceRefs: validProof.evidenceRefs.map((reference, index) => index === 0
        ? { ...reference, jsonPointer: reference.jsonPointer + '/missing' }
        : reference),
    };
    await expect(validateProof(traversalFixture, missingPointerProof)).rejects.toThrow(
      'ABG_GATE_RESULT_EVIDENCE_SELECTOR_MISSING',
    );
    const alteredDigestProof = {
      ...validProof,
      evidenceRefs: validProof.evidenceRefs.map((reference, index) => index === 0
        ? { ...reference, selectedClaimDigest: SHA256 }
        : reference),
    };
    await expect(validateProof(traversalFixture, alteredDigestProof)).rejects.toThrow(
      'ABG_GATE_RESULT_EVIDENCE_REFERENCE_MISMATCH',
    );
    const alteredMediaProof = {
      ...validProof,
      evidenceRefs: validProof.evidenceRefs.map((reference, index) => index === 0
        ? { ...reference, mediaType: 'text/plain; charset=utf-8' }
        : reference),
    };
    await expect(validateProof(traversalFixture, alteredMediaProof)).rejects.toThrow(
      'ABG_GATE_RESULT_EVIDENCE_REFERENCE_MISMATCH',
    );

    const symlinkFixture = await createFixture();
    const external = await mkdtemp(join(tmpdir(), 'hdi-abg-gate-proof-external-'));
    roots.push(external);
    try {
      await symlink(external, join(symlinkFixture.shared, 'linked'), 'junction');
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      expect(code).toBe('EPERM');
      return;
    }
    await mutateIndex(symlinkFixture, (index) => {
      const producer = recordArray(index['producers']).find((candidate) => candidate['producerId'] === 'fault');
      if (producer === undefined) throw new Error('fixture fault index missing');
      producer['relativePath'] = 'linked/producer-evidence.json';
    });
    await expect(produceAbgGateProof(proofInput(symlinkFixture, 'ABG-16'))).rejects.toThrow(
      'ABG_GATE_EVIDENCE_SYMLINK_ESCAPE',
    );
  });

  it('uses exclusive proof output and rejects a result that names another gate or producer evidence index', async () => {
    const fixture = await createFixture();
    const input = {
      ...proofInput(fixture, 'ABG-16'),
      resultRelativePath: 'gates/ABG-16/producer/result.json',
    };
    const proof = await writeAbgGateProof(input);
    await expect(writeAbgGateProof(input)).rejects.toThrow('ABG_GATE_RESULT_ALREADY_EXISTS');
    await expect(validateAbgGateResult({
      value: { ...proof, gateId: 'ABG-17' },
      evidenceRoot: fixture.root,
      expectedGateId: 'ABG-16',
      expectedRunId: RUN_ID,
      expectedRunSequence: RUN_SEQUENCE,
    })).rejects.toThrow(
      'ABG_GATE_RESULT_ID_MISMATCH',
    );
    await expect(validateProof(fixture, {
      ...proof,
      producerEvidenceIndexDigest: SHA256,
    })).rejects.toThrow('ABG_GATE_RESULT_PRODUCER_INDEX_DIGEST_MISMATCH');
  });

  it('rejects a formal collection in which all 40 gate results use the same selector set', async () => {
    const fixture = await createFixture();
    const proofs = await Promise.all(ABG_COVERAGE_MATRIX.map((entry) =>
      produceAbgGateProof(proofInput(fixture, entry.gateId)),
    ));
    const sharedReferences = proofs[0]!.evidenceRefs;
    const invalid = proofs.map((proof) => ({ ...proof, evidenceRefs: sharedReferences }));
    expect(() => assertDistinctGateEvidenceSelectorSets(invalid)).toThrow(
      'ABG_GATE_RESULT_EVIDENCE_SELECTOR_SET_SHARED',
    );
  });
});

interface Fixture {
  readonly root: string;
  readonly shared: string;
}

type MutableRecord = Record<string, unknown>;

async function createFixture(): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), 'hdi-abg-gate-proof-'));
  roots.push(parent);
  const root = join(parent, 'formal');
  const shared = join(root, 'shared');
  await createEvidenceOutputDirectory(root);
  await createEvidenceOutputDirectory(shared);

  for (const producerId of ABG_PRODUCER_IDS) {
    const source = await writeRedactedJsonArtifact(shared, 'raw/' + producerId + '.json', {
      producerId,
      status: 'PASSED',
    });
    const item = await createEvidenceItemFromFile(shared, {
      artifactId: 'fixture-' + producerId + '-source',
      relativePath: source.relativePath,
      mediaType: 'application/json',
      jsonPointer: '/status',
      claim: { producerId, status: 'PASSED' },
    });
    const outcomes = Object.fromEntries(ABG_COVERAGE_MATRIX.flatMap((entry) =>
      entry.evidenceSelectors
        .filter((selector) => selector.producerId === producerId)
        .map((selector) => [selector.assertionId, {
          status: 'PASSED' as const,
          description: 'Synthetic assertion-specific fixture evidence.',
          expected: { status: 'PASSED' },
          actual: { status: 'PASSED', producerId, assertionId: selector.assertionId },
        }]),
    ));
    const evidence = buildMatrixProducerEvidence({
      producerId,
      runId: RUN_ID,
      runSequence: RUN_SEQUENCE,
      startedAt: '2026-08-27T10:00:00',
      completedAt: '2026-08-27T10:00:01',
      processStatus: 'PASSED',
      commandIdentity: {
        executable: 'synthetic-fixture',
        arguments: [producerId],
        workingDirectory: 'repository-root',
        commandDigest: sha256(Buffer.from('synthetic-fixture:' + producerId, 'utf8')),
      },
      environmentRefs: { CI: SHA256 },
      frozenInputRefs: frozenInputs(),
      defaultEvidenceItems: [item],
      defaultReferences: {
        requestIds: ['request-' + producerId],
        principalIds: ['principal-' + producerId],
        governanceObjectIds: ['governance-object-' + producerId],
        versionIds: ['version-' + producerId],
        ruleVersions: ['rule-version-' + producerId],
        artifactDigests: [item.sha256],
      },
      outcomes,
    });
    await writeProducerEvidence(shared, producerId + '/producer-evidence.json', evidence);
  }
  await writeRedactedJsonArtifact(shared, 'shared-verification.json', {
    status: 'PASSED',
    note: 'This test fixture is deliberately ignored by gate proof selection.',
  });
  await rebuildIndex({ root, shared }, false);
  return { root, shared };
}

function proofInput(fixture: Fixture, gateId: string) {
  return {
    gateId,
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    evidenceRoot: fixture.root,
    producerEvidenceIndexRelativePath: 'shared/producer-evidence-index.json',
  };
}

async function validateProof(fixture: Fixture, value: unknown): Promise<AbgGateResult> {
  const resultRecord = record(value);
  return validateAbgGateResult({
    value,
    evidenceRoot: fixture.root,
    expectedGateId: stringValue(resultRecord['gateId']),
    expectedRunId: RUN_ID,
    expectedRunSequence: RUN_SEQUENCE,
  });
}

async function mutateProducerEvidence(
  fixture: Fixture,
  producerId: AbgProducerId,
  mutate: (evidence: MutableRecord) => void,
): Promise<void> {
  const path = join(fixture.shared, producerId, 'producer-evidence.json');
  const evidence = record(JSON.parse(await readFile(path, 'utf8')) as unknown);
  mutate(evidence);
  await writeFile(path, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
  await rebuildIndex(fixture, true);
}

async function mutateIndex(
  fixture: Fixture,
  mutate: (index: MutableRecord) => void,
): Promise<void> {
  const path = join(fixture.shared, 'producer-evidence-index.json');
  const index = record(JSON.parse(await readFile(path, 'utf8')) as unknown);
  mutate(index);
  await writeFile(path, JSON.stringify(index, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
}

async function rebuildIndex(fixture: Fixture, overwrite: boolean): Promise<void> {
  const producers = await Promise.all(ABG_PRODUCER_IDS.map(async (producerId) => {
    const relativePath = producerId + '/producer-evidence.json';
    const bytes = await readFile(join(fixture.shared, relativePath));
    const evidence = record(JSON.parse(bytes.toString('utf8')) as unknown);
    const scenarios = record(evidence['scenarios']);
    return {
      producerId,
      relativePath,
      sha256: sha256(bytes),
      status: stringValue(evidence['status']) as 'PASSED' | 'FAILED' | 'BLOCKED',
      scenarioCount: Object.keys(scenarios).length,
      assertionCount: Object.values(scenarios).reduce<number>((total, scenario) =>
        total + Object.keys(record(record(scenario)['assertions'])).length,
      0),
    };
  }));
  const index = {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    producers,
  };
  const path = join(fixture.shared, 'producer-evidence-index.json');
  if (overwrite) {
    await writeFile(path, JSON.stringify(index, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
    return;
  }
  await writeProducerEvidenceIndex(fixture.shared, 'producer-evidence-index.json', index);
}

function frozenInputs() {
  return Object.fromEntries(ABG_FROZEN_INPUT_KINDS.map((kind) => [kind, frozenInputValue(kind)]));
}

function frozenInputValue(kind: (typeof ABG_FROZEN_INPUT_KINDS)[number]): string {
  switch (kind) {
    case 'nodeVersion': return 'v24.18.0';
    case 'postgresImage': return 'postgres@sha256:' + SHA256;
    case 'keycloakImage': return 'keycloak@sha256:' + SHA256;
    case 'browserVersion': return '1.56.0';
    default: return SHA256;
  }
}

function assertionFor(gateId: string, index = 0): string {
  const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === gateId);
  const assertionId = entry?.assertionIds[index];
  if (assertionId === undefined) throw new Error('fixture assertion missing:' + gateId);
  return assertionId;
}

function producerForAssertion(assertionId: string): AbgProducerId {
  const selector = ABG_COVERAGE_MATRIX.flatMap((entry) => entry.evidenceSelectors)
    .find((candidate) => candidate.assertionId === assertionId);
  if (selector === undefined) throw new Error('fixture producer missing:' + assertionId);
  return selector.producerId;
}

function scenarioContainingAssertion(evidence: MutableRecord, assertionId: string): MutableRecord {
  const scenario = Object.values(record(evidence['scenarios'])).find((candidate) =>
    Object.hasOwn(record(candidate)['assertions'] as MutableRecord, assertionId),
  );
  if (scenario === undefined) throw new Error('fixture scenario missing:' + assertionId);
  return record(scenario);
}

function assertionRecord(evidence: MutableRecord, assertionId: string): MutableRecord {
  const assertion = record(scenarioContainingAssertion(evidence, assertionId)['assertions'])[assertionId];
  return record(assertion);
}

function setAssertionStatus(
  evidence: MutableRecord,
  assertionId: string,
  status: 'FAILED' | 'BLOCKED',
): void {
  const scenario = scenarioContainingAssertion(evidence, assertionId);
  const assertion = assertionRecord(evidence, assertionId);
  assertion['status'] = status;
  assertion['failureCode'] = 'SYNTHETIC_' + status;
  scenario['status'] = status;
  evidence['status'] = status;
}

function selectorSignature(result: AbgGateResult): string {
  return result.evidenceRefs
    .map((reference) => [
      reference.producerId,
      reference.scenarioId,
      reference.assertionId,
      reference.jsonPointer,
    ].join('|'))
    .sort((left, right) => left.localeCompare(right))
    .join('::');
}

function record(value: unknown): MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture record expected');
  }
  return value as MutableRecord;
}

function recordArray(value: unknown): MutableRecord[] {
  if (!Array.isArray(value)) throw new Error('fixture record array expected');
  return value.map(record);
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('fixture string expected');
  return value;
}
