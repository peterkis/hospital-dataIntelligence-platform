import { describe, expect, it } from 'vitest';
import {
  safeSourceMappingError, validateSourceMappingCorrection, validateSourceMappingPeriod,
  validateSourceMappingRegistration, validateSourceMappingRetraction, validateSourceMappingTimes,
  validateSourceRecordIdentity,
} from './index.js';

const governanceObjectId = '76000000-0000-7000-8000-000000000001';
const personId = '76000000-0000-7000-8000-000000000002';
const personSourceMappingId = '76000000-0000-7000-8000-000000000003';
const expectedCurrentVersionId = '76000000-0000-7000-8000-000000000004';
const identity = { governanceObjectId, sourceSystem: 'SYNTHETIC_HR', sourceEntity: 'PERSON_RECORD',
  sourceRecordKey: 'SYN-HR-ROW-000001' };
const validity = { businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null };

describe('Person Source Record Mapping contract', () => {
  it('retains the exact source identity without normalization', () => {
    const value = { ...identity, sourceSystem: 'Synthetic-HR', sourceEntity: 'Person_Record',
      sourceRecordKey: '00-𠮷-e\u0301/A' };
    const before = JSON.stringify(value);
    validateSourceRecordIdentity(value);
    expect(JSON.stringify(value)).toBe(before);
  });

  const invalidParts = [
    ['sourceSystem', '', 'SOURCE_MAPPING_SOURCE_SYSTEM_INVALID'],
    ['sourceSystem', ' SYNTHETIC_HR', 'SOURCE_MAPPING_SOURCE_SYSTEM_INVALID'],
    ['sourceSystem', `S${'X'.repeat(128)}`, 'SOURCE_MAPPING_SOURCE_SYSTEM_INVALID'],
    ['sourceEntity', 'PERSON\nRECORD', 'SOURCE_MAPPING_SOURCE_ENTITY_INVALID'],
    ['sourceEntity', 'PERSON_RECORD\u0085', 'SOURCE_MAPPING_SOURCE_ENTITY_INVALID'],
    ['sourceRecordKey', 'SYN\0KEY', 'SOURCE_MAPPING_SOURCE_KEY_INVALID'],
    ['sourceRecordKey', '\ud800', 'SOURCE_MAPPING_SOURCE_KEY_INVALID'],
    ['sourceRecordKey', '𠮷'.repeat(257), 'SOURCE_MAPPING_SOURCE_KEY_INVALID'],
  ] as const;
  invalidParts.forEach(([field, value, code], index) => it(`rejects invalid source identity ${index}`, () => {
    expect(() => validateSourceRecordIdentity({ ...identity, [field]: value })).toThrow(code);
  }));

  it('accepts inclusive source identity bounds', () => {
    validateSourceRecordIdentity({ ...identity, sourceSystem: 'S'.repeat(128),
      sourceEntity: 'E'.repeat(128), sourceRecordKey: '𠮷'.repeat(256) });
  });

  const registration = { ...identity, ...validity, personId };
  it('accepts only the closed registration contract', () => {
    validateSourceMappingRegistration(registration);
    for (const forbidden of ['identifierSystem', 'identifierValue', 'matchScore', 'employeeStatus',
      'departmentId', 'campusId', 'credential', 'oidcSub', 'patientId', 'empiId']) {
      expect(() => validateSourceMappingRegistration({ ...registration, [forbidden]: 'SYNTHETIC' })).toThrow('PERSON_INPUT_INVALID');
    }
  });

  it('requires an existing-shape explicit correction target and expected version', () => {
    const correction = { governanceObjectId, personSourceMappingId, expectedCurrentVersionId,
      correctedPersonId: personId, ...validity, reasonCode: 'WRONG_PERSON_BINDING' as const };
    validateSourceMappingCorrection(correction);
    expect(() => validateSourceMappingCorrection({ ...correction, expectedCurrentVersionId: undefined } as unknown as typeof correction))
      .toThrow('SOURCE_MAPPING_EXPECTED_VERSION_INVALID');
    expect(() => validateSourceMappingCorrection({ ...correction, correctedPersonId: undefined } as unknown as typeof correction))
      .toThrow('SOURCE_MAPPING_TARGET_PERSON_INVALID');
    expect(() => validateSourceMappingCorrection({ ...correction, reasonCode: undefined } as unknown as typeof correction))
      .toThrow('SOURCE_MAPPING_REASON_INVALID');
  });

  it('requires a reason and expected version for retraction', () => {
    const retraction = { governanceObjectId, personSourceMappingId, expectedCurrentVersionId,
      ...validity, reasonCode: 'SOURCE_RECORD_RECONCILIATION' as const };
    validateSourceMappingRetraction(retraction);
    expect(() => validateSourceMappingRetraction({ ...retraction, reasonCode: 'FREE_TEXT' } as unknown as typeof retraction))
      .toThrow('SOURCE_MAPPING_REASON_INVALID');
    expect(() => validateSourceMappingRetraction({ ...retraction, expectedCurrentVersionId: '' }))
      .toThrow('SOURCE_MAPPING_EXPECTED_VERSION_INVALID');
  });

  for (const invalid of ['2025-01-01T00:00:00Z', '2025-01-01T00:00:00+08:00', '2025-02-29T00:00:00']) {
    it(`rejects invalid local business time ${invalid}`, () => {
      expect(() => validateSourceMappingPeriod({ businessValidFrom: invalid, businessValidTo: null }))
        .toThrow('SOURCE_MAPPING_TIME_INVALID');
    });
  }

  it('rejects empty or inverted half-open periods and invalid as-of time', () => {
    expect(() => validateSourceMappingPeriod({ businessValidFrom: '2025-01-01T00:00:00',
      businessValidTo: '2025-01-01T00:00:00.000000' })).toThrow('SOURCE_MAPPING_TIME_INVALID');
    expect(() => validateSourceMappingTimes({ businessAt: '2025-01-01T00:00:00',
      recordAsOf: '2025-01-01T00:00:00Z' })).toThrow('SOURCE_MAPPING_TIME_INVALID');
  });

  it('discards raw database errors, keys, details and causes', () => {
    const unsafe = Object.assign(new Error(identity.sourceRecordKey), {
      detail: identity.sourceRecordKey, code: '23505', cause: new Error(identity.sourceRecordKey),
    });
    const safe = safeSourceMappingError(unsafe);
    expect(safe.message).toBe('SOURCE_MAPPING_OPERATION_FAILED');
    expect(JSON.stringify(safe)).toBe('{}');
    expect(safe.cause).toBeUndefined();
    expect(safe.stack?.includes(identity.sourceRecordKey)).toBe(false);
  });
});
