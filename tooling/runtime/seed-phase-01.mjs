import { decodeJwt } from 'jose';
import pg from 'pg';

const issuerUrl = requireEnvironment('KEYCLOAK_ISSUER_URL').replace(/\/$/u, '');
const ownerSubject = '10000000-0000-7000-8000-000000000001';
const consumerASubject = await obtainServiceSubject(
  'hdi-sim-consumer-a',
  requireEnvironment('HDI_SIM_CONSUMER_A_CLIENT_SECRET'),
);
const consumerBSubject = await obtainServiceSubject(
  'hdi-sim-consumer-b',
  requireEnvironment('HDI_SIM_CONSUMER_B_CLIENT_SECRET'),
);

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-phase01-seed',
  max: 1,
});
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query(
    `
      insert into platform.security_principal (
        security_principal_id, principal_code, principal_kind
      ) values
        ('40000000-0000-7000-8000-000000000001', 'phase01-owner', 'PERSON'),
        ('40000000-0000-7000-8000-000000000002', 'phase01-sim-consumer-a', 'SERVICE'),
        ('40000000-0000-7000-8000-000000000003', 'phase01-sim-consumer-b', 'SERVICE')
      on conflict (security_principal_id) do nothing
    `,
  );
  for (const binding of [
    [ownerSubject, null, 'PERSON', '40000000-0000-7000-8000-000000000001'],
    [consumerASubject, 'hdi-sim-consumer-a', 'SERVICE', '40000000-0000-7000-8000-000000000002'],
    [consumerBSubject, 'hdi-sim-consumer-b', 'SERVICE', '40000000-0000-7000-8000-000000000003'],
  ]) {
    await client.query(
      `
        insert into platform.external_identity_binding (
          issuer_url, external_subject, external_client_id, binding_kind,
          security_principal_id, binding_sequence, status
        ) values ($1, $2, $3, $4, $5, 1, 'ACTIVE')
        on conflict (issuer_url, external_subject, binding_sequence) do nothing
      `,
      [issuerUrl, ...binding],
    );
  }
  await client.query(
    `
      insert into platform.campus (campus_id, campus_code, display_name)
      values ('50000000-0000-7000-8000-000000000001', 'MAIN', 'Phase 01合成主院区')
      on conflict (campus_id) do nothing;

      insert into platform.governance_object (
        governance_object_id, object_code, object_type, display_name, created_by
      ) values
        (
          '60000000-0000-7000-8000-000000000001',
          'PHASE01-CHARGE-CATALOG', 'CHARGE_CATALOG', 'Phase 01收费项目目录',
          '40000000-0000-7000-8000-000000000001'
        ),
        (
          '60000000-0000-7000-8000-000000000002',
          'PHASE01-PRICE-LIST', 'PRICE_LIST', 'Phase 01价表',
          '40000000-0000-7000-8000-000000000001'
        )
      on conflict (governance_object_id) do nothing
    `,
  );
  const permissions = [
    ['60000000-0000-7000-8000-000000000001', 'CHARGE_CATALOG_PUBLISH'],
    ['60000000-0000-7000-8000-000000000002', 'PRICE_LIST_PUBLISH'],
    ['60000000-0000-7000-8000-000000000002', 'PRICE_RESOLVE'],
    ['60000000-0000-7000-8000-000000000002', 'CONSUMER_SUBSCRIPTION_MANAGE'],
  ];
  for (const [governanceObjectId, permissionCode] of permissions) {
    await client.query(
      `
        insert into access_control.object_permission_grant (
          governance_object_id, security_principal_id, permission_code, grant_effect,
          valid_from, valid_to, grant_sequence, granted_by, reason
        )
        select $1::uuid, '40000000-0000-7000-8000-000000000001', $2::varchar(64), 'ALLOW',
               '2026-08-08 00:00:00', null, 1,
               '40000000-0000-7000-8000-000000000001', 'Phase 01受控合成种子'
        where not exists (
          select 1 from access_control.object_permission_grant
          where governance_object_id = $1::uuid
            and security_principal_id = '40000000-0000-7000-8000-000000000001'
            and permission_code = $2::varchar(64)
            and grant_sequence = 1
        )
      `,
      [governanceObjectId, permissionCode],
    );
  }
  await client.query('commit');
  process.stdout.write(
    `${JSON.stringify({ ownerSubject, consumerASubject, consumerBSubject })}\n`,
  );
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function obtainServiceSubject(clientId, clientSecret) {
  const response = await fetch(`${issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) throw new Error(`KEYCLOAK_SERVICE_TOKEN_HTTP_${response.status}`);
  const tokenSet = await response.json();
  if (typeof tokenSet.access_token !== 'string') throw new Error('KEYCLOAK_ACCESS_TOKEN_REQUIRED');
  const payload = decodeJwt(tokenSet.access_token);
  if (typeof payload.sub !== 'string' || !/^[0-9a-f-]{36}$/u.test(payload.sub)) {
    throw new Error('KEYCLOAK_SERVICE_SUBJECT_INVALID');
  }
  return payload.sub;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
