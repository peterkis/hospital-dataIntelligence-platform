BEGIN;

-- PV-006-C-04: SECONDMENT only, SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
-- Historical definitions and all applied migration bytes remain unchanged.
ALTER TABLE person_master.assignment_semantic_term DROP CONSTRAINT assignment_semantic_term_check;
ALTER TABLE person_master.assignment_semantic_term ADD CONSTRAINT assignment_semantic_term_check CHECK (
  (dimension='PURPOSE' AND code IN ('ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING'))
  OR (dimension='MODE' AND code IN ('PRIMARY_AFFILIATION','STANDING_CONCURRENT','SECONDMENT')));
ALTER TABLE person_master.assignment_version_semantics DROP CONSTRAINT assignment_version_semantics_semantic_operation_kind_check;
ALTER TABLE person_master.assignment_version_semantics ADD CONSTRAINT assignment_version_semantics_semantic_operation_kind_check
  CHECK (semantic_operation_kind IN ('CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT','TEMPORARY_CREATE'));
ALTER TABLE person_master.assignment_version_semantics ADD CONSTRAINT assignment_temporary_semantic_operation CHECK (
  (mode_code='SECONDMENT')=(semantic_operation_kind='TEMPORARY_CREATE'));

CREATE FUNCTION person_master.assignment_temporary_candidates_valid(e jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(e)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(e))<>7
    OR NOT (e ?& ARRAY['scopeCode','purposeCode','businessValidFrom','businessValidTo','recordAsOf','candidates','result'])
    OR e->>'scopeCode' IS DISTINCT FROM 'HOSPITAL_DEPARTMENT_PLACEMENTS' OR e->>'result' IS DISTINCT FROM 'SATISFIED'
    OR e->>'purposeCode' NOT IN ('ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING')
    OR jsonb_typeof(e->'candidates') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(e->'candidates')>64 THEN RETURN false; END IF;
  IF NOT isfinite((e->>'businessValidFrom')::timestamp) OR NOT isfinite((e->>'businessValidTo')::timestamp)
    OR NOT isfinite((e->>'recordAsOf')::timestamp) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(e->'candidates') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
      OR NOT (item ?& ARRAY['assignmentId','assignmentVersionId','businessValidFrom','businessValidTo','purposeCode','modeCode'])
      OR jsonb_typeof(item->'assignmentId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'assignmentVersionId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'businessValidFrom') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'businessValidTo') NOT IN ('string','null')
      OR (item->>'purposeCode' IS NOT NULL AND item->>'purposeCode' NOT IN ('ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING'))
      OR (item->>'modeCode' IS NOT NULL AND item->>'modeCode' NOT IN ('PRIMARY_AFFILIATION','STANDING_CONCURRENT','SECONDMENT'))
      THEN RETURN false; END IF;
    PERFORM (item->>'assignmentId')::uuid, (item->>'assignmentVersionId')::uuid;
    IF NOT isfinite((item->>'businessValidFrom')::timestamp)
      OR (item->>'businessValidTo' IS NOT NULL AND NOT isfinite((item->>'businessValidTo')::timestamp)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END;
$$;

CREATE TABLE person_master.assignment_temporary_source (
  target_assignment_id uuid PRIMARY KEY DEFAULT uuidv7() CHECK (uuid_extract_version(target_assignment_id)=7),
  target_admission_version_id uuid NOT NULL UNIQUE DEFAULT uuidv7() CHECK (uuid_extract_version(target_admission_version_id)=7),
  source_assignment_id uuid NOT NULL,
  source_assignment_version_id uuid NOT NULL,
  person_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  source_department_id uuid NOT NULL,
  source_department_governance_object_id uuid NOT NULL,
  target_department_id uuid NOT NULL,
  target_department_governance_object_id uuid NOT NULL,
  source_department_version_id uuid NOT NULL,
  preserved_purpose_code text NOT NULL CHECK (preserved_purpose_code IN ('ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING')),
  temporary_mode_code text NOT NULL CHECK (temporary_mode_code='SECONDMENT'),
  source_semantic_version_id uuid NOT NULL REFERENCES person_master.assignment_version_semantics (assignment_version_id),
  source_semantic_fingerprint bytea NOT NULL CHECK (octet_length(source_semantic_fingerprint)=32),
  source_acceptance_dependency_fingerprint bytea NOT NULL CHECK (octet_length(source_acceptance_dependency_fingerprint)=32),
  source_declared_from timestamp without time zone NOT NULL CHECK (isfinite(source_declared_from)),
  source_declared_to timestamp without time zone CHECK (source_declared_to IS NULL OR isfinite(source_declared_to)),
  temporary_from timestamp without time zone NOT NULL CHECK (isfinite(temporary_from)),
  temporary_to timestamp without time zone NOT NULL CHECK (isfinite(temporary_to) AND temporary_to<TIMESTAMP '9999-01-01'),
  evaluation_record_as_of timestamp without time zone NOT NULL CHECK (isfinite(evaluation_record_as_of)),
  recorded_from timestamp without time zone NOT NULL DEFAULT platform.local_now() CHECK (isfinite(recorded_from)),
  source_window_validation_evidence jsonb NOT NULL,
  source_primary_evaluation_evidence jsonb NOT NULL CHECK (person_master.assignment_temporary_candidates_valid(source_primary_evaluation_evidence)),
  temporary_overlap_evaluation_evidence jsonb NOT NULL CHECK (person_master.assignment_temporary_candidates_valid(temporary_overlap_evaluation_evidence)),
  target_admission_dependency_fingerprint bytea NOT NULL CHECK (octet_length(target_admission_dependency_fingerprint)=32),
  policy_code text NOT NULL CHECK (policy_code='ASSIGNMENT_SOURCE_LINKED_SECONDMENT_V1'),
  policy_version integer NOT NULL CHECK (policy_version=1),
  policy_digest bytea NOT NULL CHECK (octet_length(policy_digest)=32),
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128 AND request_id !~ '[[:cntrl:]]'
    AND request_id NOT LIKE '~assignment-transfer:%'),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash)=32),
  reason_code text NOT NULL CHECK (reason_code='TEMPORARY_SECONDMENT_PLACEMENT'),
  source_link_fingerprint bytea NOT NULL DEFAULT digest('native-header-pending','sha256') CHECK (octet_length(source_link_fingerprint)=32),
  UNIQUE (governance_object_id,request_id),
  CHECK (source_assignment_id<>target_assignment_id AND source_department_id<>target_department_id),
  CHECK (source_semantic_version_id=source_assignment_version_id),
  CHECK (temporary_to>temporary_from AND source_declared_from<=temporary_from
    AND (source_declared_to IS NULL OR temporary_to<=source_declared_to)),
  CHECK (evaluation_record_as_of<=recorded_from),
  CHECK (octet_length(source_window_validation_evidence::text)+octet_length(source_primary_evaluation_evidence::text)
    +octet_length(temporary_overlap_evaluation_evidence::text)<=65536),
  FOREIGN KEY (source_assignment_id,governance_object_id,engagement_id,source_department_id)
    REFERENCES person_master.assignment (assignment_id,governance_object_id,engagement_id,department_id),
  FOREIGN KEY (target_assignment_id,governance_object_id,engagement_id,target_department_id)
    REFERENCES person_master.assignment (assignment_id,governance_object_id,engagement_id,department_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (source_assignment_version_id,source_assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id),
  FOREIGN KEY (target_admission_version_id,target_assignment_id)
    REFERENCES person_master.assignment_version (assignment_version_id,assignment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (engagement_id,person_id,governance_object_id)
    REFERENCES person_master.engagement (engagement_id,person_id,governance_object_id),
  FOREIGN KEY (source_department_id,source_department_governance_object_id)
    REFERENCES department_master.department (department_id,governance_object_id),
  FOREIGN KEY (target_department_id,target_department_governance_object_id)
    REFERENCES department_master.department (department_id,governance_object_id),
  FOREIGN KEY (source_department_version_id,source_department_id)
    REFERENCES department_master.department_version (department_version_id,department_id),
  FOREIGN KEY (target_admission_version_id,governance_object_id,request_id,created_by,operation_hash)
    REFERENCES person_master.assignment_version (assignment_version_id,governance_object_id,request_id,created_by,operation_hash)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX assignment_temporary_source_reference ON person_master.assignment_temporary_source (source_assignment_id);
CREATE INDEX assignment_temporary_bucket ON person_master.assignment_temporary_source (governance_object_id,engagement_id,preserved_purpose_code);

CREATE FUNCTION person_master.guard_assignment_temporary_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a person_master.assignment; v person_master.assignment_version; s person_master.assignment_version_semantics;
  dept uuid; locked_publication uuid; fresh_publication uuid; publication_count integer;
  d department_master.department_version; p department_master.department_published_projection;
  term person_master.assignment_semantic_term_version; candidate record; candidate_count integer:=0;
  candidate_json jsonb; window_json jsonb; source_json jsonb; e jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_WRITE_ISOLATION_UNSUPPORTED' USING ERRCODE='0A000';
  END IF;
  IF octet_length(to_jsonb(NEW)::text)>65536 THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ASSIGNMENT:'||NEW.governance_object_id||':'||NEW.request_id,0));
  IF EXISTS (SELECT 1 FROM person_master.assignment_command_outcome WHERE governance_object_id=NEW.governance_object_id AND request_id=NEW.request_id) THEN
    RAISE EXCEPTION 'ASSIGNMENT_OPERATION_CONFLICT' USING ERRCODE='23514';
  END IF;
  -- Header-first assembly prevents attaching a source to an already known child.
  IF EXISTS (SELECT 1 FROM person_master.assignment WHERE assignment_id=NEW.target_assignment_id)
    OR EXISTS (SELECT 1 FROM person_master.assignment_version WHERE assignment_version_id=NEW.target_admission_version_id)
    OR NEW.source_assignment_id=NEW.target_assignment_id THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_TARGET_ALREADY_KNOWN' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM person_master.assignment WHERE assignment_id=NEW.source_assignment_id FOR UPDATE;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_id=a.assignment_id ORDER BY version_no DESC LIMIT 1;
  SELECT * INTO s FROM person_master.assignment_version_semantics WHERE assignment_version_id=v.assignment_version_id;
  IF v.assignment_version_id IS DISTINCT FROM NEW.source_assignment_version_id OR v.evidence_kind IS DISTINCT FROM 'ADMISSION'
    OR a.governance_object_id IS DISTINCT FROM NEW.governance_object_id OR a.person_id IS DISTINCT FROM NEW.person_id
    OR a.engagement_id IS DISTINCT FROM NEW.engagement_id OR a.department_id IS DISTINCT FROM NEW.source_department_id
    OR a.department_governance_object_id IS DISTINCT FROM NEW.source_department_governance_object_id
    OR s.mode_code IS DISTINCT FROM 'PRIMARY_AFFILIATION' OR s.purpose_code IS DISTINCT FROM NEW.preserved_purpose_code
    OR s.assignment_version_id IS DISTINCT FROM NEW.source_semantic_version_id
    OR s.semantic_fingerprint IS DISTINCT FROM NEW.source_semantic_fingerprint
    OR v.dependency_fingerprint IS DISTINCT FROM NEW.source_acceptance_dependency_fingerprint
    OR v.business_valid_from IS DISTINCT FROM NEW.source_declared_from OR v.business_valid_to IS DISTINCT FROM NEW.source_declared_to
    OR v.recorded_from>NEW.evaluation_record_as_of
    OR EXISTS (SELECT 1 FROM person_master.assignment_temporary_source WHERE target_assignment_id=a.assignment_id) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SOURCE_INVALID' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM person_master.engagement WHERE engagement_id=NEW.engagement_id FOR UPDATE;
  IF NEW.evaluation_record_as_of>platform.local_now()
    OR EXISTS (SELECT 1 FROM person_master.engagement_version WHERE engagement_id=NEW.engagement_id AND recorded_from>NEW.evaluation_record_as_of)
    OR EXISTS (SELECT 1 FROM person_master.engagement_lifecycle_event WHERE engagement_id=NEW.engagement_id AND recorded_at>NEW.evaluation_record_as_of) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SNAPSHOT_STALE' USING ERRCODE='40001';
  END IF;
  FOR dept IN SELECT unnest(ARRAY[NEW.source_department_id,NEW.target_department_id]) ORDER BY 1 LOOP
    SELECT department_version_id INTO locked_publication FROM department_master.department_version
      WHERE department_id=dept AND governance_status='PUBLISHED' AND recorded_to IS NULL
      ORDER BY department_version_id LIMIT 1 FOR SHARE;
    SELECT count(*),min(department_version_id::text)::uuid INTO publication_count,fresh_publication
      FROM department_master.department_version WHERE department_id=dept AND governance_status='PUBLISHED' AND recorded_to IS NULL;
    IF publication_count<>1 OR locked_publication IS DISTINCT FROM fresh_publication THEN
      RAISE EXCEPTION 'DEPENDENCY_CHANGED_DURING_VALIDATION' USING ERRCODE='40001';
    END IF;
    SELECT * INTO d FROM department_master.department_version WHERE department_version_id=fresh_publication;
    SELECT * INTO p FROM department_master.department_published_projection WHERE department_version_id=fresh_publication;
    IF d.recorded_from>NEW.evaluation_record_as_of OR p.published_at>NEW.evaluation_record_as_of OR p.created_at>NEW.evaluation_record_as_of THEN
      RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SNAPSHOT_STALE' USING ERRCODE='40001';
    END IF;
    IF dept=NEW.source_department_id THEN
      source_json:=NEW.source_window_validation_evidence->'sourceDepartment';
      IF d.department_version_id IS DISTINCT FROM NEW.source_department_version_id OR d.business_status IS DISTINCT FROM 'ACTIVE'
        OR NOT (tsrange(d.business_valid_from,d.business_valid_to,'[)') @> tsrange(NEW.temporary_from,NEW.temporary_to,'[)'))
        OR (source_json->>'departmentVersionId')::uuid IS DISTINCT FROM d.department_version_id
        OR (source_json->>'departmentId')::uuid IS DISTINCT FROM d.department_id
        OR (source_json->>'departmentGovernanceObjectId')::uuid IS DISTINCT FROM NEW.source_department_governance_object_id
        OR (source_json->>'versionNo')::bigint IS DISTINCT FROM d.version_no
        OR source_json->>'contentHash' IS DISTINCT FROM encode(d.content_hash,'hex')
        OR (source_json->>'recordedFrom')::timestamp IS DISTINCT FROM d.recorded_from
        OR (source_json->>'recordedTo')::timestamp IS DISTINCT FROM d.recorded_to
        OR (source_json->>'businessValidFrom')::timestamp IS DISTINCT FROM d.business_valid_from
        OR (source_json->>'businessValidTo')::timestamp IS DISTINCT FROM d.business_valid_to
        OR (source_json->>'releaseId')::uuid IS DISTINCT FROM d.release_id
        OR (source_json->>'publicationProjectionId')::uuid IS DISTINCT FROM p.department_published_projection_id
        OR (source_json->>'publishedAt')::timestamp IS DISTINCT FROM p.published_at
        OR (source_json->>'recordAsOf')::timestamp IS DISTINCT FROM NEW.evaluation_record_as_of
        OR source_json->>'semanticRole' IS DISTINCT FROM 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE'
        OR source_json->>'businessStatus' IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SOURCE_WINDOW_INVALID' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  PERFORM 1 FROM person_master.assignment_semantic_term WHERE governance_object_id=NEW.governance_object_id
    AND ((dimension='PURPOSE' AND code=NEW.preserved_purpose_code) OR (dimension='MODE' AND code='SECONDMENT')) ORDER BY term_id FOR SHARE;
  FOR term IN SELECT DISTINCT ON (t.term_id) t.* FROM person_master.assignment_semantic_term_version t
    WHERE t.governance_object_id=NEW.governance_object_id AND ((t.dimension='PURPOSE' AND t.code=NEW.preserved_purpose_code)
      OR (t.dimension='MODE' AND t.code='SECONDMENT')) ORDER BY t.term_id,t.version_no DESC LOOP
    IF term.recorded_from>NEW.evaluation_record_as_of THEN RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SNAPSHOT_STALE' USING ERRCODE='40001'; END IF;
    IF term.definition_state<>'ENABLED' OR NOT (tsrange(term.business_valid_from,term.business_valid_to,'[)') @> tsrange(NEW.temporary_from,NEW.temporary_to,'[)')) THEN
      RAISE EXCEPTION 'ASSIGNMENT_TERM_NOT_APPLICABLE' USING ERRCODE='23514';
    END IF;
  END LOOP;
  window_json:=NEW.source_window_validation_evidence;
  IF jsonb_typeof(window_json) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(window_json))<>7
    OR NOT (window_json ?& ARRAY['semanticRole','requestedFrom','requestedTo','recordAsOf','sourceDepartment','targetAdmissionDependencyFingerprint','constraintResult'])
    OR window_json->>'semanticRole' IS DISTINCT FROM 'TEMPORARY_SOURCE_WINDOW_VALIDATION'
    OR window_json->>'constraintResult' IS DISTINCT FROM 'SATISFIED'
    OR (window_json->>'requestedFrom')::timestamp IS DISTINCT FROM NEW.temporary_from
    OR (window_json->>'requestedTo')::timestamp IS DISTINCT FROM NEW.temporary_to
    OR (window_json->>'recordAsOf')::timestamp IS DISTINCT FROM NEW.evaluation_record_as_of
    OR window_json->>'targetAdmissionDependencyFingerprint' IS DISTINCT FROM encode(NEW.target_admission_dependency_fingerprint,'hex')
    OR jsonb_typeof(source_json) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(source_json))<>15
    OR NOT (source_json ?& ARRAY['semanticRole','departmentGovernanceObjectId','departmentId','recordAsOf','departmentVersionId',
      'versionNo','contentHash','recordedFrom','recordedTo','releaseId','publicationProjectionId','publishedAt','businessStatus','businessValidFrom','businessValidTo']) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SOURCE_WINDOW_INVALID' USING ERRCODE='23514';
  END IF;
  FOREACH e IN ARRAY ARRAY[NEW.source_primary_evaluation_evidence,NEW.temporary_overlap_evaluation_evidence] LOOP
    IF NOT person_master.assignment_temporary_candidates_valid(e)
      OR (e->>'businessValidFrom')::timestamp IS DISTINCT FROM NEW.temporary_from
      OR (e->>'businessValidTo')::timestamp IS DISTINCT FROM NEW.temporary_to
      OR (e->>'recordAsOf')::timestamp IS DISTINCT FROM NEW.evaluation_record_as_of
      OR e->>'purposeCode' IS DISTINCT FROM NEW.preserved_purpose_code THEN
      RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NEW.source_primary_evaluation_evidence->'candidates' IS DISTINCT FROM NEW.temporary_overlap_evaluation_evidence->'candidates' THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='23514';
  END IF;
  -- Current complete versions, including CLOSURE inheritance, not all historical
  -- periods. The strong Engagement lock prevents same-bucket write skew.
  FOR candidate IN
    SELECT latest.*,sem.purpose_code,sem.mode_code FROM
      (SELECT DISTINCT ON (av.assignment_id) av.assignment_id,av.assignment_version_id,av.business_valid_from,av.business_valid_to,
        av.business_period,av.recorded_from,av.evidence_kind FROM person_master.assignment_version av
       WHERE av.governance_object_id=NEW.governance_object_id AND av.engagement_id=NEW.engagement_id AND av.assignment_id<>NEW.source_assignment_id
       ORDER BY av.assignment_id,av.version_no DESC) latest
      LEFT JOIN person_master.assignment_closure_evidence ce ON latest.evidence_kind='CLOSURE' AND ce.closure_assignment_version_id=latest.assignment_version_id
      LEFT JOIN person_master.assignment_version_semantics sem ON sem.assignment_version_id=
        CASE WHEN latest.evidence_kind='CLOSURE' THEN ce.source_semantics_version_id ELSE latest.assignment_version_id END
    ORDER BY latest.assignment_id LIMIT 65
  LOOP
    candidate_count:=candidate_count+1;
    IF candidate_count>64 THEN RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT' USING ERRCODE='23514'; END IF;
    IF candidate.recorded_from>NEW.evaluation_record_as_of THEN RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SNAPSHOT_STALE' USING ERRCODE='40001'; END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(NEW.source_primary_evaluation_evidence->'candidates') q
      WHERE (q->>'assignmentId')::uuid=candidate.assignment_id AND (q->>'assignmentVersionId')::uuid=candidate.assignment_version_id
        AND (q->>'businessValidFrom')::timestamp=candidate.business_valid_from
        AND (q->>'businessValidTo')::timestamp IS NOT DISTINCT FROM candidate.business_valid_to
        AND q->>'purposeCode' IS NOT DISTINCT FROM candidate.purpose_code AND q->>'modeCode' IS NOT DISTINCT FROM candidate.mode_code)<>1 THEN
      RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='23514';
    END IF;
    IF candidate.business_period && tsrange(NEW.temporary_from,NEW.temporary_to,'[)') THEN
      IF candidate.purpose_code IS NULL OR candidate.mode_code IS NULL THEN
        RAISE EXCEPTION 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' USING ERRCODE='23514';
      ELSIF candidate.purpose_code=NEW.preserved_purpose_code AND candidate.mode_code='PRIMARY_AFFILIATION' THEN
        RAISE EXCEPTION 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' USING ERRCODE='23514';
      ELSIF candidate.purpose_code=NEW.preserved_purpose_code AND candidate.mode_code='SECONDMENT' THEN
        RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF candidate_count<>jsonb_array_length(NEW.source_primary_evaluation_evidence->'candidates') THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_CANDIDATE_EVIDENCE_INVALID' USING ERRCODE='23514';
  END IF;
  -- Knowledge is issued after fences. It is shared by the new stable/V1/semantic
  -- participant; source history and the earlier controlled evaluation R are not rewritten.
  NEW.recorded_from:=platform.local_now();
  NEW.source_link_fingerprint:=digest(convert_to((to_jsonb(NEW)-'source_link_fingerprint')::text,'UTF8'),'sha256');
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_temporary_header BEFORE INSERT ON person_master.assignment_temporary_source
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_header();

CREATE FUNCTION person_master.guard_assignment_temporary_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t person_master.assignment_temporary_source; a person_master.assignment; v person_master.assignment_version;
  sem person_master.assignment_version_semantics; outcome person_master.assignment_command_outcome;
BEGIN
  IF TG_TABLE_NAME='assignment_temporary_source' THEN t:=NEW;
  ELSIF TG_TABLE_NAME='assignment_command_outcome' THEN
    SELECT * INTO t FROM person_master.assignment_temporary_source WHERE governance_object_id=NEW.governance_object_id AND request_id=NEW.request_id;
    IF NOT FOUND THEN
      IF NEW.operation_type='TEMPORARY_CREATE' AND NEW.rejection_code IS NULL THEN
        RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SOURCE_LINK_REQUIRED' USING ERRCODE='23514';
      END IF;
      RETURN NULL;
    END IF;
  ELSE
    IF NEW.mode_code<>'SECONDMENT' THEN RETURN NULL; END IF;
    SELECT * INTO t FROM person_master.assignment_temporary_source WHERE target_admission_version_id=NEW.assignment_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_SOURCE_LINK_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO a FROM person_master.assignment WHERE assignment_id=t.target_assignment_id;
  SELECT * INTO v FROM person_master.assignment_version WHERE assignment_version_id=t.target_admission_version_id;
  SELECT * INTO sem FROM person_master.assignment_version_semantics WHERE assignment_version_id=t.target_admission_version_id;
  SELECT * INTO outcome FROM person_master.assignment_command_outcome WHERE governance_object_id=t.governance_object_id AND request_id=t.request_id;
  IF a.assignment_id IS DISTINCT FROM t.target_assignment_id OR a.person_id IS DISTINCT FROM t.person_id
    OR a.engagement_id IS DISTINCT FROM t.engagement_id OR a.governance_object_id IS DISTINCT FROM t.governance_object_id
    OR a.department_id IS DISTINCT FROM t.target_department_id OR a.department_governance_object_id IS DISTINCT FROM t.target_department_governance_object_id
    OR a.created_at IS DISTINCT FROM t.recorded_from OR a.creation_request_id IS DISTINCT FROM t.request_id OR a.created_by IS DISTINCT FROM t.created_by
    OR v.assignment_id IS DISTINCT FROM t.target_assignment_id OR v.version_no IS DISTINCT FROM 1 OR v.evidence_kind IS DISTINCT FROM 'ADMISSION'
    OR v.business_valid_from IS DISTINCT FROM t.temporary_from OR v.business_valid_to IS DISTINCT FROM t.temporary_to
    OR v.recorded_from IS DISTINCT FROM t.recorded_from OR v.evaluation_record_as_of IS DISTINCT FROM t.evaluation_record_as_of
    OR v.dependency_fingerprint IS DISTINCT FROM t.target_admission_dependency_fingerprint
    OR sem.mode_code IS DISTINCT FROM 'SECONDMENT' OR sem.purpose_code IS DISTINCT FROM t.preserved_purpose_code
    OR sem.semantic_operation_kind IS DISTINCT FROM 'TEMPORARY_CREATE' OR sem.semantic_recorded_from IS DISTINCT FROM t.recorded_from
    OR sem.evaluation_record_as_of IS DISTINCT FROM t.evaluation_record_as_of OR sem.person_id IS DISTINCT FROM t.person_id
    OR outcome.assignment_version_id IS DISTINCT FROM t.target_admission_version_id OR outcome.operation_type IS DISTINCT FROM 'TEMPORARY_CREATE'
    OR outcome.rejection_code IS NOT NULL OR outcome.transfer_id IS NOT NULL
    OR outcome.operation_hash IS DISTINCT FROM t.operation_hash OR outcome.created_by IS DISTINCT FROM t.created_by
    OR t.source_link_fingerprint IS DISTINCT FROM digest(convert_to((to_jsonb(t)-'source_link_fingerprint')::text,'UTF8'),'sha256')
    OR t.source_assignment_version_id IS DISTINCT FROM (SELECT assignment_version_id FROM person_master.assignment_version
      WHERE assignment_id=t.source_assignment_id ORDER BY version_no DESC LIMIT 1) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_INCOMPLETE' USING ERRCODE='23514';
  END IF;
  -- Structural owner-reference pairing, not a duplicate lifecycle segmentation engine.
  IF v.authority_engagement_version_id IS DISTINCT FROM (SELECT engagement_version_id FROM person_master.engagement_version
    WHERE engagement_id=t.engagement_id ORDER BY version_no DESC LIMIT 1)
    OR v.record_visible_lifecycle_sequence IS DISTINCT FROM (SELECT coalesce(max(sequence_no),0) FROM person_master.engagement_lifecycle_event
      WHERE engagement_id=t.engagement_id AND recorded_at<=t.evaluation_record_as_of) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_DEPENDENCY_PAIR_INVALID' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('PERSON_ASSIGNMENT_CREATED'),('ASSIGNMENT_SEMANTICS_RECORDED'),('PERSON_ASSIGNMENT_TEMPORARY_CREATED')) required(action)
    WHERE NOT EXISTS (SELECT 1 FROM audit.audit_event event WHERE event.governance_object_id=t.governance_object_id
      AND event.stable_entity_id=t.target_assignment_id AND event.entity_version_id=t.target_admission_version_id
      AND event.entity_type='PERSON_ASSIGNMENT' AND event.actor_principal_id=t.created_by AND event.request_id=t.request_id AND event.action=required.action)) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_AUDIT_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER assignment_temporary_complete AFTER INSERT ON person_master.assignment_temporary_source
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_complete();
CREATE CONSTRAINT TRIGGER assignment_temporary_semantics_complete AFTER INSERT ON person_master.assignment_version_semantics
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_complete();
CREATE CONSTRAINT TRIGGER assignment_temporary_outcome_complete AFTER INSERT ON person_master.assignment_command_outcome
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_complete();

CREATE FUNCTION person_master.guard_assignment_temporary_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='assignment_transfer' THEN
    IF EXISTS (SELECT 1 FROM person_master.assignment_temporary_source WHERE target_assignment_id=NEW.source_assignment_id) THEN
      RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.version_no>1 AND NEW.evidence_kind<>'CLOSURE'
    AND EXISTS (SELECT 1 FROM person_master.assignment_temporary_source WHERE target_assignment_id=NEW.assignment_id) THEN
    RAISE EXCEPTION 'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_version_01_temporary BEFORE INSERT ON person_master.assignment_version
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_revision();
CREATE TRIGGER assignment_transfer_00_temporary BEFORE INSERT ON person_master.assignment_transfer
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_temporary_revision();
CREATE TRIGGER assignment_temporary_immutable BEFORE UPDATE OR DELETE ON person_master.assignment_temporary_source
  FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER assignment_temporary_no_truncate BEFORE TRUNCATE ON person_master.assignment_temporary_source
  FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON person_master.assignment_temporary_source FROM PUBLIC;
COMMENT ON TABLE person_master.assignment_temporary_source IS 'Immutable depth-one SECONDMENT admission/source proof. SYNTHETIC NON_PRODUCTION TEST POLICY ONLY; finite child retains source PRIMARY; no source mutation or automatic return. Asia/Shanghai.';

-- Existing closed permission/outcome checks and the complete-version function
-- are extended below; their prior behavior is retained byte-for-byte otherwise.

ALTER TABLE person_master.assignment_temporary_source ADD CONSTRAINT assignment_temporary_policy_digest_exact
  CHECK (policy_digest=decode('a35927c1c58ecd0a4fad0ae4f58bdd8ac364122dfecb0d62ac3999fd4d90b1a6','hex'));

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
    'PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE', 'PERSON_MASTER_ASSIGNMENT_TRANSFER', 'PERSON_MASTER_ASSIGNMENT_END', 'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'
  ));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_operation_type_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_operation_type_check
  CHECK (operation_type IN ('CREATE','REVISE','CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT','END','TRANSFER','TEMPORARY_CREATE'));
ALTER TABLE person_master.assignment_command_outcome DROP CONSTRAINT assignment_command_outcome_rejection_code_check;
ALTER TABLE person_master.assignment_command_outcome ADD CONSTRAINT assignment_command_outcome_rejection_code_check CHECK (rejection_code IN (
    'ASSIGNMENT_NOT_FOUND','ASSIGNMENT_NOT_KNOWN_AS_OF',
    'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE','ASSIGNMENT_TEMPORARY_SOURCE_CHAIN_NOT_SUPPORTED',
    'ASSIGNMENT_TEMPORARY_SOURCE_PRIMARY_REQUIRED','ASSIGNMENT_TEMPORARY_SAME_DEPARTMENT','ASSIGNMENT_TEMPORARY_SOURCE_PERIOD_NOT_COVERED',
    'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_NOT_ACTIVE','ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_PERIOD_NOT_COVERED',
    'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT','ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT',
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
      IF expected_operation NOT IN ('CLASSIFIED_CREATE','TEMPORARY_CREATE') THEN RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_OPERATION_INVALID' USING ERRCODE='23514'; END IF;
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

INSERT INTO platform.schema_migration (migration_id) VALUES ('0039_person_source_linked_temporary_assignment');
COMMIT;
