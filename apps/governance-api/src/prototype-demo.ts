import { sql, type Kysely } from 'kysely';
import type { DB } from './platform/database/database-types.generated.js';
import {
  PROTOTYPE_DEMO,
  PROTOTYPE_DEMO_AUDIT_TARGET,
  PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS,
  assertSyntheticPrototypeDemoFixture,
} from './prototype-demo-fixture.js';

export interface PrototypeDemoCounts {
  readonly organizationCount: number;
  readonly campusCount: number;
  readonly chargeItemCount: number;
  readonly priceListCount: number;
  readonly publishedVersionCount: number;
  readonly auditEventCount: number;
}

export interface PrototypeDemoReadyReport extends PrototypeDemoCounts {
  readonly status: 'PASSED';
}

export async function getPrototypeDemoCounts(database: Kysely<DB>): Promise<PrototypeDemoCounts> {
  const result = await sql<{
    readonly campus_count: number;
    readonly charge_item_count: number;
    readonly price_list_count: number;
    readonly published_charge_count: number;
    readonly published_price_count: number;
    readonly audit_event_count: number;
  }>`
    select
      (select count(*)::int from platform.campus
        where campus_id in (${sql.join(PROTOTYPE_DEMO.campuses.map((campus) => sql`${campus.campusId}::uuid`))})) as campus_count,
      (select count(*)::int from charge_catalog.charge_item
        where governance_object_id = ${PROTOTYPE_DEMO.chargeCatalog.governanceObjectId}::uuid) as charge_item_count,
      (select count(*)::int from price_list.price_list
        where governance_object_id in (${sql.join(PROTOTYPE_DEMO.priceLists.map((priceList) => sql`${priceList.governanceObjectId}::uuid`))})) as price_list_count,
      (select count(*)::int from charge_catalog.charge_item item
        join charge_catalog.charge_item_version version using (charge_item_id)
        where item.governance_object_id = ${PROTOTYPE_DEMO.chargeCatalog.governanceObjectId}::uuid
          and version.governance_status = 'PUBLISHED') as published_charge_count,
      (select count(*)::int from price_list.price_list list
        join price_list.price_list_release release using (price_list_id)
        where list.governance_object_id in (${sql.join(PROTOTYPE_DEMO.priceLists.map((priceList) => sql`${priceList.governanceObjectId}::uuid`))})
          and release.governance_status = 'PUBLISHED') as published_price_count,
      (select count(*)::int from audit.audit_event
        where governance_object_id in (${sql.join(PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS.map((id) => sql`${id}::uuid`))})) as audit_event_count
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new Error('PROTOTYPE_DEMO_COUNTS_UNAVAILABLE');
  return {
    organizationCount: 1,
    campusCount: row.campus_count,
    chargeItemCount: row.charge_item_count,
    priceListCount: row.price_list_count,
    publishedVersionCount: row.published_charge_count + row.published_price_count,
    auditEventCount: row.audit_event_count,
  };
}

export function assertPrototypeDemoCounts(counts: PrototypeDemoCounts): PrototypeDemoReadyReport {
  assertSyntheticPrototypeDemoFixture();
  if (
    counts.organizationCount !== 1 ||
    counts.campusCount !== 2 ||
    counts.chargeItemCount !== 5 ||
    counts.priceListCount !== 3 ||
    counts.publishedVersionCount !== 8 ||
    counts.auditEventCount !== PROTOTYPE_DEMO_AUDIT_TARGET
  ) {
    throw new Error('PROTOTYPE_DEMO_DATA_INCOMPLETE');
  }
  return { status: 'PASSED', ...counts };
}

export async function assertPrototypeDemoReady(database: Kysely<DB>): Promise<PrototypeDemoReadyReport> {
  return assertPrototypeDemoCounts(await getPrototypeDemoCounts(database));
}

export async function loadPrototypeDemoDashboard(database: Kysely<DB>, currentLocalDateTime: string) {
  const counts = assertPrototypeDemoCounts(await getPrototypeDemoCounts(database));
  const chargeItems = await sql<{
    readonly charge_item_id: string;
    readonly charge_item_version_id: string;
    readonly internal_code: string;
    readonly formal_name: string;
    readonly version_no: string;
    readonly governance_status: string;
    readonly content_digest: string;
    readonly recorded_from: string;
  }>`
    select item.charge_item_id, version.charge_item_version_id, item.internal_code,
           version.formal_name, version.version_no::text, version.governance_status,
           encode(version.content_hash, 'hex') as content_digest,
           version.recorded_from::text
    from charge_catalog.charge_item item
    join charge_catalog.charge_item_version version using (charge_item_id)
    where item.governance_object_id = ${PROTOTYPE_DEMO.chargeCatalog.governanceObjectId}::uuid
    order by item.internal_code, version.version_no
  `.execute(database);
  const priceLists = await sql<{
    readonly price_list_id: string;
    readonly price_list_release_id: string;
    readonly price_list_code: string;
    readonly display_name: string;
    readonly governance_status: string;
    readonly content_digest: string;
    readonly business_valid_from: string;
    readonly scope_level: string;
    readonly campus_name: string | null;
    readonly fixed_unit_price: string;
  }>`
    select list.price_list_id, release.price_list_release_id, list.price_list_code,
           release.display_name, release.governance_status,
           encode(release.content_hash, 'hex') as content_digest,
           release.business_valid_from::text, entry.scope_level,
           campus.display_name as campus_name, entry.fixed_unit_price::text
    from price_list.price_list list
    join price_list.price_list_release release using (price_list_id)
    join price_list.price_entry entry using (price_list_release_id)
    left join platform.campus campus on campus.campus_id = entry.campus_id
    where list.governance_object_id in (${sql.join(PROTOTYPE_DEMO.priceLists.map((priceList) => sql`${priceList.governanceObjectId}::uuid`))})
      and release.governance_status = 'PUBLISHED'
    order by list.price_list_code
  `.execute(database);
  const auditTimeline = await sql<{
    readonly audit_event_id: string;
    readonly action: string;
    readonly authority_scope: string;
    readonly governed_type: string;
    readonly actor_principal_id: string;
    readonly principal_code: string;
    readonly occurred_at: string;
    readonly audit_sequence: string;
  }>`
    select event.audit_event_id, event.action, event.authority_scope,
           coalesce(request.frozen_evidence->>'entityType', event.entity_type) as governed_type,
           event.actor_principal_id, principal.principal_code, event.occurred_at::text,
           event.audit_sequence::text
    from audit.audit_event event
    join platform.security_principal principal
      on principal.security_principal_id = event.actor_principal_id
    left join workflow.change_request request
      on request.change_request_id = event.stable_entity_id
    where event.governance_object_id in (${sql.join(PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS.map((id) => sql`${id}::uuid`))})
      and event.action in ('DRAFT_CREATED', 'CHANGE_SUBMITTED', 'APPROVAL_ACTIONED', 'PUBLISHED')
    order by event.occurred_at desc, event.audit_stream_id, event.audit_sequence desc
    limit 12
  `.execute(database);
  const approvalCount = await sql<{ readonly count: number }>`
    select count(*)::int as count
    from audit.audit_event
    where governance_object_id in (${sql.join(PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS.map((id) => sql`${id}::uuid`))})
      and action = 'APPROVAL_ACTIONED'
  `.execute(database);
  const resolution = await loadDemoResolution(database);
  return {
    status: 'READY' as const,
    environment: 'Synthetic Prototype' as const,
    identity: 'Prototype Synthetic' as const,
    timeZone: 'Asia/Shanghai' as const,
    currentLocalDateTime,
    organization: PROTOTYPE_DEMO.organization,
    campuses: PROTOTYPE_DEMO.campuses,
    counts: {
      ...counts,
      publishedChargeVersionCount: chargeItems.rows.filter((row) => row.governance_status === 'PUBLISHED').length,
      approvalEventCount: approvalCount.rows[0]?.count ?? 0,
    },
    chargeItems: groupChargeVersions(chargeItems.rows),
    priceLists: priceLists.rows.map((row) => ({
      objectId: row.price_list_id,
      versionId: row.price_list_release_id,
      code: row.price_list_code,
      displayName: row.display_name,
      governanceStatus: row.governance_status,
      digest: row.content_digest,
      businessValidFrom: normalizeLocalDateTime(row.business_valid_from),
      scopeLabel: row.scope_level === 'HOSPITAL' ? '全院' : row.campus_name ?? '院区',
      fixedUnitPrice: row.fixed_unit_price,
    })),
    auditTimeline: auditTimeline.rows.map((row) => ({
      auditEventId: row.audit_event_id,
      auditSequence: row.audit_sequence,
      action: auditActionLabel(row.action, row.authority_scope, row.governed_type),
      actor: actorLabel(row.principal_code),
      role: actorRole(row.principal_code),
      timestamp: displayLocalDateTime(row.occurred_at),
    })),
    resolution,
  };
}

async function loadDemoResolution(database: Kysely<DB>) {
  const result = await sql<{
    readonly price_resolution_id: string;
    readonly status: string;
    readonly unit_price: string | null;
    readonly quantity: string | null;
    readonly final_amount: string | null;
    readonly currency_code: string | null;
    readonly result_digest: string | null;
  }>`
    select resolution.price_resolution_id,
           resolution.resolution_status as status,
           result.unit_price::text, result.quantity::text, result.final_amount::text,
           result.currency_code, encode(result.result_hash, 'hex') as result_digest
    from price_resolution.price_resolution resolution
    left join price_resolution.price_resolution_result result using (price_resolution_id)
    where resolution.request_id = ${PROTOTYPE_DEMO.resolution.requestId}
  `.execute(database);
  const row = result.rows[0];
  if (!row) throw new Error('PROTOTYPE_DEMO_RESOLUTION_MISSING');
  const steps = await sql<{
    readonly step_no: string;
    readonly scope_checked: string;
    readonly encounter_mode_checked: string;
    readonly decision: string;
  }>`
    select step_no::text, scope_checked, encounter_mode_checked, decision
    from price_resolution.price_resolution_step
    where price_resolution_id = ${row.price_resolution_id}::uuid
    order by step_no
  `.execute(database);
  return {
    objectId: row.price_resolution_id,
    digest: row.result_digest,
    status: row.status,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    finalAmount: row.final_amount,
    currencyCode: row.currency_code,
    steps: steps.rows.map((step) => ({
      stepNo: step.step_no,
      label: resolutionStepLabel(step.scope_checked, step.encounter_mode_checked),
      decision: step.decision === 'MATCHED' ? '命中' : '未命中',
    })),
  };
}

function groupChargeVersions(rows: readonly {
  readonly charge_item_id: string;
  readonly charge_item_version_id: string;
  readonly internal_code: string;
  readonly formal_name: string;
  readonly version_no: string;
  readonly governance_status: string;
  readonly content_digest: string;
  readonly recorded_from: string;
}[]) {
  const items = new Map<string, {
    objectId: string;
    code: string;
    displayName: string;
    publishedVersion: null | { versionId: string; digest: string; recordedFrom: string };
    draftVersion: null | { versionId: string; digest: string; recordedFrom: string };
  }>();
  for (const row of rows) {
    const item = items.get(row.charge_item_id) ?? {
      objectId: row.charge_item_id,
      code: row.internal_code,
      displayName: row.formal_name,
      publishedVersion: null,
      draftVersion: null,
    };
    const version = {
      versionId: row.charge_item_version_id,
      digest: row.content_digest,
      recordedFrom: normalizeLocalDateTime(row.recorded_from),
    };
    if (row.governance_status === 'PUBLISHED') item.publishedVersion = version;
    if (row.governance_status === 'DRAFT') item.draftVersion = version;
    items.set(row.charge_item_id, item);
  }
  return [...items.values()];
}

function auditActionLabel(action: string, authorityScope: string, governedType: string): string {
  if (action === 'DRAFT_CREATED') return '创建收费项目草稿';
  if (action === 'CHANGE_SUBMITTED') return governedType === 'PRICE_LIST_RELEASE' ? '提交价表' : '提交收费项目';
  if (action === 'PUBLISHED') return governedType === 'PRICE_LIST_RELEASE' ? '发布价表' : '发布收费项目';
  if (authorityScope === 'PROFESSIONAL_REVIEW') return '专业审核';
  if (authorityScope === 'CAMPUS_PRE_CONFIRMATION') return '院区前置确认';
  return '终审批准';
}

function actorLabel(principalCode: string): string {
  if (principalCode.includes('PROFESSIONAL-REVIEWER')) return '专业审核员（合成）';
  if (principalCode.includes('OWNER-APPROVER')) return '终审负责人（合成）';
  return '数据维护员（合成）';
}

function actorRole(principalCode: string): string {
  if (principalCode.includes('PROFESSIONAL-REVIEWER')) return '专业审核';
  if (principalCode.includes('OWNER-APPROVER')) return '数据 Owner';
  return '数据管家';
}

function resolutionStepLabel(scope: string, mode: string): string {
  if (scope === 'CAMPUS' && mode === 'SPECIFIC') return '院区专用';
  if (scope === 'CAMPUS') return '院区通用';
  if (mode === 'SPECIFIC') return '全院专用';
  return '全院通用';
}

function normalizeLocalDateTime(value: string): string {
  return value.replace(' ', 'T');
}

export function displayLocalDateTime(value: string): string {
  return normalizeLocalDateTime(value).slice(0, 19).replace('T', ' ');
}
