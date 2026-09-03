BEGIN;

CREATE SCHEMA department_master;

CREATE TABLE department_master.master_data_source (
  master_data_source_id uuid PRIMARY KEY,
  source_code varchar(64) NOT NULL UNIQUE,
  source_name varchar(128) NOT NULL,
  system_type varchar(32) NOT NULL CHECK (system_type IN (
    'CLINICAL', 'ELECTRONIC_MEDICAL_RECORD', 'LABORATORY', 'IMAGING', 'PERFORMANCE'
  )),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE INDEX master_data_source_source_code_idx
  ON department_master.master_data_source (source_code);

CREATE TABLE department_master.department (
  department_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_code varchar(64) NOT NULL UNIQUE,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_by uuid NOT NULL REFERENCES platform.security_principal
);

CREATE INDEX department_department_code_idx
  ON department_master.department (department_code);

CREATE TABLE department_master.department_version (
  department_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  version_no bigint NOT NULL CHECK (version_no > 0),
  standard_name varchar(256) NOT NULL CHECK (length(btrim(standard_name)) > 0),
  short_name varchar(128),
  department_type varchar(32) NOT NULL CHECK (department_type IN (
    'CLINICAL', 'MEDICAL_TECHNOLOGY', 'AUXILIARY', 'ADMINISTRATIVE'
  )),
  clinical_flag boolean NOT NULL,
  management_flag boolean NOT NULL,
  business_status varchar(24) NOT NULL CHECK (business_status IN (
    'ACTIVE', 'SUSPENDED', 'DEPRECATED', 'SUPERSEDED'
  )),
  governance_status varchar(24) NOT NULL CHECK (governance_status IN (
    'DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED'
  )),
  description varchar(1000),
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
  UNIQUE (department_id, version_no),
  UNIQUE (department_version_id, department_id),
  CHECK (short_name IS NULL OR length(btrim(short_name)) > 0),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
);

ALTER TABLE department_master.department_version
  ADD CONSTRAINT department_version_bitemporal_exclusion
  EXCLUDE USING gist (
    department_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  );

CREATE INDEX department_version_history_idx
  ON department_master.department_version (department_id, version_no DESC);
CREATE INDEX department_version_business_time_idx
  ON department_master.department_version USING gist (department_id, business_period);

CREATE TABLE department_master.department_alias (
  department_alias_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  source_system varchar(64) NOT NULL
    REFERENCES department_master.master_data_source (source_code),
  source_code varchar(128) NOT NULL,
  source_name varchar(256) NOT NULL CHECK (length(btrim(source_name)) > 0),
  mapping_status varchar(16) NOT NULL CHECK (mapping_status IN (
    'PENDING', 'CONFIRMED', 'REJECTED'
  )),
  confidence_score numeric(5, 4) CHECK (
    confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1
  ),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (source_system, source_code)
);

CREATE INDEX department_alias_source_name_idx
  ON department_master.department_alias (source_name);
CREATE INDEX department_alias_department_idx
  ON department_master.department_alias (department_id);

CREATE TABLE department_master.department_mapping (
  department_mapping_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  source_system varchar(64) NOT NULL
    REFERENCES department_master.master_data_source (source_code),
  source_department_code varchar(128) NOT NULL,
  source_department_name varchar(256) NOT NULL
    CHECK (length(btrim(source_department_name)) > 0),
  mapping_type varchar(16) NOT NULL CHECK (mapping_type IN (
    'DIRECT', 'MANUAL', 'SUGGESTED'
  )),
  mapping_status varchar(16) NOT NULL CHECK (mapping_status IN (
    'PENDING', 'CONFIRMED', 'REJECTED'
  )),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (source_system, source_department_code)
);

CREATE INDEX department_mapping_department_idx
  ON department_master.department_mapping (department_id);
CREATE INDEX department_mapping_source_code_idx
  ON department_master.department_mapping (source_system, source_department_code);

CREATE TABLE department_master.department_quality_score (
  department_quality_score_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  completeness_score numeric(5, 2) NOT NULL CHECK (completeness_score BETWEEN 0 AND 100),
  uniqueness_score numeric(5, 2) NOT NULL CHECK (uniqueness_score BETWEEN 0 AND 100),
  standardization_score numeric(5, 2) NOT NULL CHECK (standardization_score BETWEEN 0 AND 100),
  overall_score numeric(5, 2) NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  calculated_at timestamp without time zone NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (department_id, calculated_at),
  CHECK (
    abs(overall_score - round(
      completeness_score * 0.20 + uniqueness_score * 0.30 + standardization_score * 0.50,
      2
    )) < 0.01
  )
);

CREATE INDEX department_quality_score_history_idx
  ON department_master.department_quality_score (department_id, calculated_at DESC);

CREATE TABLE department_master.department_hierarchy_view (
  department_hierarchy_view_id uuid PRIMARY KEY DEFAULT uuidv7(),
  view_code varchar(64) NOT NULL UNIQUE,
  view_name varchar(128) NOT NULL CHECK (length(btrim(view_name)) > 0),
  view_type varchar(32) NOT NULL CHECK (view_type IN (
    'ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD', 'FINANCE', 'STATISTICAL'
  )),
  operational_enabled boolean NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_by uuid NOT NULL REFERENCES platform.security_principal,
  CHECK (
    operational_enabled = (view_type IN ('ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD'))
  )
);

CREATE TABLE department_master.department_hierarchy_view_version (
  department_hierarchy_view_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_hierarchy_view_id uuid NOT NULL
    REFERENCES department_master.department_hierarchy_view,
  version_no bigint NOT NULL CHECK (version_no > 0),
  governance_status varchar(24) NOT NULL CHECK (governance_status IN (
    'DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED'
  )),
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
  UNIQUE (department_hierarchy_view_id, version_no),
  UNIQUE (department_hierarchy_view_version_id, department_hierarchy_view_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
);

ALTER TABLE department_master.department_hierarchy_view_version
  ADD CONSTRAINT department_hierarchy_view_version_bitemporal_exclusion
  EXCLUDE USING gist (
    department_hierarchy_view_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  );

CREATE INDEX department_hierarchy_view_version_history_idx
  ON department_master.department_hierarchy_view_version (
    department_hierarchy_view_id,
    version_no DESC
  );

CREATE TABLE department_master.department_hierarchy_group (
  department_hierarchy_group_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_hierarchy_view_id uuid NOT NULL
    REFERENCES department_master.department_hierarchy_view,
  group_code varchar(64) NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_by uuid NOT NULL REFERENCES platform.security_principal,
  UNIQUE (department_hierarchy_view_id, group_code),
  UNIQUE (department_hierarchy_group_id, department_hierarchy_view_id)
);

CREATE TABLE department_master.department_hierarchy_group_version (
  department_hierarchy_group_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_hierarchy_group_id uuid NOT NULL,
  department_hierarchy_view_id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  display_name varchar(256) NOT NULL CHECK (length(btrim(display_name)) > 0),
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
  UNIQUE (department_hierarchy_group_id, version_no),
  UNIQUE (department_hierarchy_group_version_id, department_hierarchy_view_id),
  FOREIGN KEY (department_hierarchy_group_id, department_hierarchy_view_id)
    REFERENCES department_master.department_hierarchy_group (
      department_hierarchy_group_id,
      department_hierarchy_view_id
    ),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from)
);

ALTER TABLE department_master.department_hierarchy_group_version
  ADD CONSTRAINT department_hierarchy_group_version_bitemporal_exclusion
  EXCLUDE USING gist (
    department_hierarchy_group_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  );

CREATE INDEX department_hierarchy_group_version_history_idx
  ON department_master.department_hierarchy_group_version (
    department_hierarchy_group_id,
    version_no DESC
  );

CREATE TABLE department_master.department_hierarchy_node (
  department_hierarchy_node_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_hierarchy_view_version_id uuid NOT NULL,
  department_hierarchy_view_id uuid NOT NULL,
  parent_node_id uuid,
  node_kind varchar(16) NOT NULL CHECK (node_kind IN ('DEPARTMENT', 'GROUP')),
  department_id uuid,
  department_version_id uuid,
  department_hierarchy_group_id uuid,
  department_hierarchy_group_version_id uuid,
  display_name varchar(256) NOT NULL CHECK (length(btrim(display_name)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (department_hierarchy_view_version_id, department_hierarchy_node_id),
  FOREIGN KEY (department_hierarchy_view_version_id, department_hierarchy_view_id)
    REFERENCES department_master.department_hierarchy_view_version (
      department_hierarchy_view_version_id,
      department_hierarchy_view_id
    ),
  FOREIGN KEY (department_version_id, department_id)
    REFERENCES department_master.department_version (department_version_id, department_id),
  FOREIGN KEY (department_hierarchy_group_id, department_hierarchy_view_id)
    REFERENCES department_master.department_hierarchy_group (
      department_hierarchy_group_id,
      department_hierarchy_view_id
    ),
  FOREIGN KEY (department_hierarchy_group_version_id, department_hierarchy_view_id)
    REFERENCES department_master.department_hierarchy_group_version (
      department_hierarchy_group_version_id,
      department_hierarchy_view_id
    ),
  FOREIGN KEY (department_hierarchy_view_version_id, parent_node_id)
    REFERENCES department_master.department_hierarchy_node (
      department_hierarchy_view_version_id,
      department_hierarchy_node_id
    ) DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_node_id IS NULL OR parent_node_id <> department_hierarchy_node_id),
  CHECK (
    (node_kind = 'DEPARTMENT'
      AND department_id IS NOT NULL
      AND department_version_id IS NOT NULL
      AND department_hierarchy_group_id IS NULL
      AND department_hierarchy_group_version_id IS NULL)
    OR
    (node_kind = 'GROUP'
      AND department_id IS NULL
      AND department_version_id IS NULL
      AND department_hierarchy_group_id IS NOT NULL
      AND department_hierarchy_group_version_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX department_hierarchy_node_department_once_idx
  ON department_master.department_hierarchy_node (
    department_hierarchy_view_version_id,
    department_id
  ) WHERE node_kind = 'DEPARTMENT';
CREATE INDEX department_hierarchy_node_parent_idx
  ON department_master.department_hierarchy_node (
    department_hierarchy_view_version_id,
    parent_node_id
  );

CREATE FUNCTION department_master.reject_hierarchy_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.parent_node_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT node.department_hierarchy_node_id, node.parent_node_id
      FROM department_master.department_hierarchy_node AS node
      WHERE node.department_hierarchy_view_version_id = NEW.department_hierarchy_view_version_id
        AND node.department_hierarchy_node_id = NEW.parent_node_id
      UNION
      SELECT node.department_hierarchy_node_id, node.parent_node_id
      FROM department_master.department_hierarchy_node AS node
      INNER JOIN ancestors
        ON ancestors.parent_node_id = node.department_hierarchy_node_id
      WHERE node.department_hierarchy_view_version_id = NEW.department_hierarchy_view_version_id
    )
    SELECT 1
    FROM ancestors
    WHERE department_hierarchy_node_id = NEW.department_hierarchy_node_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'department hierarchy cycle is forbidden';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER department_hierarchy_node_cycle_guard
AFTER INSERT OR UPDATE OF parent_node_id
ON department_master.department_hierarchy_node
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION department_master.reject_hierarchy_cycle();

CREATE FUNCTION department_master.protect_stable_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('%I.%I stable identities cannot be deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME);
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at', 'updated_by'])
     = (to_jsonb(OLD) - ARRAY['updated_at', 'updated_by']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I.%I stable identity is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME);
END;
$function$;

CREATE FUNCTION department_master.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := platform.local_now();
  RETURN NEW;
END;
$function$;

CREATE FUNCTION department_master.protect_immutable_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('%I.%I versions cannot be deleted', TG_TABLE_SCHEMA, TG_TABLE_NAME);
  END IF;

  IF OLD.recorded_to IS NULL
     AND NEW.recorded_to IS NOT NULL
     AND NEW.recorded_to > OLD.recorded_from
     AND NEW.updated_at >= OLD.updated_at
     AND (to_jsonb(NEW) - ARRAY[
       'business_period', 'recorded_to', 'recorded_period', 'updated_at', 'updated_by'
     ]) = (to_jsonb(OLD) - ARRAY[
       'business_period', 'recorded_to', 'recorded_period', 'updated_at', 'updated_by'
     ]) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I.%I version content is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME);
END;
$function$;

CREATE TRIGGER department_version_immutable
BEFORE UPDATE OR DELETE ON department_master.department_version
FOR EACH ROW EXECUTE FUNCTION department_master.protect_immutable_version();
CREATE TRIGGER department_alias_immutable
BEFORE UPDATE OR DELETE ON department_master.department_alias
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER department_mapping_immutable
BEFORE UPDATE OR DELETE ON department_master.department_mapping
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER department_quality_score_immutable
BEFORE UPDATE OR DELETE ON department_master.department_quality_score
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER department_hierarchy_view_version_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_view_version
FOR EACH ROW EXECUTE FUNCTION department_master.protect_immutable_version();
CREATE TRIGGER department_hierarchy_group_version_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_group_version
FOR EACH ROW EXECUTE FUNCTION department_master.protect_immutable_version();
CREATE TRIGGER department_hierarchy_node_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_node
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER department_stable_identity_immutable
BEFORE UPDATE OR DELETE ON department_master.department
FOR EACH ROW EXECUTE FUNCTION department_master.protect_stable_identity();
CREATE TRIGGER department_hierarchy_view_stable_identity_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_view
FOR EACH ROW EXECUTE FUNCTION department_master.protect_stable_identity();
CREATE TRIGGER department_hierarchy_group_stable_identity_immutable
BEFORE UPDATE OR DELETE ON department_master.department_hierarchy_group
FOR EACH ROW EXECUTE FUNCTION department_master.protect_stable_identity();
CREATE TRIGGER master_data_source_updated_at
BEFORE UPDATE ON department_master.master_data_source
FOR EACH ROW EXECUTE FUNCTION department_master.touch_updated_at();

INSERT INTO department_master.master_data_source (
  master_data_source_id,
  source_code,
  source_name,
  system_type
) VALUES
  ('20000000-0000-7000-8000-000000000001', 'HIS', 'HIS', 'CLINICAL'),
  ('20000000-0000-7000-8000-000000000002', 'EMR', 'EMR', 'ELECTRONIC_MEDICAL_RECORD'),
  ('20000000-0000-7000-8000-000000000003', 'LIS', 'LIS', 'LABORATORY'),
  ('20000000-0000-7000-8000-000000000004', 'PACS', 'PACS', 'IMAGING'),
  ('20000000-0000-7000-8000-000000000005', 'PERFORMANCE', '绩效', 'PERFORMANCE');

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0012_department_master');

COMMIT;
