SELECT pg_advisory_xact_lock(901002);
ALTER TABLE department_master.version DROP CONSTRAINT IF EXISTS version_source_row_check;
ALTER TABLE department_master.version ADD CONSTRAINT version_source_row_check CHECK(source_row BETWEEN 1 AND 1048576);
