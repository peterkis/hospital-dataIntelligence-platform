import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Check } from 'typebox/value';
import { PHASE_01_PROJECTION_CONTRACTS } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import {
  buildCanonicalSnapshotArtifact,
  type CanonicalSnapshotArtifactInput,
  type ProjectionContractRegistration,
} from '../../apps/governance-api/src/modules/release-distribution/index.js';
import { canonicalSha256, sha256Bytes } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { SnapshotEnvelopeSchema } from '../../apps/governance-api/src/platform/fastify/release-consumer-schemas.js';

export function checkDepartmentConsumerCanonical(options: {
  readonly contracts?: readonly ProjectionContractRegistration[];
  readonly baselineBytes?: Buffer;
  readonly buildArtifact?: (input: CanonicalSnapshotArtifactInput) => Buffer;
} = {}) {
  const registrations = options.contracts ?? PHASE_01_PROJECTION_CONTRACTS;
  const baselineBytes = options.baselineBytes ?? readFileSync(resolve(import.meta.dirname,
    'fixtures/department-consumer-baseline.json'));
  // Published evidence, NOT an updateable snapshot. From START_HEAD e366a073,
  // Git blob f10fdfce76f81a1d2a6759a94a6a023ab88c82f8. Never rebaseline this pin.
  assert.equal(sha256Bytes(baselineBytes).toString('hex'),
    '04367946e70e95bed4c1898576b33827e3fa906610bc1826fbe1e5e65e3a17e9',
    'PROJECTION_FREEZE_AUTHORITY_CHANGED');
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as {
    baselineHead: string;
    contracts: {
      projectionType: string; schemaVersion: string; schemaDigest: string;
      input: Omit<CanonicalSnapshotArtifactInput, 'projectionSchemaDigest'> & { projectionSchemaDigest: string };
      artifactUtf8: string; artifactDigest: string;
    }[];
  };
  assert.equal(baseline.baselineHead, '80ed445c7710deb72db5560acc49be3652d8fbdc');
  // Proposed versions may coexist, but can never replace a published pair.
  const identities = registrations.map((contract) => JSON.stringify([contract.projectionType, contract.schemaVersion]));
  assert.equal(new Set(identities).size, identities.length, 'PROJECTION_CONTRACT_DUPLICATE');
  const references = Object.fromEntries(registrations.flatMap((contract) => {
    const id = (contract.schema as { readonly $id?: unknown }).$id;
    return typeof id === 'string' ? [[id, contract.schema]] : [];
  }));
  const contracts = baseline.contracts.map((before) => {
    const contractId = `${before.projectionType}@${before.schemaVersion}`;
    const contract = registrations.find((candidate) =>
      candidate.projectionType === before.projectionType && candidate.schemaVersion === before.schemaVersion);
    assert.ok(contract, `PROJECTION_PUBLISHED_VERSION_MISSING:${before.projectionType}@${before.schemaVersion}`);
    const afterDigest = canonicalSha256(contract.schema).toString('hex');
    assert.equal(afterDigest, before.schemaDigest, `PROJECTION_SCHEMA_IMMUTABLE:${before.projectionType}@${before.schemaVersion}`);
    assert.equal(before.input.projectionType, contract.projectionType, `PROJECTION_TYPE_MISMATCH:${contractId}`);
    assert.equal(before.input.projectionSchemaVersion, contract.schemaVersion, `PROJECTION_VERSION_MISMATCH:${contractId}`);
    assert.equal(before.input.projectionSchemaDigest, afterDigest, `PROJECTION_DIGEST_MISMATCH:${contractId}`);
    assert.ok(Check(references, contract.schema, before.input.payload), `PROJECTION_PAYLOAD_SCHEMA_INVALID:${contractId}`);
    const bytes = (options.buildArtifact ?? buildCanonicalSnapshotArtifact)({
      ...before.input, projectionSchemaDigest: Buffer.from(afterDigest, 'hex'),
    });
    assert.deepEqual(bytes, Buffer.from(before.artifactUtf8, 'utf8'),
      `PROJECTION_ARTIFACT_IMMUTABLE:${before.projectionType}@${before.schemaVersion}`);
    assert.equal(sha256Bytes(bytes).toString('hex'), before.artifactDigest);
    assert.ok(Check(references, SnapshotEnvelopeSchema, JSON.parse(bytes.toString('utf8'))),
      `HTTP envelope disagrees with canonical bytes: ${before.projectionType}@${before.schemaVersion}`);
    return { contractId, projectionType: before.projectionType, schemaVersion: before.schemaVersion,
      beforeDigest: before.schemaDigest, afterDigest, artifactBytesUnchanged: true,
      beforeArtifactDigest: before.artifactDigest, afterArtifactDigest: sha256Bytes(bytes).toString('hex'),
      payloadSchemaValid: true, releaseEnvelopeIdentityUnchanged: true };
  });
  return { status: 'PASSED', canonicalDepartmentSchemaDigestsUnchanged: true,
    canonicalArtifactBytesUnchanged: true, contracts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(checkDepartmentConsumerCanonical())}\n`);
}
