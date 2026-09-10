BEGIN;

ALTER TABLE department_master.department_published_projection
  ADD COLUMN updated_at timestamp without time zone
  GENERATED ALWAYS AS (COALESCE(superseded_at, created_at)) STORED;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0016_department_projection_audit_time');

COMMIT;
