import { createHash } from 'node:crypto';
import pg from 'pg';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import { departmentSemanticHash } from '../../apps/governance-api/src/modules/department-master/index.js';

const HOSPITAL_NAME = 'HDI Demo Hospital';
const BUSINESS_VALID_FROM = '2026-09-01T00:00:00';
const RECORDED_FROM = '2026-09-03T09:00:00';
const QUALITY_CALCULATED_AT = '2026-09-03T09:30:00';
const DEPARTMENT_GOVERNANCE_OBJECT_ID = PROTOTYPE_FIXTURE.departmentMasterObjectId;

const campuses = [
  [PROTOTYPE_FIXTURE.departmentHeadquartersCampusId, 'HDI-DEMO-HQ', '总部院区'],
  [PROTOTYPE_FIXTURE.departmentHighTechCampusId, 'HDI-DEMO-HITECH', '高新院区'],
] as const;

const departments = [
  {
    id: PROTOTYPE_FIXTURE.respiratoryDepartmentId,
    versionId: '72100000-0000-7000-8000-000000000001',
    code: 'DEP-00001',
    standardName: '呼吸与危重症医学科',
    shortName: '呼吸与危重症科',
    departmentType: 'CLINICAL',
    clinicalFlag: true,
    managementFlag: false,
    subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE' as const,
    description: 'HDI Demo Hospital 合成科室主数据：呼吸与危重症医学科。',
  },
  {
    id: '72000000-0000-7000-8000-000000000002',
    versionId: '72100000-0000-7000-8000-000000000002',
    code: 'DEP-00002',
    standardName: '医学影像科',
    shortName: '影像科',
    departmentType: 'MEDICAL_TECHNOLOGY',
    clinicalFlag: false,
    managementFlag: false,
    subjectMappingApplicability: 'EXEMPT_MEDICAL_TECHNOLOGY' as const,
    description: 'HDI Demo Hospital 合成科室主数据：医学影像科。',
  },
  {
    id: '72000000-0000-7000-8000-000000000003',
    versionId: '72100000-0000-7000-8000-000000000003',
    code: 'DEP-00003',
    standardName: '检验医学科',
    shortName: '检验科',
    departmentType: 'MEDICAL_TECHNOLOGY',
    clinicalFlag: false,
    managementFlag: false,
    subjectMappingApplicability: 'EXEMPT_MEDICAL_TECHNOLOGY' as const,
    description: 'HDI Demo Hospital 合成科室主数据：检验医学科。',
  },
] as const;

const aliases = [
  ['72200000-0000-7000-8000-000000000001', departments[0].id, 'HIS', 'HIS-RESP', '呼吸科', '0.9800'],
  ['72200000-0000-7000-8000-000000000002', departments[0].id, 'EMR', 'EMR-RESP', '呼吸内科', '0.9600'],
  ['72200000-0000-7000-8000-000000000003', departments[0].id, 'PERFORMANCE', 'PERF-RESP', '呼吸与危重症', '0.9400'],
  ['72200000-0000-7000-8000-000000000004', departments[1].id, 'HIS', 'HIS-IMAGE', '影像科', '0.9800'],
  ['72200000-0000-7000-8000-000000000005', departments[1].id, 'PACS', 'PACS-IMAGE', '医学影像中心', '0.9500'],
  ['72200000-0000-7000-8000-000000000006', departments[2].id, 'LIS', 'LIS-LAB', '检验科', '0.9900'],
] as const;

const mappings = [
  ['72300000-0000-7000-8000-000000000001', departments[0].id, 'HIS', 'HIS-RESP', '呼吸科', 'DIRECT'],
  ['72300000-0000-7000-8000-000000000002', departments[0].id, 'EMR', 'EMR-RESP', '呼吸内科', 'MANUAL'],
  ['72300000-0000-7000-8000-000000000003', departments[0].id, 'PERFORMANCE', 'PERF-RESP', '呼吸与危重症', 'MANUAL'],
  ['72300000-0000-7000-8000-000000000004', departments[1].id, 'HIS', 'HIS-IMAGE', '影像科', 'DIRECT'],
  ['72300000-0000-7000-8000-000000000005', departments[1].id, 'PACS', 'PACS-IMAGE', '医学影像中心', 'DIRECT'],
  ['72300000-0000-7000-8000-000000000006', departments[2].id, 'LIS', 'LIS-LAB', '检验科', 'DIRECT'],
] as const;

const qualityScores = [
  ['72400000-0000-7000-8000-000000000001', departments[0].id, '100.00', '100.00', '95.00', '97.50'],
  ['72400000-0000-7000-8000-000000000002', departments[1].id, '100.00', '100.00', '90.00', '95.00'],
  ['72400000-0000-7000-8000-000000000003', departments[2].id, '95.00', '100.00', '100.00', '99.00'],
] as const;

const hierarchyViews = [
  ['73000000-0000-7000-8000-000000000001', 'DEPARTMENT-ADMIN', '行政科室层级', 'ADMINISTRATIVE', true, '74100000-0000-7000-8000-000000000001'],
  ['73000000-0000-7000-8000-000000000002', 'DEPARTMENT-OPERATION', '运营科室层级', 'OPERATIONAL', true, '74100000-0000-7000-8000-000000000002'],
  ['73000000-0000-7000-8000-000000000003', 'DEPARTMENT-MEDICAL-RECORD', '病案科室层级', 'MEDICAL_RECORD', true, '74100000-0000-7000-8000-000000000003'],
  ['73000000-0000-7000-8000-000000000004', 'DEPARTMENT-FINANCE', '财务科室层级', 'FINANCE', false, '74100000-0000-7000-8000-000000000004'],
  ['73000000-0000-7000-8000-000000000005', 'DEPARTMENT-STATISTICAL', '统计科室层级', 'STATISTICAL', false, '74100000-0000-7000-8000-000000000005'],
] as const;

const operationalHierarchies = [
  {
    view: hierarchyViews[0],
    versionId: '73100000-0000-7000-8000-000000000001',
    groupId: '73200000-0000-7000-8000-000000000001',
    groupVersionId: '73300000-0000-7000-8000-000000000001',
    groupCode: 'ADMIN-CLINICAL-TECH',
    groupName: '行政临床医技科室',
    nodePrefix: '73410000-0000-7000-8000-00000000000',
  },
  {
    view: hierarchyViews[1],
    versionId: '73100000-0000-7000-8000-000000000002',
    groupId: '73200000-0000-7000-8000-000000000002',
    groupVersionId: '73300000-0000-7000-8000-000000000002',
    groupCode: 'OPERATION-SERVICE-UNIT',
    groupName: '运营诊疗服务单元',
    nodePrefix: '73420000-0000-7000-8000-00000000000',
  },
  {
    view: hierarchyViews[2],
    versionId: '73100000-0000-7000-8000-000000000003',
    groupId: '73200000-0000-7000-8000-000000000003',
    groupVersionId: '73300000-0000-7000-8000-000000000003',
    groupCode: 'MEDICAL-RECORD-CLASSIFICATION',
    groupName: '病案科室分类',
    nodePrefix: '73430000-0000-7000-8000-00000000000',
  },
] as const;

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-department-seed',
  max: 1,
});
let client: pg.PoolClient | undefined;

try {
  client = await pool.connect();
  await client.query('begin');
  const migration = await client.query(
    "select exists(select 1 from platform.schema_migration where migration_id = '0013_department_master_api_readiness') as applied",
  );
  if (migration.rows[0]?.applied !== true) throw new Error('DEPARTMENT_MIGRATION_REQUIRED');

  const inserted = {
    principals: 0,
    campuses: 0,
    departments: 0,
    versions: 0,
    aliases: 0,
    mappings: 0,
    qualityScores: 0,
    hierarchyViews: 0,
    hierarchyViewVersions: 0,
    hierarchyGroups: 0,
    hierarchyGroupVersions: 0,
    hierarchyNodes: 0,
    governanceObjects: 0,
    permissions: 0,
    campusAssignments: 0,
  };

  inserted.principals += await insertCount(client, `
    insert into platform.security_principal (
      security_principal_id, principal_code, principal_kind, status
    ) values ($1::uuid, 'PROTOTYPE-SYNTHETIC-STEWARD', 'PERSON', 'ACTIVE')
    on conflict (security_principal_id) do nothing
  `, [PROTOTYPE_FIXTURE.actorPrincipalId]);

  const governanceObjects = [
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-MASTER', 'DEPARTMENT_MASTER', 'PROTOTYPE SYNTHETIC DEPARTMENT MASTER'],
    ...hierarchyViews.map((view) => [view[5], `PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-${view[3]}`, 'DEPARTMENT_HIERARCHY', `PROTOTYPE SYNTHETIC ${view[3]} DEPARTMENT HIERARCHY`] as const),
  ] as const;
  for (const object of governanceObjects) {
    inserted.governanceObjects += await insertCount(client, `
      insert into platform.governance_object (
        governance_object_id, object_code, object_type, display_name, created_by
      ) values ($1::uuid, $2, $3, $4, $5::uuid)
      on conflict (governance_object_id) do nothing
    `, [...object, PROTOTYPE_FIXTURE.actorPrincipalId]);
  }
  const permissionFixtures = [
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.actorPrincipalId, 'CONSUMER_SUBSCRIPTION_MANAGE'],
    [hierarchyViews[0][5], PROTOTYPE_FIXTURE.actorPrincipalId, 'CONSUMER_SUBSCRIPTION_MANAGE'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_MASTER_DRAFT_READ'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_MASTER_DRAFT_WRITE'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_MASTER_SUBMIT'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.reviewerPrincipalId, 'DEPARTMENT_MASTER_REVIEW'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.approverPrincipalId, 'DEPARTMENT_MASTER_APPROVE'],
    [DEPARTMENT_GOVERNANCE_OBJECT_ID, PROTOTYPE_FIXTURE.approverPrincipalId, 'DEPARTMENT_MASTER_PUBLISH'],
    ...hierarchyViews.flatMap((view) => [
      [view[5], PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_HIERARCHY_DRAFT_READ'],
      [view[5], PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_HIERARCHY_DRAFT_WRITE'],
      [view[5], PROTOTYPE_FIXTURE.actorPrincipalId, 'DEPARTMENT_HIERARCHY_SUBMIT'],
      [view[5], PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
      [view[5], PROTOTYPE_FIXTURE.reviewerPrincipalId, 'DEPARTMENT_HIERARCHY_REVIEW'],
      [view[5], PROTOTYPE_FIXTURE.approverPrincipalId, 'DEPARTMENT_HIERARCHY_APPROVE'],
      [view[5], PROTOTYPE_FIXTURE.approverPrincipalId, 'DEPARTMENT_HIERARCHY_PUBLISH'],
    ]),
  ] as const;
  for (const [objectId, principalId, permissionCode] of permissionFixtures) {
    inserted.permissions += await insertCount(client, `
      insert into access_control.object_permission_grant (
        governance_object_id, security_principal_id, permission_code, grant_effect,
        valid_from, grant_sequence, granted_by, reason, scope_level, campus_id
      ) values ($1::uuid, $2::uuid, $3, 'ALLOW', '2026-01-01 00:00:00', 1,
        $4::uuid, 'PROTOTYPE SYNTHETIC DEPARTMENT PERMISSION', 'HOSPITAL', null)
      on conflict (governance_object_id, security_principal_id, permission_code, grant_sequence) do nothing
    `, [objectId, principalId, permissionCode, PROTOTYPE_FIXTURE.actorPrincipalId]);
  }

  for (const [id, code, name] of campuses) {
    inserted.campuses += await insertCount(client, `
      insert into platform.campus (campus_id, campus_code, display_name, status)
      values ($1::uuid, $2::varchar(64), $3::varchar(256), 'ACTIVE')
      on conflict (campus_id) do nothing
    `, [id, code, name]);
  }

  for (const department of departments) {
    inserted.departments += await insertCount(client, `
      insert into department_master.department (
        department_id, governance_object_id, department_code, created_by, updated_by
      ) values ($1::uuid, $2::uuid, $3::varchar(64), $4::uuid, $4::uuid)
      on conflict (department_id) do nothing
    `, [department.id, DEPARTMENT_GOVERNANCE_OBJECT_ID, department.code, PROTOTYPE_FIXTURE.actorPrincipalId]);
    inserted.versions += await insertCount(client, `
      insert into department_master.department_version (
        department_version_id, department_id, version_no, standard_name, short_name,
        department_type, clinical_flag, management_flag, subject_mapping_applicability, business_status,
        governance_status, description, business_valid_from, business_valid_to,
        recorded_from, recorded_to, release_id, content_hash, created_by, updated_by
      ) values (
        $1::uuid, $2::uuid, 1, $3::varchar(256), $4::varchar(128),
        $5::varchar(32), $6::boolean, $7::boolean, $8, 'ACTIVE',
        'DRAFT', $9::varchar(1000), $10::timestamp, null,
        $11::timestamp, null, null, $12::bytea, $13::uuid, $13::uuid
      )
      on conflict (department_version_id) do update set
        subject_mapping_applicability = excluded.subject_mapping_applicability,
        content_hash = excluded.content_hash,
        updated_at = platform.local_now(),
        updated_by = excluded.updated_by
      where department_master.department_version.governance_status = 'DRAFT'
        and (department_master.department_version.subject_mapping_applicability,
             department_master.department_version.content_hash)
          is distinct from (excluded.subject_mapping_applicability, excluded.content_hash)
    `, [
      department.versionId,
      department.id,
      department.standardName,
      department.shortName,
      department.departmentType,
      department.clinicalFlag,
      department.managementFlag,
      department.subjectMappingApplicability,
      department.description,
      BUSINESS_VALID_FROM,
      RECORDED_FROM,
      departmentSemanticHash({
        departmentId: department.id,
        departmentVersionId: department.versionId,
        versionNo: '1',
        standardName: department.standardName,
        shortName: department.shortName,
        departmentType: department.departmentType,
        clinicalFlag: department.clinicalFlag,
        managementFlag: department.managementFlag,
        subjectMappingApplicability: department.subjectMappingApplicability,
        businessStatus: 'ACTIVE',
        description: department.description,
        businessValidFrom: BUSINESS_VALID_FROM,
        businessValidTo: null,
        recordedFrom: RECORDED_FROM,
      }),
      PROTOTYPE_FIXTURE.actorPrincipalId,
    ]);
  }

  const campusAssignments = [
    ['72500000-0000-7000-8000-000000000001', departments[0].id, campuses[0][0]],
    ['72500000-0000-7000-8000-000000000002', departments[1].id, campuses[0][0]],
    ['72500000-0000-7000-8000-000000000003', departments[1].id, campuses[1][0]],
  ] as const;
  for (const [assignmentId, departmentId, campusId] of campusAssignments) {
    inserted.campusAssignments += await insertCount(client, `
      insert into department_master.department_campus_assignment (
        department_campus_assignment_id, department_id, campus_id,
        business_valid_from, business_valid_to, recorded_from, recorded_to,
        content_hash, created_by, updated_by
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::timestamp, null, $5::timestamp, null,
        $6::bytea, $7::uuid, $7::uuid
      ) on conflict (department_campus_assignment_id) do nothing
    `, [
      assignmentId,
      departmentId,
      campusId,
      BUSINESS_VALID_FROM,
      RECORDED_FROM,
      contentHash(['department-campus-assignment', assignmentId, departmentId, campusId]),
      PROTOTYPE_FIXTURE.actorPrincipalId,
    ]);
  }

  for (const alias of aliases) {
    inserted.aliases += await insertCount(client, `
      insert into department_master.department_alias (
        department_alias_id, department_id, source_system, source_code,
        source_name, mapping_status, confidence_score
      ) values ($1::uuid, $2::uuid, $3, $4, $5, 'CONFIRMED', $6::numeric)
      on conflict (department_alias_id) do nothing
    `, alias);
  }

  for (const mapping of mappings) {
    inserted.mappings += await insertCount(client, `
      insert into department_master.department_source_mapping (
        department_mapping_id, department_id, source_system,
        source_department_code, source_department_name, match_method, mapping_status
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, 'CONFIRMED')
      on conflict (department_mapping_id) do nothing
    `, mapping);
  }

  for (const score of qualityScores) {
    inserted.qualityScores += await insertCount(client, `
      insert into department_master.department_quality_score (
        department_quality_score_id, department_id, completeness_score,
        uniqueness_score, standardization_score, overall_score, calculated_at
      ) values ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::timestamp)
      on conflict (department_quality_score_id) do nothing
    `, [...score, QUALITY_CALCULATED_AT]);
  }

  for (const [id, code, name, type, operationalEnabled, governanceObjectId] of hierarchyViews) {
    inserted.hierarchyViews += await insertCount(client, `
      insert into department_master.department_hierarchy_view (
        department_hierarchy_view_id, governance_object_id, view_code, view_name, view_type,
        operational_enabled, created_by, updated_by
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6::boolean, $7::uuid, $7::uuid)
      on conflict (department_hierarchy_view_id) do nothing
    `, [id, governanceObjectId, code, name, type, operationalEnabled, PROTOTYPE_FIXTURE.actorPrincipalId]);
  }

  for (const hierarchy of operationalHierarchies) {
    const viewId = hierarchy.view[0];
    inserted.hierarchyGroups += await insertCount(client, `
      insert into department_master.department_hierarchy_group (
        department_hierarchy_group_id, department_hierarchy_view_id,
        group_code, created_by, updated_by
      ) values ($1::uuid, $2::uuid, $3, $4::uuid, $4::uuid)
      on conflict (department_hierarchy_group_id) do nothing
    `, [hierarchy.groupId, viewId, hierarchy.groupCode, PROTOTYPE_FIXTURE.actorPrincipalId]);
    inserted.hierarchyGroupVersions += await insertCount(client, `
      insert into department_master.department_hierarchy_group_version (
        department_hierarchy_group_version_id, department_hierarchy_group_id,
        department_hierarchy_view_id, version_no, display_name,
        business_valid_from, business_valid_to, recorded_from, recorded_to,
        content_hash, created_by, updated_by
      ) values (
        $1::uuid, $2::uuid, $3::uuid, 1, $4,
        $5::timestamp, null, $6::timestamp, null,
        $7::bytea, $8::uuid, $8::uuid
      )
      on conflict (department_hierarchy_group_version_id) do nothing
    `, [
      hierarchy.groupVersionId,
      hierarchy.groupId,
      viewId,
      hierarchy.groupName,
      BUSINESS_VALID_FROM,
      RECORDED_FROM,
      contentHash(['hierarchy-group', hierarchy.groupCode, hierarchy.groupName]),
      PROTOTYPE_FIXTURE.actorPrincipalId,
    ]);
    inserted.hierarchyViewVersions += await insertCount(client, `
      insert into department_master.department_hierarchy_view_version (
        department_hierarchy_view_version_id, department_hierarchy_view_id,
        version_no, governance_status, business_valid_from, business_valid_to,
        recorded_from, recorded_to, release_id, content_hash, created_by, updated_by
      ) values (
        $1::uuid, $2::uuid, 1, 'DRAFT', $3::timestamp, null,
        $4::timestamp, null, null, $5::bytea, $6::uuid, $6::uuid
      )
      on conflict (department_hierarchy_view_version_id) do nothing
    `, [
      hierarchy.versionId,
      viewId,
      BUSINESS_VALID_FROM,
      RECORDED_FROM,
      contentHash([
        'hierarchy-snapshot',
        hierarchy.view[1],
        hierarchy.groupName,
        ...departments.map((department) => [department.id, department.versionId, department.standardName]),
      ]),
      PROTOTYPE_FIXTURE.actorPrincipalId,
    ]);

    const rootNodeId = `${hierarchy.nodePrefix}1`;
    inserted.hierarchyNodes += await insertCount(client, `
      insert into department_master.department_hierarchy_node (
        department_hierarchy_node_id, department_hierarchy_view_version_id,
        department_hierarchy_view_id, parent_node_id, node_kind,
        department_id, department_version_id, department_hierarchy_group_id,
        department_hierarchy_group_version_id, display_name, sort_order
      ) values (
        $1::uuid, $2::uuid, $3::uuid, null, 'GROUP',
        null, null, $4::uuid, $5::uuid, $6, 0
      )
      on conflict (department_hierarchy_node_id) do nothing
    `, [
      rootNodeId,
      hierarchy.versionId,
      viewId,
      hierarchy.groupId,
      hierarchy.groupVersionId,
      hierarchy.groupName,
    ]);
    for (const [index, department] of departments.entries()) {
      inserted.hierarchyNodes += await insertCount(client, `
        insert into department_master.department_hierarchy_node (
          department_hierarchy_node_id, department_hierarchy_view_version_id,
          department_hierarchy_view_id, parent_node_id, node_kind,
          department_id, department_version_id, department_hierarchy_group_id,
          department_hierarchy_group_version_id, display_name, sort_order
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'DEPARTMENT',
          $5::uuid, $6::uuid, null, null, $7, $8::integer
        )
        on conflict (department_hierarchy_node_id) do nothing
      `, [
        `${hierarchy.nodePrefix}${index + 2}`,
        hierarchy.versionId,
        viewId,
        rootNodeId,
        department.id,
        department.versionId,
        department.standardName,
        index + 1,
      ]);
    }
  }

  const verification = await verifySeed(client);
  await client.query('commit');
  const totalInserted = Object.values(inserted).reduce((sum, count) => sum + count, 0);
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    seedIdempotent: totalInserted === 0,
    hospital: { name: HOSPITAL_NAME, governanceBoundary: 'SINGLE_HOSPITAL' },
    campuses: campuses.map(([, code, name]) => ({ code, name })),
    inserted,
    checks: verification,
  })}\n`);
} catch (error) {
  await client?.query('rollback').catch(() => undefined);
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    rolledBack: true,
    errorCode: safeErrorCode(error, 'DEPARTMENT_DEMO_SEED_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}

async function insertCount(
  client: pg.PoolClient,
  query: string,
  values: readonly unknown[],
): Promise<number> {
  const result = await client.query(query, [...values]);
  return result.rowCount ?? 0;
}

async function verifySeed(client: pg.PoolClient): Promise<Record<string, boolean>> {
  const result = await client.query(`
    select
      (select count(*)::int = 5 from department_master.master_data_source
        where enabled = true and source_code in ('HIS', 'EMR', 'LIS', 'PACS', 'PERFORMANCE')) as sources_created,
      (select count(*)::int = 2 from platform.campus
        where campus_id in (
          $1::uuid,
          $2::uuid
        ) and display_name in ('总部院区', '高新院区')) as campuses_created,
      (select count(*)::int = 3 from department_master.department
        where department_code in ('DEP-00001', 'DEP-00002', 'DEP-00003')
          and governance_object_id = $3::uuid) as department_created,
      (select count(*)::int = 3 from department_master.department_version
        where department_version_id in (
          '72100000-0000-7000-8000-000000000001'::uuid,
          '72100000-0000-7000-8000-000000000002'::uuid,
          '72100000-0000-7000-8000-000000000003'::uuid
        ) and governance_status = 'DRAFT'
          and subject_mapping_applicability in (
            'REQUIRED_CLINICAL_SERVICE', 'EXEMPT_MEDICAL_TECHNOLOGY'
          )) as version_created,
      (select count(*)::int = 6 from department_master.department_alias
        where department_alias_id::text like '72200000-0000-7000-8000-%') as alias_created,
      (select count(*)::int = 6 from department_master.department_source_mapping
        where department_mapping_id::text like '72300000-0000-7000-8000-%'
          and mapping_status = 'CONFIRMED') as mapping_created,
      (select count(*)::int = 3 from department_master.department_quality_score
        where department_quality_score_id::text like '72400000-0000-7000-8000-%') as quality_score_created,
      (select count(*)::int = 6 from platform.governance_object
        where governance_object_id in (
          $3::uuid,
          '74100000-0000-7000-8000-000000000001'::uuid,
          '74100000-0000-7000-8000-000000000002'::uuid,
          '74100000-0000-7000-8000-000000000003'::uuid,
          '74100000-0000-7000-8000-000000000004'::uuid,
          '74100000-0000-7000-8000-000000000005'::uuid
        )) as governance_objects_bound,
      (select count(*)::int = 3 from department_master.department_campus_assignment
        where department_campus_assignment_id::text like '72500000-0000-7000-8000-%') as campus_assignments_created,
      (select count(distinct department_id)::int = 2
        from department_master.department_campus_assignment
        where campus_id in (
          $1::uuid,
          $2::uuid
        ) and department_campus_assignment_id in (
          '72500000-0000-7000-8000-000000000001'::uuid,
          '72500000-0000-7000-8000-000000000002'::uuid,
          '72500000-0000-7000-8000-000000000003'::uuid
        )) as campus_assignments_share_stable_departments,
      (select count(*)::int = 5 from department_master.department_hierarchy_view
        where view_type in ('ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD', 'FINANCE', 'STATISTICAL')) as hierarchy_views_registered,
      (select count(*)::int = 3 from department_master.department_hierarchy_view
        where operational_enabled = true
          and view_type in ('ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD')) as operational_views_enabled,
      (select count(*)::int = 2 from department_master.department_hierarchy_view
        where operational_enabled = false
          and view_type in ('FINANCE', 'STATISTICAL')) as reserved_views_registration_only,
      (select count(*)::int = 3 from department_master.department_hierarchy_view_version
        where governance_status = 'DRAFT') as hierarchy_versions_created,
      (select count(*)::int = 12 from department_master.department_hierarchy_node
        where department_hierarchy_view_version_id in (
          '73100000-0000-7000-8000-000000000001'::uuid,
          '73100000-0000-7000-8000-000000000002'::uuid,
          '73100000-0000-7000-8000-000000000003'::uuid
        )) as hierarchy_nodes_created,
      (select count(*)::int = 9
        from department_master.department_hierarchy_node as node
        inner join department_master.department_version as version
          on version.department_version_id = node.department_version_id
          and version.department_id = node.department_id
        where node.node_kind = 'DEPARTMENT'
          and node.department_hierarchy_view_version_id in (
            '73100000-0000-7000-8000-000000000001'::uuid,
            '73100000-0000-7000-8000-000000000002'::uuid,
            '73100000-0000-7000-8000-000000000003'::uuid
          )
          and node.display_name = version.standard_name) as snapshot_names_and_versions_frozen,
      not exists (
        select 1 from information_schema.columns
        where table_schema = 'department_master'
          and table_name = 'department_version'
          and column_name in ('parent_department_id', 'hierarchy_level', 'tree_path')
      ) as no_generic_parent_on_department_version
  `, [
    PROTOTYPE_FIXTURE.departmentHeadquartersCampusId,
    PROTOTYPE_FIXTURE.departmentHighTechCampusId,
    PROTOTYPE_FIXTURE.departmentMasterObjectId,
  ]);
  const checks = result.rows[0] as Record<string, boolean> | undefined;
  if (!checks || Object.values(checks).some((value) => value !== true)) {
    throw new Error('DEPARTMENT_DEMO_SEED_VERIFICATION_FAILED');
  }
  return checks;
}

function contentHash(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: `REQUIRED_ENVIRONMENT_MISSING:${name}` })}\n`);
    process.exit(1);
  }
  return value;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (/^[A-Z0-9_]+$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) return error.message;
  return fallback;
}
