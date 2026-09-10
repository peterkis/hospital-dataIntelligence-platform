import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';

export async function assignmentSemanticDatabaseIdentity(database: Kysely<DB>) {
  return (await sql<{ database: string; oid: string; role: string; address: string; port: number; startedAt: string; migrations: number }>`
    select current_database() as database,(select oid::text from pg_database where datname=current_database()) as oid,
      current_user as role,inet_server_addr()::text as address,inet_server_port() as port,
      pg_postmaster_start_time()::text as "startedAt",(select count(*)::int from platform.schema_migration) as migrations
  `.execute(database)).rows[0]!;
}

export async function assignmentSemanticRecoveryFingerprint(database: Kysely<DB>, ids: readonly string[], requests: readonly string[]) {
  return (await sql<{ count: number; digest: string }>`select count(*)::int as count,
    encode(digest(string_agg(j,'' order by kind,j),'sha256'),'hex') as digest from (
      select 'core' as kind,to_jsonb(v)::text as j from person_master.assignment_version v where assignment_version_id=any(${ids}::uuid[])
      union all select 'stable',to_jsonb(a)::text from person_master.assignment a where assignment_id in
        (select assignment_id from person_master.assignment_version where assignment_version_id=any(${ids}::uuid[]))
      union all select 'segments',to_jsonb(s)::text from person_master.assignment_validation_segment s where assignment_version_id=any(${ids}::uuid[])
      union all select 'semantics',to_jsonb(s)::text from person_master.assignment_version_semantics s where assignment_version_id=any(${ids}::uuid[])
      union all select 'definitions',to_jsonb(d)::text from person_master.assignment_semantic_term_version d where term_version_id in
        (select purpose_term_version_id from person_master.assignment_version_semantics where assignment_version_id=any(${ids}::uuid[])
         union select mode_term_version_id from person_master.assignment_version_semantics where assignment_version_id=any(${ids}::uuid[]))
      union all select 'outcome',to_jsonb(o)::text from person_master.assignment_command_outcome o where assignment_version_id=any(${ids}::uuid[])
      union all select 'audit',to_jsonb(a)::text from audit.audit_event a where request_id=any(${requests}::text[])
    ) rows`.execute(database)).rows[0]!;
}
