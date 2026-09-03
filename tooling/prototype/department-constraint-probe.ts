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

  checks['immutableVersionContentRejected'] = await expectSqlState(client, '55000', `
    update department_master.department_version
    set standard_name = '禁止覆盖'
    where department_version_id = '72100000-0000-7000-8000-000000000001'
  `);

  await client.query('savepoint record_closure_probe');
  await client.query(`
    update department_master.department_version
    set recorded_to = '2026-10-01 00:00:00',
        updated_at = platform.local_now(),
        updated_by = '70000000-0000-7000-8000-000000000001'
    where department_version_id = '72100000-0000-7000-8000-000000000001'
  `);
  checks['recordPeriodClosureAllowed'] = true;
  await client.query('rollback to savepoint record_closure_probe');

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
      '73200000-0000-7000-8000-000000000001',
      '73300000-0000-7000-8000-000000000001',
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
        '73200000-0000-7000-8000-000000000001',
        '73300000-0000-7000-8000-000000000001', '循环探针A', 99
      ),
      (
        '7f000000-0000-7000-8000-000000000005',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001',
        '7f000000-0000-7000-8000-000000000004', 'GROUP',
        '73200000-0000-7000-8000-000000000001',
        '73300000-0000-7000-8000-000000000001', '循环探针B', 100
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
        '73200000-0000-7000-8000-000000000001',
        '73300000-0000-7000-8000-000000000001', '森林根A', 99
      ),
      (
        '7f000000-0000-7000-8000-000000000007',
        '73100000-0000-7000-8000-000000000001',
        '73000000-0000-7000-8000-000000000001', null, 'GROUP',
        '73200000-0000-7000-8000-000000000001',
        '73300000-0000-7000-8000-000000000001', '森林根B', 100
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
      ) as independent_view_placements,
      (
        select count(*)::int = 9
        from department_master.department_hierarchy_node as node
        inner join department_master.department_version as version
          on version.department_version_id = node.department_version_id
          and version.department_id = node.department_id
        where node.node_kind = 'DEPARTMENT'
          and node.display_name = version.standard_name
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
