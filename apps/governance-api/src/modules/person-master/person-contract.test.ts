import { describe, expect, it } from 'vitest';
import { normalizePersonFacts } from './index.js';

describe('Person subject core contract (SYNTHETIC / NON_PRODUCTION)', () => {
  it('preserves Unicode and internal spaces while trimming a name; birth date is optional', () => {
    expect(normalizePersonFacts({ canonicalName: '  SYNTHETIC 合成  人员  ' }, '2026-09-04'))
      .toEqual({ canonicalName: 'SYNTHETIC 合成  人员', birthDate: null });
  });
  it.each(['', '   ', 'x'.repeat(257)])('rejects invalid canonical name %j', (canonicalName) => {
    expect(() => normalizePersonFacts({ canonicalName }, '2026-09-04')).toThrow('PERSON_NAME_INVALID');
  });
  it.each(['2026-09-05', '2025-02-29', '1980-01-01T00:00:00', '0000-01-01'])('rejects invalid/future birth date %s', (birthDate) => {
    expect(() => normalizePersonFacts({ canonicalName: 'SYNTHETIC', birthDate }, '2026-09-04')).toThrow('PERSON_BIRTH_DATE_INVALID');
  });
  it.each(['departmentId', 'campusId', 'employmentStatus', 'employmentType', 'engagementType',
    'jobCode', 'positionCode', 'roleCode', 'credential', 'license', 'employeeNo', 'sourceSystemCode',
    'oidcSub', 'keycloakUserId', 'servicePrincipalId', 'patientId', 'empiId', 'medicalRecordNo',
    'sexCode', 'genderCode', 'phone', 'email', 'isActive'])('rejects adjacent domain fact %s', (field) => {
    expect(() => normalizePersonFacts({ canonicalName: 'SYNTHETIC', [field]: 'SYNTHETIC' }, '2026-09-04'))
      .toThrow('PERSON_INPUT_INVALID');
  });
  it('accepts a real leap date and preserves supplementary Unicode characters', () => {
    expect(normalizePersonFacts({ canonicalName: '𠮷'.repeat(256), birthDate: '2000-02-29' }, '2026-09-04').birthDate).toBe('2000-02-29');
  });
});
