import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';

export interface PersonFacts {
  readonly canonicalName: string;
  readonly birthDate: string | null;
}

export interface PersonSubject {
  readonly personId: string;
  readonly governanceObjectId: string;
  readonly createdAt: string;
}
export interface PersonSubjectVersion extends PersonFacts {
  readonly personVersionId: string;
  readonly personId: string;
  readonly versionNo: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
}
export interface CreatePersonSubject {
  readonly governanceObjectId: string;
  readonly subjectEligibility: 'CONFIRMED_HOSPITAL_PERSONNEL';
  readonly facts: { readonly canonicalName: string; readonly birthDate?: string | null };
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface PersonReference {
  readonly governanceObjectId: string;
  readonly personId: string;
}
export interface CreatePersonSubjectVersion extends PersonReference {
  readonly facts: CreatePersonSubject['facts'];
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface PersonAsOfQuery extends PersonReference {
  readonly businessAt: string;
  readonly recordAsOf: string;
}
export interface PersonCoreApplication {
  createPersonSubject(command: CreatePersonSubject): Promise<PersonSubjectVersion>;
  createPersonSubjectVersion(command: CreatePersonSubjectVersion): Promise<PersonSubjectVersion>;
  getPersonSubject(query: PersonReference): Promise<{ readonly subject: PersonSubject; readonly latestVersion: PersonSubjectVersion }>;
  getPersonSubjectVersion(query: PersonReference & { readonly personVersionId: string }): Promise<PersonSubjectVersion>;
  listPersonSubjectVersions(query: PersonReference): Promise<readonly PersonSubjectVersion[]>;
  findPersonSubjectAsOf(query: PersonAsOfQuery): Promise<PersonSubjectVersion | null>;
}

export function normalizePersonFacts(input: unknown, today: string): PersonFacts {
  assertClosedObject(input, ['canonicalName', 'birthDate']);
  const name = input['canonicalName'];
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 256 || name.includes('\0')) {
    throw new Error('PERSON_NAME_INVALID');
  }
  const birthDate = input['birthDate'] ?? null;
  if (birthDate !== null) {
    try {
      if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate) || birthDate.startsWith('0000-')) throw new Error();
      parseLocalDateTime(`${birthDate}T00:00:00`);
      if (birthDate > today) throw new Error();
    } catch { throw new Error('PERSON_BIRTH_DATE_INVALID'); }
  }
  return { canonicalName: name.trim(), birthDate: birthDate as string | null };
}

export function assertClosedObject(input: unknown, keys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))) throw new Error('PERSON_INPUT_INVALID');
}

export function assertPersonUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error('PERSON_ID_INVALID');
  }
}

export function assertPersonPeriod(from: string, to: string | null): void {
  parseLocalDateTime(from);
  if (from.startsWith('0000-')) throw new Error('PERSON_BUSINESS_TIME_INVALID');
  if (to !== null) {
    parseLocalDateTime(to);
    if (comparableTime(to) <= comparableTime(from)) throw new Error('PERSON_BUSINESS_TIME_INVALID');
  }
}

function comparableTime(value: string): string {
  const [seconds, fraction = ''] = value.split('.');
  return `${seconds}.${fraction.padEnd(6, '0')}`;
}
