BEGIN;

-- PV-006-C-03-01: SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY; Asia/Shanghai.
-- Forward-only: existing ADMISSION evidence columns and original guards remain authoritative.
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
    'PERSON_MASTER_ASSIGNMENT_END', 'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'
  ));


ALTER TABLE person_master.assignment_version DROP CONSTRAINT assignment_version_reason_code_check;
ALTER TABLE person_master.assignment_version ADD CONSTRAINT assignment_version_reason_code_check
  CHECK (reason_code IN ('VALIDITY_CORRECTION','CONTINUATION_EXTENSION','SEMANTIC_ADOPTION','SEMANTIC_CORRECTION','LIFECYCLE_END'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_operation_type_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_operation_type_check
  CHECK (operation_type IN ('CREATE','REVISE','CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT','END'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_rejection_code_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_rejection_code_check CHECK (rejection_code IN (
    'ASSIGNMENT_ALREADY_CLOSED','ASSIGNMENT_CLOSURE_PERIOD_INVALID','ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN',
    'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT','ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE',
    'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT','ASSIGNMENT_SEMANTIC_REVISION_REQUIRED','ASSIGNMENT_ALREADY_CLASSIFIED',
    'ASSIGNMENT_SEMANTICS_REQUIRED','ASSIGNMENT_TERM_NOT_APPLICABLE',
    'ASSIGNMENT_STALE_VERSION','ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED',
    'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED','ASSIGNMENT_DEPENDENCY_UNKNOWN',
    'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT','ASSIGNMENT_PLACEMENT_NOT_FOUND',
    'ASSIGNMENT_PLACEMENT_UNPUBLISHED','ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
    'ASSIGNMENT_PLACEMENT_NOT_ACTIVE','ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED',
    'ENGAGEMENT_NOT_FOUND','ENGAGEMENT_NOT_KNOWN_AS_OF'));


ALTER TABLE person_master.assignment_version
  ADD COLUMN evidence_kind text NOT NULL DEFAULT 'ADMISSION' CHECK (evidence_kind IN ('ADMISSION','CLOSURE')),
  ALTER COLUMN validation_policy_code DROP NOT NULL,
  ALTER COLUMN evaluation_record_as_of DROP NOT NULL,
  ALTER COLUMN authority_engagement_version_id DROP NOT NULL,
  ALTER COLUMN authority_engagement_version_no DROP NOT NULL,
  ALTER COLUMN authority_engagement_recorded_from DROP NOT NULL,
  ALTER COLUMN authority_engagement_valid_from DROP NOT NULL,
  ALTER COLUMN record_visible_lifecycle_sequence DROP NOT NULL,
  ALTER COLUMN department_version_id DROP NOT NULL,
  ALTER COLUMN department_version_no DROP NOT NULL,
  ALTER COLUMN department_content_hash DROP NOT NULL,
  ALTER COLUMN department_recorded_from DROP NOT NULL,
  ALTER COLUMN department_release_id DROP NOT NULL,
  ALTER COLUMN department_publication_projection_id DROP NOT NULL,
  ALTER COLUMN department_published_at DROP NOT NULL,
  ALTER COLUMN department_business_status DROP NOT NULL,
  ALTER COLUMN department_valid_from DROP NOT NULL,
  ALTER COLUMN dependency_fingerprint DROP NOT NULL;
ALTER TABLE person_master.assignment_version ADD CONSTRAINT assignment_evidence_kind_complete CHECK (
  (evidence_kind='ADMISSION' AND reason_code IS DISTINCT FROM 'LIFECYCLE_END'
    AND validation_policy_code IS NOT NULL
    AND evaluation_record_as_of IS NOT NULL
    AND authority_engagement_version_id IS NOT NULL
    AND authority_engagement_version_no IS NOT NULL
    AND authority_engagement_recorded_from IS NOT NULL
    AND authority_engagement_valid_from IS NOT NULL
    AND record_visible_lifecycle_sequence IS NOT NULL
    AND department_version_id IS NOT NULL
    AND department_version_no IS NOT NULL
    AND department_content_hash IS NOT NULL
    AND department_recorded_from IS NOT NULL
    AND department_release_id IS NOT NULL
    AND department_publication_projection_id IS NOT NULL
    AND department_published_at IS NOT NULL
    AND department_business_status IS NOT NULL
    AND department_valid_from IS NOT NULL
    AND dependency_fingerprint IS NOT NULL)
  OR (evidence_kind='CLOSURE' AND reason_code IS NOT DISTINCT FROM 'LIFECYCLE_END'
    AND validation_policy_code IS NULL
    AND evaluation_record_as_of IS NULL
    AND authority_engagement_version_id IS NULL
    AND authority_engagement_version_no IS NULL
    AND authority_engagement_recorded_from IS NULL
    AND authority_engagement_valid_from IS NULL
    AND record_visible_lifecycle_sequence IS NULL
    AND department_version_id IS NULL
    AND department_version_no IS NULL
    AND department_content_hash IS NULL
    AND department_recorded_from IS NULL
    AND department_release_id IS NULL
    AND department_publication_projection_id IS NULL
    AND department_published_at IS NULL
    AND department_business_status IS NULL
    AND department_valid_from IS NULL
    AND dependency_fingerprint IS NULL
    AND authority_engagement_valid_to IS NULL
    AND classification_type_version_id IS NULL
    AND classification_type_version_no IS NULL
    AND classification_type_code IS NULL
    AND classification_category_code IS NULL
    AND classified_at IS NULL
    AND department_recorded_to IS NULL
    AND department_valid_to IS NULL)
);

CREATE TABLE person_master.assignment_closure_evidence (
  closure_assignment_version_id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL UNIQUE,
  governance_object_id uuid NOT NULL,
  previous_assignment_version_id uuid NOT NULL,
  previous_version_no bigint NOT NULL CHECK (previous_version_no>0),
  previous_business_valid_from timestamp without time zone NOT NULL CHECK (isfinite(previous_business_valid_from)),
  previous_business_valid_to timestamp without time zone CHECK (previous_business_valid_to IS NULL OR isfinite(previous_business_valid_to)),
  ended_at timestamp without time zone NOT NULL CHECK (isfinite(ended_at)),
  closure_recorded_from timestamp without time zone NOT NULL CHECK (isfinite(closure_recorded_from)),
  reason_code text NOT NULL CHECK (reason_code IN ('PLACEMENT_ENDED','HISTORICAL_END_RECORDED','ADMINISTRATIVE_CLOSURE')),
  closure_policy_code text NOT NULL CHECK (closure_policy_code='ASSIGNMENT_NON_EXPANSIVE_CLOSURE_V1'),
  closure_policy_version integer NOT NULL CHECK (closure_policy_version=1),
  closure_policy_digest bytea NOT NULL CHECK (closure_policy_digest=decode('aa8ad0d60b7a41f98624e8ac328bd951a11e590f2337205ececc4efd68a98b16','hex')),
  proof_kind text NOT NULL CHECK (proof_kind='NON_EXPANSIVE_CLOSURE'),
  is_period_preserving_end_confirmation boolean NOT NULL,
  source_acceptance_version_id uuid NOT NULL,
  source_acceptance_dependency_fingerprint bytea NOT NULL CHECK (octet_length(source_acceptance_dependency_fingerprint)=32),
  source_semantics_version_id uuid REFERENCES person_master.assignment_version_semantics (assignment_version_id),
  source_semantic_fingerprint bytea CHECK (source_semantic_fingerprint IS NULL OR octet_length(source_semantic_fingerprint)=32),
  semantic_inheritance text NOT NULL CHECK (semantic_inheritance IN ('CLASSIFIED','UNCLASSIFIED')),
  created_by uuid NOT NULL,
  request_id text NOT NULL,
  operation_hash bytea NOT NULL,
  closure_evidence_fingerprint bytea NOT NULL CHECK (octet_length(closure_evidence_fingerprint)=32),
  FOREIGN KEY (closure_assignment_version_id,assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  FOREIGN KEY (closure_assignment_version_id,governance_object_id,request_id,created_by,operation_hash)
    REFERENCES person_master.assignment_version (assignment_version_id,governance_object_id,request_id,created_by,operation_hash),
  FOREIGN KEY (previous_assignment_version_id,assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  FOREIGN KEY (source_acceptance_version_id,assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  CHECK (ended_at>previous_business_valid_from AND (previous_business_valid_to IS NULL OR ended_at<=previous_business_valid_to)),
  CHECK ((semantic_inheritance='CLASSIFIED' AND source_semantics_version_id IS NOT NULL AND source_semantic_fingerprint IS NOT NULL)
    OR (semantic_inheritance='UNCLASSIFIED' AND source_semantics_version_id IS NULL AND source_semantic_fingerprint IS NULL))
);

CREATE FUNCTION person_master.guard_assignment_closure_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; p person_master.assignment_version; s person_master.assignment_version_semantics;
BEGIN
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=NEW.closure_assignment_version_id;
  SELECT * INTO p FROM person_master.assignment_version WHERE assignment_version_id=v.supersedes_assignment_version_id;
  SELECT * INTO s FROM person_master.assignment_version_semantics WHERE assignment_version_id=p.assignment_version_id;
  IF v.evidence_kind IS DISTINCT FROM 'CLOSURE' OR p.evidence_kind IS DISTINCT FROM 'ADMISSION'
    OR NEW.previous_assignment_version_id IS DISTINCT FROM p.assignment_version_id
    OR NEW.previous_version_no IS DISTINCT FROM p.version_no
    OR NEW.previous_business_valid_from IS DISTINCT FROM p.business_valid_from
    OR NEW.previous_business_valid_to IS DISTINCT FROM p.business_valid_to
    OR NEW.ended_at IS DISTINCT FROM v.business_valid_to
    OR NEW.closure_recorded_from IS DISTINCT FROM v.recorded_from
    OR NEW.source_acceptance_version_id IS DISTINCT FROM p.assignment_version_id
    OR NEW.source_acceptance_dependency_fingerprint IS DISTINCT FROM p.dependency_fingerprint
    OR NEW.is_period_preserving_end_confirmation IS DISTINCT FROM (p.business_valid_to IS NOT NULL AND NEW.ended_at=p.business_valid_to)
    OR NEW.source_semantics_version_id IS DISTINCT FROM s.assignment_version_id
    OR NEW.source_semantic_fingerprint IS DISTINCT FROM s.semantic_fingerprint
    OR NEW.semantic_inheritance IS DISTINCT FROM (CASE WHEN s.assignment_version_id IS NULL THEN 'UNCLASSIFIED' ELSE 'CLASSIFIED' END) THEN
    RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_EVIDENCE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_closure_evidence_guard BEFORE INSERT ON person_master.assignment_closure_evidence
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_closure_evidence();

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
    NEW.recorded_from:=platform.local_now();
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

CREATE OR REPLACE FUNCTION person_master.pin_assignment_semantic_engagement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence_kind='CLOSURE' THEN
    PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION person_master.require_assignment_closure_complete(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version;
BEGIN
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=target;
  IF v.evidence_kind IS DISTINCT FROM 'CLOSURE'
    OR NOT EXISTS (SELECT 1 FROM person_master.assignment_closure_evidence WHERE closure_assignment_version_id=target)
    OR EXISTS (SELECT 1 FROM person_master.assignment_validation_segment WHERE assignment_version_id=target)
    OR EXISTS (SELECT 1 FROM person_master.assignment_version_semantics WHERE assignment_version_id=target) THEN
    RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM person_master.assignment_command_outcome o
    WHERE o.governance_object_id=v.governance_object_id AND o.request_id=v.request_id AND o.assignment_version_id=target
      AND o.created_by=v.created_by AND o.operation_hash=v.operation_hash AND o.operation_type='END') THEN
    RAISE EXCEPTION 'ASSIGNMENT_SUCCESS_OUTCOME_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.audit_event a WHERE a.governance_object_id=v.governance_object_id
    AND a.stable_entity_id=v.assignment_id AND a.entity_version_id=target AND a.request_id=v.request_id
    AND a.actor_principal_id=v.created_by AND a.action='PERSON_ASSIGNMENT_ENDED') THEN
    RAISE EXCEPTION 'ASSIGNMENT_CLOSURE_AUDIT_REQUIRED' USING ERRCODE='23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION person_master.guard_assignment_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; segment person_master.assignment_validation_segment;
  expected_from timestamp without time zone; expected_no integer; target uuid;
  semantics person_master.assignment_version_semantics; prior_semantics person_master.assignment_version_semantics;
  prior_version person_master.assignment_version; expected_operation text;
BEGIN
  IF TG_TABLE_NAME='assignment' THEN
    SELECT assignment_version_id INTO target FROM person_master.assignment_version WHERE assignment_id=NEW.assignment_id AND version_no=1;
  ELSIF TG_TABLE_NAME='assignment_closure_evidence' THEN target:=NEW.closure_assignment_version_id;
  ELSE target:=NEW.assignment_version_id; END IF;
  IF target IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_FIRST_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=target;
  IF v.evidence_kind='CLOSURE' THEN
    PERFORM person_master.require_assignment_closure_complete(target);
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM person_master.assignment_closure_evidence WHERE closure_assignment_version_id=target) THEN
    RAISE EXCEPTION 'ASSIGNMENT_EVIDENCE_KIND_MISMATCH' USING ERRCODE='23514';
  END IF;
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

CREATE OR REPLACE FUNCTION person_master.guard_assignment_semantics() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v person_master.assignment_version; d person_master.assignment_semantic_term_version;
  candidate record; candidate_count integer:=0; primary_count integer:=0; unknown_count integer:=0;
BEGIN
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=NEW.assignment_version_id;
  IF v.evidence_kind IS DISTINCT FROM 'ADMISSION' THEN
    RAISE EXCEPTION 'ASSIGNMENT_EVIDENCE_KIND_MISMATCH' USING ERRCODE='23514';
  END IF;
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
      (SELECT DISTINCT ON (av.assignment_id) av.assignment_id,av.assignment_version_id,av.business_period,av.recorded_from,av.evidence_kind
       FROM person_master.assignment_version av
       WHERE av.engagement_id=NEW.engagement_id AND av.governance_object_id=NEW.governance_object_id
         AND av.assignment_id<>NEW.assignment_id
       ORDER BY av.assignment_id,av.version_no DESC) latest
      LEFT JOIN person_master.assignment_closure_evidence ce
        ON latest.evidence_kind='CLOSURE' AND ce.closure_assignment_version_id=latest.assignment_version_id
      LEFT JOIN person_master.assignment_version_semantics s ON s.assignment_version_id=
        CASE WHEN latest.evidence_kind='CLOSURE' THEN ce.source_semantics_version_id ELSE latest.assignment_version_id END
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

CREATE CONSTRAINT TRIGGER assignment_closure_complete AFTER INSERT ON person_master.assignment_closure_evidence
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_complete();
CREATE CONSTRAINT TRIGGER assignment_outcome_complete AFTER INSERT ON person_master.assignment_command_outcome
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.assignment_version_id IS NOT NULL)
  EXECUTE FUNCTION person_master.guard_assignment_complete();
CREATE TRIGGER assignment_closure_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_closure_evidence
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_closure_no_truncate BEFORE TRUNCATE ON person_master.assignment_closure_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_closure_evidence FROM PUBLIC;
COMMENT ON TABLE person_master.assignment_closure_evidence IS 'SYNTHETIC NON_PRODUCTION non-expansive explicit closure; original acceptance pointers do not revalidate remaining history. Asia/Shanghai.';
COMMENT ON COLUMN person_master.assignment_version.evidence_kind IS 'ADMISSION retains original positive evidence; CLOSURE has independent non-expansive proof and no new ACTIVE segments.';
INSERT INTO platform.schema_migration (migration_id) VALUES ('0035_person_assignment_end_closure');
COMMIT;
