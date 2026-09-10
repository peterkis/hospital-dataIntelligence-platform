import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { AuthorizationModule } from '../authorization/index.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';

export interface DepartmentPlacementReferenceQuery {
  readonly departmentGovernanceObjectId: string;
  readonly departmentId: string;
  readonly recordAsOf: string;
}
export interface DepartmentPlacementReference extends DepartmentPlacementReferenceQuery {
  readonly semanticRole: 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE';
  readonly departmentVersionId: string;
  readonly versionNo: string;
  readonly contentHash: string;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly releaseId: string;
  readonly publicationProjectionId: string;
  readonly publishedAt: string;
  readonly businessStatus: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface DepartmentPlacementReferenceReader {
  getDepartmentPlacementReferenceAsOf(query: DepartmentPlacementReferenceQuery): Promise<DepartmentPlacementReference>;
}

/** Composition-only scoped reader; no writer or database handle escapes. */
export function createDepartmentPlacementReferenceScope(database: Transaction<DB>,
  authorization: AuthorizationModule,
  requireScope: (objectId: string) => Promise<void>,
): DepartmentPlacementReferenceReader & {
  pinDepartment(query: Omit<DepartmentPlacementReferenceQuery, 'recordAsOf'>): Promise<void>;
} {
  async function authorize(query: Omit<DepartmentPlacementReferenceQuery, 'recordAsOf'>) {
    for (const id of [query.departmentGovernanceObjectId, query.departmentId])
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id))
        throw new Error('ASSIGNMENT_PLACEMENT_ID_INVALID');
    await requireScope(query.departmentGovernanceObjectId);
    await authorization.requireObjectPermission({ governanceObjectId: query.departmentGovernanceObjectId,
      permissionCode: 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ' });
    const row = await database.selectFrom('department_master.department as d')
      .select('d.department_id').where('d.department_id', '=', query.departmentId)
      .where('d.governance_object_id', '=', query.departmentGovernanceObjectId).executeTakeFirst();
    if (!row) throw new Error('ASSIGNMENT_PLACEMENT_NOT_FOUND');
  }
  return {
    async pinDepartment(query) {
      await authorize(query);
      // This is the row that confirmDepartmentPublication locks and closes.
      const rows = await database.selectFrom('department_master.department_version').select('department_version_id')
        .where('department_id', '=', query.departmentId).where('governance_status', '=', 'PUBLISHED')
        .where('recorded_to', 'is', null).orderBy('department_version_id').limit(2).forShare().execute();
      // READ COMMITTED may have waited across a publication. Never use the old candidate.
      const fresh = await database.selectFrom('department_master.department_version').select('department_version_id')
        .where('department_id', '=', query.departmentId).where('governance_status', '=', 'PUBLISHED')
        .where('recorded_to', 'is', null).limit(2).execute();
      if (rows.length === 0 && fresh.length === 0) throw new Error('ASSIGNMENT_PLACEMENT_UNPUBLISHED');
      if (rows.length > 1 || fresh.length > 1) throw new Error('ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED');
      if (rows.length !== 1 || fresh.length !== 1 || fresh[0]!.department_version_id !== rows[0]!.department_version_id)
        throw new Error('DEPENDENCY_CHANGED_DURING_VALIDATION');
    },
    async getDepartmentPlacementReferenceAsOf(query) {
      if (Object.keys(query).some(k => !['departmentGovernanceObjectId', 'departmentId', 'recordAsOf'].includes(k)))
        throw new Error('ASSIGNMENT_INPUT_INVALID');
      parseLocalDateTime(query.recordAsOf);
      await authorize(query);
      const rows = (await sql<{ department_version_id: string; version_no: string; content_hash: string;
        recorded_from: string; recorded_to: string | null; release_id: string; publication_id: string;
        published_at: string; business_status: string; business_valid_from: string; business_valid_to: string | null }>`
        select v.department_version_id, v.version_no::text, encode(v.content_hash,'hex') as content_hash,
          v.recorded_from,v.recorded_to,v.release_id,p.department_published_projection_id as publication_id,
          p.published_at,v.business_status,v.business_valid_from,v.business_valid_to
        from department_master.department_version v
        join department_master.department_published_projection p
          on p.department_version_id=v.department_version_id and p.department_id=v.department_id
          and p.published_release_id=v.release_id
        where v.department_id=${query.departmentId}::uuid and v.governance_status='PUBLISHED'
          and v.recorded_from <= ${query.recordAsOf}::timestamp
          and (v.recorded_to is null or ${query.recordAsOf}::timestamp < v.recorded_to)
          and p.published_at <= ${query.recordAsOf}::timestamp and p.created_at <= ${query.recordAsOf}::timestamp
        limit 2
      `.execute(database)).rows;
      if (rows.length !== 1) throw new Error(rows.length ? 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED' : 'ASSIGNMENT_PLACEMENT_UNPUBLISHED');
      const r = rows[0]!;
      return { ...query, semanticRole: 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE',
        departmentVersionId: r.department_version_id, versionNo: r.version_no, contentHash: r.content_hash,
        recordedFrom: r.recorded_from, recordedTo: r.recorded_to, releaseId: r.release_id,
        publicationProjectionId: r.publication_id, publishedAt: r.published_at, businessStatus: r.business_status,
        businessValidFrom: r.business_valid_from, businessValidTo: r.business_valid_to };
    },
  };
}
