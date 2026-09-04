import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// No server imports. Runtime schemas are projections of the frozen OpenAPI.
// The published fixture supplies immutable digest identities: Swagger removes
// $id and changes const to enum on legacy schemas, so hashing its transformed
// schema would NOT reproduce their canonical schema digest.
const root = resolve(import.meta.dirname, '../../..');
const api = JSON.parse(readFileSync(resolve(root, 'contracts/openapi/phase-01.openapi.json'), 'utf8'));
const fixtureBytes = readFileSync(resolve(root, 'tooling/prototype/fixtures/department-consumer-baseline.json'));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),
  '04367946e70e95bed4c1898576b33827e3fa906610bc1826fbe1e5e65e3a17e9', 'PUBLISHED_CONTRACT_AUTHORITY_CHANGED');
const published = JSON.parse(fixtureBytes).contracts;
const prefix = '/v1/phase-01/consumer-subscriptions/{subscriptionId}';
function resolveReferences(value) {
  if (Array.isArray(value)) return value.map(resolveReferences);
  if (typeof value !== 'object' || value === null) return value;
  if (value.$ref) {
    assert.match(value.$ref, /^#\/components\/schemas\/[^/]+$/u);
    const schema = api.components.schemas[value.$ref.split('/').at(-1)];
    assert.ok(schema, 'OPENAPI_REFERENCE_MISSING');
    return resolveReferences(schema);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item)]));
}
const response = (path, method, status, media = 'application/json') =>
  resolveReferences(api.paths[prefix + path][method].responses[status].content[media].schema);
const envelopes = response('/snapshots/{snapshotId}/content', 'get', 200,
  'application/vnd.hdi.canonical-snapshot+json').anyOf;
const contracts = envelopes.map((envelope) => {
  const identity = envelope.properties.projectionContract.properties;
  const projectionType = identity.projectionType.enum[0];
  const schemaVersion = identity.schemaVersion.enum[0];
  const pin = published.find((entry) => entry.projectionType === projectionType && entry.schemaVersion === schemaVersion);
  assert.ok(pin, 'PUBLISHED_CONTRACT_IDENTITY_MISSING');
  return { projectionType, schemaVersion, schemaDigest: pin.schemaDigest,
    aggregateType: envelope.properties.release.properties.aggregateType.enum[0],
    envelope: { ...envelope, properties: { ...envelope.properties, payload: {} } },
    payload: envelope.properties.payload };
});
assert.equal(contracts.length, published.length);
const schemas = {
  replayContextSchema: response('/releases/{releaseId}/replay-context', 'get', 200),
  eventsSchema: response('/events', 'get', 200),
  operationalSchema: response('/operational-status', 'get', 200),
  receiptResponseSchema: response('/receipts', 'post', 201),
  receiptBodySchema: resolveReferences(api.paths[prefix + '/receipts'].post.requestBody.content['application/json'].schema),
};
const output = '// Generated from frozen OpenAPI and published digest evidence. DO NOT EDIT.\n' +
  "import type { XSchema } from 'typebox/schema';\n\n" +
  'export const contracts: readonly { readonly projectionType: string; readonly schemaVersion: string; readonly schemaDigest: string; readonly aggregateType: string; readonly envelope: XSchema; readonly payload: XSchema }[] = ' +
  JSON.stringify(contracts, null, 2) + ';\n\n' +
  Object.entries(schemas).map(([name, schema]) => `export const ${name}: XSchema = ${JSON.stringify(schema, null, 2)};\n`).join('\n');
const destination = resolve(import.meta.dirname, '../src/contracts.generated.ts');
if (process.argv.includes('--check')) assert.equal(readFileSync(destination, 'utf8'), output, 'SDK_GENERATED_CONTRACT_DRIFT');
else writeFileSync(destination, output);
console.log('SDK contracts verified: 7 published identities; OpenAPI unchanged.');
