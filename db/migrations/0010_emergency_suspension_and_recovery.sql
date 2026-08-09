BEGIN;

CREATE SCHEMA emergency_control;

CREATE TABLE emergency_control.suspension_event (
  suspension_event_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  price_list_id uuid NOT NULL,
  price_list_release_id uuid NOT NULL,
  event_sequence bigint NOT NULL CHECK (event_sequence > 0),
  scope_level varchar(16) NOT NULL CHECK (scope_level IN ('HOSPITAL', 'CAMPUS')),
  campus_id uuid REFERENCES platform.campus,
  effective_from timestamp without time zone NOT NULL,
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  evidence jsonb NOT NULL,
  actor_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  recorded_at timestamp without time zone NOT NULL,
  request_id varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  FOREIGN KEY (price_list_id, price_list_release_id)
    REFERENCES price_list.price_list_release (price_list_id, price_list_release_id),
  UNIQUE (governance_object_id, event_sequence),
  CHECK (
    (scope_level = 'HOSPITAL' AND campus_id IS NULL)
    OR (scope_level = 'CAMPUS' AND campus_id IS NOT NULL)
  )
);

CREATE TRIGGER suspension_event_append_only
BEFORE UPDATE OR DELETE ON emergency_control.suspension_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE emergency_control.impact_case (
  impact_case_id uuid PRIMARY KEY DEFAULT uuidv7(),
  suspension_event_id uuid NOT NULL UNIQUE REFERENCES emergency_control.suspension_event,
  priority varchar(16) NOT NULL CHECK (priority = 'CRITICAL'),
  case_status varchar(24) NOT NULL CHECK (case_status IN (
    'OPEN', 'UNDER_REVIEW', 'RECOVERY_PUBLISHED', 'CLOSED'
  )),
  emergency_actor_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  recovery_release_id uuid REFERENCES release_distribution.governance_release,
  created_at timestamp without time zone NOT NULL,
  closed_at timestamp without time zone
);

CREATE UNIQUE INDEX one_open_impact_per_suspended_release
ON emergency_control.impact_case (suspension_event_id)
WHERE case_status <> 'CLOSED';

CREATE TABLE emergency_control.impact_case_action (
  impact_case_action_id uuid PRIMARY KEY DEFAULT uuidv7(),
  impact_case_id uuid NOT NULL REFERENCES emergency_control.impact_case,
  action_sequence bigint NOT NULL CHECK (action_sequence > 0),
  action_type varchar(32) NOT NULL CHECK (action_type IN (
    'POST_INCIDENT_REVIEW_APPROVED', 'RECOVERY_LINKED', 'CLOSURE_CONFIRMED'
  )),
  actor_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  evidence jsonb NOT NULL,
  occurred_at timestamp without time zone NOT NULL,
  UNIQUE (impact_case_id, action_sequence)
);

CREATE TRIGGER impact_case_action_append_only
BEFORE UPDATE OR DELETE ON emergency_control.impact_case_action
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE release_distribution.release_relationship (
  release_relationship_id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  target_release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  relationship_type varchar(32) NOT NULL CHECK (relationship_type IN (
    'COMPENSATES', 'REPLACES', 'REPACKAGES_CONTRACT'
  )),
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamp without time zone NOT NULL,
  UNIQUE (source_release_id, target_release_id, relationship_type),
  CHECK (source_release_id <> target_release_id)
);

CREATE TRIGGER release_relationship_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_relationship
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0010_emergency_suspension_and_recovery');

COMMIT;
