import { Type } from 'typebox';
import { LOCAL_DATE_TIME_JSON_PATTERN } from '../local-datetime/local-datetime.js';
import { CONSUMER_AUDIT_STAGES, CONSUMER_AUDIT_EVENTS, CONSUMER_REPORT_EVENTS, CONSUMER_FAILURE_CODES } from '../../modules/audit/index.js';
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' });
const time = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const sequence = Type.String({ pattern: '^(?:0|[1-9]\\d{0,18})$' });
const digest = Type.String({ pattern: '^[0-9a-f]{64}$' });
const text = Type.String({ maxLength: 256 });
const eventType = Type.Enum(CONSUMER_AUDIT_EVENTS);
const result = Type.Enum(['SUCCEEDED', 'FAILED', 'REQUESTED']);
const nullableUuid = Type.Union([uuid, Type.Null()]);
const nullableText = Type.Union([text, Type.Null()]);
export const ConsumerAuditReportSchema = Type.Object({
  evidenceId: uuid, releaseId: uuid, eventType: Type.Enum(CONSUMER_REPORT_EVENTS),
  mode: Type.Union([Type.Literal('ORIGINAL'), Type.Literal('REPLAY')]),
  operationId: Type.Optional(uuid), attemptId: Type.Optional(uuid), occurredAt: time,
  failureStage: Type.Optional(Type.Enum(CONSUMER_AUDIT_STAGES)),
  failureCode: Type.Optional(Type.Enum(CONSUMER_FAILURE_CODES)),
}, { additionalProperties: false });
export const ConsumerAuditQuerySchema = Type.Object({
  afterSequence: Type.Optional(sequence), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  releaseId: Type.Optional(uuid), projectionType: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9.-]+$' })),
  eventType: Type.Optional(eventType), result: Type.Optional(result),
  occurredFrom: Type.Optional(time), occurredTo: Type.Optional(time),
}, { additionalProperties: false });
export const ConsumerAuditAcknowledgementSchema = Type.Object({ auditEventId: uuid, auditSequence: sequence }, { additionalProperties: false });
export const ConsumerAuditPageSchema = Type.Object({ events: Type.Array(Type.Object({
  auditEventId: uuid, auditSequence: sequence, eventType, actorPrincipalId: uuid,
  occurredAt: time, recordedAt: time, requestId: uuid, correlationId: uuid, previousHash: digest, currentHash: digest,
  evidence: Type.Object({
    evidenceKind: Type.Literal('CONSUMER_RELEASE'), subscriptionId: uuid, subscriptionVersionId: nullableUuid,
    subscriptionVersion: Type.Union([sequence, Type.Null()]), servicePrincipalId: uuid, governanceObjectId: uuid,
    projectionType: nullableText, projectionSchemaVersion: nullableText, releaseId: nullableUuid, eventId: nullableUuid,
    stage: Type.Optional(Type.Enum(CONSUMER_AUDIT_STAGES)), result, failureCode: Type.Union([Type.Enum(CONSUMER_FAILURE_CODES), Type.Null()]),
    source: Type.Union([Type.Literal('CONSUMER_REPORTED'), Type.Literal('PLATFORM')]),
    mode: Type.Union([Type.Literal('ORIGINAL'), Type.Literal('REPLAY')]), operationId: nullableUuid, attemptId: nullableUuid,
    checkpoint: sequence, receiptId: nullableUuid, receiptApplyResult: nullableText,
    snapshotDigest: Type.Union([digest, Type.Null()]), consumerOccurredAt: Type.Union([time, Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false }), { maxItems: 100 }), nextAfterSequence: Type.Union([sequence, Type.Null()]) }, { additionalProperties: false });
