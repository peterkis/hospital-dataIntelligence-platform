BEGIN;

CREATE TABLE department_master.department_published_projection (
  department_published_projection_id uuid PRIMARY KEY DEFAULT uuidv7(),
  department_id uuid NOT NULL REFERENCES department_master.department,
  department_version_id uuid NOT NULL,
  department_code varchar(64) NOT NULL,
  standard_name varchar(256) NOT NULL CHECK (length(btrim(standard_name)) > 0),
  department_type varchar(32) NOT NULL CHECK (department_type IN (
    'CLINICAL', 'MEDICAL_TECHNOLOGY', 'AUXILIARY', 'ADMINISTRATIVE'
  )),
  subject_mapping_applicability varchar(40) NOT NULL CHECK (
    subject_mapping_applicability IN (
      'REQUIRED_OUTPATIENT',
      'REQUIRED_CLINICAL_SERVICE',
      'EXEMPT_MEDICAL_TECHNOLOGY',
      'EXEMPT_AUXILIARY',
      'PENDING_DETERMINATION'
    )
  ),
  campuses jsonb NOT NULL CHECK (jsonb_typeof(campuses) = 'array'),
  hierarchies jsonb NOT NULL CHECK (jsonb_typeof(hierarchies) = 'object'),
  quality_score numeric(5, 2) CHECK (quality_score BETWEEN 0 AND 100),
  published_release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  published_at timestamp without time zone NOT NULL,
  superseded_at timestamp without time zone,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (department_version_id, department_id)
    REFERENCES department_master.department_version (department_version_id, department_id),
  UNIQUE (department_version_id),
  UNIQUE (published_release_id),
  CHECK (superseded_at IS NULL OR superseded_at > published_at)
);

CREATE UNIQUE INDEX department_published_projection_current_idx
  ON department_master.department_published_projection (department_id)
  WHERE superseded_at IS NULL;
CREATE INDEX department_published_projection_as_of_idx
  ON department_master.department_published_projection (
    department_id,
    published_at DESC,
    superseded_at
  );

CREATE FUNCTION department_master.validate_published_projection_source()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_status varchar(24);
  source_release_id uuid;
  source_content_hash bytea;
  source_code varchar(64);
  source_standard_name varchar(256);
  source_department_type varchar(32);
  source_mapping_applicability varchar(40);
BEGIN
  SELECT
    version.governance_status,
    version.release_id,
    version.content_hash,
    department.department_code,
    version.standard_name,
    version.department_type,
    version.subject_mapping_applicability
  INTO
    source_status,
    source_release_id,
    source_content_hash,
    source_code,
    source_standard_name,
    source_department_type,
    source_mapping_applicability
  FROM department_master.department_version AS version
  INNER JOIN department_master.department AS department
    ON department.department_id = version.department_id
  WHERE version.department_version_id = NEW.department_version_id
    AND version.department_id = NEW.department_id;

  IF NOT FOUND
     OR source_status <> 'PUBLISHED'
     OR source_release_id IS DISTINCT FROM NEW.published_release_id
     OR source_content_hash IS DISTINCT FROM NEW.content_hash
     OR source_code IS DISTINCT FROM NEW.department_code
     OR source_standard_name IS DISTINCT FROM NEW.standard_name
     OR source_department_type IS DISTINCT FROM NEW.department_type
     OR source_mapping_applicability IS DISTINCT FROM NEW.subject_mapping_applicability THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'department projection requires its exact published source version';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION department_master.protect_published_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'department published projections cannot be deleted';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.superseded_at <= OLD.published_at
     OR NEW.department_published_projection_id <> OLD.department_published_projection_id
     OR NEW.department_id <> OLD.department_id
     OR NEW.department_version_id <> OLD.department_version_id
     OR NEW.department_code <> OLD.department_code
     OR NEW.standard_name <> OLD.standard_name
     OR NEW.department_type <> OLD.department_type
     OR NEW.subject_mapping_applicability <> OLD.subject_mapping_applicability
     OR NEW.campuses <> OLD.campuses
     OR NEW.hierarchies <> OLD.hierarchies
     OR NEW.quality_score IS DISTINCT FROM OLD.quality_score
     OR NEW.published_release_id <> OLD.published_release_id
     OR NEW.published_at <> OLD.published_at
     OR NEW.content_hash <> OLD.content_hash
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'department published projection content is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION department_master.require_projection_for_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM department_master.department_published_projection AS projection
    WHERE projection.department_version_id = NEW.department_version_id
      AND projection.department_id = NEW.department_id
      AND projection.published_release_id = NEW.release_id
      AND projection.content_hash = NEW.content_hash
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'published department version requires a published projection';
  END IF;
  RETURN NULL;
END;
$function$;

INSERT INTO department_master.department_published_projection (
  department_id,
  department_version_id,
  department_code,
  standard_name,
  department_type,
  subject_mapping_applicability,
  campuses,
  hierarchies,
  quality_score,
  published_release_id,
  published_at,
  superseded_at,
  content_hash,
  created_at
)
SELECT
  version.department_id,
  version.department_version_id,
  department.department_code,
  version.standard_name,
  version.department_type,
  version.subject_mapping_applicability,
  COALESCE(campus_snapshot.names, '[]'::jsonb),
  COALESCE(hierarchy_snapshot.views, '{}'::jsonb),
  quality_snapshot.overall_score,
  release.release_id,
  release.recorded_from,
  version.recorded_to,
  version.content_hash,
  release.created_at
FROM department_master.department_version AS version
INNER JOIN department_master.department AS department
  ON department.department_id = version.department_id
INNER JOIN release_distribution.governance_release AS release
  ON release.release_id = version.release_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(campus.display_name ORDER BY campus.campus_code) AS names
  FROM department_master.department_campus_assignment AS assignment
  INNER JOIN platform.campus AS campus ON campus.campus_id = assignment.campus_id
  WHERE assignment.department_id = version.department_id
    AND assignment.business_period @> version.business_valid_from
    AND assignment.recorded_period @> release.recorded_from
) AS campus_snapshot ON true
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(view_type, display_name ORDER BY view_code) AS views
  FROM (
    SELECT
      hierarchy_view.view_type,
      hierarchy_view.view_code,
      COALESCE(parent_node.display_name, department_node.display_name) AS display_name
    FROM department_master.department_hierarchy_view_version AS hierarchy_version
    INNER JOIN department_master.department_hierarchy_view AS hierarchy_view
      ON hierarchy_view.department_hierarchy_view_id = hierarchy_version.department_hierarchy_view_id
    INNER JOIN department_master.department_hierarchy_node AS department_node
      ON department_node.department_hierarchy_view_version_id =
        hierarchy_version.department_hierarchy_view_version_id
      AND department_node.department_id = version.department_id
    LEFT JOIN department_master.department_hierarchy_node AS parent_node
      ON parent_node.department_hierarchy_node_id = department_node.parent_node_id
    WHERE hierarchy_version.governance_status = 'PUBLISHED'
      AND hierarchy_version.business_period @> version.business_valid_from
      AND hierarchy_version.recorded_period @> release.recorded_from
  ) AS published_views
) AS hierarchy_snapshot ON true
LEFT JOIN LATERAL (
  SELECT score.overall_score
  FROM department_master.department_quality_score AS score
  WHERE score.department_id = version.department_id
    AND score.calculated_at <= release.recorded_from
  ORDER BY score.calculated_at DESC, score.department_quality_score_id DESC
  LIMIT 1
) AS quality_snapshot ON true
WHERE version.governance_status = 'PUBLISHED';

CREATE TRIGGER department_published_projection_source_guard
BEFORE INSERT ON department_master.department_published_projection
FOR EACH ROW EXECUTE FUNCTION department_master.validate_published_projection_source();

CREATE TRIGGER department_published_projection_immutable
BEFORE UPDATE OR DELETE ON department_master.department_published_projection
FOR EACH ROW EXECUTE FUNCTION department_master.protect_published_projection();

CREATE CONSTRAINT TRIGGER department_version_projection_required
AFTER INSERT OR UPDATE OF governance_status, release_id, content_hash
ON department_master.department_version
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.governance_status = 'PUBLISHED')
EXECUTE FUNCTION department_master.require_projection_for_published_version();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0015_department_published_projection');

COMMIT;
