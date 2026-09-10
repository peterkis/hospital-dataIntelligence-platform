BEGIN;

ALTER TABLE access_control.object_permission_grant
  DROP CONSTRAINT object_permission_grant_permission_code_check;
ALTER TABLE access_control.object_permission_grant
  ADD CONSTRAINT object_permission_grant_permission_code_check CHECK (permission_code IN (
    'CHARGE_CATALOG_DRAFT_READ', 'CHARGE_CATALOG_DRAFT_WRITE', 'CHARGE_CATALOG_PUBLISH',
    'CHARGE_CATALOG_SUBMIT', 'CHARGE_CATALOG_REVIEW', 'CHARGE_CATALOG_APPROVE',
    'PRICE_LIST_DRAFT_READ', 'PRICE_LIST_DRAFT_WRITE', 'PRICE_LIST_PUBLISH',
    'PRICE_LIST_SUBMIT', 'PRICE_LIST_REVIEW', 'PRICE_LIST_APPROVE',
    'DEPARTMENT_MASTER_DRAFT_READ', 'DEPARTMENT_MASTER_DRAFT_WRITE',
    'DEPARTMENT_MASTER_SUBMIT', 'DEPARTMENT_MASTER_REVIEW', 'DEPARTMENT_MASTER_APPROVE', 'DEPARTMENT_MASTER_PUBLISH',
    'DEPARTMENT_HIERARCHY_DRAFT_READ', 'DEPARTMENT_HIERARCHY_DRAFT_WRITE',
    'DEPARTMENT_HIERARCHY_SUBMIT', 'DEPARTMENT_HIERARCHY_REVIEW', 'DEPARTMENT_HIERARCHY_APPROVE', 'DEPARTMENT_HIERARCHY_PUBLISH',
    'CAMPUS_PRICE_CONFIRM', 'SCHEMA_UPGRADE_SUBMIT', 'SCHEMA_UPGRADE_APPROVE', 'PRICE_RESOLVE',
    'CONSUMER_SUBSCRIPTION_MANAGE', 'AUDIT_READ', 'EMERGENCY_SUSPEND', 'IMPACT_REVIEW', 'RECOVERY_APPROVE',
    'PERSON_MASTER_CORE_READ', 'PERSON_MASTER_CORE_WRITE',
    'PERSON_MASTER_IDENTIFIER_READ', 'PERSON_MASTER_IDENTIFIER_WRITE',
    'PERSON_MASTER_SOURCE_MAPPING_READ', 'PERSON_MASTER_SOURCE_MAPPING_WRITE', 'PERSON_MASTER_SOURCE_MAPPING_CORRECT',
    'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE'
  ));

CREATE TABLE person_master.engagement (
  engagement_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_id) = 7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  person_id uuid NOT NULL,
  creation_request_id varchar(128) NOT NULL CHECK (length(btrim(creation_request_id)) > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  FOREIGN KEY (person_id, governance_object_id)
    REFERENCES person_master.person_subject (person_id, governance_object_id),
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (engagement_id, person_id, governance_object_id)
);

CREATE INDEX engagement_person_idx
  ON person_master.engagement (governance_object_id, person_id, engagement_id);

CREATE TABLE person_master.engagement_version (
  engagement_version_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_version_id) = 7),
  engagement_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  person_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  supersedes_engagement_version_id uuid,
  revision_reason_code varchar(32) CHECK (revision_reason_code IS NULL OR revision_reason_code IN (
    'FACT_CORRECTION', 'VALIDITY_CORRECTION', 'CONTINUATION_EXTENSION'
  )),
  business_valid_from timestamp without time zone NOT NULL CHECK (
    isfinite(business_valid_from) AND business_valid_from >= TIMESTAMP '0001-01-01'
  ),
  business_valid_to timestamp without time zone CHECK (
    business_valid_to IS NULL OR isfinite(business_valid_to)
  ),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id varchar(128) NOT NULL CHECK (length(btrim(request_id)) > 0),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  business_period tsrange GENERATED ALWAYS AS (
    tsrange(business_valid_from, business_valid_to, '[)')
  ) STORED,
  FOREIGN KEY (engagement_id, person_id, governance_object_id)
    REFERENCES person_master.engagement (engagement_id, person_id, governance_object_id),
  UNIQUE (engagement_id, version_no),
  UNIQUE (engagement_id, request_id),
  UNIQUE (engagement_version_id, engagement_id),
  FOREIGN KEY (supersedes_engagement_version_id, engagement_id)
    REFERENCES person_master.engagement_version (engagement_version_id, engagement_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

COMMENT ON TABLE person_master.engagement IS
  'SYNTHETIC NON_PRODUCTION only. Permanent formal hospital relationship identity owned by exactly one Person. No type, classification, lifecycle, assignment, role or credential facts.';
COMMENT ON TABLE person_master.engagement_version IS
  'Immutable bitemporal relationship-period assertions. Continuity and extension append versions on the same Engagement ID; a later new relation requires a new Engagement ID.';
COMMENT ON COLUMN person_master.engagement_version.revision_reason_code IS
  'B-01 revision provenance only; it is not an Engagement lifecycle or business-state field.';
COMMENT ON COLUMN person_master.engagement_version.recorded_from IS
  'Asia/Shanghai database record time, strictly increasing per Engagement.';

CREATE TRIGGER engagement_scope_guard
BEFORE INSERT ON person_master.engagement
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE TRIGGER engagement_version_scope_guard
BEFORE INSERT ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_engagement_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation person_master.engagement;
  previous person_master.engagement_version;
BEGIN
  SELECT * INTO relation
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO previous
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id
  ORDER BY version_no DESC
  LIMIT 1;

  IF previous.engagement_version_id IS NULL THEN
    IF NEW.version_no <> 1
       OR NEW.supersedes_engagement_version_id IS NOT NULL
       OR NEW.revision_reason_code IS NOT NULL
       OR NEW.request_id <> relation.creation_request_id
       OR NEW.created_by <> relation.created_by THEN
      RAISE EXCEPTION 'ENGAGEMENT_FIRST_VERSION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version_no <> previous.version_no + 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_VERSION_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_engagement_version_id IS DISTINCT FROM previous.engagement_version_id THEN
      RAISE EXCEPTION 'ENGAGEMENT_SUPERSEDES_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.revision_reason_code IS NULL THEN
      RAISE EXCEPTION 'ENGAGEMENT_REVISION_REASON_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (previous.recorded_from IS NOT NULL AND NEW.recorded_from <= previous.recorded_from)
     OR NEW.recorded_from > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_next_version_guard
BEFORE INSERT ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_next_version();

CREATE FUNCTION person_master.require_engagement_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM person_master.engagement_version
    WHERE engagement_id = NEW.engagement_id AND version_no = 1
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER engagement_first_version_required
AFTER INSERT ON person_master.engagement
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION person_master.require_engagement_first_version();

CREATE TRIGGER engagement_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_version_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_no_truncate
BEFORE TRUNCATE ON person_master.engagement
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_version_no_truncate
BEFORE TRUNCATE ON person_master.engagement_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE, DELETE, TRUNCATE
  ON person_master.engagement, person_master.engagement_version
  FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0023_person_engagement_core');

COMMIT;
