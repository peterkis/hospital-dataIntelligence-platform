BEGIN;

-- Reuse the existing INSERT-only, hash-chained evidence ledger.
CREATE INDEX audit_event_consumer_release_idx ON audit.audit_event
  (audit_stream_id, (event_payload ->> 'releaseId'), audit_sequence);
CREATE INDEX audit_event_consumer_action_idx ON audit.audit_event
  (audit_stream_id, action, audit_sequence);

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0019_consumer_release_audit_indexes');
COMMIT;
