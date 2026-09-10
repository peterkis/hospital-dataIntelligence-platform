BEGIN;

-- PV-006-C-03-02. SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY / Asia/Shanghai.
-- Original migrations and original row evidence are never rewritten.
CREATE TABLE person_master.assignment_transfer (
  transfer_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(transfer_id)=7),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  root_request_id text NOT NULL CHECK (length(btrim(root_request_id)) BETWEEN 1 AND 128
    AND root_request_id NOT LIKE '~assignment-transfer:%'),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash)=32),
  source_operation_hash bytea NOT NULL CHECK (octet_length(source_operation_hash)=32),
  target_operation_hash bytea NOT NULL CHECK (octet_length(target_operation_hash)=32),
  source_assignment_id uuid NOT NULL UNIQUE REFERENCES person_master.assignment,
  source_previous_version_id uuid NOT NULL REFERENCES person_master.assignment_version,
  source_closure_version_id uuid NOT NULL UNIQUE DEFAULT uuidv7(),
  target_assignment_id uuid NOT NULL UNIQUE DEFAULT uuidv7(),
  target_admission_version_id uuid NOT NULL UNIQUE DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  source_department_governance_object_id uuid NOT NULL,
  source_department_id uuid NOT NULL,
  target_department_governance_object_id uuid NOT NULL,
  target_department_id uuid NOT NULL,
  source_original_from timestamp without time zone NOT NULL CHECK (isfinite(source_original_from)),
  source_original_to timestamp without time zone CHECK (source_original_to IS NULL OR isfinite(source_original_to)),
  effective_at timestamp without time zone NOT NULL CHECK (isfinite(effective_at)),
  preserved_purpose_code text NOT NULL,
  preserved_mode_code text NOT NULL,
  source_request_id text NOT NULL,
  target_request_id text NOT NULL,
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  policy_code text NOT NULL CHECK (policy_code='ASSIGNMENT_ATOMIC_TRANSFER_V1'),
  policy_version integer NOT NULL CHECK (policy_version=1),
  policy_digest bytea NOT NULL CHECK (octet_length(policy_digest)=32),
  UNIQUE (governance_object_id,root_request_id),
  UNIQUE (governance_object_id,source_request_id),
  UNIQUE (governance_object_id,target_request_id),
  CHECK (source_assignment_id<>target_assignment_id AND source_department_id<>target_department_id),
  CHECK (source_original_from<effective_at AND (source_original_to IS NULL OR effective_at<source_original_to)),
  FOREIGN KEY (engagement_id,person_id,governance_object_id)
    REFERENCES person_master.engagement (engagement_id,person_id,governance_object_id),
  FOREIGN KEY (target_department_id,target_department_governance_object_id)
    REFERENCES department_master.department (department_id,governance_object_id),
  FOREIGN KEY (source_closure_version_id) REFERENCES person_master.assignment_version DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_assignment_id) REFERENCES person_master.assignment DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_admission_version_id) REFERENCES person_master.assignment_version DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE person_master.assignment_command_outcome ADD COLUMN transfer_id uuid
  REFERENCES person_master.assignment_transfer DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_outcome_exclusive_result CHECK (
  (operation_type<>'TRANSFER' AND assignment_version_id IS NOT NULL AND transfer_id IS NULL AND rejection_code IS NULL)
  OR (operation_type='TRANSFER' AND assignment_version_id IS NULL AND transfer_id IS NOT NULL AND rejection_code IS NULL)
  OR (assignment_version_id IS NULL AND transfer_id IS NULL AND rejection_code IS NOT NULL));

-- Namespace encoding is the exact UTF-8 SHA-256 of the canonical two-string JSON array.
CREATE FUNCTION person_master.assignment_transfer_child(scope uuid, root_request text, side text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT '~assignment-transfer:' || encode(digest(convert_to(
    '[' || to_json(scope::text)::text || ',' || to_json(root_request)::text || ']', 'UTF8'),'sha256'),'hex') || ':' || side
$$;

CREATE FUNCTION person_master.guard_assignment_transfer_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a person_master.assignment; v person_master.assignment_version; s person_master.assignment_version_semantics;
  locked_publication uuid; fresh_publication uuid; publication_count integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_WRITE_ISOLATION_UNSUPPORTED' USING ERRCODE='0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ASSIGNMENT:'||NEW.governance_object_id||':'||NEW.root_request_id,0));
  IF EXISTS (SELECT 1 FROM person_master.assignment_command_outcome
    WHERE governance_object_id=NEW.governance_object_id AND request_id=NEW.root_request_id) THEN
    RAISE EXCEPTION 'ASSIGNMENT_OPERATION_CONFLICT' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM person_master.assignment WHERE assignment_id=NEW.source_assignment_id FOR UPDATE;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_id=a.assignment_id ORDER BY version_no DESC LIMIT 1;
  SELECT * INTO s FROM person_master.assignment_version_semantics WHERE assignment_version_id=v.assignment_version_id;
  IF v.assignment_version_id IS DISTINCT FROM NEW.source_previous_version_id OR v.evidence_kind IS DISTINCT FROM 'ADMISSION'
    OR s.assignment_version_id IS NULL OR a.governance_object_id IS DISTINCT FROM NEW.governance_object_id
    OR a.person_id IS DISTINCT FROM NEW.person_id OR a.engagement_id IS DISTINCT FROM NEW.engagement_id
    OR a.department_id IS DISTINCT FROM NEW.source_department_id
    OR a.department_governance_object_id IS DISTINCT FROM NEW.source_department_governance_object_id
    OR v.business_valid_from IS DISTINCT FROM NEW.source_original_from OR v.business_valid_to IS DISTINCT FROM NEW.source_original_to
    OR s.purpose_code IS DISTINCT FROM NEW.preserved_purpose_code OR s.mode_code IS DISTINCT FROM NEW.preserved_mode_code
    OR NEW.source_request_id IS DISTINCT FROM person_master.assignment_transfer_child(NEW.governance_object_id,NEW.root_request_id,'source')
    OR NEW.target_request_id IS DISTINCT FROM person_master.assignment_transfer_child(NEW.governance_object_id,NEW.root_request_id,'target') THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_SOURCE_INVALID' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR UPDATE;
  -- The same publication fence used by the Department owner, with a fresh selection after waiting.
  SELECT department_version_id INTO locked_publication FROM department_master.department_version
    WHERE department_id=NEW.target_department_id AND governance_status='PUBLISHED' AND recorded_to IS NULL
    ORDER BY department_version_id LIMIT 1 FOR SHARE;
  SELECT count(*),min(department_version_id::text)::uuid INTO publication_count,fresh_publication
    FROM department_master.department_version WHERE department_id=NEW.target_department_id AND governance_status='PUBLISHED' AND recorded_to IS NULL;
  IF publication_count<>1 OR locked_publication IS DISTINCT FROM fresh_publication THEN
    RAISE EXCEPTION 'DEPENDENCY_CHANGED_DURING_VALIDATION' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM person_master.assignment_semantic_term WHERE governance_object_id=NEW.governance_object_id
    AND ((dimension='PURPOSE' AND code=NEW.preserved_purpose_code) OR (dimension='MODE' AND code=NEW.preserved_mode_code))
    ORDER BY term_id FOR SHARE;
  -- All participant IDs and R are signed here, never caller-selected or moved into the future.
  NEW.transfer_id:=uuidv7(); NEW.source_closure_version_id:=uuidv7();
  NEW.target_assignment_id:=uuidv7(); NEW.target_admission_version_id:=uuidv7();
  NEW.recorded_from:=platform.local_now();
  IF NEW.recorded_from<=v.recorded_from THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_CLOCK_RETRY' USING ERRCODE='40001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_transfer_header BEFORE INSERT ON person_master.assignment_transfer
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_header();

CREATE FUNCTION person_master.guard_assignment_transfer_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t person_master.assignment_transfer; request text;
BEGIN
  IF TG_TABLE_NAME='assignment' THEN request:=NEW.creation_request_id; ELSE request:=NEW.request_id; END IF;
  IF request NOT LIKE '~assignment-transfer:%' THEN RETURN NEW; END IF;
  SELECT * INTO t FROM person_master.assignment_transfer WHERE governance_object_id=NEW.governance_object_id
    AND (source_request_id=request OR target_request_id=request);
  IF NOT FOUND OR NEW.created_by IS DISTINCT FROM t.created_by THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_PARENT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_WRITE_ISOLATION_UNSUPPORTED' USING ERRCODE='0A000';
  END IF;
  IF TG_TABLE_NAME='assignment' THEN
    IF request<>t.target_request_id OR NEW.engagement_id<>t.engagement_id OR NEW.person_id<>t.person_id
      OR NEW.department_id<>t.target_department_id OR NEW.department_governance_object_id<>t.target_department_governance_object_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_TARGET_INVALID' USING ERRCODE='23514';
    END IF;
    NEW.assignment_id:=t.target_assignment_id; NEW.created_at:=t.recorded_from;
  ELSIF TG_TABLE_NAME='assignment_version' THEN
    IF request=t.source_request_id THEN
      IF NEW.assignment_id<>t.source_assignment_id OR NEW.evidence_kind<>'CLOSURE'
        OR NEW.supersedes_assignment_version_id IS DISTINCT FROM t.source_previous_version_id THEN
        RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_SOURCE_INVALID' USING ERRCODE='23514';
      END IF;
      NEW.assignment_version_id:=t.source_closure_version_id;
    ELSE
      IF NEW.assignment_id<>t.target_assignment_id OR NEW.evidence_kind<>'ADMISSION' OR NEW.version_no<>1
        OR NEW.evaluation_record_as_of IS DISTINCT FROM t.recorded_from THEN
        RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_TARGET_INVALID' USING ERRCODE='23514';
      END IF;
      NEW.assignment_version_id:=t.target_admission_version_id;
    END IF;
    NEW.recorded_from:=t.recorded_from;
  ELSE
    IF NEW.rejection_code IS NOT NULL OR NEW.transfer_id IS NOT NULL
      OR (request=t.source_request_id AND (NEW.operation_type<>'END' OR NEW.assignment_version_id IS DISTINCT FROM t.source_closure_version_id))
      OR (request=t.target_request_id AND (NEW.operation_type<>'CLASSIFIED_CREATE' OR NEW.assignment_version_id IS DISTINCT FROM t.target_admission_version_id)) THEN
      RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_CHILD_RESULT_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_00_transfer BEFORE INSERT ON person_master.assignment
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_participant();
CREATE TRIGGER assignment_version_00_transfer BEFORE INSERT ON person_master.assignment_version
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_participant();
CREATE TRIGGER assignment_outcome_00_transfer BEFORE INSERT ON person_master.assignment_command_outcome
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_participant();

CREATE FUNCTION person_master.guard_assignment_transfer_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t person_master.assignment_transfer; c person_master.assignment_version; v person_master.assignment_version;
  a person_master.assignment; s person_master.assignment_version_semantics; prior_s person_master.assignment_version_semantics;
  ce person_master.assignment_closure_evidence; root person_master.assignment_command_outcome;
BEGIN
  IF TG_TABLE_NAME='assignment_transfer' THEN t:=NEW;
  ELSE
    SELECT * INTO t FROM person_master.assignment_transfer WHERE transfer_id=NEW.transfer_id;
    IF NOT FOUND THEN
      IF NEW.operation_type='TRANSFER' AND (NEW.rejection_code IS NULL OR EXISTS
        (SELECT 1 FROM person_master.assignment_transfer WHERE governance_object_id=NEW.governance_object_id AND root_request_id=NEW.request_id)) THEN
        RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_INCOMPLETE' USING ERRCODE='23514';
      END IF;
      RETURN NULL;
    END IF;
  END IF;
  SELECT * INTO c FROM person_master.assignment_version WHERE assignment_version_id=t.source_closure_version_id;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=t.target_admission_version_id;
  SELECT * INTO a FROM person_master.assignment WHERE assignment_id=t.target_assignment_id;
  SELECT * INTO s FROM person_master.assignment_version_semantics WHERE assignment_version_id=t.target_admission_version_id;
  SELECT * INTO prior_s FROM person_master.assignment_version_semantics WHERE assignment_version_id=t.source_previous_version_id;
  SELECT * INTO ce FROM person_master.assignment_closure_evidence WHERE closure_assignment_version_id=t.source_closure_version_id;
  SELECT * INTO root FROM person_master.assignment_command_outcome WHERE governance_object_id=t.governance_object_id AND request_id=t.root_request_id;
  IF c.assignment_id IS DISTINCT FROM t.source_assignment_id OR c.evidence_kind IS DISTINCT FROM 'CLOSURE'
    OR c.supersedes_assignment_version_id IS DISTINCT FROM t.source_previous_version_id
    OR c.business_valid_from IS DISTINCT FROM t.source_original_from OR c.business_valid_to IS DISTINCT FROM t.effective_at
    OR v.assignment_id IS DISTINCT FROM t.target_assignment_id OR v.evidence_kind IS DISTINCT FROM 'ADMISSION' OR v.version_no IS DISTINCT FROM 1
    OR v.business_valid_from IS DISTINCT FROM t.effective_at OR v.business_valid_to IS DISTINCT FROM t.source_original_to
    OR a.governance_object_id IS DISTINCT FROM t.governance_object_id OR a.person_id IS DISTINCT FROM t.person_id
    OR a.engagement_id IS DISTINCT FROM t.engagement_id OR a.department_id IS DISTINCT FROM t.target_department_id
    OR a.department_governance_object_id IS DISTINCT FROM t.target_department_governance_object_id
    OR c.recorded_from IS DISTINCT FROM t.recorded_from OR v.recorded_from IS DISTINCT FROM t.recorded_from
    OR a.created_at IS DISTINCT FROM t.recorded_from OR s.semantic_recorded_from IS DISTINCT FROM t.recorded_from
    OR v.evaluation_record_as_of IS DISTINCT FROM t.recorded_from OR s.evaluation_record_as_of IS DISTINCT FROM t.recorded_from
    OR s.purpose_code IS DISTINCT FROM t.preserved_purpose_code OR s.mode_code IS DISTINCT FROM t.preserved_mode_code
    OR ce.source_semantics_version_id IS DISTINCT FROM prior_s.assignment_version_id
    OR ce.source_semantic_fingerprint IS DISTINCT FROM prior_s.semantic_fingerprint
    OR c.request_id IS DISTINCT FROM t.source_request_id OR v.request_id IS DISTINCT FROM t.target_request_id
    OR c.operation_hash IS DISTINCT FROM t.source_operation_hash OR v.operation_hash IS DISTINCT FROM t.target_operation_hash
    OR c.created_by IS DISTINCT FROM t.created_by OR v.created_by IS DISTINCT FROM t.created_by
    OR root.transfer_id IS DISTINCT FROM t.transfer_id OR root.operation_type IS DISTINCT FROM 'TRANSFER'
    OR root.operation_hash IS DISTINCT FROM t.operation_hash OR root.created_by IS DISTINCT FROM t.created_by
    OR root.assignment_version_id IS NOT NULL OR root.rejection_code IS NOT NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  -- Existing completion guards independently require both child outcomes and all admission/closure evidence.
  PERFORM person_master.require_assignment_closure_complete(t.source_closure_version_id);
  IF NOT EXISTS (SELECT 1 FROM audit.audit_event WHERE governance_object_id=t.governance_object_id AND request_id=t.root_request_id
    AND actor_principal_id=t.created_by AND stable_entity_id=t.transfer_id AND action='PERSON_ASSIGNMENT_TRANSFERRED')
    OR NOT EXISTS (SELECT 1 FROM audit.audit_event WHERE governance_object_id=t.governance_object_id AND request_id=t.target_request_id
      AND actor_principal_id=t.created_by AND entity_version_id=t.target_admission_version_id AND action='PERSON_ASSIGNMENT_CREATED')
    OR NOT EXISTS (SELECT 1 FROM audit.audit_event WHERE governance_object_id=t.governance_object_id AND request_id=t.target_request_id
      AND actor_principal_id=t.created_by AND entity_version_id=t.target_admission_version_id AND action='ASSIGNMENT_SEMANTICS_RECORDED') THEN
    RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_AUDIT_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER assignment_transfer_complete AFTER INSERT ON person_master.assignment_transfer
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_complete();
CREATE CONSTRAINT TRIGGER assignment_transfer_outcome_complete AFTER INSERT ON person_master.assignment_command_outcome
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_transfer_complete();
CREATE TRIGGER assignment_transfer_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_transfer
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_transfer_no_truncate BEFORE TRUNCATE ON person_master.assignment_transfer
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_transfer FROM PUBLIC;
COMMENT ON TABLE person_master.assignment_transfer IS 'SYNTHETIC NON_PRODUCTION exact atomic transfer mapping; no pending workflow state. Database-issued operation knowledge time, not commit time; Asia/Shanghai.';

-- Forward-only replacements below retain the original permission/rejection domains and ordinary version guard.
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
    'PERSON_MASTER_ASSIGNMENT_TRANSFER', 'PERSON_MASTER_ASSIGNMENT_END', 'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'
  ));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_operation_type_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_operation_type_check
  CHECK (operation_type IN ('CREATE','REVISE','CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT','END','TRANSFER'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_rejection_code_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_rejection_code_check CHECK (rejection_code IN (
    'ASSIGNMENT_TRANSFER_SOURCE_UNCLASSIFIED','ASSIGNMENT_TRANSFER_PERIOD_INVALID','ASSIGNMENT_TRANSFER_SAME_DEPARTMENT','ASSIGNMENT_ALREADY_CLOSED','ASSIGNMENT_CLOSURE_PERIOD_INVALID','ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN',
    'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT','ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE',
    'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT','ASSIGNMENT_SEMANTIC_REVISION_REQUIRED','ASSIGNMENT_ALREADY_CLASSIFIED',
    'ASSIGNMENT_SEMANTICS_REQUIRED','ASSIGNMENT_TERM_NOT_APPLICABLE',
    'ASSIGNMENT_STALE_VERSION','ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED',
    'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED','ASSIGNMENT_DEPENDENCY_UNKNOWN',
    'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT','ASSIGNMENT_PLACEMENT_NOT_FOUND',
    'ASSIGNMENT_PLACEMENT_UNPUBLISHED','ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
    'ASSIGNMENT_PLACEMENT_NOT_ACTIVE','ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
    'ENGAGEMENT_NOT_FOUND','ENGAGEMENT_NOT_KNOWN_AS_OF'));
CREATE OR REPLACE FUNCTION person_master.guard_assignment_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stable person_master.assignment; prior person_master.assignment_version;
BEGIN
  SELECT * INTO stable FROM person_master.assignment WHERE assignment_id=NEW.assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE='23503'; END IF;
  SELECT * INTO prior FROM person_master.assignment_version WHERE assignment_id=NEW.assignment_id ORDER BY version_no DESC LIMIT 1;
  IF prior.evidence_kind='CLOSURE' THEN
    RAISE EXCEPTION 'ASSIGNMENT_ALREADY_CLOSED' USING ERRCODE='23514';
  END IF;
  IF NEW.evidence_kind='CLOSURE' THEN
    IF current_setting('transaction_isolation')<>'read committed' THEN
      RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_WRITE_ISOLATION_UNSUPPORTED' USING ERRCODE='0A000';
    END IF;
    IF prior.assignment_version_id IS NULL OR prior.evidence_kind IS DISTINCT FROM 'ADMISSION' THEN
      RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_PREDECESSOR_REQUIRED' USING ERRCODE='23514';
    END IF;
    IF NEW.business_valid_from IS DISTINCT FROM prior.business_valid_from
      OR NEW.business_valid_to IS NULL OR NOT isfinite(NEW.business_valid_to)
      OR NEW.business_valid_to<=prior.business_valid_from
      OR (prior.business_valid_to IS NOT NULL AND NEW.business_valid_to>prior.business_valid_to) THEN
      RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_NON_EXPANSION_REQUIRED' USING ERRCODE='23514';
    END IF;
    -- Same strong identity fence as classified writes, with no business-state read.
    PERFORM 1 FROM person_master.engagement WHERE engagement_id=stable.engagement_id
      AND governance_object_id=stable.governance_object_id AND person_id=stable.person_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_IDENTITY_INVALID' USING ERRCODE='23503'; END IF;
    -- The native closure clock is generated after the serialization fence, never backfilled.
    IF NEW.request_id LIKE '~assignment-transfer:%' THEN
      SELECT recorded_from INTO NEW.recorded_from FROM person_master.assignment_transfer
        WHERE governance_object_id=NEW.governance_object_id AND source_request_id=NEW.request_id
          AND source_closure_version_id=NEW.assignment_version_id;
      IF NEW.recorded_from IS NULL THEN
        RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_PARENT_REQUIRED' USING ERRCODE='23514';
      END IF;
    ELSE
      NEW.recorded_from:=platform.local_now();
    END IF;
  END IF;
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
INSERT INTO platform.schema_migration (migration_id) VALUES ('0036_person_assignment_atomic_transfer');
COMMIT;
