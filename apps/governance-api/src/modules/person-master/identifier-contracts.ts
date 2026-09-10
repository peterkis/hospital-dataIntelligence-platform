import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { assertClosedObject, assertPersonPeriod, type PersonReference } from './contracts.js';

export type IdentifierAssertionStatus = 'ASSERTED' | 'RETRACTED';
export interface IdentifierKey {
  readonly governanceObjectId: string;
  readonly identifierSystem: string;
  readonly identifierValue: string;
}
export interface IdentifierReference {
  readonly governanceObjectId: string;
  readonly personIdentifierId: string;
}
export interface IdentifierValidity {
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface RegisterPersonIdentifier extends IdentifierKey, IdentifierValidity {
  readonly personId: string;
  readonly identifierEligibility: 'CONFIRMED_PERSON_IDENTIFIER';
}
export interface CreatePersonIdentifierVersion extends IdentifierReference, IdentifierValidity {
  readonly assertionStatus: IdentifierAssertionStatus;
}
export interface PersonIdentifier extends IdentifierKey {
  readonly personIdentifierId: string;
  readonly personId: string;
  readonly createdAt: string;
}
export interface PersonIdentifierVersion extends IdentifierReference, IdentifierValidity {
  readonly personId: string;
  readonly personIdentifierVersionId: string;
  readonly versionNo: string;
  readonly assertionStatus: IdentifierAssertionStatus;
  readonly recordedFrom: string;
}
export interface IdentifierTimes {
  readonly businessAt: string;
  readonly recordAsOf: string;
}
export interface PersonIdentifierApplication {
  registerPersonIdentifier(command: RegisterPersonIdentifier): Promise<PersonIdentifierVersion>;
  createPersonIdentifierVersion(command: CreatePersonIdentifierVersion): Promise<PersonIdentifierVersion>;
  getPersonIdentifier(query: IdentifierReference): Promise<PersonIdentifier>;
  listPersonIdentifiers(query: PersonReference): Promise<readonly PersonIdentifier[]>;
  listPersonIdentifierVersions(query: IdentifierReference): Promise<readonly PersonIdentifierVersion[]>;
  findPersonIdentifierAsOf(query: IdentifierReference & IdentifierTimes): Promise<PersonIdentifierVersion | null>;
  findPersonByIdentifier(query: IdentifierKey & IdentifierTimes): Promise<PersonIdentifierVersion | null>;
}

// Input is already canonical in its namespace. Validation never transforms it.
export function validateIdentifierKey(input: IdentifierKey): void {
  if (typeof input.identifierSystem !== 'string' || input.identifierSystem.length > 512 ||
    !/^[A-Za-z][A-Za-z0-9+.-]*:[\x21-\x7e]+$/u.test(input.identifierSystem)) {
    throw new Error('PERSON_IDENTIFIER_SYSTEM_INVALID');
  }
  const value = input.identifierValue;
  if (typeof value !== 'string' || !value || [...value].length > 256 || value.trim() !== value ||
    /^[\p{White_Space}\uFEFF]|[\p{White_Space}\uFEFF]$/u.test(value) || /[\p{Cc}\p{Cs}]/u.test(value)) {
    throw new Error('PERSON_IDENTIFIER_VALUE_INVALID');
  }
}

export function validateIdentifierPeriod(input: IdentifierValidity): void {
  if (typeof input.businessValidFrom !== 'string' || (input.businessValidTo !== null && typeof input.businessValidTo !== 'string')) {
    throw new Error('PERSON_IDENTIFIER_TIME_INVALID');
  }
  assertPersonPeriod(input.businessValidFrom, input.businessValidTo);
}

export function validateIdentifierTimes(input: IdentifierTimes): void {
  for (const time of [input.businessAt, input.recordAsOf]) {
    if (typeof time !== 'string' || time.startsWith('0000-')) throw new Error('PERSON_IDENTIFIER_TIME_INVALID');
    parseLocalDateTime(time);
  }
}

export function validateIdentifierRegistration(command: RegisterPersonIdentifier): void {
  assertClosedObject(command, ['governanceObjectId', 'personId', 'identifierSystem', 'identifierValue',
    'identifierEligibility', 'businessValidFrom', 'businessValidTo']);
  if (command.identifierEligibility !== 'CONFIRMED_PERSON_IDENTIFIER') throw new Error('PERSON_IDENTIFIER_ELIGIBILITY_INVALID');
  validateIdentifierKey(command);
  validateIdentifierPeriod(command);
}

const SAFE_ERRORS = new Set([
  'PERSON_IDENTIFIER_SYSTEM_INVALID', 'PERSON_IDENTIFIER_VALUE_INVALID', 'PERSON_IDENTIFIER_TIME_INVALID',
  'PERSON_IDENTIFIER_ELIGIBILITY_INVALID', 'PERSON_IDENTIFIER_ASSERTION_INVALID', 'PERSON_IDENTIFIER_NOT_FOUND',
  'PERSON_IDENTIFIER_OPERATION_CONFLICT', 'PERSON_IDENTIFIER_ALREADY_REGISTERED', 'PERSON_IDENTIFIER_COLLISION',
  'PERSON_IDENTIFIER_CONTEXT_INVALID', 'PERSON_INPUT_INVALID', 'PERSON_ID_INVALID', 'PERSON_BUSINESS_TIME_INVALID',
  'PERSON_NOT_FOUND', 'PERSON_GOVERNANCE_SCOPE_INVALID', 'PERSON_HUMAN_ACTOR_REQUIRED',
  'LOCAL_DATETIME_INVALID', 'OBJECT_PERMISSION_FORBIDDEN',
]);

export function safeIdentifierError(error: unknown): Error {
  // Do not forward pg detail, query parameters, causes or arbitrary exception text.
  return new Error(error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : 'PERSON_IDENTIFIER_OPERATION_FAILED');
}
