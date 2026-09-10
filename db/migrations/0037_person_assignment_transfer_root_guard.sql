BEGIN;
-- Actual rollback-only SQL RED: an unrelated root could refer to an already complete transfer.
-- Keep applied 0036 intact and bind the newly inserted outcome, not only the original root.
ALTER TABLE person_master.assignment_transfer ADD CONSTRAINT assignment_transfer_policy_digest_exact
  CHECK (policy_digest=decode('5adc307a4996c3a45aba0e4d432cd6d0b95bde74e18f64f5b0ab47812e844903','hex'));
CREATE OR REPLACE FUNCTION person_master.guard_assignment_transfer_complete() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.governance_object_id IS DISTINCT FROM t.governance_object_id
      OR NEW.request_id IS DISTINCT FROM t.root_request_id OR NEW.created_by IS DISTINCT FROM t.created_by
      OR NEW.operation_hash IS DISTINCT FROM t.operation_hash OR NEW.operation_type IS DISTINCT FROM 'TRANSFER' THEN
      RAISE EXCEPTION 'ASSIGNMENT_TRANSFER_ROOT_MAPPING_INVALID' USING ERRCODE='23514';
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
INSERT INTO platform.schema_migration (migration_id) VALUES ('0037_person_assignment_transfer_root_guard');
COMMIT;
