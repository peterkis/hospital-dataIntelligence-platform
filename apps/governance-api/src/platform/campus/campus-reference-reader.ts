import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../database/database-types.generated.js';

export interface CampusReferenceReader {
  getDisplayNames(campusIds: readonly string[]): Promise<readonly string[]>;
  getReferences(campusIds: readonly string[]): Promise<readonly CampusReference[]>;
}

export interface CampusReference {
  readonly campusId: string;
  readonly campusCode: string;
  readonly displayName: string;
}

export function createCampusReferenceReader(
  database: Kysely<DB> | Transaction<DB>,
): CampusReferenceReader {
  async function getReferences(campusIds: readonly string[]): Promise<readonly CampusReference[]> {
    if (campusIds.length === 0) return [];
    const rows = await database
      .selectFrom('platform.campus')
      .select(['campus_id', 'campus_code', 'display_name'])
      .where('campus_id', 'in', [...campusIds])
      .orderBy('campus_code')
      .execute();
    if (rows.length !== new Set(campusIds).size) {
      throw new Error('DEPARTMENT_PROJECTION_CAMPUS_REFERENCE_NOT_FOUND');
    }
    return rows.map((row) => ({
      campusId: row.campus_id,
      campusCode: row.campus_code,
      displayName: row.display_name,
    }));
  }

  return {
    async getDisplayNames(campusIds) {
      return (await getReferences(campusIds)).map((reference) => reference.displayName);
    },
    getReferences,
  };
}
