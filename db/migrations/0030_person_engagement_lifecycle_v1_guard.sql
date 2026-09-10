BEGIN;

CREATE OR REPLACE FUNCTION person_master.guard_engagement_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation person_master.engagement;
  period person_master.engagement_version;
  previous person_master.engagement_lifecycle_event;
  applicable person_master.engagement_lifecycle_event;
BEGIN
  SELECT * INTO relation
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id
    AND governance_object_id = NEW.governance_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO period
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id
  ORDER BY version_no DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.business_effective_at < period.business_valid_from THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_STARTED' USING ERRCODE = '23514';
  END IF;
  IF period.business_valid_to IS NOT NULL
     AND NEW.business_effective_at >= period.business_valid_to THEN
    RAISE EXCEPTION 'ENGAGEMENT_ENDED' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO previous
  FROM person_master.engagement_lifecycle_event
  WHERE engagement_id = NEW.engagement_id
  ORDER BY sequence_no DESC
  LIMIT 1;
  IF previous.engagement_lifecycle_event_id IS NULL THEN
    IF NEW.sequence_no <> 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.sequence_no <> previous.sequence_no + 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.recorded_at <= previous.recorded_at THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.recorded_at > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO applicable
  FROM person_master.engagement_lifecycle_event
  WHERE engagement_id = NEW.engagement_id
    AND business_effective_at <= NEW.business_effective_at
  ORDER BY business_effective_at DESC, sequence_no DESC
  LIMIT 1;
  IF NEW.event_type = 'SUSPENDED' AND applicable.event_type = 'SUSPENDED' THEN
    RAISE EXCEPTION 'ENGAGEMENT_ALREADY_SUSPENDED' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'RESUMED'
     AND applicable.event_type IS DISTINCT FROM 'SUSPENDED' THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_SUSPENDED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION person_master.guard_engagement_lifecycle_rejection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id
    AND governance_object_id = NEW.governance_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  PERFORM 1
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id AND version_no = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM person_master.engagement_lifecycle_event
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
  ) OR EXISTS (
    SELECT 1 FROM person_master.engagement_version
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF NEW.recorded_at > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION person_master.guard_engagement_lifecycle_version_insert()
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

  IF EXISTS (
    SELECT 1 FROM person_master.engagement_lifecycle_event
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
  ) OR EXISTS (
    SELECT 1 FROM person_master.engagement_lifecycle_rejection
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
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

COMMENT ON FUNCTION person_master.guard_engagement_lifecycle_event() IS
  'Locks the stable Engagement and requires V1 before append-only lifecycle evidence can exist.';
COMMENT ON FUNCTION person_master.guard_engagement_lifecycle_rejection() IS
  'Locks the stable Engagement and requires V1 before a rejected lifecycle request can become replay authority.';
COMMENT ON FUNCTION person_master.guard_engagement_lifecycle_version_insert() IS
  'Locks stable Engagement before every V1/later version cross-table request check and owns bounded lifecycle-end invariants.';

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0030_person_engagement_lifecycle_v1_guard');

COMMIT;
