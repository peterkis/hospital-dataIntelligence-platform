BEGIN;

DROP FUNCTION person_master.guard_engagement_lifecycle_end_version();
DROP FUNCTION person_master.guard_engagement_lifecycle_version_request_conflict();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0029_person_engagement_lifecycle_guard_cleanup');

COMMIT;
