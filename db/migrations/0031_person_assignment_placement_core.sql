BEGIN;

-- C-01 only: SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
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
    'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ', 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE',
    'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE',
    'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'
  ));

-- Owner-approved structural reference keys. Existing source semantics are unchanged.
CREATE UNIQUE INDEX department_assignment_scope_reference
  ON department_master.department (department_id, governance_object_id);
CREATE UNIQUE INDEX department_assignment_publication_reference
  ON department_master.department_published_projection
  (department_published_projection_id, department_version_id, department_id, published_release_id);
CREATE UNIQUE INDEX engagement_assignment_event_reference
  ON person_master.engagement_lifecycle_event (engagement_lifecycle_event_id, engagement_id, sequence_no);
CREATE UNIQUE INDEX engagement_assignment_classification_reference
  ON person_master.engagement_classification (engagement_id, engagement_type_version_id);

CREATE TABLE person_master.assignment (
  assignment_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(assignment_id)=7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  engagement_id uuid NOT NULL,
  person_id uuid NOT NULL,
  department_governance_object_id uuid NOT NULL,
  department_id uuid NOT NULL,
  placement_scope text NOT NULL CHECK (placement_scope='DEPARTMENT'),
  relation_basis text NOT NULL CHECK (relation_basis='CONFIRMED_DISTINCT_PLACEMENT'),
  creation_request_id text NOT NULL CHECK (length(btrim(creation_request_id)) BETWEEN 1 AND 128),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(created_at)),
  FOREIGN KEY (engagement_id,person_id,governance_object_id)
    REFERENCES person_master.engagement (engagement_id,person_id,governance_object_id),
  FOREIGN KEY (department_id,department_governance_object_id)
    REFERENCES department_master.department (department_id,governance_object_id),
  UNIQUE (governance_object_id,creation_request_id),
  UNIQUE (assignment_id,governance_object_id,engagement_id,department_id)
);

CREATE TABLE person_master.assignment_version (
  assignment_version_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(assignment_version_id)=7),
  assignment_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  department_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no>0),
  supersedes_assignment_version_id uuid,
  reason_code text CHECK (reason_code IN ('VALIDITY_CORRECTION','CONTINUATION_EXTENSION')),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from) AND business_valid_from >= TIMESTAMP '0001-01-01'),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR isfinite(business_valid_to)),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash)=32),
  validation_policy_code text NOT NULL CHECK (validation_policy_code='ASSIGNMENT_DEPARTMENT_CORE_V1'),
  evaluation_record_as_of timestamp without time zone NOT NULL CHECK (isfinite(evaluation_record_as_of)),
  authority_engagement_version_id uuid NOT NULL,
  authority_engagement_version_no bigint NOT NULL CHECK (authority_engagement_version_no>0),
  authority_engagement_recorded_from timestamp without time zone NOT NULL,
  authority_engagement_valid_from timestamp without time zone NOT NULL,
  authority_engagement_valid_to timestamp without time zone,
  record_visible_lifecycle_sequence bigint NOT NULL CHECK (record_visible_lifecycle_sequence>=0),
  classification_type_version_id uuid,
  classification_type_version_no bigint,
  classification_type_code text,
  classification_category_code text,
  classified_at timestamp without time zone,
  department_version_id uuid NOT NULL,
  department_version_no bigint NOT NULL CHECK (department_version_no>0),
  department_content_hash bytea NOT NULL CHECK (octet_length(department_content_hash)=32),
  department_recorded_from timestamp without time zone NOT NULL,
  department_recorded_to timestamp without time zone,
  department_release_id uuid NOT NULL,
  department_publication_projection_id uuid NOT NULL,
  department_published_at timestamp without time zone NOT NULL,
  department_business_status text NOT NULL CHECK (department_business_status='ACTIVE'),
  department_valid_from timestamp without time zone NOT NULL,
  department_valid_to timestamp without time zone,
  dependency_fingerprint bytea NOT NULL CHECK (octet_length(dependency_fingerprint)=32),
  business_period tsrange GENERATED ALWAYS AS (tsrange(business_valid_from,business_valid_to,'[)')) STORED,
  FOREIGN KEY (assignment_id,governance_object_id,engagement_id,department_id)
    REFERENCES person_master.assignment (assignment_id,governance_object_id,engagement_id,department_id),
  FOREIGN KEY (authority_engagement_version_id,engagement_id)
    REFERENCES person_master.engagement_version (engagement_version_id,engagement_id),
  FOREIGN KEY (engagement_id,classification_type_version_id)
    REFERENCES person_master.engagement_classification (engagement_id,engagement_type_version_id),
  FOREIGN KEY (department_version_id,department_id)
    REFERENCES department_master.department_version (department_version_id,department_id),
  FOREIGN KEY (department_publication_projection_id,department_version_id,department_id,department_release_id)
    REFERENCES department_master.department_published_projection
      (department_published_projection_id,department_version_id,department_id,published_release_id),
  UNIQUE (assignment_id,version_no),
  UNIQUE (governance_object_id,request_id),
  UNIQUE (assignment_version_id,assignment_id),
  UNIQUE (assignment_version_id,engagement_id),
  UNIQUE (assignment_version_id,governance_object_id,request_id,created_by,operation_hash),
  FOREIGN KEY (supersedes_assignment_version_id,assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  CHECK (business_valid_to IS NULL OR business_valid_to>business_valid_from),
  CHECK (authority_engagement_valid_from <= business_valid_from AND
    (authority_engagement_valid_to IS NULL OR (business_valid_to IS NOT NULL AND business_valid_to<=authority_engagement_valid_to))),
  CHECK (department_valid_from <= business_valid_from AND
    (department_valid_to IS NULL OR (business_valid_to IS NOT NULL AND business_valid_to<=department_valid_to))),
  CHECK (authority_engagement_recorded_from<=evaluation_record_as_of AND
    department_recorded_from<=evaluation_record_as_of AND department_published_at<=evaluation_record_as_of AND
    (department_recorded_to IS NULL OR evaluation_record_as_of<department_recorded_to) AND evaluation_record_as_of<=recorded_from),
  CHECK ((classification_type_version_id IS NULL AND classification_type_version_no IS NULL AND
    classification_type_code IS NULL AND classification_category_code IS NULL AND classified_at IS NULL)
    OR (classification_type_version_id IS NOT NULL AND classification_type_version_no>0 AND
    classification_type_code IS NOT NULL AND classification_category_code IS NOT NULL AND classified_at<=evaluation_record_as_of))
);

CREATE TABLE person_master.assignment_validation_segment (
  assignment_version_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  segment_no integer NOT NULL CHECK (segment_no BETWEEN 1 AND 128),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from)),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR isfinite(business_valid_to)),
  business_state text NOT NULL CHECK (business_state='ACTIVE'),
  last_applicable_lifecycle_event_id uuid,
  lifecycle_sequence bigint NOT NULL CHECK (lifecycle_sequence>=0),
  PRIMARY KEY (assignment_version_id,segment_no),
  FOREIGN KEY (assignment_version_id,engagement_id)
    REFERENCES person_master.assignment_version (assignment_version_id,engagement_id),
  FOREIGN KEY (last_applicable_lifecycle_event_id,engagement_id,lifecycle_sequence)
    REFERENCES person_master.engagement_lifecycle_event (engagement_lifecycle_event_id,engagement_id,sequence_no),
  CHECK ((last_applicable_lifecycle_event_id IS NULL)=(lifecycle_sequence=0)),
  CHECK (business_valid_to IS NULL OR business_valid_to>business_valid_from)
);

CREATE TABLE person_master.assignment_command_outcome (
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  operation_type text NOT NULL CHECK (operation_type IN ('CREATE','REVISE')),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash)=32),
  assignment_version_id uuid,
  rejection_code text CHECK (rejection_code IN (
    'ASSIGNMENT_STALE_VERSION','ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED',
    'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED','ASSIGNMENT_DEPENDENCY_UNKNOWN',
    'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT','ASSIGNMENT_PLACEMENT_NOT_FOUND',
    'ASSIGNMENT_PLACEMENT_UNPUBLISHED','ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
    'ASSIGNMENT_PLACEMENT_NOT_ACTIVE','ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
    'ENGAGEMENT_NOT_FOUND','ENGAGEMENT_NOT_KNOWN_AS_OF')),
  recorded_at timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_at)),
  PRIMARY KEY (governance_object_id,request_id),
  CHECK ((assignment_version_id IS NULL)<>(rejection_code IS NULL)),
  FOREIGN KEY (assignment_version_id,governance_object_id,request_id,created_by,operation_hash)
    REFERENCES person_master.assignment_version
      (assignment_version_id,governance_object_id,request_id,created_by,operation_hash)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX assignment_engagement_reference ON person_master.assignment (governance_object_id,engagement_id,assignment_id);
CREATE INDEX assignment_department_reference ON person_master.assignment (department_governance_object_id,department_id);
CREATE INDEX assignment_version_record_reference ON person_master.assignment_version (assignment_id,recorded_from,version_no DESC);

CREATE TRIGGER assignment_scope_guard BEFORE INSERT ON person_master.assignment
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();
CREATE TRIGGER assignment_version_scope_guard BEFORE INSERT ON person_master.assignment_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

CREATE FUNCTION person_master.guard_assignment_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stable person_master.assignment; prior person_master.assignment_version;
BEGIN
  SELECT * INTO stable FROM person_master.assignment WHERE assignment_id=NEW.assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE='23503'; END IF;
  SELECT * INTO prior FROM person_master.assignment_version WHERE assignment_id=NEW.assignment_id ORDER BY version_no DESC LIMIT 1;
  IF prior.assignment_version_id IS NULL THEN
    IF NEW.version_no<>1 OR NEW.supersedes_assignment_version_id IS NOT NULL OR NEW.reason_code IS NOT NULL
      OR NEW.request_id<>stable.creation_request_id OR NEW.created_by<>stable.created_by THEN
      RAISE EXCEPTION 'ASSIGNMENT_FIRST_VERSION_INVALID' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.version_no<>prior.version_no+1 OR NEW.supersedes_assignment_version_id IS DISTINCT FROM prior.assignment_version_id
      OR NEW.reason_code IS NULL OR NEW.recorded_from<=prior.recorded_from THEN
      RAISE EXCEPTION 'ASSIGNMENT_VERSION_SEQUENCE_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.recorded_from>platform.local_now() OR NEW.recorded_from<stable.created_at THEN
    RAISE EXCEPTION 'ASSIGNMENT_RECORD_TIME_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_version_guard BEFORE INSERT ON person_master.assignment_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_version();

CREATE FUNCTION person_master.guard_assignment_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; segment person_master.assignment_validation_segment;
  expected_from timestamp without time zone; expected_no integer; target uuid;
BEGIN
  IF TG_TABLE_NAME='assignment' THEN
    SELECT assignment_version_id INTO target FROM person_master.assignment_version WHERE assignment_id=NEW.assignment_id AND version_no=1;
  ELSE target:=NEW.assignment_version_id; END IF;
  IF target IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_FIRST_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=target;
  expected_from:=v.business_valid_from; expected_no:=1;
  FOR segment IN SELECT * FROM person_master.assignment_validation_segment WHERE assignment_version_id=target ORDER BY segment_no LOOP
    IF segment.segment_no<>expected_no OR segment.business_valid_from IS DISTINCT FROM expected_from
      OR segment.lifecycle_sequence>v.record_visible_lifecycle_sequence THEN
      RAISE EXCEPTION 'ASSIGNMENT_SEGMENTS_INVALID' USING ERRCODE='23514';
    END IF;
    expected_from:=segment.business_valid_to; expected_no:=expected_no+1;
  END LOOP;
  IF expected_no=1 OR expected_from IS DISTINCT FROM v.business_valid_to THEN
    RAISE EXCEPTION 'ASSIGNMENT_SEGMENTS_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM person_master.assignment_command_outcome o
    WHERE o.governance_object_id=v.governance_object_id AND o.request_id=v.request_id AND o.assignment_version_id=target
      AND o.created_by=v.created_by AND o.operation_hash=v.operation_hash
      AND o.operation_type=CASE WHEN v.version_no=1 THEN 'CREATE' ELSE 'REVISE' END) THEN
    RAISE EXCEPTION 'ASSIGNMENT_SUCCESS_OUTCOME_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER assignment_complete AFTER INSERT ON person_master.assignment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_complete();
CREATE CONSTRAINT TRIGGER assignment_version_complete AFTER INSERT ON person_master.assignment_version
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_complete();
CREATE CONSTRAINT TRIGGER assignment_segment_complete AFTER INSERT ON person_master.assignment_validation_segment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_complete();

CREATE TRIGGER assignment_immutable BEFORE UPDATE OR DELETE ON person_master.assignment
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_no_truncate BEFORE TRUNCATE ON person_master.assignment
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_version_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_version_no_truncate BEFORE TRUNCATE ON person_master.assignment_version
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_segment_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_validation_segment
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_segment_no_truncate BEFORE TRUNCATE ON person_master.assignment_validation_segment
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_outcome_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_command_outcome
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_outcome_no_truncate BEFORE TRUNCATE ON person_master.assignment_command_outcome
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment,person_master.assignment_version,
  person_master.assignment_validation_segment,person_master.assignment_command_outcome FROM PUBLIC;
COMMENT ON TABLE person_master.assignment IS 'SYNTHETIC NON_PRODUCTION DEPARTMENT-only stable placement under exactly one Engagement; no roles, campus or approval.';
COMMENT ON TABLE person_master.assignment_version IS 'Immutable complete placement period and acceptance dependency evidence. ASSIGNMENT_DEPARTMENT_CORE_V1 is test policy only, not published authority.';
COMMENT ON TABLE person_master.assignment_validation_segment IS 'Immutable bounded ACTIVE segments covering exactly one accepted AssignmentVersion; all timestamps are Asia/Shanghai local.';
COMMENT ON TABLE person_master.assignment_command_outcome IS 'Append-only request replay authority for successful or bounded rejected Assignment commands; no generic workflow.';

INSERT INTO platform.schema_migration (migration_id) VALUES ('0031_person_assignment_placement_core');
COMMIT;
