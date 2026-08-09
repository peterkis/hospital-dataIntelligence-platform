BEGIN;

ALTER TABLE access_control.object_permission_grant
  ADD COLUMN scope_level varchar(16) NOT NULL DEFAULT 'HOSPITAL'
    CHECK (scope_level IN ('HOSPITAL', 'CAMPUS')),
  ADD COLUMN campus_id uuid REFERENCES platform.campus,
  ADD CONSTRAINT object_permission_scope_shape CHECK (
    (scope_level = 'HOSPITAL' AND campus_id IS NULL)
    OR (scope_level = 'CAMPUS' AND campus_id IS NOT NULL)
  );

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

DROP INDEX access_control.object_permission_grant_lookup_idx;
CREATE INDEX object_permission_grant_lookup_idx
  ON access_control.object_permission_grant (
    governance_object_id,
    security_principal_id,
    permission_code,
    scope_level,
    campus_id,
    grant_sequence DESC
  );

CREATE TABLE access_control.authorization_decision (
  authorization_decision_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  security_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  permission_code varchar(64) NOT NULL,
  requested_scope_level varchar(16) NOT NULL CHECK (requested_scope_level IN ('HOSPITAL', 'CAMPUS')),
  requested_campus_id uuid REFERENCES platform.campus,
  decision varchar(8) NOT NULL CHECK (decision IN ('ALLOW', 'DENY')),
  explanation_code varchar(64) NOT NULL,
  request_id varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  decided_at timestamp without time zone NOT NULL,
  CHECK (
    (requested_scope_level = 'HOSPITAL' AND requested_campus_id IS NULL)
    OR (requested_scope_level = 'CAMPUS' AND requested_campus_id IS NOT NULL)
  )
);

CREATE TRIGGER authorization_decision_append_only
BEFORE UPDATE OR DELETE ON access_control.authorization_decision
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0007_object_and_campus_authorization');

COMMIT;
