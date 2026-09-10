import pg from 'pg';

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-department-constraint-probe',
  max: 1,
});

const client = await pool.connect();
const checks: Record<string, boolean> = {};

try {
  await client.query('begin');
  checks['stableDepartmentDeletionRejected'] = await expectSqlState(client, '55000', `
    delete from department_master.department
    where department_id = '72000000-0000-7000-8000-000000000001'
  `);
  checks['draftRecordPeriodDirectClosureRejected'] = await expectSqlState(client, '55000', `
    update department_master.department_version
    set recorded_to = '2026-10-01 00:00:00', updated_at = platform.local_now()
    where department_version_id = '72100000-0000-7000-8000-000000000001'
  `);

  await client.query(`
    insert into department_master.department_hierarchy_group (
      department_hierarchy_group_id, department_hierarchy_view_id, group_code,
      created_by, updated_by
    ) values
      ('7f100000-0000-7000-8000-000000000001', '73000000-0000-7000-8000-000000000001', 'PROBE-A', '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001'),
      ('7f100000-0000-7000-8000-000000000002', '73000000-0000-7000-8000-000000000001', 'PROBE-B', '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001'),
      ('7f100000-0000-7000-8000-000000000003', '73000000-0000-7000-8000-000000000002', 'PROBE-C', '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001');
    insert into department_master.department_hierarchy_group_version (
      department_hierarchy_group_version_id, department_hierarchy_group_id,
      department_hierarchy_view_id, version_no, display_name,
      business_valid_from, recorded_from, content_hash, created_by, updated_by
    ) values
      ('7f110000-0000-7000-8000-000000000001', '7f100000-0000-7000-8000-000000000001', '73000000-0000-7000-8000-000000000001', 1, '探针A', '2026-09-01 00:00:00', '2026-09-03 09:00:00', digest('probe-a', 'sha256'), '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001'),
      ('7f110000-0000-7000-8000-000000000002', '7f100000-0000-7000-8000-000000000002', '73000000-0000-7000-8000-000000000001', 1, '探针B', '2026-09-01 00:00:00', '2026-09-03 09:00:00', digest('probe-b', 'sha256'), '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001'),
      ('7f110000-0000-7000-8000-000000000003', '7f100000-0000-7000-8000-000000000003', '73000000-0000-7000-8000-000000000002', 1, '探针C', '2026-09-01 00:00:00', '2026-09-03 09:00:00', digest('probe-c', 'sha256'), '70000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001')
  `);

  checks['mismatchedGroupAndGroupVersionRejected'] = await expectSqlState(client, '23503', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, node_kind, department_hierarchy_group_id,
      department_hierarchy_group_version_id, display_name
    ) values (
      '7f000000-0000-7000-8000-000000000020',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001', 'GROUP',
      '7f100000-0000-7000-8000-000000000001',
      '7f110000-0000-7000-8000-000000000002', '错配分组'
    )
  `);

  checks['duplicateGroupPlacementRejected'] = await expectSqlState(client, '23505', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, node_kind, department_hierarchy_group_id,
      department_hierarchy_group_version_id, display_name
    ) values
    (
      '7f000000-0000-7000-8000-000000000021',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001', 'GROUP',
      '7f100000-0000-7000-8000-000000000001',
      '7f110000-0000-7000-8000-000000000001', '重复分组'
    ), (
      '7f000000-0000-7000-8000-000000000022',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001', 'GROUP',
      '7f100000-0000-7000-8000-000000000001',
      '7f110000-0000-7000-8000-000000000001', '重复分组'
    )
  `);

  checks['groupVersionFromOtherViewRejected'] = await expectSqlState(client, '23503', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, node_kind, department_hierarchy_group_id,
      department_hierarchy_group_version_id, display_name
    ) values (
      '7f000000-0000-7000-8000-000000000023',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001', 'GROUP',
      '7f100000-0000-7000-8000-000000000003',
      '7f110000-0000-7000-8000-000000000003', '跨视图分组'
    )
  `);

  checks['duplicateDepartmentPlacementRejected'] = await expectSqlState(client, '23505', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, parent_node_id, node_kind,
      department_id, department_version_id, display_name, sort_order
    ) values (
      '7f000000-0000-7000-8000-000000000001',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001',
      '73410000-0000-7000-8000-000000000001',
      'DEPARTMENT',
      '72000000-0000-7000-8000-000000000001',
      '72100000-0000-7000-8000-000000000001',
      '重复科室', 99
    )
  `);

  checks['crossViewVersionParentRejected'] = await expectSqlState(client, '23503', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, parent_node_id, node_kind,
      department_hierarchy_group_id, department_hierarchy_group_version_id,
      display_name, sort_order
    ) values (
      '7f000000-0000-7000-8000-000000000002',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001',
      '73420000-0000-7000-8000-000000000001',
      'GROUP',
      '7f100000-0000-7000-8000-000000000001',
      '7f110000-0000-7000-8000-000000000001',
      '跨版本父节点探针', 99
    );
    set constraints all immediate
  `);

  checks['mixedDepartmentGroupReferenceRejected'] = await expectSqlState(client, '23514', `
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, parent_node_id, node_kind,
      department_id, department_version_id,
      department_hierarchy_group_id, department_hierarchy_group_version_id,
      display_name, sort_order
    ) values (
      '7f000000-0000-7000-8000-000000000003',
      '73100000-0000-7000-8000-000000000001',
      '73000000-0000-7000-8000-000000000001', null, 'GROUP',
      '72000000-0000-7000-8000-000000000001',
      '72100000-0000-7000-8000-000000000001',
      '73200000-0000-7000-8000-000000000001',
      '73300000-0000-7000-8000-000000000001',
      '混合引用探针', 99
    )
  `);

  await client.query('savepoint cycle_probe');
  await client.query(`
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, parent_node_id, node_kind,
      department_hierarchy_group_id, department_hierarchy_group_version_id,
      display_name, sort_order
    ) values
      (
        '7f000000-0000-7000-8000-000000000004',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001',
        '7f000000-0000-7000-8000-000000000005', 'GROUP',
        '7f100000-0000-7000-8000-000000000001',
        '7f110000-0000-7000-8000-000000000001', '循环探针A', 99
      ),
      (
        '7f000000-0000-7000-8000-000000000005',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001',
        '7f000000-0000-7000-8000-000000000004', 'GROUP',
        '7f100000-0000-7000-8000-000000000002',
        '7f110000-0000-7000-8000-000000000002', '循环探针B', 100
      )
  `);
  try {
    await client.query('set constraints all immediate');
    checks['cycleRejected'] = false;
  } catch (error) {
    checks['cycleRejected'] = sqlState(error) === '23514';
  }
  await client.query('rollback to savepoint cycle_probe');

  await client.query('savepoint forest_probe');
  await client.query(`
    insert into department_master.department_hierarchy_node (
      department_hierarchy_node_id, department_hierarchy_view_version_id,
      department_hierarchy_view_id, parent_node_id, node_kind,
      department_hierarchy_group_id, department_hierarchy_group_version_id,
      display_name, sort_order
    ) values
      (
        '7f000000-0000-7000-8000-000000000006',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001', null, 'GROUP',
        '7f100000-0000-7000-8000-000000000001',
        '7f110000-0000-7000-8000-000000000001', '森林根A', 99
      ),
      (
        '7f000000-0000-7000-8000-000000000007',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001', null, 'GROUP',
        '7f100000-0000-7000-8000-000000000002',
        '7f110000-0000-7000-8000-000000000002', '森林根B', 100
      );
    set constraints all immediate
  `);
  checks['multipleRootsAllowed'] = true;
  await client.query('rollback to savepoint forest_probe');

  const catalog = await client.query(`
    select
      not exists (
        select 1
        from information_schema.columns
        where table_schema = 'department_master'
          and table_name = 'department_version'
          and column_name in ('parent_department_id', 'hierarchy_level', 'tree_path')
      ) as no_generic_parent,
      not exists (
        select 1
        from information_schema.columns
        where table_schema = 'department_master'
          and data_type in ('timestamp with time zone', 'time with time zone')
      ) as local_datetime_only,
      not exists (
        select 1
        from information_schema.tables as tables
        where tables.table_schema = 'department_master'
          and tables.table_type = 'BASE TABLE'
          and (
            not exists (
              select 1 from information_schema.columns
              where table_schema = tables.table_schema
                and table_name = tables.table_name
                and column_name = 'created_at'
            )
            or not exists (
              select 1 from information_schema.columns
              where table_schema = tables.table_schema
                and table_name = tables.table_name
                and column_name = 'updated_at'
            )
          )
      ) as all_tables_have_audit_times,
      (
        select count(distinct parent_node_id)::int = 3
        from department_master.department_hierarchy_node
        where node_kind = 'DEPARTMENT'
          and department_id = '72000000-0000-7000-8000-000000000001'
          and department_hierarchy_view_version_id in (
            '73100000-0000-7000-8000-000000000001'::uuid,
            '73100000-0000-7000-8000-000000000002'::uuid,
            '73100000-0000-7000-8000-000000000003'::uuid
          )
      ) as independent_view_placements,
      (
        select count(*)::int = 9
        from department_master.department_hierarchy_node as node
        inner join department_master.department_version as version
          on version.department_version_id = node.department_version_id
          and version.department_id = node.department_id
        where node.node_kind = 'DEPARTMENT'
          and node.display_name = version.standard_name
          and node.department_hierarchy_view_version_id in (
            '73100000-0000-7000-8000-000000000001'::uuid,
            '73100000-0000-7000-8000-000000000002'::uuid,
            '73100000-0000-7000-8000-000000000003'::uuid
          )
      ) as frozen_names_and_versions
  `);
  Object.assign(checks, catalog.rows[0]);
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error('DEPARTMENT_CONSTRAINT_PROBE_FAILED');
  }
  await client.query('rollback');
  process.stdout.write(`${JSON.stringify({ status: 'PASSED', checks })}\n`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: error instanceof Error ? error.message : 'DEPARTMENT_CONSTRAINT_PROBE_FAILED',
    checks,
  })}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

async function expectSqlState(
  client: pg.PoolClient,
  expected: string,
  query: string,
): Promise<boolean> {
  await client.query('savepoint negative_probe');
  try {
    await client.query(query);
    return false;
  } catch (error) {
    return sqlState(error) === expected;
  } finally {
    await client.query('rollback to savepoint negative_probe');
  }
}

function sqlState(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return null;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
