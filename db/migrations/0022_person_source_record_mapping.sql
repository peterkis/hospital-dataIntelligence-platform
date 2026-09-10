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
    'PERSON_MASTER_SOURCE_MAPPING_READ', 'PERSON_MASTER_SOURCE_MAPPING_WRITE', 'PERSON_MASTER_SOURCE_MAPPING_CORRECT'
  ));

CREATE TABLE person_master.person_source_mapping (
  person_source_mapping_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(person_source_mapping_id) = 7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  source_system varchar(128) COLLATE "C" NOT NULL CHECK (
    length(source_system) > 0 AND source_system !~ '[[:cntrl:]]'
    AND source_system = btrim(source_system, E' \t\n\r\v\f' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ),
  source_entity varchar(128) COLLATE "C" NOT NULL CHECK (
    length(source_entity) > 0 AND source_entity !~ '[[:cntrl:]]'
    AND source_entity = btrim(source_entity, E' \t\n\r\v\f' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ),
  source_record_key varchar(256) COLLATE "C" NOT NULL CHECK (
    length(source_record_key) > 0 AND source_record_key !~ '[[:cntrl:]]'
    AND source_record_key = btrim(source_record_key, E' \t\n\r\v\f' || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  ),
  creation_request_id varchar(128) NOT NULL CHECK (length(btrim(creation_request_id)) > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  CONSTRAINT person_source_mapping_exact_unique UNIQUE (
    governance_object_id, source_system, source_entity, source_record_key
  ),
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (person_source_mapping_id, governance_object_id)
);

CREATE TABLE person_master.person_source_mapping_version (
  person_source_mapping_version_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(person_source_mapping_version_id) = 7),
  person_source_mapping_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  person_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  mapping_status varchar(16) NOT NULL CHECK (mapping_status IN ('MAPPED', 'RETRACTED')),
  change_kind varchar(16) NOT NULL CHECK (change_kind IN ('REGISTERED', 'CORRECTED', 'RETRACTED')),
  supersedes_mapping_version_id uuid,
  reason_code varchar(40) CHECK (reason_code IS NULL OR reason_code IN (
    'WRONG_PERSON_BINDING', 'BUSINESS_VALIDITY_CORRECTION', 'SOURCE_RECORD_RECONCILIATION'
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
  FOREIGN KEY (person_source_mapping_id, governance_object_id)
    REFERENCES person_master.person_source_mapping (person_source_mapping_id, governance_object_id),
  FOREIGN KEY (person_id, governance_object_id)
    REFERENCES person_master.person_subject (person_id, governance_object_id),
  UNIQUE (person_source_mapping_id, version_no),
  UNIQUE (person_source_mapping_id, request_id),
  UNIQUE (person_source_mapping_version_id, person_source_mapping_id),
  FOREIGN KEY (supersedes_mapping_version_id, person_source_mapping_id)
    REFERENCES person_master.person_source_mapping_version (
      person_source_mapping_version_id, person_source_mapping_id
    ),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

CREATE INDEX person_source_mapping_version_person_idx
  ON person_master.person_source_mapping_version (governance_object_id, person_id, version_no);

COMMENT ON TABLE person_master.person_source_mapping IS
  'SYNTHETIC NON_PRODUCTION only. Permanent exact logical source-record identity. Person targets never belong to this stable row.';
COMMENT ON TABLE person_master.person_source_mapping_version IS
  'Immutable Person bindings. Correction and retraction append direct-successor versions; prior record-time beliefs remain reproducible.';
COMMENT ON COLUMN person_master.person_source_mapping.source_record_key IS
  'Opaque canonical source-adapter key. It is not a Person Identifier and must not enter audit, logs, errors or metrics.';
COMMENT ON COLUMN person_master.person_source_mapping_version.operation_hash IS
  'Internal retry identity only. Never exported to audit, logs or metrics.';

CREATE TRIGGER person_source_mapping_scope_guard
BEFORE INSERT ON person_master.person_source_mapping
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE TRIGGER person_source_mapping_version_scope_guard
BEFORE INSERT ON person_master.person_source_mapping_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_source_mapping_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mapping person_master.person_source_mapping;
  previous person_master.person_source_mapping_version;
BEGIN
  SELECT * INTO mapping
  FROM person_master.person_source_mapping
  WHERE person_source_mapping_id = NEW.person_source_mapping_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOURCE_MAPPING_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO previous
  FROM person_master.person_source_mapping_version
  WHERE person_source_mapping_id = NEW.person_source_mapping_id
  ORDER BY version_no DESC
  LIMIT 1;

  IF previous.person_source_mapping_version_id IS NULL THEN
    IF NEW.version_no <> 1 OR NEW.mapping_status <> 'MAPPED'
       OR NEW.change_kind <> 'REGISTERED'
       OR NEW.supersedes_mapping_version_id IS NOT NULL
       OR NEW.reason_code IS NOT NULL
       OR NEW.request_id <> mapping.creation_request_id
       OR NEW.created_by <> mapping.created_by THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_FIRST_VERSION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version_no <> previous.version_no + 1 THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_VERSION_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_mapping_version_id IS DISTINCT FROM previous.person_source_mapping_version_id THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_SUPERSEDES_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.change_kind = 'REGISTERED' OR NEW.reason_code IS NULL THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_CHANGE_KIND_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.change_kind = 'CORRECTED' AND NEW.mapping_status <> 'MAPPED' THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_CORRECTION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.change_kind = 'RETRACTED' AND (
      NEW.mapping_status <> 'RETRACTED' OR NEW.person_id <> previous.person_id
    ) THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_RETRACTION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.person_id <> previous.person_id AND NEW.change_kind <> 'CORRECTED' THEN
      RAISE EXCEPTION 'SOURCE_MAPPING_PERSON_REPOINT_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (previous.recorded_from IS NOT NULL AND NEW.recorded_from <= previous.recorded_from)
     OR NEW.recorded_from > platform.local_now() THEN
    RAISE EXCEPTION 'SOURCE_MAPPING_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_source_mapping_next_version_guard
BEFORE INSERT ON person_master.person_source_mapping_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_source_mapping_next_version();

CREATE FUNCTION person_master.require_source_mapping_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM person_master.person_source_mapping_version
    WHERE person_source_mapping_id = NEW.person_source_mapping_id AND version_no = 1
  ) THEN
    RAISE EXCEPTION 'SOURCE_MAPPING_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER person_source_mapping_first_version_required
AFTER INSERT ON person_master.person_source_mapping
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION person_master.require_source_mapping_first_version();

CREATE TRIGGER person_source_mapping_immutable
BEFORE UPDATE OR DELETE ON person_master.person_source_mapping
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_source_mapping_version_immutable
BEFORE UPDATE OR DELETE ON person_master.person_source_mapping_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_source_mapping_no_truncate
BEFORE TRUNCATE ON person_master.person_source_mapping
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER person_source_mapping_version_no_truncate
BEFORE TRUNCATE ON person_master.person_source_mapping_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE, DELETE, TRUNCATE
  ON person_master.person_source_mapping, person_master.person_source_mapping_version
  FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0022_person_source_record_mapping');

COMMIT;
