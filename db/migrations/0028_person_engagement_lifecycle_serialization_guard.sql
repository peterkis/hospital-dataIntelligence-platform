BEGIN;

DROP TRIGGER engagement_lifecycle_end_version_guard
  ON person_master.engagement_version;
DROP TRIGGER engagement_lifecycle_request_conflict_version
  ON person_master.engagement_version;

CREATE FUNCTION person_master.guard_engagement_lifecycle_version_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation person_master.engagement;
  previous person_master.engagement_version;
BEGIN
  SELECT * INTO relation
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id
    AND governance_object_id = NEW.governance_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  IF NEW.revision_reason_code IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM person_master.engagement_lifecycle_event
      WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
    ) OR EXISTS (
      SELECT 1 FROM person_master.engagement_lifecycle_rejection
      WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
    )
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT' USING ERRCODE = '23505';
  END IF;

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
       AND NEW.business_valid_to > previous.business_valid_to)
     OR (previous.business_valid_to IS NOT NULL
       AND previous.business_valid_to <= platform.local_now()) THEN
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

CREATE TRIGGER engagement_lifecycle_00_version_guard
BEFORE INSERT ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_version_insert();

COMMENT ON FUNCTION person_master.guard_engagement_lifecycle_version_insert() IS
  'Locks the stable Engagement before version/event/rejection cross-table checks. All revisions preserve lifecycle request identity; ordinary end cannot rewrite an already-ended relation.';

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0028_person_engagement_lifecycle_serialization_guard');

COMMIT;
