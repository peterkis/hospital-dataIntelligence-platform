import pg from 'pg';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

const principals = [
  [PROTOTYPE_FIXTURE.actorPrincipalId, 'PROTOTYPE-SYNTHETIC-STEWARD'],
  [PROTOTYPE_FIXTURE.reviewerPrincipalId, 'PROTOTYPE-SYNTHETIC-PROFESSIONAL-REVIEWER'],
  [PROTOTYPE_FIXTURE.approverPrincipalId, 'PROTOTYPE-SYNTHETIC-OWNER-APPROVER'],
] as const;

const permissions = [
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_DRAFT_READ'],
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_DRAFT_WRITE'],
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_SUBMIT'],
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.reviewerPrincipalId, 'CHARGE_CATALOG_REVIEW'],
  [PROTOTYPE_FIXTURE.chargeCatalogObjectId, PROTOTYPE_FIXTURE.approverPrincipalId, 'CHARGE_CATALOG_APPROVE'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_DRAFT_READ'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_DRAFT_WRITE'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_SUBMIT'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_RESOLVE'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.reviewerPrincipalId, 'PRICE_LIST_REVIEW'],
  [PROTOTYPE_FIXTURE.priceListObjectId, PROTOTYPE_FIXTURE.approverPrincipalId, 'PRICE_LIST_APPROVE'],
] as const;

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-synthetic-seed',
  max: 1,
});
let client: pg.PoolClient | undefined;

try {
  client = await pool.connect();
  await client.query('begin');
  const migrationState = await client.query(
    "select to_regclass('platform.schema_migration') is not null as exists",
  );
  if (migrationState.rows[0]?.exists !== true) throw new Error('PROTOTYPE_MIGRATIONS_REQUIRED');

  let insertedPrincipalCount = 0;
  for (const [principalId, principalCode] of principals) {
    const inserted = await client.query(
      `
        insert into platform.security_principal (
          security_principal_id, principal_code, principal_kind
        ) values ($1::uuid, $2::varchar(128), 'PERSON')
        on conflict (security_principal_id) do nothing
      `,
      [principalId, principalCode],
    );
    insertedPrincipalCount += inserted.rowCount ?? 0;
  }

  const service = await client.query(`
    insert into platform.security_principal (
      security_principal_id, principal_code, principal_kind, status
    ) values ($1::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-CONSUMER', 'SERVICE', 'ACTIVE')
    on conflict (security_principal_id) do nothing
  `, [PROTOTYPE_FIXTURE.serviceConsumerPrincipalId]);
  insertedPrincipalCount += service.rowCount ?? 0;
  const serviceCheck = await client.query(`
    select exists(select 1 from platform.security_principal
      where security_principal_id = $1::uuid
        and principal_code = 'PROTOTYPE-SYNTHETIC-DEPARTMENT-CONSUMER'
        and principal_kind = 'SERVICE' and status = 'ACTIVE') as valid
  `, [PROTOTYPE_FIXTURE.serviceConsumerPrincipalId]);
  if (serviceCheck.rows[0]?.valid !== true) throw new Error('PROTOTYPE_SERVICE_SEED_INVALID');

  const campus = await client.query(
    `
      insert into platform.campus (campus_id, campus_code, display_name)
      values (
        $1::uuid,
        'PROTOTYPE-SYNTHETIC-CAMPUS',
        'PROTOTYPE SYNTHETIC CAMPUS'
      )
      on conflict (campus_id) do nothing
    `,
    [PROTOTYPE_FIXTURE.campusId],
  );

  const governanceObjects = [
    [
      PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      'PROTOTYPE-SYNTHETIC-CHARGE-CATALOG',
      'CHARGE_CATALOG',
      'PROTOTYPE SYNTHETIC CHARGE CATALOG',
    ],
    [
      PROTOTYPE_FIXTURE.priceListObjectId,
      'PROTOTYPE-SYNTHETIC-PRICE-LIST',
      'PRICE_LIST',
      'PROTOTYPE SYNTHETIC PRICE LIST',
    ],
  ] as const;
  let insertedGovernanceObjectCount = 0;
  for (const [id, code, type, displayName] of governanceObjects) {
    const inserted = await client.query(
      `
        insert into platform.governance_object (
          governance_object_id, object_code, object_type, display_name, created_by
        ) values ($1::uuid, $2::varchar(128), $3::varchar(32), $4::varchar(256), $5::uuid)
        on conflict (governance_object_id) do nothing
      `,
      [id, code, type, displayName, PROTOTYPE_FIXTURE.actorPrincipalId],
    );
    insertedGovernanceObjectCount += inserted.rowCount ?? 0;
  }

  let insertedPermissionCount = 0;
  for (const [governanceObjectId, principalId, permissionCode] of permissions) {
    const inserted = await client.query(
      `
        insert into access_control.object_permission_grant (
          governance_object_id, security_principal_id, permission_code, grant_effect,
          valid_from, valid_to, grant_sequence, granted_by, reason,
          scope_level, campus_id
        ) values (
          $1::uuid, $2::uuid, $3::varchar(64), 'ALLOW',
          '2026-01-01 00:00:00', null, 1, $4::uuid,
          'PROTOTYPE SYNTHETIC MINIMUM PERMISSION', 'HOSPITAL', null
        )
        on conflict (
          governance_object_id, security_principal_id, permission_code, grant_sequence
        ) do nothing
      `,
      [governanceObjectId, principalId, permissionCode, PROTOTYPE_FIXTURE.actorPrincipalId],
    );
    insertedPermissionCount += inserted.rowCount ?? 0;
  }

  await verifyFixture(client);
  await client.query('commit');
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    seedIdempotent: insertedPrincipalCount === 0 && campus.rowCount === 0 &&
      insertedGovernanceObjectCount === 0 && insertedPermissionCount === 0,
    inserted: {
      principals: insertedPrincipalCount,
      campuses: campus.rowCount ?? 0,
      governanceObjects: insertedGovernanceObjectCount,
      permissions: insertedPermissionCount,
    },
    fixtureIds: PROTOTYPE_FIXTURE,
  })}\n`);
} catch (error) {
  await client?.query('rollback').catch(() => undefined);
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    rolledBack: true,
    errorCode: safeErrorCode(error, 'PROTOTYPE_SEED_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}

async function verifyFixture(client: pg.PoolClient): Promise<void> {
  const result = await client.query(
    `
      select
        (select count(*)::int from platform.security_principal
          where (security_principal_id, principal_code) in (
            ($1::uuid, 'PROTOTYPE-SYNTHETIC-STEWARD'),
            ($2::uuid, 'PROTOTYPE-SYNTHETIC-PROFESSIONAL-REVIEWER'),
            ($3::uuid, 'PROTOTYPE-SYNTHETIC-OWNER-APPROVER')
          ) and principal_kind = 'PERSON' and status = 'ACTIVE') as principals,
        (select count(*)::int from platform.campus
          where campus_id = $4::uuid
            and campus_code = 'PROTOTYPE-SYNTHETIC-CAMPUS'
            and display_name = 'PROTOTYPE SYNTHETIC CAMPUS') as campuses,
        (select count(*)::int from platform.governance_object
          where governance_object_id in ($5::uuid, $6::uuid)
            and object_code like 'PROTOTYPE-SYNTHETIC-%'
            and display_name like 'PROTOTYPE SYNTHETIC %') as governance_objects,
        (select count(*)::int from access_control.object_permission_grant
          where grant_sequence = 1 and grant_effect = 'ALLOW'
            and reason = 'PROTOTYPE SYNTHETIC MINIMUM PERMISSION'
            and (governance_object_id, security_principal_id, permission_code) in (
              select * from unnest($7::uuid[], $8::uuid[], $9::varchar[])
            )) as permissions
    `,
    [
      PROTOTYPE_FIXTURE.actorPrincipalId,
      PROTOTYPE_FIXTURE.reviewerPrincipalId,
      PROTOTYPE_FIXTURE.approverPrincipalId,
      PROTOTYPE_FIXTURE.campusId,
      PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      PROTOTYPE_FIXTURE.priceListObjectId,
      permissions.map(([objectId]) => objectId),
      permissions.map(([, principalId]) => principalId),
      permissions.map(([, , permissionCode]) => permissionCode),
    ],
  );
  const observed = result.rows[0];
  if (
    observed?.principals !== principals.length ||
    observed?.campuses !== 1 ||
    observed?.governance_objects !== 2 ||
    observed?.permissions !== permissions.length
  ) {
    throw new Error('PROTOTYPE_SEED_VERIFICATION_FAILED');
  }
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
