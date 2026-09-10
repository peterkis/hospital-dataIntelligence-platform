BEGIN;

-- PV-006-C-02: SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY; Asia/Shanghai.
ALTER TABLE access_control.object_permission_grant DROP CONSTRAINT object_permission_grant_permission_code_check;
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
    'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
    'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_READ','PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_WRITE',
    'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'
  ));

CREATE TABLE person_master.assignment_semantic_term (
  term_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(term_id)=7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  dimension text NOT NULL CHECK (dimension IN ('PURPOSE','MODE')),
  code text NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(created_at)),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  creation_request_id text NOT NULL CHECK (length(btrim(creation_request_id)) BETWEEN 1 AND 128),
  UNIQUE (governance_object_id,dimension,code),
  UNIQUE (term_id,governance_object_id,dimension,code),
  CHECK ((dimension='PURPOSE' AND code IN ('ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING'))
    OR (dimension='MODE' AND code IN ('PRIMARY_AFFILIATION','STANDING_CONCURRENT')))
);
CREATE TABLE person_master.assignment_semantic_term_version (
  term_version_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(term_version_id)=7),
  term_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  dimension text NOT NULL,
  code text NOT NULL,
  version_no bigint NOT NULL CHECK (version_no>0),
  supersedes_term_version_id uuid,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160 AND label !~ '[[:cntrl:]]'),
  definition_state text NOT NULL CHECK (definition_state IN ('ENABLED','RETIRED')),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from) AND business_valid_from>=TIMESTAMP '0001-01-01'),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR (isfinite(business_valid_to) AND business_valid_to>business_valid_from)),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  reason_code text CHECK (reason_code IN ('LABEL_CORRECTION','APPLICABILITY_CORRECTION','RETIREMENT')),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash)=32),
  FOREIGN KEY (term_id,governance_object_id,dimension,code) REFERENCES person_master.assignment_semantic_term (term_id,governance_object_id,dimension,code),
  UNIQUE (term_id,version_no), UNIQUE (governance_object_id,request_id),
  UNIQUE (term_version_id,term_id), UNIQUE (term_version_id,governance_object_id,dimension,code),
  FOREIGN KEY (supersedes_term_version_id,term_id) REFERENCES person_master.assignment_semantic_term_version (term_version_id,term_id)
);
CREATE INDEX assignment_semantic_term_record_lookup ON person_master.assignment_semantic_term_version (term_id,recorded_from,version_no DESC);

CREATE TABLE person_master.assignment_version_semantics (
  assignment_version_id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  person_id uuid NOT NULL,
  purpose_term_version_id uuid NOT NULL,
  purpose_dimension text NOT NULL DEFAULT 'PURPOSE' CHECK (purpose_dimension='PURPOSE'),
  purpose_code text NOT NULL,
  mode_term_version_id uuid NOT NULL,
  mode_dimension text NOT NULL DEFAULT 'MODE' CHECK (mode_dimension='MODE'),
  mode_code text NOT NULL,
  constraint_scope_code text NOT NULL CHECK (constraint_scope_code='HOSPITAL_DEPARTMENT_PLACEMENTS'),
  semantic_operation_kind text NOT NULL CHECK (semantic_operation_kind IN ('CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT')),
  correction_reason_code text CHECK (correction_reason_code IN ('PURPOSE_CORRECTION','MODE_CORRECTION','PURPOSE_AND_MODE_CORRECTION')),
  business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(business_valid_from)),
  business_valid_to timestamp without time zone CHECK (business_valid_to IS NULL OR (isfinite(business_valid_to) AND business_valid_to>business_valid_from)),
  semantic_recorded_from timestamp without time zone NOT NULL CHECK (isfinite(semantic_recorded_from)),
  evaluation_record_as_of timestamp without time zone NOT NULL CHECK (isfinite(evaluation_record_as_of)),
  policy_code text NOT NULL CHECK (policy_code='ASSIGNMENT_PRIMARY_DEPARTMENT_SCOPE_V1'),
  policy_version integer NOT NULL CHECK (policy_version=1),
  policy_digest bytea NOT NULL CHECK (policy_digest=decode('791b816a14b150613ba0935d031e27ef07a19c4715bc1d20e2135a9885f764bb','hex')),
  evaluation jsonb NOT NULL CHECK (jsonb_typeof(evaluation)='object' AND octet_length(evaluation::text)<=65536),
  semantic_fingerprint bytea NOT NULL CHECK (octet_length(semantic_fingerprint)=32),
  request_id text NOT NULL,
  created_by uuid NOT NULL,
  operation_hash bytea NOT NULL,
  FOREIGN KEY (assignment_version_id,assignment_id) REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  FOREIGN KEY (assignment_version_id,engagement_id) REFERENCES person_master.assignment_version (assignment_version_id,engagement_id),
  FOREIGN KEY (assignment_version_id,governance_object_id,request_id,created_by,operation_hash)
    REFERENCES person_master.assignment_version (assignment_version_id,governance_object_id,request_id,created_by,operation_hash),
  FOREIGN KEY (engagement_id,person_id,governance_object_id) REFERENCES person_master.engagement (engagement_id,person_id,governance_object_id),
  FOREIGN KEY (purpose_term_version_id,governance_object_id,purpose_dimension,purpose_code)
    REFERENCES person_master.assignment_semantic_term_version (term_version_id,governance_object_id,dimension,code),
  FOREIGN KEY (mode_term_version_id,governance_object_id,mode_dimension,mode_code)
    REFERENCES person_master.assignment_semantic_term_version (term_version_id,governance_object_id,dimension,code),
  CHECK ((semantic_operation_kind='SEMANTIC_CORRECT')=(correction_reason_code IS NOT NULL)),
  CHECK (evaluation_record_as_of<=semantic_recorded_from)
);

ALTER TABLE person_master.assignment_version DROP CONSTRAINT assignment_version_reason_code_check;
ALTER TABLE person_master.assignment_version ADD CONSTRAINT assignment_version_reason_code_check
  CHECK (reason_code IN ('VALIDITY_CORRECTION','CONTINUATION_EXTENSION','SEMANTIC_ADOPTION','SEMANTIC_CORRECTION'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_operation_type_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_operation_type_check
  CHECK (operation_type IN ('CREATE','REVISE','CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_rejection_code_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_rejection_code_check CHECK (rejection_code IN (
    'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT','ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE',
    'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT','ASSIGNMENT_SEMANTIC_REVISION_REQUIRED','ASSIGNMENT_ALREADY_CLASSIFIED',
    'ASSIGNMENT_SEMANTICS_REQUIRED','ASSIGNMENT_TERM_NOT_APPLICABLE',
    'ASSIGNMENT_STALE_VERSION','ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED',
    'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED','ASSIGNMENT_DEPENDENCY_UNKNOWN',
    'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT','ASSIGNMENT_PLACEMENT_NOT_FOUND',
    'ASSIGNMENT_PLACEMENT_UNPUBLISHED','ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
    'ASSIGNMENT_PLACEMENT_NOT_ACTIVE','ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
    'ENGAGEMENT_NOT_FOUND','ENGAGEMENT_NOT_KNOWN_AS_OF'));

CREATE FUNCTION person_master.guard_assignment_semantic_term_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t person_master.assignment_semantic_term; p person_master.assignment_semantic_term_version;
BEGIN
  SELECT * INTO t FROM person_master.assignment_semantic_term WHERE term_id=NEW.term_id FOR UPDATE;
  SELECT * INTO p FROM person_master.assignment_semantic_term_version WHERE term_id=NEW.term_id ORDER BY version_no DESC LIMIT 1;
  IF p.term_version_id IS NULL THEN
    IF NEW.version_no<>1 OR NEW.supersedes_term_version_id IS NOT NULL OR NEW.reason_code IS NOT NULL
      OR NEW.created_by<>t.created_by OR NEW.request_id<>t.creation_request_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_TERM_FIRST_VERSION_INVALID' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.version_no<>p.version_no+1 OR NEW.supersedes_term_version_id IS DISTINCT FROM p.term_version_id
    OR NEW.recorded_from<=p.recorded_from OR NEW.reason_code IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_TERM_VERSION_SEQUENCE_INVALID' USING ERRCODE='23514';
  END IF;
  IF NEW.recorded_from>platform.local_now() OR NEW.recorded_from<t.created_at THEN
    RAISE EXCEPTION 'ASSIGNMENT_TERM_RECORD_TIME_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_semantic_term_version_guard BEFORE INSERT ON person_master.assignment_semantic_term_version
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_semantic_term_version();
CREATE FUNCTION person_master.guard_assignment_semantic_term_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM person_master.assignment_semantic_term_version WHERE term_id=NEW.term_id AND version_no=1) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TERM_FIRST_VERSION_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER assignment_semantic_term_complete AFTER INSERT ON person_master.assignment_semantic_term
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_semantic_term_complete();
CREATE TRIGGER assignment_semantic_term_scope BEFORE INSERT ON person_master.assignment_semantic_term
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_subject_scope();

-- Raw SQL follows the existing raw share fence. Applications acquire the stronger
-- classified UPDATE lock directly, before core inserts; no application upgrade.
CREATE FUNCTION person_master.pin_assignment_semantic_engagement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR SHARE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_version_semantic_fence BEFORE INSERT ON person_master.assignment_version
  FOR EACH ROW EXECUTE FUNCTION person_master.pin_assignment_semantic_engagement();

CREATE FUNCTION person_master.guard_assignment_semantics() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; d person_master.assignment_semantic_term_version;
  candidate record; candidate_count integer:=0; primary_count integer:=0; unknown_count integer:=0;
BEGIN
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=NEW.assignment_version_id;
  IF NEW.semantic_recorded_from IS DISTINCT FROM v.recorded_from
    OR NEW.evaluation_record_as_of IS DISTINCT FROM v.evaluation_record_as_of
    OR NEW.business_valid_from IS DISTINCT FROM v.business_valid_from
    OR NEW.business_valid_to IS DISTINCT FROM v.business_valid_to THEN
    RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_VERSION_PAIR_INVALID' USING ERRCODE='23514';
  END IF;
  -- Each volatile statement obtains fresh visibility after any E lock wait under RC.
  PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR UPDATE;
  FOR d IN SELECT * FROM person_master.assignment_semantic_term_version
    WHERE term_version_id IN (NEW.purpose_term_version_id,NEW.mode_term_version_id) LOOP
    IF d.definition_state<>'ENABLED' OR d.recorded_from>NEW.evaluation_record_as_of
      OR NOT (tsrange(d.business_valid_from,d.business_valid_to,'[)') @> tsrange(NEW.business_valid_from,NEW.business_valid_to,'[)'))
      OR d.term_version_id IS DISTINCT FROM (SELECT term_version_id FROM person_master.assignment_semantic_term_version
        WHERE term_id=d.term_id AND recorded_from<=NEW.evaluation_record_as_of ORDER BY version_no DESC LIMIT 1) THEN
      RAISE EXCEPTION 'ASSIGNMENT_TERM_NOT_APPLICABLE' USING ERRCODE='23514';
    END IF;
  END LOOP;
  -- Current complete declarations protect direct SQL against a caller's stale R.
  -- This does not claim protection against a superuser disabling native guards.
  FOR candidate IN
    SELECT latest.*, s.purpose_code, s.mode_code FROM
      (SELECT DISTINCT ON (av.assignment_id) av.assignment_id,av.assignment_version_id,av.business_period,av.recorded_from
       FROM person_master.assignment_version av
       WHERE av.engagement_id=NEW.engagement_id AND av.governance_object_id=NEW.governance_object_id
         AND av.assignment_id<>NEW.assignment_id
       ORDER BY av.assignment_id,av.version_no DESC) latest
      LEFT JOIN person_master.assignment_version_semantics s USING (assignment_version_id)
    LIMIT 65
  LOOP
    candidate_count:=candidate_count+1;
    IF candidate_count>64 THEN RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT' USING ERRCODE='23514'; END IF;
    IF candidate.recorded_from>NEW.evaluation_record_as_of THEN
      RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_SNAPSHOT_STALE' USING ERRCODE='40001';
    END IF;
    IF candidate.business_period && tsrange(NEW.business_valid_from,NEW.business_valid_to,'[)') THEN
      IF candidate.purpose_code IS NULL THEN unknown_count:=unknown_count+1;
      ELSIF candidate.purpose_code=NEW.purpose_code AND candidate.mode_code='PRIMARY_AFFILIATION' THEN primary_count:=primary_count+1;
      END IF;
    END IF;
  END LOOP;
  IF NEW.mode_code='PRIMARY_AFFILIATION' AND primary_count>0 THEN
    RAISE EXCEPTION 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' USING ERRCODE='23514';
  END IF;
  IF NEW.mode_code='PRIMARY_AFFILIATION' AND unknown_count>0 THEN
    RAISE EXCEPTION 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  IF (NEW.evaluation->>'confirmedPrimaryCount')::integer IS DISTINCT FROM primary_count
    OR (NEW.evaluation->>'unclassifiedCandidateCount')::integer IS DISTINCT FROM unknown_count THEN
    RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_EVIDENCE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_semantics_guard BEFORE INSERT ON person_master.assignment_version_semantics
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_semantics();

CREATE OR REPLACE FUNCTION person_master.guard_assignment_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; segment person_master.assignment_validation_segment;
  expected_from timestamp without time zone; expected_no integer; target uuid;
  semantics person_master.assignment_version_semantics; prior_semantics person_master.assignment_version_semantics;
  prior_version person_master.assignment_version; expected_operation text;
BEGIN
  IF TG_TABLE_NAME='assignment' THEN
    SELECT assignment_version_id INTO target FROM person_master.assignment_version WHERE assignment_id=NEW.assignment_id AND version_no=1;
  ELSE target:=NEW.assignment_version_id; END IF;
  IF target IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_FIRST_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=target;
  SELECT * INTO semantics FROM person_master.assignment_version_semantics WHERE assignment_version_id=target;
  SELECT * INTO prior_version FROM person_master.assignment_version WHERE assignment_version_id=v.supersedes_assignment_version_id;
  SELECT * INTO prior_semantics FROM person_master.assignment_version_semantics WHERE assignment_version_id=v.supersedes_assignment_version_id;
  expected_operation:=CASE WHEN v.version_no=1 THEN 'CREATE' ELSE 'REVISE' END;
  IF semantics.assignment_version_id IS NULL THEN
    IF v.reason_code IN ('SEMANTIC_ADOPTION','SEMANTIC_CORRECTION') OR EXISTS
      (SELECT 1 FROM person_master.assignment_version_semantics s JOIN person_master.assignment_version av USING (assignment_version_id)
       WHERE av.assignment_id=v.assignment_id AND av.version_no<v.version_no) THEN
      RAISE EXCEPTION 'ASSIGNMENT_SEMANTICS_REQUIRED' USING ERRCODE='23514';
    END IF;
  ELSE
    expected_operation:=semantics.semantic_operation_kind;
    IF v.version_no=1 THEN
      IF expected_operation<>'CLASSIFIED_CREATE' THEN RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_OPERATION_INVALID' USING ERRCODE='23514'; END IF;
    ELSIF prior_semantics.assignment_version_id IS NULL THEN
      IF expected_operation<>'SEMANTIC_ADOPT' OR v.reason_code IS DISTINCT FROM 'SEMANTIC_ADOPTION'
        OR v.business_valid_from IS DISTINCT FROM prior_version.business_valid_from OR v.business_valid_to IS DISTINCT FROM prior_version.business_valid_to THEN
        RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_ADOPTION_INVALID' USING ERRCODE='23514';
      END IF;
    ELSIF expected_operation='CLASSIFIED_PERIOD_REVISE' THEN
      IF v.reason_code NOT IN ('VALIDITY_CORRECTION','CONTINUATION_EXTENSION')
        OR semantics.purpose_code<>prior_semantics.purpose_code OR semantics.mode_code<>prior_semantics.mode_code THEN
        RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_PERIOD_REVISION_INVALID' USING ERRCODE='23514';
      END IF;
    ELSIF expected_operation='SEMANTIC_CORRECT' THEN
      IF v.reason_code IS DISTINCT FROM 'SEMANTIC_CORRECTION'
        OR v.business_valid_from IS DISTINCT FROM prior_version.business_valid_from OR v.business_valid_to IS DISTINCT FROM prior_version.business_valid_to THEN
        RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_CORRECTION_INVALID' USING ERRCODE='23514';
      END IF;
    ELSE RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_OPERATION_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
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
      AND o.operation_type=expected_operation) THEN
    RAISE EXCEPTION 'ASSIGNMENT_SUCCESS_OUTCOME_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER assignment_semantics_complete AFTER INSERT ON person_master.assignment_version_semantics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_complete();

CREATE TRIGGER assignment_semantic_term_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_semantic_term
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_semantic_term_no_truncate BEFORE TRUNCATE ON person_master.assignment_semantic_term
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_semantic_term FROM PUBLIC;
CREATE TRIGGER assignment_semantic_term_version_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_semantic_term_version
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_semantic_term_version_no_truncate BEFORE TRUNCATE ON person_master.assignment_semantic_term_version
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_semantic_term_version FROM PUBLIC;
CREATE TRIGGER assignment_version_semantics_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_version_semantics
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_version_semantics_no_truncate BEFORE TRUNCATE ON person_master.assignment_version_semantics
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_version_semantics FROM PUBLIC;
COMMENT ON TABLE person_master.assignment_semantic_term IS 'C02 closed independent PURPOSE/MODE stable code identity. SYNTHETIC NON_PRODUCTION TEST POLICY ONLY.';
COMMENT ON TABLE person_master.assignment_semantic_term_version IS 'Immutable complete definition periods, latest-at-R selection, frozen exact labels. Asia/Shanghai local timestamps.';
COMMENT ON TABLE person_master.assignment_version_semantics IS 'Atomic exact-version classification. Missing row is UNCLASSIFIED, never a default mode. Scoped at-most-one declaration; no clinical eligibility.';
INSERT INTO platform.schema_migration (migration_id) VALUES ('0033_person_assignment_semantics');
COMMIT;
