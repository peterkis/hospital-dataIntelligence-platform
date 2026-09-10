BEGIN;

CREATE OR REPLACE FUNCTION person_master.guard_engagement_lifecycle_end_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous person_master.engagement_version;
BEGIN
  IF NEW.revision_reason_code IS DISTINCT FROM 'LIFECYCLE_END' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO previous
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id
  ORDER BY version_no DESC
  LIMIT 1;
  IF previous.engagement_version_id IS NULL
     OR NEW.business_valid_from IS DISTINCT FROM previous.business_valid_from
     OR NEW.business_valid_to IS NULL
     OR NEW.business_valid_to <= NEW.business_valid_from
     OR (previous.business_valid_to IS NOT NULL
       AND NEW.business_valid_to > previous.business_valid_to) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_END_VERSION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM person_master.engagement_lifecycle_event
    WHERE engagement_id = NEW.engagement_id
      AND business_effective_at >= NEW.business_valid_to
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_END_EVENT_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION person_master.guard_engagement_lifecycle_end_version() IS
  'Accepts ordinary/V1 version rows unchanged. LIFECYCLE_END must shorten one continuous relation period and cannot strand same-time or future lifecycle evidence.';

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0026_person_engagement_lifecycle_guard_correction');

COMMIT;
