import { describe, expect, it } from 'vitest';
import {
  assertAuditPayloadSafe,
  DEPARTMENT_AUDIT_EVENT_TYPES,
  type AppendAuditEventCommand,
  type AppendGovernanceAuditEventCommand,
  type AuditEventService,
  type RecordedAuditEvent,
} from '../audit/index.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { createDepartmentGovernanceAudit } from './department-audit.js';

const context: RequestContext = {
  actorPrincipalId: '10000000-0000-7000-8000-000000000001',
  requestId: 'PV-005-AUDIT-TEST',
  correlationId: 'PV-005-AUDIT',
  occurredAt: '2026-09-03T16:00:00',
};
const governanceObjectId = '74000000-0000-7000-8000-000000000001';
const departmentId = '72000000-0000-7000-8000-000000000001';
const departmentVersionId = '72100000-0000-7000-8000-000000000001';
const mappingId = '72300000-0000-7000-8000-000000000001';
const assignmentId = '72500000-0000-7000-8000-000000000001';
const hash = Buffer.alloc(32, 1);

describe('department governance audit events', () => {
  it('creates the stable department identity with DEPARTMENT_CREATED', async () => {
    const fixture = auditFixture();
    await fixture.audit.departmentCreated({ governanceObjectId, departmentId, creator: context.actorPrincipalId });
    expect(fixture.events[0]).toMatchObject({
      eventType: 'DEPARTMENT_CREATED', aggregateType: 'DEPARTMENT', aggregateId: departmentId,
      governanceObjectId, actorId: context.actorPrincipalId,
      payload: { departmentId, governanceObjectId, creator: context.actorPrincipalId },
    });
  });

  it('creates a semantic version with DEPARTMENT_VERSION_CREATED', async () => {
    const fixture = auditFixture();
    await fixture.audit.departmentVersionCreated({ governanceObjectId, departmentId, departmentVersionId, versionNo: '2', contentHash: hash });
    expect(fixture.events[0]).toMatchObject({
      eventType: 'DEPARTMENT_VERSION_CREATED',
      payload: { departmentId, departmentVersionId, versionNo: '2', contentHash: hash.toString('hex') },
    });
  });

  it('publishes a department version with its release and local publication time', async () => {
    const fixture = auditFixture();
    await fixture.audit.departmentPublished({ governanceObjectId, departmentVersionId, releaseId: '76000000-0000-7000-8000-000000000001', publishedAt: context.occurredAt, contentHash: hash });
    expect(fixture.events[0]).toMatchObject({
      eventType: 'DEPARTMENT_PUBLISHED',
      payload: { departmentVersionId, releaseId: '76000000-0000-7000-8000-000000000001', publishedAt: context.occurredAt },
    });
  });

  it('records the review result and reviewer', async () => {
    const fixture = auditFixture();
    await fixture.audit.departmentReviewed({ governanceObjectId, departmentVersionId, reviewResult: 'APPROVED', reviewer: context.actorPrincipalId, reason: '专业复核通过' });
    expect(fixture.events[0]).toMatchObject({ eventType: 'DEPARTMENT_REVIEWED', payload: { reviewResult: 'APPROVED', reviewer: context.actorPrincipalId } });
  });

  it('records source-mapping confirmation and operator', async () => {
    const fixture = auditFixture();
    await fixture.audit.sourceMappingConfirmed({ governanceObjectId, mappingId, operator: context.actorPrincipalId });
    expect(fixture.events[0]).toMatchObject({ eventType: 'DEPARTMENT_SOURCE_MAPPING_CONFIRMED', payload: { mappingId, operator: context.actorPrincipalId } });
  });

  it('records both sides of a campus-assignment change', async () => {
    const fixture = auditFixture();
    const oldAssignment = { assignmentId: '72500000-0000-7000-8000-000000000000', campusId: '71000000-0000-7000-8000-000000000001', businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, recordedFrom: '2026-09-03T09:00:00', recordedTo: context.occurredAt };
    const newAssignment = { assignmentId, campusId: oldAssignment.campusId, businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, recordedFrom: context.occurredAt, recordedTo: null };
    await fixture.audit.campusChanged({ governanceObjectId, assignmentId, oldAssignment, newAssignment, contentHash: hash });
    expect(fixture.events[0]).toMatchObject({ eventType: 'DEPARTMENT_CAMPUS_CHANGED', payload: { oldAssignment, newAssignment } });
  });

  it('rolls back audit when the business transaction rolls back', async () => {
    const state: TransactionState = { business: [], events: [] };
    await expect(runTransaction(state, async (draft, audit) => {
      draft.business.push(departmentId);
      await audit.departmentCreated({ governanceObjectId, departmentId, creator: context.actorPrincipalId });
      throw new Error('BUSINESS_ROLLBACK');
    })).rejects.toThrowError('BUSINESS_ROLLBACK');
    expect(state).toEqual({ business: [], events: [] });
  });

  it('rolls back business state when audit persistence fails', async () => {
    const state: TransactionState = { business: [], events: [] };
    await expect(runTransaction(state, async (draft, audit) => {
      draft.business.push(departmentId);
      await audit.departmentCreated({ governanceObjectId, departmentId, creator: context.actorPrincipalId });
    }, true)).rejects.toThrowError('AUDIT_WRITE_FAILED');
    expect(state).toEqual({ business: [], events: [] });
  });

  it('rejects sensitive fields and complete request bodies from payloads', () => {
    for (const field of ['DATABASE_URL', 'password', 'access_token', 'Cookie', 'clientSecret', 'request_body']) {
      expect(() => assertAuditPayloadSafe({ nested: { [field]: 'forbidden' } })).toThrowError('AUDIT_PAYLOAD_SENSITIVE_FIELD');
    }
    expect(() => assertAuditPayloadSafe({ departmentId, reason: '业务事实' })).not.toThrow();
    expect(DEPARTMENT_AUDIT_EVENT_TYPES).toHaveLength(16);
  });

  it('uses Asia/Shanghai LocalDateTime values without UTC or offsets', async () => {
    const fixture = auditFixture();
    const event = await fixture.audit.departmentCreated({ governanceObjectId, departmentId, creator: context.actorPrincipalId });
    expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u);
    expect(event.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u);
    expect(() => auditFixture({ ...context, occurredAt: '2026-09-03T08:00:00Z' })).toThrow();
    expect(() => auditFixture({ ...context, occurredAt: '2026-09-03T16:00:00+08:00' })).toThrow();
  });
});

interface TransactionState {
  readonly business: string[];
  readonly events: RecordedAuditEvent[];
}

async function runTransaction(
  state: TransactionState,
  work: (draft: TransactionState, audit: ReturnType<typeof createDepartmentGovernanceAudit>) => Promise<void>,
  failAudit = false,
): Promise<void> {
  const draft: TransactionState = { business: [...state.business], events: [...state.events] };
  const fixture = auditFixture(context, draft.events, failAudit);
  await work(draft, fixture.audit);
  state.business.splice(0, state.business.length, ...draft.business);
  state.events.splice(0, state.events.length, ...draft.events);
}

function auditFixture(
  requestContext: RequestContext = context,
  events: RecordedAuditEvent[] = [],
  failAudit = false,
) {
  const service: AuditEventService = {
    async append(command: AppendAuditEventCommand | AppendGovernanceAuditEventCommand) {
      if (failAudit) throw new Error('AUDIT_WRITE_FAILED');
      if (!('eventType' in command)) throw new Error('CANONICAL_DEPARTMENT_EVENT_REQUIRED');
      assertAuditPayloadSafe(command.payload);
      const event: RecordedAuditEvent = {
        auditEventId: `event-${events.length + 1}`,
        auditSequence: String(events.length + 1),
        currentHash: Buffer.alloc(32),
        eventType: command.eventType,
        aggregateType: command.aggregateType,
        aggregateId: command.aggregateId,
        governanceObjectId: command.governanceObjectId,
        actorId: requestContext.actorPrincipalId,
        occurredAt: requestContext.occurredAt,
        recordedAt: '2026-09-03T16:00:00.123456',
        payload: command.payload,
      };
      events.push(event);
      return event;
    },
    async verifyChain() { return true; },
    async verifyChainDetailed() { return { valid: true, eventCount: events.length, firstMismatchSequence: null, errorType: null }; },
    async query() { return []; },
  };
  return { audit: createDepartmentGovernanceAudit(service, requestContext), events };
}
