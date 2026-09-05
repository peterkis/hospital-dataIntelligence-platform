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
    'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE',
    'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ', 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE',
    'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ', 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE'
  ));

CREATE TABLE person_master.engagement_type (
  engagement_type_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_type_id) = 7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  type_code text COLLATE "C" NOT NULL CHECK (
    type_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  creation_request_id text NOT NULL CHECK (
    length(btrim(creation_request_id)) BETWEEN 1 AND 128
  ),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(created_at)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  UNIQUE (governance_object_id, type_code),
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (engagement_type_id, governance_object_id)
);

CREATE TABLE person_master.engagement_type_version (
  engagement_type_version_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_type_version_id) = 7),
  engagement_type_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  supersedes_engagement_type_version_id uuid,
  category_code text NOT NULL CHECK (category_code IN (
    'LABOR_OR_HR', 'DISPATCH_OR_SERVICE', 'EXTERNAL_PROFESSIONAL', 'TRAINING_OR_LEARNING'
  )),
  display_name text NOT NULL CHECK (
    display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 256
  ),
  business_valid_from timestamp without time zone NOT NULL CHECK (
    isfinite(business_valid_from) AND business_valid_from >= TIMESTAMP '0001-01-01'
  ),
  business_valid_to timestamp without time zone CHECK (
    business_valid_to IS NULL OR isfinite(business_valid_to)
  ),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  business_period tsrange GENERATED ALWAYS AS (
    tsrange(business_valid_from, business_valid_to, '[)')
  ) STORED,
  FOREIGN KEY (engagement_type_id, governance_object_id)
    REFERENCES person_master.engagement_type (engagement_type_id, governance_object_id),
  UNIQUE (engagement_type_id, version_no),
  UNIQUE (engagement_type_id, request_id),
  UNIQUE (engagement_type_version_id, engagement_type_id, governance_object_id),
  FOREIGN KEY (
    supersedes_engagement_type_version_id, engagement_type_id, governance_object_id
  ) REFERENCES person_master.engagement_type_version (
    engagement_type_version_id, engagement_type_id, governance_object_id
  ),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

CREATE INDEX engagement_type_version_business_idx
  ON person_master.engagement_type_version
  USING gist (engagement_type_id, business_period);

CREATE TABLE person_master.engagement_classification (
  engagement_id uuid PRIMARY KEY,
  governance_object_id uuid NOT NULL,
  person_id uuid NOT NULL,
  engagement_type_id uuid NOT NULL,
  engagement_type_version_id uuid NOT NULL,
  classified_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(classified_at)),
  classified_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  FOREIGN KEY (engagement_id, person_id, governance_object_id)
    REFERENCES person_master.engagement (engagement_id, person_id, governance_object_id),
  FOREIGN KEY (engagement_type_version_id, engagement_type_id, governance_object_id)
    REFERENCES person_master.engagement_type_version (
      engagement_type_version_id, engagement_type_id, governance_object_id
    ),
  UNIQUE (governance_object_id, request_id)
);

CREATE INDEX engagement_classification_type_idx
  ON person_master.engagement_classification (
    governance_object_id, engagement_type_id, engagement_type_version_id
  );

CREATE TABLE person_master.engagement_overlap_rule (
  engagement_overlap_rule_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_overlap_rule_id) = 7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  left_type_code text COLLATE "C" NOT NULL,
  right_type_code text COLLATE "C" NOT NULL,
  creation_request_id text NOT NULL CHECK (
    length(btrim(creation_request_id)) BETWEEN 1 AND 128
  ),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(created_at)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  FOREIGN KEY (governance_object_id, left_type_code)
    REFERENCES person_master.engagement_type (governance_object_id, type_code),
  FOREIGN KEY (governance_object_id, right_type_code)
    REFERENCES person_master.engagement_type (governance_object_id, type_code),
  UNIQUE (governance_object_id, left_type_code, right_type_code),
  UNIQUE (governance_object_id, creation_request_id),
  UNIQUE (engagement_overlap_rule_id, governance_object_id),
  CHECK (left_type_code <= right_type_code)
);

CREATE TABLE person_master.engagement_overlap_rule_version (
  engagement_overlap_rule_version_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_overlap_rule_version_id) = 7),
  engagement_overlap_rule_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  supersedes_engagement_overlap_rule_version_id uuid,
  decision text NOT NULL CHECK (decision IN ('ALLOW', 'FORBID', 'REVIEW_REQUIRED')),
  business_valid_from timestamp without time zone NOT NULL CHECK (
    isfinite(business_valid_from) AND business_valid_from >= TIMESTAMP '0001-01-01'
  ),
  business_valid_to timestamp without time zone CHECK (
    business_valid_to IS NULL OR isfinite(business_valid_to)
  ),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  business_period tsrange GENERATED ALWAYS AS (
    tsrange(business_valid_from, business_valid_to, '[)')
  ) STORED,
  FOREIGN KEY (engagement_overlap_rule_id, governance_object_id)
    REFERENCES person_master.engagement_overlap_rule (
      engagement_overlap_rule_id, governance_object_id
    ),
  UNIQUE (engagement_overlap_rule_id, version_no),
  UNIQUE (engagement_overlap_rule_id, request_id),
  UNIQUE (engagement_overlap_rule_version_id, engagement_overlap_rule_id),
  FOREIGN KEY (
    supersedes_engagement_overlap_rule_version_id, engagement_overlap_rule_id
  ) REFERENCES person_master.engagement_overlap_rule_version (
    engagement_overlap_rule_version_id, engagement_overlap_rule_id
  ),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

CREATE INDEX engagement_overlap_rule_version_business_idx
  ON person_master.engagement_overlap_rule_version
  USING gist (engagement_overlap_rule_id, business_period);

COMMENT ON TABLE person_master.engagement_type IS
  'SYNTHETIC NON_PRODUCTION POC Engagement Type stable definitions. Not a hospital HR code-system authority.';
COMMENT ON TABLE person_master.engagement_type_version IS
  'Immutable bitemporal Engagement Type definitions. Display-name changes never rewrite frozen Engagement classifications.';
COMMENT ON TABLE person_master.engagement_classification IS
  'Immutable one-to-one Engagement identity classification frozen to an exact Engagement Type version.';
COMMENT ON TABLE person_master.engagement_overlap_rule IS
  'TEST POLICY ONLY - NOT HOSPITAL HR POLICY. Canonical symmetric Engagement Type pair identity.';
COMMENT ON TABLE person_master.engagement_overlap_rule_version IS
  'TEST POLICY ONLY - NOT HOSPITAL HR POLICY. Immutable ALLOW, FORBID or REVIEW_REQUIRED rule versions.';

CREATE TRIGGER engagement_type_scope_guard
BEFORE INSERT ON person_master.engagement_type
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER engagement_type_version_scope_guard
BEFORE INSERT ON person_master.engagement_type_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER engagement_overlap_rule_scope_guard
BEFORE INSERT ON person_master.engagement_overlap_rule
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER engagement_overlap_rule_version_scope_guard
BEFORE INSERT ON person_master.engagement_overlap_rule_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_engagement_type_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  definition person_master.engagement_type;
  previous person_master.engagement_type_version;
BEGIN
  SELECT * INTO definition
  FROM person_master.engagement_type
  WHERE engagement_type_id = NEW.engagement_type_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_TYPE_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO previous
  FROM person_master.engagement_type_version
  WHERE engagement_type_id = NEW.engagement_type_id
  ORDER BY version_no DESC
  LIMIT 1;

  IF previous.engagement_type_version_id IS NULL THEN
    IF NEW.version_no <> 1
       OR NEW.supersedes_engagement_type_version_id IS NOT NULL
       OR NEW.request_id <> definition.creation_request_id
       OR NEW.created_by <> definition.created_by THEN
      RAISE EXCEPTION 'ENGAGEMENT_TYPE_FIRST_VERSION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version_no <> previous.version_no + 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_TYPE_VERSION_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_engagement_type_version_id IS DISTINCT FROM previous.engagement_type_version_id THEN
      RAISE EXCEPTION 'ENGAGEMENT_TYPE_SUPERSEDES_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (previous.recorded_from IS NOT NULL AND NEW.recorded_from <= previous.recorded_from)
     OR NEW.recorded_from > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_TYPE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_type_next_version_guard
BEFORE INSERT ON person_master.engagement_type_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_type_next_version();

CREATE FUNCTION person_master.require_engagement_type_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM person_master.engagement_type_version
    WHERE engagement_type_id = NEW.engagement_type_id AND version_no = 1
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_TYPE_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER engagement_type_first_version_required
AFTER INSERT ON person_master.engagement_type
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION person_master.require_engagement_type_first_version();

CREATE FUNCTION person_master.guard_engagement_classification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation person_master.engagement;
BEGIN
  SELECT * INTO relation
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF NEW.request_id <> relation.creation_request_id
     OR NEW.classified_by <> relation.created_by
     OR NEW.classified_at < relation.created_at
     OR NEW.classified_at > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_CLASSIFICATION_PROVENANCE_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_classification_guard
BEFORE INSERT ON person_master.engagement_classification
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_classification();

CREATE FUNCTION person_master.require_engagement_classification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM person_master.engagement_classification
    WHERE engagement_id = NEW.engagement_id
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_CLASSIFICATION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER engagement_classification_required
AFTER INSERT ON person_master.engagement
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION person_master.require_engagement_classification();

CREATE FUNCTION person_master.guard_engagement_overlap_rule_next_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  definition person_master.engagement_overlap_rule;
  previous person_master.engagement_overlap_rule_version;
BEGIN
  SELECT * INTO definition
  FROM person_master.engagement_overlap_rule
  WHERE engagement_overlap_rule_id = NEW.engagement_overlap_rule_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO previous
  FROM person_master.engagement_overlap_rule_version
  WHERE engagement_overlap_rule_id = NEW.engagement_overlap_rule_id
  ORDER BY version_no DESC
  LIMIT 1;

  IF previous.engagement_overlap_rule_version_id IS NULL THEN
    IF NEW.version_no <> 1
       OR NEW.supersedes_engagement_overlap_rule_version_id IS NOT NULL
       OR NEW.request_id <> definition.creation_request_id
       OR NEW.created_by <> definition.created_by THEN
      RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_FIRST_VERSION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version_no <> previous.version_no + 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_VERSION_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.supersedes_engagement_overlap_rule_version_id IS DISTINCT FROM previous.engagement_overlap_rule_version_id THEN
      RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_SUPERSEDES_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (previous.recorded_from IS NOT NULL AND NEW.recorded_from <= previous.recorded_from)
     OR NEW.recorded_from > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_overlap_rule_next_version_guard
BEFORE INSERT ON person_master.engagement_overlap_rule_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_overlap_rule_next_version();

CREATE FUNCTION person_master.require_engagement_overlap_rule_first_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM person_master.engagement_overlap_rule_version
    WHERE engagement_overlap_rule_id = NEW.engagement_overlap_rule_id AND version_no = 1
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_OVERLAP_RULE_FIRST_VERSION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER engagement_overlap_rule_first_version_required
AFTER INSERT ON person_master.engagement_overlap_rule
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION person_master.require_engagement_overlap_rule_first_version();

CREATE TRIGGER engagement_type_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_type
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_type_version_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_type_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_classification_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_classification
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_overlap_rule_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_overlap_rule
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_overlap_rule_version_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_overlap_rule_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TRIGGER engagement_type_no_truncate
BEFORE TRUNCATE ON person_master.engagement_type
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_type_version_no_truncate
BEFORE TRUNCATE ON person_master.engagement_type_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_classification_no_truncate
BEFORE TRUNCATE ON person_master.engagement_classification
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_overlap_rule_no_truncate
BEFORE TRUNCATE ON person_master.engagement_overlap_rule
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_overlap_rule_version_no_truncate
BEFORE TRUNCATE ON person_master.engagement_overlap_rule_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON
  person_master.engagement_type,
  person_master.engagement_type_version,
  person_master.engagement_classification,
  person_master.engagement_overlap_rule,
  person_master.engagement_overlap_rule_version
FROM PUBLIC;

-- Existing B-01 relations are synthetic and carried no type facts. Freeze them
-- to one explicitly non-production representative definition without changing
-- either B-01 table. This is test migration provenance, not hospital HR policy.
INSERT INTO person_master.engagement_type (
  governance_object_id, type_code, creation_request_id, created_by
)
SELECT source.governance_object_id, 'CONTRACT_EMPLOYEE',
  'PV006-B02-B01-SYNTHETIC-BACKFILL-TYPE', source.created_by
FROM (
  SELECT DISTINCT ON (governance_object_id) governance_object_id, created_by
  FROM person_master.engagement
  ORDER BY governance_object_id, created_at, engagement_id
) AS source
ON CONFLICT (governance_object_id, type_code) DO NOTHING;

INSERT INTO person_master.engagement_type_version (
  engagement_type_id, governance_object_id, version_no,
  supersedes_engagement_type_version_id, category_code, display_name,
  business_valid_from, business_valid_to, created_by, request_id, operation_hash
)
SELECT definition.engagement_type_id, definition.governance_object_id, 1, null,
  'LABOR_OR_HR', 'SYNTHETIC CONTRACT EMPLOYEE - B-01 BACKFILL',
  TIMESTAMP '0001-01-01 00:00:00', null, definition.created_by,
  definition.creation_request_id,
  digest('PV-006-B-02|B-01|SYNTHETIC|CONTRACT_EMPLOYEE', 'sha256')
FROM person_master.engagement_type AS definition
WHERE definition.type_code = 'CONTRACT_EMPLOYEE'
  AND definition.creation_request_id = 'PV006-B02-B01-SYNTHETIC-BACKFILL-TYPE'
  AND NOT EXISTS (
    SELECT 1 FROM person_master.engagement_type_version AS version
    WHERE version.engagement_type_id = definition.engagement_type_id
  );

INSERT INTO person_master.engagement_classification (
  engagement_id, governance_object_id, person_id,
  engagement_type_id, engagement_type_version_id,
  classified_by, request_id
)
SELECT relation.engagement_id, relation.governance_object_id, relation.person_id,
  definition.engagement_type_id, version.engagement_type_version_id,
  relation.created_by, relation.creation_request_id
FROM person_master.engagement AS relation
JOIN person_master.engagement_type AS definition
  ON definition.governance_object_id = relation.governance_object_id
 AND definition.type_code = 'CONTRACT_EMPLOYEE'
JOIN person_master.engagement_type_version AS version
  ON version.engagement_type_id = definition.engagement_type_id
 AND version.version_no = 1
ON CONFLICT (engagement_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM person_master.engagement AS relation
    LEFT JOIN person_master.engagement_classification AS classification
      ON classification.engagement_id = relation.engagement_id
    WHERE classification.engagement_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_CLASSIFICATION_BACKFILL_INCOMPLETE';
  END IF;
END;
$$;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0024_person_engagement_classification_overlap');

COMMIT;
