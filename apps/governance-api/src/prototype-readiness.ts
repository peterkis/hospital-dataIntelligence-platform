import { readdir } from 'node:fs/promises';
import { sql, type Kysely } from 'kysely';
import type { DB } from './platform/database/database-types.generated.js';
import { PROTOTYPE_FIXTURE, PROTOTYPE_PRINCIPALS } from './prototype-fixture.js';

const EXPECTED_PERMISSIONS = [
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

export interface PrototypeDatabaseReadiness {
  readonly postgresqlVersion: string;
  readonly migrationCount: number;
  readonly syntheticPrincipalCount: number;
}

export async function assertPrototypeDatabaseReady(
  database: Kysely<DB>,
  migrationDirectory: string,
): Promise<PrototypeDatabaseReadiness> {
  const version = await database
    .selectNoFrom(sql<string>`version()`.as('version'))
    .executeTakeFirstOrThrow();
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  const appliedMigrations = await database
    .selectFrom('platform.schema_migration')
    .select('migration_id')
    .execute();
  const appliedIds = new Set(appliedMigrations.map((migration) => migration.migration_id));
  if (!migrationFiles.every((name) => appliedIds.has(name.replace(/\.sql$/u, '')))) {
    throw new Error('PROTOTYPE_MIGRATIONS_INCOMPLETE');
  }

  const principalIds = PROTOTYPE_PRINCIPALS.map((principal) => principal.principalId);
  const principals = await database
    .selectFrom('platform.security_principal')
    .select(['security_principal_id', 'principal_code', 'principal_kind', 'status'])
    .where('security_principal_id', 'in', principalIds)
    .execute();
  const principalById = new Map(
    principals.map((principal) => [principal.security_principal_id, principal]),
  );
  for (const expected of PROTOTYPE_PRINCIPALS) {
    const principal = principalById.get(expected.principalId);
    if (
      principal?.principal_code !== expected.principalCode ||
      principal.principal_kind !== 'PERSON' ||
      principal.status !== 'ACTIVE'
    ) {
      throw new Error('PROTOTYPE_SYNTHETIC_SEED_MISSING');
    }
  }

  const campus = await database
    .selectFrom('platform.campus')
    .select(['campus_code', 'display_name', 'status'])
    .where('campus_id', '=', PROTOTYPE_FIXTURE.campusId)
    .executeTakeFirst();
  if (
    campus?.campus_code !== 'PROTOTYPE-SYNTHETIC-CAMPUS' ||
    campus.display_name !== 'PROTOTYPE SYNTHETIC CAMPUS' ||
    campus.status !== 'ACTIVE'
  ) {
    throw new Error('PROTOTYPE_SYNTHETIC_SEED_MISSING');
  }

  const objectIds = [
    PROTOTYPE_FIXTURE.chargeCatalogObjectId,
    PROTOTYPE_FIXTURE.priceListObjectId,
  ];
  const governanceObjects = await database
    .selectFrom('platform.governance_object')
    .select(['governance_object_id', 'object_code', 'object_type', 'status'])
    .where('governance_object_id', 'in', objectIds)
    .execute();
  const expectedObjects = new Set([
    `${PROTOTYPE_FIXTURE.chargeCatalogObjectId}|PROTOTYPE-SYNTHETIC-CHARGE-CATALOG|CHARGE_CATALOG|ACTIVE`,
    `${PROTOTYPE_FIXTURE.priceListObjectId}|PROTOTYPE-SYNTHETIC-PRICE-LIST|PRICE_LIST|ACTIVE`,
  ]);
  if (
    governanceObjects.length !== expectedObjects.size ||
    governanceObjects.some((object) => !expectedObjects.has(
      `${object.governance_object_id}|${object.object_code}|${object.object_type}|${object.status}`,
    ))
  ) {
    throw new Error('PROTOTYPE_SYNTHETIC_SEED_MISSING');
  }

  const grants = await database
    .selectFrom('access_control.object_permission_grant')
    .select([
      'governance_object_id',
      'security_principal_id',
      'permission_code',
      'grant_effect',
      'grant_sequence',
      'reason',
      'scope_level',
      'campus_id',
    ])
    .where('governance_object_id', 'in', objectIds)
    .where('security_principal_id', 'in', principalIds)
    .where('grant_sequence', '=', '1')
    .execute();
  const activeGrantKeys = new Set(
    grants
      .filter((grant) =>
        grant.grant_effect === 'ALLOW' &&
        grant.reason === 'PROTOTYPE SYNTHETIC MINIMUM PERMISSION' &&
        grant.scope_level === 'HOSPITAL' &&
        grant.campus_id === null)
      .map((grant) =>
        `${grant.governance_object_id}|${grant.security_principal_id}|${grant.permission_code}`),
  );
  if (EXPECTED_PERMISSIONS.some((permission) => !activeGrantKeys.has(permission.join('|')))) {
    throw new Error('PROTOTYPE_SYNTHETIC_SEED_MISSING');
  }

  return {
    postgresqlVersion: version.version,
    migrationCount: migrationFiles.length,
    syntheticPrincipalCount: principals.length,
  };
}
