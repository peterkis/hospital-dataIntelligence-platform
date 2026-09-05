import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { EngagementEffectiveContext } from './engagement-effective-contracts.js';
import { deriveEngagementBusinessState, type EngagementBusinessStateQuery,
  type EngagementLifecycleEventType } from './engagement-lifecycle-contracts.js';
import type { EngagementCategoryCode } from './engagement-policy-contracts.js';

/** Private, lock-free, one-statement snapshot. Authorization belongs to callers. */
export async function resolveEngagementTemporalContext(
  database: Transaction<DB>, query: EngagementBusinessStateQuery,
): Promise<EngagementEffectiveContext> {
  const result = await sql<{
    person_id: string; engagement_version_id: string | null; version_no: string;
    recorded_from: string; business_valid_from: string; business_valid_to: string | null;
    event_id: string | null; event_type: EngagementLifecycleEventType | null;
    sequence_no: string; type_code: string; category_code: EngagementCategoryCode;
    type_version_id: string | null; type_version_no: string; classified_at: string;
  }>`
    select relation.person_id, version.engagement_version_id, version.version_no::text,
      version.recorded_from, version.business_valid_from, version.business_valid_to,
      event.engagement_lifecycle_event_id as event_id, event.event_type,
      coalesce(sequence.sequence_no, 0)::text as sequence_no,
      frozen.type_code, frozen.category_code, frozen.engagement_type_version_id as type_version_id,
      frozen.version_no::text as type_version_no, frozen.classified_at
    from person_master.engagement as relation
    left join lateral (
      select v.* from person_master.engagement_version v
      where v.engagement_id=relation.engagement_id and v.governance_object_id=relation.governance_object_id
        and v.recorded_from <= ${query.recordAsOf}::timestamp
      order by v.version_no desc limit 1
    ) version on true
    left join lateral (
      select e.engagement_lifecycle_event_id,e.event_type
      from person_master.engagement_lifecycle_event e
      where e.engagement_id=relation.engagement_id and e.governance_object_id=relation.governance_object_id
        and e.recorded_at <= ${query.recordAsOf}::timestamp
        and e.business_effective_at <= ${query.businessAt}::timestamp
      order by e.business_effective_at desc,e.sequence_no desc limit 1
    ) event on true
    left join lateral (
      select max(e.sequence_no) as sequence_no from person_master.engagement_lifecycle_event e
      where e.engagement_id=relation.engagement_id and e.governance_object_id=relation.governance_object_id
        and e.recorded_at <= ${query.recordAsOf}::timestamp
    ) sequence on true
    left join lateral (
      select d.type_code,t.category_code,t.engagement_type_version_id,t.version_no,c.classified_at
      from person_master.engagement_classification c
      join person_master.engagement_type d on d.engagement_type_id=c.engagement_type_id
      join person_master.engagement_type_version t on t.engagement_type_version_id=c.engagement_type_version_id
      where c.engagement_id=relation.engagement_id and c.governance_object_id=relation.governance_object_id
        and c.classified_at <= ${query.recordAsOf}::timestamp
        and t.recorded_from <= ${query.recordAsOf}::timestamp
    ) frozen on true
    where relation.governance_object_id=${query.governanceObjectId}::uuid
      and relation.engagement_id=${query.engagementId}::uuid
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
  if (!row.engagement_version_id) throw new Error('ENGAGEMENT_NOT_KNOWN_AS_OF');
  const businessState = deriveEngagementBusinessState({ businessAt: query.businessAt,
    businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to,
    lastApplicableEventType: row.event_type });
  return { ...query, semanticRole: 'EFFECTIVE_ENGAGEMENT_CONTEXT', personId: row.person_id,
    authorityEngagementVersionId: row.engagement_version_id, authorityVersionNo: row.version_no,
    authorityRecordedFrom: row.recorded_from, authoritativeBusinessValidFrom: row.business_valid_from,
    authoritativeBusinessValidTo: row.business_valid_to,
    isWithinBusinessPeriod: businessState === 'ACTIVE' || businessState === 'SUSPENDED', businessState,
    lastApplicableLifecycleEventId: row.event_id, recordVisibleLifecycleSequence: row.sequence_no,
    classification: row.type_version_id === null ? null : {
      engagementTypeCode: row.type_code, engagementCategoryCode: row.category_code,
      engagementTypeVersionId: row.type_version_id, engagementTypeVersionNo: row.type_version_no,
      classifiedAt: row.classified_at,
    } };
}
