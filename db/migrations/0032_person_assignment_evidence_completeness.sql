BEGIN;

-- The C-01 rollback-only negative probe exposed SQL CHECK's NULL result.
-- Preserve applied 0031 and require an explicitly complete non-null classification.
ALTER TABLE person_master.assignment_version
  ADD CONSTRAINT assignment_classification_evidence_complete CHECK (
    (classification_type_version_id IS NULL AND classification_type_version_no IS NULL
      AND classification_type_code IS NULL AND classification_category_code IS NULL AND classified_at IS NULL)
    OR
    (classification_type_version_id IS NOT NULL AND classification_type_version_no IS NOT NULL
      AND classification_type_version_no > 0 AND classification_type_code IS NOT NULL
      AND classification_category_code IS NOT NULL AND classified_at IS NOT NULL
      AND isfinite(classified_at) AND classified_at <= evaluation_record_as_of)
  ),
  ADD CONSTRAINT assignment_authority_times_finite CHECK (
    isfinite(authority_engagement_recorded_from) AND isfinite(authority_engagement_valid_from)
    AND (authority_engagement_valid_to IS NULL OR
      (isfinite(authority_engagement_valid_to) AND authority_engagement_valid_to > authority_engagement_valid_from))
    AND isfinite(department_recorded_from) AND isfinite(department_published_at) AND isfinite(department_valid_from)
    AND (department_recorded_to IS NULL OR isfinite(department_recorded_to))
    AND (department_valid_to IS NULL OR (isfinite(department_valid_to) AND department_valid_to > department_valid_from))
  );

INSERT INTO platform.schema_migration (migration_id) VALUES ('0032_person_assignment_evidence_completeness');
COMMIT;
