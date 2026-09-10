BEGIN;

ALTER TABLE release_distribution.consumer_subscription_version
  ADD COLUMN criticality varchar(16) NOT NULL DEFAULT 'NORMAL'
    CHECK (criticality IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  ADD COLUMN expected_apply_within_seconds integer
    CHECK (expected_apply_within_seconds > 0),
  ADD COLUMN retry_window_seconds integer
    CHECK (retry_window_seconds > 0),
  ADD CONSTRAINT consumer_sla_retry_window_check CHECK (
    retry_window_seconds >= expected_apply_within_seconds
  );

-- PostgreSQL integer supplies the representation bound of 2147483647 seconds.
-- The existing append-only trigger also protects these operational fields.
INSERT INTO platform.schema_migration (migration_id)
VALUES ('0018_consumer_operational_sla');

COMMIT;
