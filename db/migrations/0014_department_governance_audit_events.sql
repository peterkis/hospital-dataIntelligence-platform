BEGIN;

ALTER TABLE audit.audit_event
  ADD COLUMN recorded_at timestamp without time zone,
  ADD COLUMN event_payload jsonb;

ALTER TABLE audit.audit_event
  ADD CONSTRAINT audit_event_payload_object_check CHECK (
    event_payload IS NULL OR jsonb_typeof(event_payload) = 'object'
  ),
  ADD CONSTRAINT audit_event_payload_recorded_at_check CHECK (
    event_payload IS NULL OR recorded_at IS NOT NULL
  );

COMMENT ON COLUMN audit.audit_event.recorded_at IS
  'Asia/Shanghai local database time at which the audit event was durably recorded.';
COMMENT ON COLUMN audit.audit_event.event_payload IS
  'Minimal business facts for typed governance events; credentials and complete request bodies are forbidden.';

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0014_department_governance_audit_events');

COMMIT;
