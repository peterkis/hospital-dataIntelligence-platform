import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PHASE_01_PROJECTION_CONTRACTS } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { DepartmentMasterProjectionSchema } from '../../apps/governance-api/src/modules/department-master/index.js';
import { checkDepartmentConsumerCanonical } from './check-department-consumer-canonical.js';
import { buildCanonicalSnapshotArtifact, type ProjectionContractRegistration } from '../../apps/governance-api/src/modules/release-distribution/index.js';
import { canonicalSha256, sha256Bytes } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { Check } from 'typebox/value';
import { ConsumerProjectionSupportSchema } from '../../apps/governance-api/src/platform/fastify/release-consumer-schemas.js';
import { evaluateProjectionSchemaCompatibility } from './evaluate-projection-schema-compatibility.js';

const master = PHASE_01_PROJECTION_CONTRACTS.find((contract) => contract.projectionType === 'hdi.department-master')!;
const proposed: ProjectionContractRegistration = { ...master, schemaVersion: '2', schema: {
  ...DepartmentMasterProjectionSchema, properties: {
    ...DepartmentMasterProjectionSchema.properties, syntheticNote: { type: 'string' },
  },
} };
const baselineBytes = readFileSync(resolve(import.meta.dirname, 'fixtures/department-consumer-baseline.json'));

for (const published of PHASE_01_PROJECTION_CONTRACTS) {
  it(`B: freezes definitions and semantic annotations for ${published.projectionType}@${published.schemaVersion}`, () => {
    for (const schema of [
      { ...published.schema, $defs: { syntheticMeaning: { const: 'CHANGED' } } },
      { ...published.schema, description: 'Synthetic changed interpretation' },
      { ...published.schema, $id: 'urn:synthetic:changed-identity' },
    ]) {
      assert.throws(() => checkDepartmentConsumerCanonical({ contracts: PHASE_01_PROJECTION_CONTRACTS.map((contract) =>
        contract === published ? { ...contract, schema } : contract) }), /PROJECTION_SCHEMA_IMMUTABLE/);
    }
  });
}

it('C: regenerates all seven exact artifacts, including reordered payload keys', () => {
  function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
    }
    return value;
  }
  const first = checkDepartmentConsumerCanonical();
  const second = checkDepartmentConsumerCanonical({ buildArtifact: (input) =>
    buildCanonicalSnapshotArtifact({ ...input, payload: reverseKeys(input.payload) }) });
  assert.deepEqual(second, first);
  assert.equal(first.contracts.length, 7);
  assert.equal(first.contracts.find((contract) => contract.projectionType === 'hdi.department-master')?.afterDigest,
    'a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc');
  assert.equal(first.contracts.find((contract) => contract.projectionType === 'hdi.department-hierarchy')?.afterDigest,
    '72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372');
});

it('rejects duplicate registrations instead of hiding a changed schema behind the first match', () => {
  assert.throws(() => checkDepartmentConsumerCanonical({ contracts: [
    ...PHASE_01_PROJECTION_CONTRACTS, { ...PHASE_01_PROJECTION_CONTRACTS[0]!, schema: { type: 'null' } },
  ] }), /PROJECTION_CONTRACT_DUPLICATE/);
});

it('A: rejects even an optional property added to the published Master V1', () => {
  const contracts = PHASE_01_PROJECTION_CONTRACTS.map((contract) =>
    contract.projectionType === 'hdi.department-master' ? {
      ...contract,
      schema: { ...DepartmentMasterProjectionSchema, properties: {
        ...DepartmentMasterProjectionSchema.properties, syntheticNote: { type: 'string' },
      } },
    } : contract);
  assert.throws(() => checkDepartmentConsumerCanonical({ contracts }), /PROJECTION_SCHEMA_IMMUTABLE/);
});

it('D: evaluates synthetic V2 independently while retaining every old artifact', () => {
  const result = evaluateProjectionSchemaCompatibility(master, proposed);
  assert.equal(result.backwardCompatible, true);
  assert.equal(result.forwardCompatible, false);
  assert.equal(result.classification, 'BACKWARD_COMPATIBLE');
  assert.equal(checkDepartmentConsumerCanonical({ contracts: [...PHASE_01_PROJECTION_CONTRACTS, proposed] })
    .canonicalArtifactBytesUnchanged, true);
  assert.throws(() => checkDepartmentConsumerCanonical({ contracts: PHASE_01_PROJECTION_CONTRACTS.map((contract) =>
    contract === master ? { ...proposed, schemaVersion: '1' } : contract) }), /PROJECTION_SCHEMA_IMMUTABLE/);
  assert.equal(PHASE_01_PROJECTION_CONTRACTS.length, 7);
  assert.equal(PHASE_01_PROJECTION_CONTRACTS.some((contract) =>
    contract.projectionType.startsWith('hdi.department-') && contract.schemaVersion === '2'), false);
  assert.equal(Check(ConsumerProjectionSupportSchema, {
    projectionType: proposed.projectionType, projectionSchemaVersion: proposed.schemaVersion,
  }), false);
});

it('E: changing the registry version cannot remove or replace the old identity', () => {
  for (const replacement of [proposed, { ...master, projectionType: 'synthetic.changed-type' }]) {
    assert.throws(() => checkDepartmentConsumerCanonical({ contracts: PHASE_01_PROJECTION_CONTRACTS.map((contract) =>
      contract === master ? replacement : contract) }), /PROJECTION_PUBLISHED_VERSION_MISSING/);
  }
});

it('E: rejects a new version written into an old release artifact', () => {
  assert.throws(() => checkDepartmentConsumerCanonical({
    buildArtifact: (input) => buildCanonicalSnapshotArtifact({ ...input, projectionSchemaVersion: '2' }),
  }), /PROJECTION_ARTIFACT_IMMUTABLE/);
});

it('rejects updating the golden fixture even when the replacement is self-consistent', () => {
  const baseline = JSON.parse(baselineBytes.toString('utf8'));
  const frozen = baseline.contracts.find((contract: { projectionType: string }) => contract.projectionType === master.projectionType);
  frozen.schemaDigest = canonicalSha256(proposed.schema).toString('hex');
  frozen.input.projectionSchemaDigest = frozen.schemaDigest;
  const artifact = buildCanonicalSnapshotArtifact({ ...frozen.input, projectionSchemaDigest: Buffer.from(frozen.schemaDigest, 'hex') });
  frozen.artifactUtf8 = artifact.toString('utf8');
  frozen.artifactDigest = sha256Bytes(artifact).toString('hex');
  assert.throws(() => checkDepartmentConsumerCanonical({
    contracts: PHASE_01_PROJECTION_CONTRACTS.map((contract) =>
      contract === master ? { ...proposed, schemaVersion: '1' } : contract),
    baselineBytes: Buffer.from(JSON.stringify(baseline, null, 2)),
  }), /PROJECTION_FREEZE_AUTHORITY_CHANGED/);
  // Even a whitespace-only rebaseline is forbidden; the published Git blob is authority.
  assert.throws(() => checkDepartmentConsumerCanonical({
    baselineBytes: Buffer.concat([baselineBytes, Buffer.from('\n')]),
  }), /PROJECTION_FREEZE_AUTHORITY_CHANGED/);
});

it('rejects release identity, envelope profile, payload and raw byte rewrites', () => {
  for (const change of [
    (input: Parameters<typeof buildCanonicalSnapshotArtifact>[0]) => buildCanonicalSnapshotArtifact({ ...input, releaseNo: '999' }),
    (input: Parameters<typeof buildCanonicalSnapshotArtifact>[0]) => buildCanonicalSnapshotArtifact({ ...input, projectionType: 'synthetic.other' }),
    (input: Parameters<typeof buildCanonicalSnapshotArtifact>[0]) => buildCanonicalSnapshotArtifact({ ...input, payload: null }),
    (input: Parameters<typeof buildCanonicalSnapshotArtifact>[0]) => Buffer.from(buildCanonicalSnapshotArtifact(input).toString('utf8').replace('phase-01.v1', 'phase-01.v2')),
    (input: Parameters<typeof buildCanonicalSnapshotArtifact>[0]) => Buffer.concat([buildCanonicalSnapshotArtifact(input), Buffer.from('\n')]),
  ]) assert.throws(() => checkDepartmentConsumerCanonical({ buildArtifact: change }), /PROJECTION_ARTIFACT_IMMUTABLE/);
});

it('reports forward compatibility independently for removal of an optional property', () => {
  const result = evaluateProjectionSchemaCompatibility({ ...proposed, schemaVersion: 'synthetic-old' }, master);
  assert.equal(result.backwardCompatible, false);
  assert.equal(result.forwardCompatible, true);
  assert.equal(result.classification, 'FORWARD_COMPATIBLE');
});

it('reports a required extra property as breaking in both directions for closed objects', () => {
  const result = evaluateProjectionSchemaCompatibility(master, { ...proposed, schema: {
    ...proposed.schema, required: [...DepartmentMasterProjectionSchema.required, 'syntheticNote'],
  } });
  assert.equal(result.backwardCompatible, false);
  assert.equal(result.forwardCompatible, false);
  assert.equal(result.classification, 'BREAKING');
});

it('reports unchanged schemas as fully compatible, without inferring from version numbers', () => {
  assert.equal(evaluateProjectionSchemaCompatibility(master, { ...master, schemaVersion: 'synthetic-next' }).classification, 'FULLY_COMPATIBLE');
  assert.throws(() => evaluateProjectionSchemaCompatibility(master, master), /PROJECTION_EVOLUTION_NEW_VERSION_REQUIRED/);
  assert.throws(() => evaluateProjectionSchemaCompatibility(master, { ...proposed, projectionType: 'synthetic.other' }), /PROJECTION_EVOLUTION_TYPE_MISMATCH/);
});

it('requires review for unproved constraints, type changes and semantic annotations', () => {
  for (const schema of [
    { ...DepartmentMasterProjectionSchema, description: 'Synthetic new meaning' },
    { ...DepartmentMasterProjectionSchema, minProperties: 1 },
    { ...DepartmentMasterProjectionSchema, properties: { ...DepartmentMasterProjectionSchema.properties, versionNo: { type: 'number' } } },
  ]) {
    const result = evaluateProjectionSchemaCompatibility(master, { ...proposed, schema });
    assert.equal(result.classification, 'REQUIRES_REVIEW');
    assert.equal(result.backwardCompatible, null);
    assert.equal(result.forwardCompatible, null);
  }
});

it('does not infer compatibility through unresolved or context-dependent references', () => {
  const schema = { type: 'object', additionalProperties: false,
    properties: { linked: { $ref: '#/properties/syntheticNote' } } };
  const result = evaluateProjectionSchemaCompatibility({ ...master, schema }, { ...proposed, schema: {
    ...schema, properties: { ...schema.properties, syntheticNote: { type: 'string' } },
  } });
  assert.equal(result.classification, 'REQUIRES_REVIEW');
});
