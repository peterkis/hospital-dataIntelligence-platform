import type { Selectable } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';

type VersionRow = Selectable<DB['person_master.assignment_version']>;
const REQUIRED = ['validation_policy_code', 'evaluation_record_as_of', 'authority_engagement_version_id', 'authority_engagement_version_no',
  'authority_engagement_recorded_from', 'authority_engagement_valid_from', 'record_visible_lifecycle_sequence', 'department_version_id',
  'department_version_no', 'department_content_hash', 'department_recorded_from', 'department_release_id', 'department_publication_projection_id',
  'department_published_at', 'department_business_status', 'department_valid_from', 'dependency_fingerprint'] as const;
type AdmissionRow = VersionRow & { [Column in typeof REQUIRED[number]]: NonNullable<VersionRow[Column]> };

/** SQL's mutually exclusive branch is checked again before constructing the legacy JSON shape. */
export function assertAssignmentAdmissionRow(row: VersionRow): asserts row is AdmissionRow {
  if (row.evidence_kind !== 'ADMISSION' || REQUIRED.some(column => row[column] === null))
    throw new Error('ASSIGNMENT_ADMISSION_EVIDENCE_INVALID');
}
