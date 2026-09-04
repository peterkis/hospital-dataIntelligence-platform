import { describe, expect, it } from 'vitest';
import { Check } from 'typebox/value';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  ConsumerProjectionSupportSchema, CreateSubscriptionBodySchema, CreateSubscriptionVersionBodySchema,
} from '../../platform/fastify/release-consumer-schemas.js';
import { mapHttpError } from '../../platform/fastify/map-http-error.js';

const id = '10000000-0000-7000-8000-000000000001';
const legalPairs = [
  ['hdi.price-list', '0'], ['hdi.price-list', '1'], ['hdi.price-list', '2'],
  ['hdi.department-master', '1'], ['hdi.department-hierarchy', '1'],
] as const;
describe('Department release consumer contract', () => {
  it.each(legalPairs)('accepts exact %s @ %s in both subscription operations', (projectionType, projectionSchemaVersion) => {
    const pair = { projectionType, projectionSchemaVersion };
    expect(Check(ConsumerProjectionSupportSchema, pair)).toBe(true);
    expect(Check(CreateSubscriptionBodySchema, { ...pair, governanceObjectId: id, servicePrincipalId: id, subscriptionCode: 'SYNTHETIC' })).toBe(true);
    expect(Check(CreateSubscriptionVersionBodySchema, { ...pair, governanceObjectId: id })).toBe(true);
  });
  it.each([
    ['hdi.department-master', '0'], ['hdi.department-master', '2'],
    ['hdi.department-hierarchy', '0'], ['hdi.department-hierarchy', '2'],
    ['hdi.price-list', '3'], ['unknown', '1'], ['hdi.charge-catalog', '1'],
  ])('rejects unsupported HTTP pair %s @ %s', (projectionType, projectionSchemaVersion) => {
    const pair = { projectionType, projectionSchemaVersion };
    expect(Check(CreateSubscriptionBodySchema, { ...pair, governanceObjectId: id, servicePrincipalId: id, subscriptionCode: 'SYNTHETIC' })).toBe(false);
    expect(Check(CreateSubscriptionVersionBodySchema, { ...pair, governanceObjectId: id })).toBe(false);
  });
  it.each(legalPairs)('rejects extra properties in %s @ %s', (projectionType, projectionSchemaVersion) => {
    const body = { projectionType, projectionSchemaVersion, governanceObjectId: id, actorPrincipalId: id };
    expect(Check(CreateSubscriptionVersionBodySchema, body)).toBe(false);
    expect(Check(CreateSubscriptionBodySchema, { ...body, subscriptionCode: 'SYNTHETIC', servicePrincipalId: id })).toBe(false);
  });
  it('preserves all seven canonical schema digests and exact artifact bytes', () => {
    const output = execFileSync(process.execPath,
      ['--import', 'tsx', 'tooling/prototype/check-department-consumer-canonical.ts'],
      { cwd: resolve(import.meta.dirname, '../../../../..'), encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output).contracts).toHaveLength(7);
  });
  it.each(['CONSUMER_PROJECTION_GOVERNANCE_OBJECT_MISMATCH', 'CONSUMER_SERVICE_PRINCIPAL_INVALID'])(
    'maps %s to the stable 400 contract', (code) => expect(mapHttpError(new Error(code))).toEqual({ statusCode: 400, code }));
});
