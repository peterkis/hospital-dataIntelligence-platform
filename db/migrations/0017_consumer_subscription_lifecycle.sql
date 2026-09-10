BEGIN;

ALTER TABLE release_distribution.consumer_subscription
  ADD COLUMN lifecycle_status varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED')),
  ADD COLUMN lifecycle_changed_at timestamp without time zone;

UPDATE release_distribution.consumer_subscription SET lifecycle_changed_at = created_at;
ALTER TABLE release_distribution.consumer_subscription
  ALTER COLUMN lifecycle_changed_at SET NOT NULL,
  ALTER COLUMN lifecycle_changed_at SET DEFAULT platform.local_now();

CREATE FUNCTION release_distribution.guard_subscription_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consumer subscription history is retained' USING ERRCODE = '55000';
  END IF;
  IF NEW.consumer_subscription_id IS DISTINCT FROM OLD.consumer_subscription_id
    OR NEW.subscription_code IS DISTINCT FROM OLD.subscription_code
    OR NEW.service_principal_id IS DISTINCT FROM OLD.service_principal_id
    OR NEW.governance_object_id IS DISTINCT FROM OLD.governance_object_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'consumer subscription identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.lifecycle_status = OLD.lifecycle_status THEN
    RETURN OLD;
  END IF;
  IF NOT (
    (OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status IN ('SUSPENDED', 'REVOKED'))
    OR (OLD.lifecycle_status = 'SUSPENDED' AND NEW.lifecycle_status IN ('ACTIVE', 'REVOKED'))
    OR (OLD.lifecycle_status = 'REVOKED' AND NEW.lifecycle_status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'consumer subscription lifecycle transition is invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consumer_subscription_lifecycle_guard
BEFORE UPDATE OR DELETE ON release_distribution.consumer_subscription
FOR EACH ROW EXECUTE FUNCTION release_distribution.guard_subscription_lifecycle();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0017_consumer_subscription_lifecycle');

COMMIT;
