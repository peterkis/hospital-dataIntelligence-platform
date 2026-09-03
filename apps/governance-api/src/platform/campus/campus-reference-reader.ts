import type { Transaction } from 'kysely';
import type { DB } from '../database/database-types.generated.js';

export interface CampusReferenceReader {
  getDisplayNames(campusIds: readonly string[]): Promise<readonly string[]>;
}

export function createCampusReferenceReader(
  database: Transaction<DB>,
): CampusReferenceReader {
  return {
    async getDisplayNames(campusIds) {
      if (campusIds.length === 0) return [];
      const rows = await database
        .selectFrom('platform.campus')
        .select(['campus_id', 'display_name'])
        .where('campus_id', 'in', [...campusIds])
        .orderBy('campus_code')
        .execute();
      if (rows.length !== new Set(campusIds).size) {
        throw new Error('DEPARTMENT_PROJECTION_CAMPUS_REFERENCE_NOT_FOUND');
      }
      return rows.map((row) => row.display_name);
    },
  };
}
