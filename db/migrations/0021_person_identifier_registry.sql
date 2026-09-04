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
    'PERSON_MASTER_IDENTIFIER_READ', 'PERSON_MASTER_IDENTIFIER_WRITE'
  ));

CREATE TABLE person_master.person_identifier (
  person_identifier_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(person_identifier_id) = 7),
  person_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  identifier_system varchar(512) COLLATE "C" NOT NULL CHECK (
    identifier_system ~ '^[A-Za-z][A-Za-z0-9+.-]*:[!-~]+$'
  ),
  identifier_value varchar(256) COLLATE "C" NOT NULL CHECK (
    length(identifier_value) > 0 AND identifier_value !~ '[[:cntrl:]]'
    AND identifier_value = btrim(identifier_value, E' \t\n\r\v\f' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ),
  creation_request_id varchar(128) NOT NULL CHECK (length(btrim(creation_request_id)) > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  FOREIGN KEY (person_id, governance_object_id) REFERENCES person_master.person_subject (person_id, governance_object_id),
  CONSTRAINT person_identifier_exact_unique UNIQUE (governance_object_id, identifier_system, identifier_value),
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (person_identifier_id, person_id, governance_object_id)
);
CREATE INDEX person_identifier_person_idx ON person_master.person_identifier (governance_object_id, person_id);

CREATE TABLE person_master.person_identifier_version (
  person_identifier_version_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(person_identifier_version_id) = 7),
  person_identifier_id uuid NOT NULL,
  person_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  assertion_status varchar(16) NOT NULL CHECK (assertion_status IN ('ASSERTED', 'RETRACTED')),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from) AND business_valid_from >= TIMESTAMP '0001-01-01'),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR isfinite(business_valid_to)),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id varchar(128) NOT NULL CHECK (length(btrim(request_id)) > 0),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  business_period tsrange GENERATED ALWAYS AS (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  FOREIGN KEY (person_identifier_id, person_id, governance_object_id)
    REFERENCES person_master.person_identifier (person_identifier_id, person_id, governance_object_id),
  UNIQUE (person_identifier_id, version_no),
  UNIQUE (person_identifier_id, request_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

COMMENT ON TABLE person_master.person_identifier IS
  'SYNTHETIC NON_PRODUCTION only. Permanent exact namespace/value binding to existing Person. No reuse after expiry or retraction. No production sensitive-identifier storage protection claim.';
COMMENT ON TABLE person_master.person_identifier_version IS
  'Immutable assertions. Latest recorded version applicable at the business instant wins; RETRACTED means no effective binding. Uncovered business periods retain prior assertions.';
COMMENT ON COLUMN person_master.person_identifier_version.operation_hash IS
  'Retry identity for operation kind and assertion validity only. Never contains identifier value or its hash; never exported to audit.';

CREATE TRIGGER person_identifier_scope_guard BEFORE INSERT ON person_master.person_identifier
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER person_identifier_version_scope_guard BEFORE INSERT ON person_master.person_identifier_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_identifier_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_version bigint; prior_recorded timestamp without time zone; relationship person_master.person_identifier;
BEGIN
  SELECT * INTO relationship FROM person_master.person_identifier
    WHERE person_identifier_id = NEW.person_identifier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSON_IDENTIFIER_NOT_FOUND' USING ERRCODE = '23503'; END IF;
  SELECT version_no, recorded_from INTO prior_version, prior_recorded
    FROM person_master.person_identifier_version WHERE person_identifier_id = NEW.person_identifier_id ORDER BY version_no DESC LIMIT 1;
  IF NEW.version_no <> coalesce(prior_version, 0) + 1 THEN
    RAISE EXCEPTION 'PERSON_IDENTIFIER_VERSION_SEQUENCE_INVALID' USING ERRCODE = '23514';
  END IF;
  IF prior_version IS NULL AND (NEW.assertion_status <> 'ASSERTED' OR NEW.request_id <> relationship.creation_request_id OR NEW.created_by <> relationship.created_by) THEN
    RAISE EXCEPTION 'PERSON_IDENTIFIER_FIRST_ASSERTION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF (prior_recorded IS NOT NULL AND NEW.recorded_from <= prior_recorded) OR NEW.recorded_from > platform.local_now() THEN
    RAISE EXCEPTION 'PERSON_IDENTIFIER_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER person_identifier_next_version_guard BEFORE INSERT ON person_master.person_identifier_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_identifier_next_version();

CREATE FUNCTION person_master.require_identifier_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM person_master.person_identifier_version WHERE person_identifier_id = NEW.person_identifier_id AND version_no = 1) THEN
    RAISE EXCEPTION 'PERSON_IDENTIFIER_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER person_identifier_first_version_required AFTER INSERT ON person_master.person_identifier
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.require_identifier_first_version();

CREATE TRIGGER person_identifier_immutable BEFORE UPDATE OR DELETE ON person_master.person_identifier
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_identifier_version_immutable BEFORE UPDATE OR DELETE ON person_master.person_identifier_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_identifier_no_truncate BEFORE TRUNCATE ON person_master.person_identifier
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_identifier_version_no_truncate BEFORE TRUNCATE ON person_master.person_identifier_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON person_master.person_identifier, person_master.person_identifier_version FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id) VALUES ('0021_person_identifier_registry');
COMMIT;
