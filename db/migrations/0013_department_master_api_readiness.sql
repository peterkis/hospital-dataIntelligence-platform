BEGIN;

ALTER TABLE platform.governance_object
  DROP CONSTRAINT governance_object_object_type_check;
ALTER TABLE platform.governance_object
  ADD CONSTRAINT governance_object_object_type_check CHECK (object_type IN (
    'CHARGE_CATALOG',
    'PRICE_LIST',
    'DEPARTMENT_MASTER',
    'DEPARTMENT_HIERARCHY'
  ));

ALTER TABLE access_control.object_permission_grant
  DROP CONSTRAINT object_permission_grant_permission_code_check;
ALTER TABLE access_control.object_permission_grant
  ADD CONSTRAINT object_permission_grant_permission_code_check CHECK (permission_code IN (
    'CHARGE_CATALOG_DRAFT_READ',
    'CHARGE_CATALOG_DRAFT_WRITE',
    'CHARGE_CATALOG_PUBLISH',
    'CHARGE_CATALOG_SUBMIT',
    'CHARGE_CATALOG_REVIEW',
    'CHARGE_CATALOG_APPROVE',
    'PRICE_LIST_DRAFT_READ',
    'PRICE_LIST_DRAFT_WRITE',
    'PRICE_LIST_PUBLISH',
    'PRICE_LIST_SUBMIT',
    'PRICE_LIST_REVIEW',
    'PRICE_LIST_APPROVE',
    'DEPARTMENT_MASTER_DRAFT_READ',
    'DEPARTMENT_MASTER_DRAFT_WRITE',
    'DEPARTMENT_MASTER_SUBMIT',
    'DEPARTMENT_MASTER_REVIEW',
    'DEPARTMENT_MASTER_APPROVE',
    'DEPARTMENT_MASTER_PUBLISH',
    'DEPARTMENT_HIERARCHY_DRAFT_READ',
    'DEPARTMENT_HIERARCHY_DRAFT_WRITE',
    'DEPARTMENT_HIERARCHY_SUBMIT',
    'DEPARTMENT_HIERARCHY_REVIEW',
    'DEPARTMENT_HIERARCHY_APPROVE',
    'DEPARTMENT_HIERARCHY_PUBLISH',
    'CAMPUS_PRICE_CONFIRM',
    'SCHEMA_UPGRADE_SUBMIT',
    'SCHEMA_UPGRADE_APPROVE',
    'PRICE_RESOLVE',
    'CONSUMER_SUBSCRIPTION_MANAGE',
    'AUDIT_READ',
    'EMERGENCY_SUSPEND',
    'IMPACT_REVIEW',
    'RECOVERY_APPROVE'
  ));

INSERT INTO platform.governance_object (
  governance_object_id,
  object_code,
  object_type,
  display_name,
  created_by
)
SELECT seed.governance_object_id, seed.object_code, seed.object_type, seed.display_name,
       principal.security_principal_id
FROM platform.security_principal AS principal
CROSS JOIN (VALUES
  ('74000000-0000-7000-8000-000000000001'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-MASTER', 'DEPARTMENT_MASTER', 'PROTOTYPE SYNTHETIC DEPARTMENT MASTER'),
  ('74100000-0000-7000-8000-000000000001'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-ADMIN', 'DEPARTMENT_HIERARCHY', 'PROTOTYPE SYNTHETIC ADMINISTRATIVE DEPARTMENT HIERARCHY'),
  ('74100000-0000-7000-8000-000000000002'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-OPERATION', 'DEPARTMENT_HIERARCHY', 'PROTOTYPE SYNTHETIC OPERATIONAL DEPARTMENT HIERARCHY'),
  ('74100000-0000-7000-8000-000000000003'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-MEDICAL-RECORD', 'DEPARTMENT_HIERARCHY', 'PROTOTYPE SYNTHETIC MEDICAL RECORD DEPARTMENT HIERARCHY'),
  ('74100000-0000-7000-8000-000000000004'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-FINANCE', 'DEPARTMENT_HIERARCHY', 'PROTOTYPE SYNTHETIC FINANCE DEPARTMENT HIERARCHY'),
  ('74100000-0000-7000-8000-000000000005'::uuid, 'PROTOTYPE-SYNTHETIC-DEPARTMENT-HIERARCHY-STATISTICAL', 'DEPARTMENT_HIERARCHY', 'PROTOTYPE SYNTHETIC STATISTICAL DEPARTMENT HIERARCHY')
) AS seed(governance_object_id, object_code, object_type, display_name)
WHERE principal.principal_code = 'PROTOTYPE-SYNTHETIC-STEWARD'
ON CONFLICT (governance_object_id) DO NOTHING;

DROP TRIGGER department_stable_identity_immutable
  ON department_master.department;
DROP TRIGGER department_hierarchy_view_stable_identity_immutable
  ON department_master.department_hierarchy_view;

ALTER TABLE department_master.department
  ADD COLUMN governance_object_id uuid REFERENCES platform.governance_object;
UPDATE department_master.department
SET governance_object_id = '74000000-0000-7000-8000-000000000001'
WHERE governance_object_id IS NULL;
ALTER TABLE department_master.department
  ALTER COLUMN governance_object_id SET NOT NULL;
CREATE INDEX department_governance_object_idx
  ON department_master.department (governance_object_id, department_id);

ALTER TABLE department_master.department_hierarchy_view
  ADD COLUMN governance_object_id uuid REFERENCES platform.governance_object;
UPDATE department_master.department_hierarchy_view
SET governance_object_id = CASE view_type
  WHEN 'ADMINISTRATIVE' THEN '74100000-0000-7000-8000-000000000001'::uuid
  WHEN 'OPERATIONAL' THEN '74100000-0000-7000-8000-000000000002'::uuid
  WHEN 'MEDICAL_RECORD' THEN '74100000-0000-7000-8000-000000000003'::uuid
  WHEN 'FINANCE' THEN '74100000-0000-7000-8000-000000000004'::uuid
  WHEN 'STATISTICAL' THEN '74100000-0000-7000-8000-000000000005'::uuid
END
WHERE governance_object_id IS NULL;
ALTER TABLE department_master.department_hierarchy_view
  ALTER COLUMN governance_object_id SET NOT NULL,
  ADD CONSTRAINT department_hierarchy_view_governance_object_key
    UNIQUE (governance_object_id);

CREATE FUNCTION department_master.require_governance_object_type()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  actual_type varchar(32);
  required_type varchar(32);
BEGIN
  required_type := CASE TG_TABLE_NAME
    WHEN 'department' THEN 'DEPARTMENT_MASTER'
    WHEN 'department_hierarchy_view' THEN 'DEPARTMENT_HIERARCHY'
  END;
  SELECT object_type INTO actual_type
  FROM platform.governance_object
  WHERE governance_object_id = NEW.governance_object_id;
  IF actual_type IS DISTINCT FROM required_type THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('%s requires governance object type %s', TG_TABLE_NAME, required_type);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER department_governance_object_type_guard
BEFORE INSERT OR UPDATE OF governance_object_id ON department_master.department
FOR EACH ROW EXECUTE FUNCTION department_master.require_governance_object_type();
CREATE TRIGGER department_hierarchy_view_governance_object_type_guard
BEFORE INSERT OR UPDATE OF governance_object_id
ON department_master.department_hierarchy_view
FOR EACH ROW EXECUTE FUNCTION department_master.require_governance_object_type();
CREATE TRIGGER department_stable_identity_immutable
BEFORE UPDATE OR DELETE ON department_master.department
FOR EACH ROW EXECUTE FUNCTION department_master.protect_stable_identity();
CREATE TRIGGER department_hierarchy_view_stable_identity_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_view
FOR EACH ROW EXECUTE FUNCTION department_master.protect_stable_identity();

DROP TRIGGER department_version_immutable ON department_master.department_version;
DROP TRIGGER department_hierarchy_view_version_immutable
  ON department_master.department_hierarchy_view_version;
DROP TRIGGER department_hierarchy_node_immutable
  ON department_master.department_hierarchy_node;

ALTER TABLE department_master.department_version
  ADD COLUMN subject_mapping_applicability varchar(40),
  ADD COLUMN release_id uuid REFERENCES release_distribution.governance_release;
UPDATE department_master.department_version AS version
SET subject_mapping_applicability = CASE department.department_code
      WHEN 'DEP-00001' THEN 'REQUIRED_CLINICAL_SERVICE'
      WHEN 'DEP-00002' THEN 'EXEMPT_MEDICAL_TECHNOLOGY'
      WHEN 'DEP-00003' THEN 'EXEMPT_MEDICAL_TECHNOLOGY'
      ELSE 'PENDING_DETERMINATION'
    END,
    governance_status = 'DRAFT'
FROM department_master.department AS department
WHERE department.department_id = version.department_id;
ALTER TABLE department_master.department_version
  ALTER COLUMN subject_mapping_applicability SET NOT NULL,
  DROP CONSTRAINT department_version_governance_status_check,
  ADD CONSTRAINT department_version_governance_status_check CHECK (
    governance_status IN ('DRAFT', 'PUBLISHED')
  ),
  ADD CONSTRAINT department_version_release_shape CHECK (
    (governance_status = 'DRAFT' AND release_id IS NULL)
    OR (governance_status = 'PUBLISHED' AND release_id IS NOT NULL)
  ),
  ADD CONSTRAINT department_version_subject_mapping_applicability_check CHECK (
    subject_mapping_applicability IN (
      'REQUIRED_OUTPATIENT',
      'REQUIRED_CLINICAL_SERVICE',
      'EXEMPT_MEDICAL_TECHNOLOGY',
      'EXEMPT_AUXILIARY',
      'PENDING_DETERMINATION'
    )
  ),
  ADD CONSTRAINT department_version_subject_mapping_duty_check CHECK (
    (NOT clinical_flag OR subject_mapping_applicability NOT IN (
      'EXEMPT_MEDICAL_TECHNOLOGY', 'EXEMPT_AUXILIARY'
    ))
    AND (
      subject_mapping_applicability <> 'EXEMPT_MEDICAL_TECHNOLOGY'
      OR (department_type = 'MEDICAL_TECHNOLOGY' AND NOT clinical_flag)
    )
    AND (
      subject_mapping_applicability <> 'EXEMPT_AUXILIARY'
      OR (department_type = 'AUXILIARY' AND NOT clinical_flag)
    )
  );

ALTER TABLE department_master.department_version
  DROP CONSTRAINT department_version_bitemporal_exclusion;
ALTER TABLE department_master.department_version
  ADD CONSTRAINT department_version_bitemporal_exclusion
  EXCLUDE USING gist (
    department_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  ) WHERE (governance_status = 'PUBLISHED');

ALTER TABLE department_master.department_hierarchy_view_version
  ADD COLUMN release_id uuid REFERENCES release_distribution.governance_release;
UPDATE department_master.department_hierarchy_view_version
SET governance_status = 'DRAFT';
ALTER TABLE department_master.department_hierarchy_view_version
  DROP CONSTRAINT department_hierarchy_view_version_governance_status_check,
  ADD CONSTRAINT department_hierarchy_view_version_governance_status_check CHECK (
    governance_status IN ('DRAFT', 'PUBLISHED')
  ),
  ADD CONSTRAINT department_hierarchy_view_version_release_shape CHECK (
    (governance_status = 'DRAFT' AND release_id IS NULL)
    OR (governance_status = 'PUBLISHED' AND release_id IS NOT NULL)
  );
ALTER TABLE department_master.department_hierarchy_view_version
  DROP CONSTRAINT department_hierarchy_view_version_bitemporal_exclusion;
ALTER TABLE department_master.department_hierarchy_view_version
  ADD CONSTRAINT department_hierarchy_view_version_bitemporal_exclusion
  EXCLUDE USING gist (
    department_hierarchy_view_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  ) WHERE (governance_status = 'PUBLISHED');

CREATE FUNCTION department_master.protect_department_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  semantic_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'department versions cannot be deleted';
  END IF;
  IF NEW.department_version_id <> OLD.department_version_id
     OR NEW.department_id <> OLD.department_id
     OR NEW.version_no <> OLD.version_no
     OR NEW.recorded_from <> OLD.recorded_from
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'department version identity is immutable';
  END IF;
  semantic_changed := ROW(
    NEW.standard_name, NEW.short_name, NEW.department_type,
    NEW.clinical_flag, NEW.management_flag, NEW.subject_mapping_applicability,
    NEW.business_status, NEW.description, NEW.business_valid_from, NEW.business_valid_to
  ) IS DISTINCT FROM ROW(
    OLD.standard_name, OLD.short_name, OLD.department_type,
    OLD.clinical_flag, OLD.management_flag, OLD.subject_mapping_applicability,
    OLD.business_status, OLD.description, OLD.business_valid_from, OLD.business_valid_to
  );
  IF OLD.governance_status = 'DRAFT' AND NEW.governance_status = 'DRAFT' THEN
    IF NEW.release_id IS NOT NULL OR NEW.recorded_to IS DISTINCT FROM OLD.recorded_to THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'draft department version cannot reference a release';
    END IF;
    IF semantic_changed AND NEW.content_hash = OLD.content_hash THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'department draft content hash must change with semantic content';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.governance_status = 'DRAFT' AND NEW.governance_status = 'PUBLISHED' THEN
    IF NEW.release_id IS NULL OR semantic_changed OR NEW.content_hash <> OLD.content_hash
       OR NEW.business_status = 'SUPERSEDED' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid department publication transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.governance_status = 'PUBLISHED'
     AND NEW.governance_status = 'PUBLISHED'
     AND NEW.release_id = OLD.release_id
     AND NOT semantic_changed
     AND NEW.content_hash = OLD.content_hash
     AND OLD.recorded_to IS NULL
     AND NEW.recorded_to IS NOT NULL
     AND NEW.recorded_to > OLD.recorded_from THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published department version is immutable';
END;
$function$;

CREATE FUNCTION department_master.protect_hierarchy_view_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  semantic_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'hierarchy view versions cannot be deleted';
  END IF;
  IF NEW.department_hierarchy_view_version_id <> OLD.department_hierarchy_view_version_id
     OR NEW.department_hierarchy_view_id <> OLD.department_hierarchy_view_id
     OR NEW.version_no <> OLD.version_no
     OR NEW.recorded_from <> OLD.recorded_from
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'hierarchy view version identity is immutable';
  END IF;
  semantic_changed := ROW(NEW.business_valid_from, NEW.business_valid_to)
    IS DISTINCT FROM ROW(OLD.business_valid_from, OLD.business_valid_to);
  IF OLD.governance_status = 'DRAFT' AND NEW.governance_status = 'DRAFT' THEN
    IF NEW.release_id IS NOT NULL OR NEW.recorded_to IS DISTINCT FROM OLD.recorded_to THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'draft hierarchy version cannot reference a release';
    END IF;
    IF semantic_changed AND NEW.content_hash = OLD.content_hash THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'hierarchy draft content hash must change with semantic content';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.governance_status = 'DRAFT' AND NEW.governance_status = 'PUBLISHED' THEN
    IF NEW.release_id IS NULL OR semantic_changed OR NEW.content_hash <> OLD.content_hash THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid hierarchy publication transition';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.governance_status = 'PUBLISHED'
     AND NEW.governance_status = 'PUBLISHED'
     AND NEW.release_id = OLD.release_id
     AND NOT semantic_changed
     AND NEW.content_hash = OLD.content_hash
     AND OLD.recorded_to IS NULL
     AND NEW.recorded_to IS NOT NULL
     AND NEW.recorded_to > OLD.recorded_from THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published hierarchy view version is immutable';
END;
$function$;

CREATE FUNCTION department_master.protect_hierarchy_node_by_parent_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_version_id uuid;
  parent_status varchar(24);
BEGIN
  parent_version_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.department_hierarchy_view_version_id
    ELSE NEW.department_hierarchy_view_version_id
  END;
  SELECT governance_status INTO STRICT parent_status
  FROM department_master.department_hierarchy_view_version
  WHERE department_hierarchy_view_version_id = parent_version_id;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published hierarchy nodes are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER department_version_lifecycle_guard
BEFORE UPDATE OR DELETE ON department_master.department_version
FOR EACH ROW EXECUTE FUNCTION department_master.protect_department_version_lifecycle();
CREATE TRIGGER department_hierarchy_view_version_lifecycle_guard
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_view_version
FOR EACH ROW EXECUTE FUNCTION department_master.protect_hierarchy_view_version_lifecycle();
CREATE TRIGGER department_hierarchy_node_parent_status_guard
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_node
FOR EACH ROW EXECUTE FUNCTION department_master.protect_hierarchy_node_by_parent_status();

ALTER TABLE department_master.department_mapping
  RENAME TO department_source_mapping;
ALTER TABLE department_master.department_source_mapping
  RENAME COLUMN mapping_type TO match_method;
DROP TRIGGER department_mapping_immutable
  ON department_master.department_source_mapping;

CREATE FUNCTION department_master.protect_source_mapping_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'department source mappings cannot be deleted';
  END IF;
  IF OLD.mapping_status <> 'PENDING'
     OR NEW.mapping_status NOT IN ('CONFIRMED', 'REJECTED')
     OR NEW.department_mapping_id <> OLD.department_mapping_id
     OR NEW.department_id <> OLD.department_id
     OR NEW.source_system <> OLD.source_system
     OR NEW.source_department_code <> OLD.source_department_code
     OR NEW.source_department_name <> OLD.source_department_name
     OR NEW.match_method <> OLD.match_method
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid department source mapping transition';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER department_source_mapping_transition_guard
BEFORE UPDATE OR DELETE ON department_master.department_source_mapping
FOR EACH ROW EXECUTE FUNCTION department_master.protect_source_mapping_transition();

ALTER TABLE department_master.department_hierarchy_group_version
  ADD CONSTRAINT department_hierarchy_group_version_identity_key UNIQUE (
    department_hierarchy_group_version_id,
    department_hierarchy_group_id,
    department_hierarchy_view_id
  );
ALTER TABLE department_master.department_hierarchy_node
  ADD CONSTRAINT department_hierarchy_node_group_version_identity_fkey FOREIGN KEY (
    department_hierarchy_group_version_id,
    department_hierarchy_group_id,
    department_hierarchy_view_id
  ) REFERENCES department_master.department_hierarchy_group_version (
    department_hierarchy_group_version_id,
    department_hierarchy_group_id,
    department_hierarchy_view_id
  );
CREATE UNIQUE INDEX department_hierarchy_node_group_once_idx
  ON department_master.department_hierarchy_node (
    department_hierarchy_view_version_id,
    department_hierarchy_group_id
  ) WHERE node_kind = 'GROUP';

CREATE TABLE department_master.department_campus_assignment (
  department_campus_assignment_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  campus_id uuid NOT NULL REFERENCES platform.campus,
  business_valid_from timestamp without time zone NOT NULL,
  business_valid_to timestamp without time zone,
  recorded_from timestamp without time zone NOT NULL,
  recorded_to timestamp without time zone,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_by uuid NOT NULL REFERENCES platform.security_principal,
  business_period tsrange GENERATED ALWAYS AS
    (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  recorded_period tsrange GENERATED ALWAYS AS
    (tsrange(recorded_from, recorded_to, '[)')) STORED,
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
);
ALTER TABLE department_master.department_campus_assignment
  ADD CONSTRAINT department_campus_assignment_bitemporal_exclusion
  EXCLUDE USING gist (
    department_id WITH =,
    campus_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  );
CREATE INDEX department_campus_assignment_history_idx
  ON department_master.department_campus_assignment (
    department_id,
    campus_id,
    recorded_from DESC
  );
CREATE TRIGGER department_campus_assignment_immutable
BEFORE UPDATE OR DELETE ON department_master.department_campus_assignment
FOR EACH ROW EXECUTE FUNCTION department_master.protect_immutable_version();

INSERT INTO workflow.approval_template (
  approval_template_id, template_code, display_name, status
) VALUES
  ('00000000-0000-7000-8000-000000000060', 'DEPARTMENT_MASTER_NORMAL_V1', '科室主数据普通内容变更审批', 'ACTIVE'),
  ('00000000-0000-7000-8000-000000000070', 'DEPARTMENT_HIERARCHY_NORMAL_V1', '科室层级视图普通内容变更审批', 'ACTIVE');
INSERT INTO workflow.approval_template_version (
  approval_template_version_id, approval_template_id, version_no,
  governance_status, stage_type, submitter_may_approve, content_hash, published_at
) VALUES
  ('00000000-0000-7000-8000-000000000061', '00000000-0000-7000-8000-000000000060', 1, 'PUBLISHED', 'PROFESSIONAL_REVIEW_OWNER_FINAL', false, digest('DEPARTMENT_MASTER_NORMAL_V1|1|REVIEW|OWNER', 'sha256'), '2026-09-03 00:00:00'),
  ('00000000-0000-7000-8000-000000000071', '00000000-0000-7000-8000-000000000070', 1, 'PUBLISHED', 'PROFESSIONAL_REVIEW_OWNER_FINAL', false, digest('DEPARTMENT_HIERARCHY_NORMAL_V1|1|REVIEW|OWNER', 'sha256'), '2026-09-03 00:00:00');
INSERT INTO workflow.approval_template_stage (
  approval_template_version_id, stage_sequence, stage_type,
  permission_code, campus_scope_required
) VALUES
  ('00000000-0000-7000-8000-000000000061', 1, 'PROFESSIONAL_REVIEW', 'DEPARTMENT_MASTER_REVIEW', false),
  ('00000000-0000-7000-8000-000000000061', 2, 'OWNER_FINAL_APPROVAL', 'DEPARTMENT_MASTER_APPROVE', false),
  ('00000000-0000-7000-8000-000000000071', 1, 'PROFESSIONAL_REVIEW', 'DEPARTMENT_HIERARCHY_REVIEW', false),
  ('00000000-0000-7000-8000-000000000071', 2, 'OWNER_FINAL_APPROVAL', 'DEPARTMENT_HIERARCHY_APPROVE', false);

CREATE TABLE release_distribution.release_member_department (
  release_member_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  department_id uuid NOT NULL,
  department_version_id uuid NOT NULL,
  snapshot_name varchar(256) NOT NULL,
  member_hash bytea NOT NULL CHECK (octet_length(member_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (department_version_id, department_id)
    REFERENCES department_master.department_version (department_version_id, department_id),
  UNIQUE (release_id, department_id)
);
CREATE TABLE release_distribution.release_member_department_hierarchy (
  release_member_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  department_hierarchy_view_id uuid NOT NULL,
  department_hierarchy_view_version_id uuid NOT NULL,
  snapshot_name varchar(256) NOT NULL,
  member_hash bytea NOT NULL CHECK (octet_length(member_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (
    department_hierarchy_view_version_id,
    department_hierarchy_view_id
  ) REFERENCES department_master.department_hierarchy_view_version (
    department_hierarchy_view_version_id,
    department_hierarchy_view_id
  ),
  UNIQUE (release_id, department_hierarchy_view_id)
);
CREATE TRIGGER release_member_department_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_member_department
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER release_member_department_hierarchy_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_member_department_hierarchy
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0013_department_master_api_readiness');

COMMIT;
