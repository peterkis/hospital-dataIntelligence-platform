BEGIN;

ALTER TABLE workflow.approval_template_version
  DROP CONSTRAINT approval_template_version_stage_type_check;
ALTER TABLE workflow.approval_template_version
  ADD CONSTRAINT approval_template_version_stage_type_check CHECK (stage_type IN (
    'OWNER_FINAL_APPROVAL',
    'PROFESSIONAL_REVIEW_OWNER_FINAL',
    'CAMPUS_CONFIRM_REVIEW_OWNER_FINAL',
    'DOMAIN_CONFIRM_CONTRACT_FINAL'
  ));

ALTER TABLE workflow.change_request
  DROP CONSTRAINT change_request_change_kind_check,
  DROP CONSTRAINT change_request_request_status_check;
ALTER TABLE workflow.change_request
  ADD CONSTRAINT change_request_change_kind_check CHECK (change_kind IN (
    'INITIAL_PUBLICATION',
    'VERSION_CHANGE',
    'RETROACTIVE_CORRECTION',
    'CAMPUS_DIFFERENCE_PRICE',
    'PROJECTION_SCHEMA_UPGRADE',
    'RECOVERY_PUBLICATION'
  )),
  ADD CONSTRAINT change_request_request_status_check CHECK (request_status IN (
    'SUBMITTED',
    'UNDER_REVIEW',
    'AWAITING_FINAL',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN'
  )),
  ADD COLUMN risk_classification varchar(32) NOT NULL DEFAULT 'NORMAL'
    CHECK (risk_classification IN ('NORMAL', 'HIGH', 'PURE_SCHEMA_UPGRADE', 'RECOVERY')),
  ADD COLUMN frozen_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN required_stage_count integer NOT NULL DEFAULT 1 CHECK (required_stage_count > 0),
  ADD COLUMN next_action_sequence bigint NOT NULL DEFAULT 1 CHECK (next_action_sequence > 0);

ALTER TABLE workflow.approval_action
  DROP CONSTRAINT approval_action_stage_type_check,
  DROP CONSTRAINT approval_action_action_result_check;
ALTER TABLE workflow.approval_action
  ADD CONSTRAINT approval_action_stage_type_check CHECK (stage_type IN (
    'CAMPUS_PRE_CONFIRMATION',
    'PROFESSIONAL_REVIEW',
    'DOMAIN_SEMANTIC_CONFIRMATION',
    'OWNER_FINAL_APPROVAL',
    'CONTRACT_FINAL_APPROVAL',
    'WITHDRAWAL'
  )),
  ADD CONSTRAINT approval_action_action_result_check CHECK (action_result IN (
    'APPROVED', 'REJECTED', 'WITHDRAWN'
  ));

CREATE TABLE workflow.approval_template_stage (
  approval_template_version_id uuid NOT NULL REFERENCES workflow.approval_template_version,
  stage_sequence bigint NOT NULL CHECK (stage_sequence > 0),
  stage_type varchar(32) NOT NULL CHECK (stage_type IN (
    'CAMPUS_PRE_CONFIRMATION',
    'PROFESSIONAL_REVIEW',
    'DOMAIN_SEMANTIC_CONFIRMATION',
    'OWNER_FINAL_APPROVAL',
    'CONTRACT_FINAL_APPROVAL'
  )),
  permission_code varchar(64) NOT NULL,
  campus_scope_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY (approval_template_version_id, stage_sequence),
  UNIQUE (approval_template_version_id, stage_type)
);

CREATE TRIGGER approval_template_stage_append_only
BEFORE UPDATE OR DELETE ON workflow.approval_template_stage
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

INSERT INTO workflow.approval_template_stage (
  approval_template_version_id, stage_sequence, stage_type, permission_code, campus_scope_required
) VALUES (
  '00000000-0000-7000-8000-000000000002', 1, 'OWNER_FINAL_APPROVAL',
  'CHARGE_CATALOG_APPROVE', false
);

INSERT INTO workflow.approval_template (
  approval_template_id, template_code, display_name, status
) VALUES
  ('00000000-0000-7000-8000-000000000010', 'NORMAL_CONTENT_V1', '普通内容变更审批', 'ACTIVE'),
  ('00000000-0000-7000-8000-000000000020', 'HIGH_RISK_PRICE_V1', '高风险价表审批', 'ACTIVE'),
  ('00000000-0000-7000-8000-000000000030', 'CAMPUS_DIFFERENCE_PRICE_V1', '院区差异价审批', 'ACTIVE'),
  ('00000000-0000-7000-8000-000000000040', 'PURE_SCHEMA_UPGRADE_V1', '纯投影Schema升级审批', 'ACTIVE'),
  ('00000000-0000-7000-8000-000000000050', 'RECOVERY_PUBLICATION_V1', '补偿恢复发布审批', 'ACTIVE');

INSERT INTO workflow.approval_template_version (
  approval_template_version_id, approval_template_id, version_no, governance_status,
  stage_type, submitter_may_approve, content_hash, published_at
) VALUES
  ('00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000010', 1, 'PUBLISHED', 'PROFESSIONAL_REVIEW_OWNER_FINAL', false, digest('NORMAL_CONTENT_V1|1|REVIEW|OWNER|submitter_may_approve=false', 'sha256'), '2026-08-09 00:00:00'),
  ('00000000-0000-7000-8000-000000000021', '00000000-0000-7000-8000-000000000020', 1, 'PUBLISHED', 'PROFESSIONAL_REVIEW_OWNER_FINAL', false, digest('HIGH_RISK_PRICE_V1|1|REVIEW|OWNER|submitter_may_approve=false', 'sha256'), '2026-08-09 00:00:00'),
  ('00000000-0000-7000-8000-000000000031', '00000000-0000-7000-8000-000000000030', 1, 'PUBLISHED', 'CAMPUS_CONFIRM_REVIEW_OWNER_FINAL', false, digest('CAMPUS_DIFFERENCE_PRICE_V1|1|CAMPUS|REVIEW|OWNER', 'sha256'), '2026-08-09 00:00:00'),
  ('00000000-0000-7000-8000-000000000041', '00000000-0000-7000-8000-000000000040', 1, 'PUBLISHED', 'DOMAIN_CONFIRM_CONTRACT_FINAL', true, digest('PURE_SCHEMA_UPGRADE_V1|1|DOMAIN|CONTRACT|same_person_exception=true', 'sha256'), '2026-08-09 00:00:00'),
  ('00000000-0000-7000-8000-000000000051', '00000000-0000-7000-8000-000000000050', 1, 'PUBLISHED', 'PROFESSIONAL_REVIEW_OWNER_FINAL', false, digest('RECOVERY_PUBLICATION_V1|1|REVIEW|RECOVERY_OWNER|submitter_may_approve=false', 'sha256'), '2026-08-09 00:00:00');

INSERT INTO workflow.approval_template_stage (
  approval_template_version_id, stage_sequence, stage_type, permission_code, campus_scope_required
) VALUES
  ('00000000-0000-7000-8000-000000000011', 1, 'PROFESSIONAL_REVIEW', 'CHARGE_CATALOG_REVIEW', false),
  ('00000000-0000-7000-8000-000000000011', 2, 'OWNER_FINAL_APPROVAL', 'CHARGE_CATALOG_APPROVE', false),
  ('00000000-0000-7000-8000-000000000021', 1, 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', false),
  ('00000000-0000-7000-8000-000000000021', 2, 'OWNER_FINAL_APPROVAL', 'PRICE_LIST_APPROVE', false),
  ('00000000-0000-7000-8000-000000000031', 1, 'CAMPUS_PRE_CONFIRMATION', 'CAMPUS_PRICE_CONFIRM', true),
  ('00000000-0000-7000-8000-000000000031', 2, 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', false),
  ('00000000-0000-7000-8000-000000000031', 3, 'OWNER_FINAL_APPROVAL', 'PRICE_LIST_APPROVE', false),
  ('00000000-0000-7000-8000-000000000041', 1, 'DOMAIN_SEMANTIC_CONFIRMATION', 'SCHEMA_UPGRADE_SUBMIT', false),
  ('00000000-0000-7000-8000-000000000041', 2, 'CONTRACT_FINAL_APPROVAL', 'SCHEMA_UPGRADE_APPROVE', false),
  ('00000000-0000-7000-8000-000000000051', 1, 'PROFESSIONAL_REVIEW', 'PRICE_LIST_REVIEW', false),
  ('00000000-0000-7000-8000-000000000051', 2, 'OWNER_FINAL_APPROVAL', 'RECOVERY_APPROVE', false);

CREATE OR REPLACE FUNCTION workflow.protect_terminal_request()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.request_status IN ('APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'terminal change requests are immutable';
  END IF;
  IF NEW.submitted_content_hash <> OLD.submitted_content_hash
     OR NEW.approval_template_version_id <> OLD.approval_template_version_id
     OR NEW.submitted_by <> OLD.submitted_by
     OR NEW.frozen_evidence <> OLD.frozen_evidence THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'submitted approval evidence is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0008_versioned_approval_workflow');

COMMIT;
