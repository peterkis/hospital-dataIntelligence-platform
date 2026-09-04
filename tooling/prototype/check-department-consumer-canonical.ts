import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Check } from 'typebox/value';
import { PHASE_01_PROJECTION_CONTRACTS } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import {
  buildCanonicalSnapshotArtifact,
  type CanonicalSnapshotArtifactInput,
} from '../../apps/governance-api/src/modules/release-distribution/index.js';
import { canonicalSha256, sha256Bytes } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { SnapshotEnvelopeSchema } from '../../apps/governance-api/src/platform/fastify/release-consumer-schemas.js';

export function checkDepartmentConsumerCanonical() {
  const baseline = JSON.parse(readFileSync(resolve(import.meta.dirname,
    'fixtures/department-consumer-baseline.json'), 'utf8')) as {
    baselineHead: string;
    contracts: {
      projectionType: string; schemaVersion: string; schemaDigest: string;
      input: Omit<CanonicalSnapshotArtifactInput, 'projectionSchemaDigest'> & { projectionSchemaDigest: string };
      artifactUtf8: string; artifactDigest: string;
    }[];
  };
  assert.equal(baseline.baselineHead, '80ed445c7710deb72db5560acc49be3652d8fbdc');
  assert.equal(baseline.contracts.length, PHASE_01_PROJECTION_CONTRACTS.length);
  const references = Object.fromEntries(PHASE_01_PROJECTION_CONTRACTS.flatMap((contract) => {
    const id = (contract.schema as { readonly $id?: unknown }).$id;
    return typeof id === 'string' ? [[id, contract.schema]] : [];
  }));
  const contracts = baseline.contracts.map((before) => {
    const contract = PHASE_01_PROJECTION_CONTRACTS.find((candidate) =>
      candidate.projectionType === before.projectionType && candidate.schemaVersion === before.schemaVersion);
    assert.ok(contract);
    const afterDigest = canonicalSha256(contract.schema).toString('hex');
    assert.equal(afterDigest, before.schemaDigest, `Canonical schema changed: ${before.projectionType}@${before.schemaVersion}`);
    assert.ok(Check(contract.schema, before.input.payload));
    const bytes = buildCanonicalSnapshotArtifact({
      ...before.input, projectionSchemaDigest: Buffer.from(afterDigest, 'hex'),
    });
    assert.deepEqual(bytes, Buffer.from(before.artifactUtf8, 'utf8'));
    assert.equal(sha256Bytes(bytes).toString('hex'), before.artifactDigest);
    assert.ok(Check(references, SnapshotEnvelopeSchema, JSON.parse(bytes.toString('utf8'))),
      `HTTP envelope disagrees with canonical bytes: ${before.projectionType}@${before.schemaVersion}`);
    return { projectionType: before.projectionType, schemaVersion: before.schemaVersion,
      beforeDigest: before.schemaDigest, afterDigest, artifactBytesUnchanged: true };
  });
  return { status: 'PASSED', canonicalDepartmentSchemaDigestsUnchanged: true,
    canonicalArtifactBytesUnchanged: true, contracts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(checkDepartmentConsumerCanonical())}\n`);
}
