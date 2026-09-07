import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { AuthorizationModule } from '../authorization/index.js';
import { assertClosedObject } from './contracts.js';
import { assertEngagementUuid } from './engagement-contracts.js';
import { deriveEngagementBusinessState, type EngagementLifecycleEventType } from './engagement-lifecycle-contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { resolveEngagementTemporalContext } from './engagement-temporal-resolver.js';
import type { EngagementEffectivePeriodReader, EngagementEffectivePeriodQuery,
  EngagementEffectivePeriodContext, EngagementStateSegment } from './engagement-effective-period-contracts.js';

const LIMIT = 'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT';

/** C02 identity-only owner port; it never evaluates lifecycle or clinical validity. */
export function createAssignmentEngagementIdentityReader(database: Transaction<DB>, authorization: AuthorizationModule,
  requireScope: (objectId: string) => Promise<void>) {
  return async (query: { governanceObjectId: string; engagementId: string; recordAsOf: string }): Promise<{ personId: string }> => {
    assertClosedObject(query, ['governanceObjectId', 'engagementId', 'recordAsOf']);
    assertEngagementUuid(query.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
    assertEngagementUuid(query.engagementId, 'ENGAGEMENT_ID_INVALID');
    const recordAsOf = temporalKey(query.recordAsOf);
    await requireScope(query.governanceObjectId);
    for (const permissionCode of ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ'] as const)
      await authorization.requireObjectPermission({ governanceObjectId: query.governanceObjectId, permissionCode });
    const row = await database.selectFrom('person_master.engagement').select(['person_id', 'created_at'])
      .where('governance_object_id', '=', query.governanceObjectId).where('engagement_id', '=', query.engagementId).executeTakeFirst();
    if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
    if (temporalKey(row.created_at) > recordAsOf) throw new Error('ENGAGEMENT_NOT_KNOWN_AS_OF');
    return { personId: row.person_id };
  };
}

/** C02 composition-only pin. Acquire UPDATE directly; do not upgrade the C01 SHARE pin. */
export function createClassifiedAssignmentEngagementPin(database: Transaction<DB>, authorization: AuthorizationModule,
  requireScope: (objectId: string)=>Promise<void>) {
  return async (query: { governanceObjectId: string; engagementId: string }): Promise<void> => {
    assertEngagementUuid(query.governanceObjectId,'ENGAGEMENT_SCOPE_INVALID');
    assertEngagementUuid(query.engagementId,'ENGAGEMENT_ID_INVALID');
    await requireScope(query.governanceObjectId);
    for (const permissionCode of ['PERSON_MASTER_ENGAGEMENT_READ','PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'] as const)
      await authorization.requireObjectPermission({ governanceObjectId: query.governanceObjectId,permissionCode });
    const row=await database.selectFrom('person_master.engagement').select('engagement_id')
      .where('governance_object_id','=',query.governanceObjectId).where('engagement_id','=',query.engagementId).forUpdate().executeTakeFirst();
    if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
  };
}

/** Composition-only factory. Every read uses its caller's transaction snapshot. */
export function createEngagementEffectivePeriodScope(database: Transaction<DB>,
  authorization: AuthorizationModule,
  requireScope: (objectId: string) => Promise<void>,
): EngagementEffectivePeriodReader & {
  pinEngagement(query: { governanceObjectId: string; engagementId: string }): Promise<void>;
} {
  async function authorize(query: { governanceObjectId: string; engagementId: string }) {
    assertEngagementUuid(query.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
    assertEngagementUuid(query.engagementId, 'ENGAGEMENT_ID_INVALID');
    await requireScope(query.governanceObjectId);
    for (const permissionCode of ['PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'] as const)
      await authorization.requireObjectPermission({ governanceObjectId: query.governanceObjectId, permissionCode });
  }
  return {
    async pinEngagement(query) {
      await authorize(query);
      const row = await database.selectFrom('person_master.engagement').select('engagement_id')
        .where('governance_object_id', '=', query.governanceObjectId)
        .where('engagement_id', '=', query.engagementId).forShare().executeTakeFirst();
      if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
    },
    async getEngagementEffectivePeriodAsOf(query): Promise<EngagementEffectivePeriodContext> {
      assertClosedObject(query, ['governanceObjectId', 'engagementId', 'requestedFrom', 'requestedTo', 'recordAsOf']);
      const start = temporalKey(query.requestedFrom), end = query.requestedTo === null ? null : temporalKey(query.requestedTo);
      temporalKey(query.recordAsOf);
      if (end !== null && end <= start) throw new Error('ASSIGNMENT_PERIOD_INVALID');
      await authorize(query);
      const base = await resolveEngagementTemporalContext(database, { governanceObjectId: query.governanceObjectId,
        engagementId: query.engagementId, businessAt: query.requestedFrom, recordAsOf: query.recordAsOf });
      // Only the last applicable prefix fact and max+1 in-period facts are loaded.
      const events = (await sql<{ id: string; effective: string; sequence: string; type: EngagementLifecycleEventType }>`
        (select engagement_lifecycle_event_id as id, business_effective_at as effective,
          sequence_no::text as sequence, event_type as type
         from person_master.engagement_lifecycle_event
         where engagement_id=${query.engagementId}::uuid and governance_object_id=${query.governanceObjectId}::uuid
          and recorded_at <= ${query.recordAsOf}::timestamp and business_effective_at <= ${query.requestedFrom}::timestamp
         order by business_effective_at desc, sequence_no desc limit 1)
        union all
        (select engagement_lifecycle_event_id, business_effective_at, sequence_no::text, event_type
         from person_master.engagement_lifecycle_event
         where engagement_id=${query.engagementId}::uuid and governance_object_id=${query.governanceObjectId}::uuid
          and recorded_at <= ${query.recordAsOf}::timestamp and business_effective_at > ${query.requestedFrom}::timestamp
          and (${query.requestedTo}::timestamp is null or business_effective_at < ${query.requestedTo}::timestamp)
         order by business_effective_at, sequence_no limit 65)
      `.execute(database)).rows;
      if (events.length > 64) throw new Error(LIMIT);
      const boundaries = new Set([start]);
      for (const value of [base.authoritativeBusinessValidFrom, base.authoritativeBusinessValidTo,
        ...events.map(e => e.effective)]) {
        if (value !== null) { const k = temporalKey(value); if (k > start && (end === null || k < end)) boundaries.add(k); }
      }
      const ordered = [...boundaries].sort();
      if (ordered.length > 128) throw new Error(LIMIT);
      const stateSegments: EngagementStateSegment[] = ordered.map((from, i) => {
        const applicable = events.filter(e => temporalKey(e.effective) <= from).sort((a, b) =>
          temporalKey(a.effective).localeCompare(temporalKey(b.effective)) || (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)).at(-1);
        return { from, to: ordered[i + 1] ?? end,
          businessState: deriveEngagementBusinessState({ businessAt: from,
            businessValidFrom: base.authoritativeBusinessValidFrom, businessValidTo: base.authoritativeBusinessValidTo,
            lastApplicableEventType: applicable?.type ?? null }),
          lastApplicableLifecycleEventId: applicable?.id ?? null, lifecycleSequence: applicable?.sequence ?? '0' };
      });
      const result: EngagementEffectivePeriodContext = { ...query, semanticRole: 'EFFECTIVE_ENGAGEMENT_PERIOD_CONTEXT',
        personId: base.personId, authorityEngagementVersionId: base.authorityEngagementVersionId,
        authorityVersionNo: base.authorityVersionNo, authorityRecordedFrom: base.authorityRecordedFrom,
        authoritativeBusinessValidFrom: base.authoritativeBusinessValidFrom, authoritativeBusinessValidTo: base.authoritativeBusinessValidTo,
        recordVisibleLifecycleSequence: base.recordVisibleLifecycleSequence, classification: base.classification, stateSegments };
      if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new Error(LIMIT);
      return result;
    },
  };
}
