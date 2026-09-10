BEGIN;

CREATE SCHEMA person_master;

ALTER TABLE platform.governance_object
  DROP CONSTRAINT governance_object_object_type_check;
ALTER TABLE platform.governance_object
  ADD CONSTRAINT governance_object_object_type_check CHECK (object_type IN (
    'CHARGE_CATALOG', 'PRICE_LIST', 'DEPARTMENT_MASTER', 'DEPARTMENT_HIERARCHY', 'PERSON_MASTER'
  ));
CREATE UNIQUE INDEX person_master_single_authority_idx
  ON platform.governance_object (object_type) WHERE object_type = 'PERSON_MASTER';

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
    'PERSON_MASTER_CORE_READ', 'PERSON_MASTER_CORE_WRITE'
  ));

CREATE TABLE person_master.person_subject (
  person_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  creation_request_id varchar(128) NOT NULL CHECK (length(btrim(creation_request_id)) > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (person_id, governance_object_id)
);

CREATE TABLE person_master.person_subject_version (
  person_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  canonical_name varchar(256) NOT NULL CHECK (
    length(canonical_name) > 0
    AND canonical_name = btrim(canonical_name, E' \t\n\r\v\f' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ),
  birth_date date CHECK (birth_date IS NULL OR (isfinite(birth_date) AND birth_date >= DATE '0001-01-01')),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from)),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR isfinite(business_valid_to)),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id varchar(128) NOT NULL CHECK (length(btrim(request_id)) > 0),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  business_period tsrange GENERATED ALWAYS AS (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  FOREIGN KEY (person_id, governance_object_id)
    REFERENCES person_master.person_subject (person_id, governance_object_id),
  UNIQUE (person_id, version_no),
  UNIQUE (person_id, request_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

COMMENT ON TABLE person_master.person_subject IS
  'Permanent hospital natural-person identity. No employment, account or patient authority. Creation actor is audit provenance only.';
COMMENT ON TABLE person_master.person_subject_version IS
  'Append-only identity assertions. At a business instant, a revision supersedes earlier applicable assertions from recorded_from onward; uncovered business periods retain prior facts. No publication is implied.';
COMMENT ON COLUMN person_master.person_subject_version.birth_date IS 'Optional calendar date, never a timestamp.';
COMMENT ON COLUMN person_master.person_subject_version.recorded_from IS 'Asia/Shanghai database record time; per-person version_no owns ordering.';

CREATE FUNCTION person_master.guard_subject_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.governance_object
    WHERE governance_object_id = NEW.governance_object_id AND object_type = 'PERSON_MASTER' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'person governance scope required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.security_principal
    WHERE security_principal_id = NEW.created_by AND principal_kind = 'PERSON' AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'active human creation actor required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER person_subject_scope_guard BEFORE INSERT ON person_master.person_subject
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER person_version_scope_guard BEFORE INSERT ON person_master.person_subject_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_version bigint; prior_recorded timestamp without time zone;
BEGIN
  PERFORM 1 FROM person_master.person_subject WHERE person_id = NEW.person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person subject required' USING ERRCODE = '23503';
  END IF;
  SELECT version_no, recorded_from INTO prior_version, prior_recorded
    FROM person_master.person_subject_version WHERE person_id = NEW.person_id ORDER BY version_no DESC LIMIT 1;
  IF NEW.version_no <> coalesce(prior_version, 0) + 1 THEN
    RAISE EXCEPTION 'person version must extend sequence' USING ERRCODE = '23514';
  END IF;
  IF prior_recorded IS NOT NULL AND NEW.recorded_from <= prior_recorded THEN
    RAISE EXCEPTION 'person record time must advance' USING ERRCODE = '23514';
  END IF;
  IF NEW.recorded_from > platform.local_now() OR
     (NEW.birth_date IS NOT NULL AND NEW.birth_date > platform.local_now()::date) THEN
    RAISE EXCEPTION 'future person record or birth date forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER person_next_version_guard BEFORE INSERT ON person_master.person_subject_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_next_version();

CREATE FUNCTION person_master.require_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM person_master.person_subject_version WHERE person_id = NEW.person_id AND version_no = 1) THEN
    RAISE EXCEPTION 'person first version required in creation transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER person_first_version_required AFTER INSERT ON person_master.person_subject
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.require_first_version();

CREATE TRIGGER person_subject_immutable BEFORE UPDATE OR DELETE ON person_master.person_subject
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_version_immutable BEFORE UPDATE OR DELETE ON person_master.person_subject_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_subject_no_truncate BEFORE TRUNCATE ON person_master.person_subject
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_version_no_truncate BEFORE TRUNCATE ON person_master.person_subject_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON person_master.person_subject, person_master.person_subject_version FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id) VALUES ('0020_person_master_subject_core');
COMMIT;
