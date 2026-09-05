import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { assertClosedObject, assertPersonPeriod } from './contracts.js';

export type SourceMappingStatus = 'MAPPED' | 'RETRACTED';
export type SourceMappingChangeKind = 'REGISTERED' | 'CORRECTED' | 'RETRACTED';
export type SourceMappingReasonCode =
  | 'WRONG_PERSON_BINDING'
  | 'BUSINESS_VALIDITY_CORRECTION'
  | 'SOURCE_RECORD_RECONCILIATION';

export interface SourceRecordIdentity {
  readonly governanceObjectId: string;
  readonly sourceSystem: string;
  readonly sourceEntity: string;
  readonly sourceRecordKey: string;
}

export interface PersonSourceMappingReference {
  readonly governanceObjectId: string;
  readonly personSourceMappingId: string;
}

export interface PersonSourceMappingVersionReference extends PersonSourceMappingReference {
  readonly personSourceMappingVersionId: string;
}

export interface SourceMappingValidity {
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export interface RegisterPersonSourceMapping extends SourceRecordIdentity, SourceMappingValidity {
  readonly personId: string;
}

export interface CorrectPersonSourceMapping extends PersonSourceMappingReference, SourceMappingValidity {
  readonly expectedCurrentVersionId: string;
  readonly correctedPersonId: string;
  readonly reasonCode: SourceMappingReasonCode;
}

export interface RetractPersonSourceMapping extends PersonSourceMappingReference, SourceMappingValidity {
  readonly expectedCurrentVersionId: string;
  readonly reasonCode: SourceMappingReasonCode;
}

export interface PersonSourceMapping extends SourceRecordIdentity {
  readonly personSourceMappingId: string;
  readonly createdAt: string;
}

export interface PersonSourceMappingVersion extends PersonSourceMappingReference, SourceMappingValidity {
  readonly personSourceMappingVersionId: string;
  readonly personId: string;
  readonly versionNo: string;
  readonly mappingStatus: SourceMappingStatus;
  readonly changeKind: SourceMappingChangeKind;
  readonly supersedesMappingVersionId: string | null;
  readonly reasonCode: SourceMappingReasonCode | null;
  readonly recordedFrom: string;
}

export interface SourceMappingTimes {
  readonly businessAt: string;
  readonly recordAsOf: string;
}

export interface PersonSourceMappingApplication {
  registerPersonSourceMapping(command: RegisterPersonSourceMapping): Promise<PersonSourceMappingVersion>;
  correctPersonSourceMapping(command: CorrectPersonSourceMapping): Promise<PersonSourceMappingVersion>;
  retractPersonSourceMapping(command: RetractPersonSourceMapping): Promise<PersonSourceMappingVersion>;
  getPersonSourceMapping(query: PersonSourceMappingReference): Promise<PersonSourceMapping>;
  getPersonSourceMappingVersion(query: PersonSourceMappingVersionReference): Promise<PersonSourceMappingVersion>;
  listPersonSourceMappingVersions(query: PersonSourceMappingReference): Promise<readonly PersonSourceMappingVersion[]>;
  findPersonSourceMappingAsOf(query: PersonSourceMappingReference & SourceMappingTimes): Promise<PersonSourceMappingVersion | null>;
  findPersonBySourceRecord(query: SourceRecordIdentity & SourceMappingTimes): Promise<PersonSourceMappingVersion | null>;
}

export function validateSourceRecordIdentity(input: SourceRecordIdentity): void {
  validatePart(input.sourceSystem, 128, 'SOURCE_MAPPING_SOURCE_SYSTEM_INVALID');
  validatePart(input.sourceEntity, 128, 'SOURCE_MAPPING_SOURCE_ENTITY_INVALID');
  validatePart(input.sourceRecordKey, 256, 'SOURCE_MAPPING_SOURCE_KEY_INVALID');
}

export function validateSourceMappingPeriod(input: SourceMappingValidity): void {
  try {
    if (typeof input.businessValidFrom !== 'string' ||
      (input.businessValidTo !== null && typeof input.businessValidTo !== 'string')) throw new Error();
    assertPersonPeriod(input.businessValidFrom, input.businessValidTo);
  } catch { throw new Error('SOURCE_MAPPING_TIME_INVALID'); }
}

export function validateSourceMappingTimes(input: SourceMappingTimes): void {
  try {
    for (const time of [input.businessAt, input.recordAsOf]) {
      if (typeof time !== 'string' || time.startsWith('0000-')) throw new Error();
      parseLocalDateTime(time);
    }
  } catch { throw new Error('SOURCE_MAPPING_TIME_INVALID'); }
}

export function validateSourceMappingReason(reason: unknown): asserts reason is SourceMappingReasonCode {
  if (!['WRONG_PERSON_BINDING', 'BUSINESS_VALIDITY_CORRECTION', 'SOURCE_RECORD_RECONCILIATION'].includes(String(reason))) {
    throw new Error('SOURCE_MAPPING_REASON_INVALID');
  }
}

export function validateSourceMappingRegistration(command: RegisterPersonSourceMapping): void {
  assertClosedObject(command, ['governanceObjectId', 'sourceSystem', 'sourceEntity', 'sourceRecordKey',
    'personId', 'businessValidFrom', 'businessValidTo']);
  requireUuid(command.governanceObjectId, 'SOURCE_MAPPING_SCOPE_INVALID');
  requireUuid(command.personId, 'SOURCE_MAPPING_TARGET_PERSON_INVALID');
  validateSourceRecordIdentity(command);
  validateSourceMappingPeriod(command);
}

export function validateSourceMappingCorrection(command: CorrectPersonSourceMapping): void {
  assertClosedObject(command, ['governanceObjectId', 'personSourceMappingId', 'expectedCurrentVersionId',
    'correctedPersonId', 'businessValidFrom', 'businessValidTo', 'reasonCode']);
  requireUuid(command.governanceObjectId, 'SOURCE_MAPPING_SCOPE_INVALID');
  requireUuid(command.personSourceMappingId, 'SOURCE_MAPPING_ID_INVALID');
  requireUuid(command.expectedCurrentVersionId, 'SOURCE_MAPPING_EXPECTED_VERSION_INVALID');
  requireUuid(command.correctedPersonId, 'SOURCE_MAPPING_TARGET_PERSON_INVALID');
  validateSourceMappingReason(command.reasonCode);
  validateSourceMappingPeriod(command);
}

export function validateSourceMappingRetraction(command: RetractPersonSourceMapping): void {
  assertClosedObject(command, ['governanceObjectId', 'personSourceMappingId', 'expectedCurrentVersionId',
    'businessValidFrom', 'businessValidTo', 'reasonCode']);
  requireUuid(command.governanceObjectId, 'SOURCE_MAPPING_SCOPE_INVALID');
  requireUuid(command.personSourceMappingId, 'SOURCE_MAPPING_ID_INVALID');
  requireUuid(command.expectedCurrentVersionId, 'SOURCE_MAPPING_EXPECTED_VERSION_INVALID');
  validateSourceMappingReason(command.reasonCode);
  validateSourceMappingPeriod(command);
}

const SAFE_ERRORS = new Set([
  'SOURCE_MAPPING_SOURCE_SYSTEM_INVALID', 'SOURCE_MAPPING_SOURCE_ENTITY_INVALID', 'SOURCE_MAPPING_SOURCE_KEY_INVALID',
  'SOURCE_MAPPING_TIME_INVALID', 'SOURCE_MAPPING_REASON_INVALID', 'SOURCE_MAPPING_NOT_FOUND',
  'SOURCE_MAPPING_VERSION_NOT_FOUND', 'SOURCE_MAPPING_ALREADY_EXISTS', 'SOURCE_MAPPING_OPERATION_CONFLICT',
  'SOURCE_MAPPING_STALE_VERSION', 'SOURCE_MAPPING_TARGET_PERSON_INVALID', 'SOURCE_MAPPING_SCOPE_INVALID',
  'SOURCE_MAPPING_CONTEXT_INVALID', 'SOURCE_MAPPING_ID_INVALID', 'SOURCE_MAPPING_EXPECTED_VERSION_INVALID',
  'PERSON_GOVERNANCE_SCOPE_INVALID', 'PERSON_HUMAN_ACTOR_REQUIRED', 'PERSON_INPUT_INVALID',
  'OBJECT_PERMISSION_FORBIDDEN',
]);

export function safeSourceMappingError(error: unknown): Error {
  return new Error(error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message : 'SOURCE_MAPPING_OPERATION_FAILED');
}

function validatePart(value: unknown, maximum: number, code: string): void {
  if (typeof value !== 'string' || !value || [...value].length > maximum || value.trim() !== value ||
    /^[\p{White_Space}\uFEFF]|[\p{White_Space}\uFEFF]$/u.test(value) || /[\p{Cc}\p{Cs}]/u.test(value)) {
    throw new Error(code);
  }
}

function requireUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error(code);
  }
}
