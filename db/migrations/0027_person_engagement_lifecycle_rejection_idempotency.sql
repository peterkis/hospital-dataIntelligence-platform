BEGIN;

CREATE TABLE person_master.engagement_lifecycle_rejection (
  engagement_lifecycle_rejection_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_lifecycle_rejection_id) = 7),
  engagement_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('SUSPEND', 'RESUME', 'END')),
  rejection_code text NOT NULL CHECK (rejection_code IN (
    'ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE', 'ENGAGEMENT_NOT_STARTED',
    'ENGAGEMENT_ALREADY_SUSPENDED', 'ENGAGEMENT_NOT_SUSPENDED', 'ENGAGEMENT_ENDED',
    'ENGAGEMENT_END_BEFORE_START', 'ENGAGEMENT_STALE_VERSION',
    'ENGAGEMENT_LIFECYCLE_END_CONFLICT'
  )),
  recorded_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(recorded_at)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  FOREIGN KEY (engagement_id, governance_object_id)
    REFERENCES person_master.engagement (engagement_id, governance_object_id),
  UNIQUE (engagement_id, request_id)
);

CREATE INDEX engagement_lifecycle_rejection_recorded_idx
  ON person_master.engagement_lifecycle_rejection (engagement_id, recorded_at, request_id);

COMMENT ON TABLE person_master.engagement_lifecycle_rejection IS
  'SYNTHETIC NON_PRODUCTION append-only replay authority for rejected suspend, resume and end requests. It stores bounded outcome codes, never Person or external basis values.';

CREATE FUNCTION person_master.guard_engagement_lifecycle_event_request_conflict()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM person_master.engagement_version
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
  ) OR EXISTS (
    SELECT 1 FROM person_master.engagement_lifecycle_rejection
    WHERE engagement_id = NEW.engagement_id AND request_id = NEW.request_id
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_lifecycle_request_conflict_event
BEFORE INSERT ON person_master.engagement_lifecycle_event
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_event_request_conflict();

CREATE FUNCTION person_master.guard_engagement_lifecycle_version_request_conflict()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision_reason_code = 'LIFECYCLE_END' AND (
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_lifecycle_request_conflict_version
BEFORE INSERT ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_version_request_conflict();

CREATE FUNCTION person_master.guard_engagement_lifecycle_rejection()
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

CREATE TRIGGER engagement_lifecycle_rejection_guard
BEFORE INSERT ON person_master.engagement_lifecycle_rejection
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_rejection();
CREATE TRIGGER engagement_lifecycle_rejection_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_lifecycle_rejection
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_lifecycle_rejection_no_truncate
BEFORE TRUNCATE ON person_master.engagement_lifecycle_rejection
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE, DELETE, TRUNCATE
  ON person_master.engagement_lifecycle_rejection
  FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0027_person_engagement_lifecycle_rejection_idempotency');

COMMIT;
