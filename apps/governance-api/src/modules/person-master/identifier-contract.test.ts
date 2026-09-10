import { describe, expect, it } from 'vitest';
import { safeIdentifierError, validateIdentifierKey, validateIdentifierPeriod, validateIdentifierRegistration } from './index.js';

const key = { governanceObjectId: '76000000-0000-7000-8000-000000000001',
  identifierSystem: 'urn:hdi:synthetic:Personnel-Number', identifierValue: 'SYN-PN-00a-/ A' };
describe('Person Identifier canonical input and privacy boundary', () => {
  it('retains namespace case, punctuation, internal spaces and leading zeroes exactly', () => {
    const before = JSON.stringify(key); validateIdentifierKey(key); expect(JSON.stringify(key) === before).toBe(true);
  });
  it('accepts https namespaces and Unicode canonical values without folding', () => {
    validateIdentifierKey({ ...key, identifierSystem: 'https://synthetic.example/Personnel', identifierValue: 'SYN-𠮷-e\u0301/01' });
  });
  const badSystems = ['', 'personnel', ':abc', 'urn:', ' urn:hdi:x', 'urn:hdi:x ', 'urn:hdi:\tX', 'urn:hdi:\0X', 'urn:hdi:人', `urn:${'x'.repeat(509)}`];
  badSystems.forEach((identifierSystem, index) => it(`rejects invalid namespace case ${index}`, () => {
    expect(() => validateIdentifierKey({ ...key, identifierSystem })).toThrow('PERSON_IDENTIFIER_SYSTEM_INVALID');
  }));
  const badValues = ['', ' ', ' SYN', 'SYN ', '\u00a0SYN', 'SYN\u3000', '\u0085SYN', 'SYN\uFEFF', 'SYN\0X', 'SYN\nX', 'SYN\u0085X', 'SYN\ud800', '𠮷'.repeat(257)];
  badValues.forEach((identifierValue, index) => it(`rejects invalid value case ${index} with bounded error`, () => {
    expect(() => validateIdentifierKey({ ...key, identifierValue })).toThrow('PERSON_IDENTIFIER_VALUE_INVALID');
  }));
  it('accepts inclusive string bounds', () => {
    validateIdentifierKey({ ...key, identifierSystem: `urn:${'x'.repeat(508)}`, identifierValue: '𠮷'.repeat(256) });
  });
  const command = { ...key, personId: key.governanceObjectId, identifierEligibility: 'CONFIRMED_PERSON_IDENTIFIER' as const,
    businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null };
  it('requires a confirmed identifier', () => {
    expect(() => validateIdentifierRegistration({ ...command, identifierEligibility: 'CANDIDATE' } as unknown as typeof command)).toThrow('PERSON_IDENTIFIER_ELIGIBILITY_INVALID');
  });
  const forbidden = ['sourceSystem', 'sourceSystemCode', 'sourceEntity', 'sourceEntityType', 'sourceTable', 'sourceRecordKey',
    'sourceRecordId', 'externalRowId', 'sourcePrimaryKey', 'sourceDatabase', 'sourceFile', 'identifierType', 'identifierCategory',
    'identifierClass', 'employmentStatus', 'departmentId', 'campusId', 'credential', 'oidcSub', 'patientId', 'empiId', 'accountId'];
  forbidden.forEach((name) => it(`rejects out-of-scope property ${name}`, () => {
    expect(() => validateIdentifierRegistration({ ...command, [name]: 'SYNTHETIC' })).toThrow('PERSON_INPUT_INVALID');
  }));
  ['2020-01-01T00:00:00Z', '2020-01-01T00:00:00+08:00', '2025-02-29T00:00:00'].forEach((businessValidFrom, index) => {
    it(`rejects invalid local time ${index}`, () => expect(() => validateIdentifierPeriod({ businessValidFrom, businessValidTo: null })).toThrow());
  });
  it('rejects equal boundaries even with different fractional representation', () => {
    expect(() => validateIdentifierPeriod({ businessValidFrom: '2020-01-01T00:00:00', businessValidTo: '2020-01-01T00:00:00.000000' })).toThrow();
  });
  it('discards raw database exceptions, details and causes', () => {
    const unsafe = Object.assign(new Error(key.identifierValue), { detail: key.identifierValue, code: '23505' });
    const safe = safeIdentifierError(unsafe);
    expect(safe.message).toBe('PERSON_IDENTIFIER_OPERATION_FAILED');
    expect(JSON.stringify(safe)).toBe('{}');
    expect(safe.cause).toBeUndefined();
    expect(safe.stack?.includes(key.identifierValue)).toBe(false);
  });
});
