BEGIN;

-- A C02 rollback-only real SQL probe demonstrated that a row lock alone cannot
-- refresh an old REPEATABLE READ snapshot when the locked identity is immutable.
-- Keep applied 0033 intact. Classified mutations use READ COMMITTED; consistent
-- historical read-only RR snapshots and C01 raw writes retain their existing paths.
CREATE FUNCTION person_master.guard_assignment_semantic_write_isolation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ASSIGNMENT_SEMANTIC_WRITE_ISOLATION_UNSUPPORTED' USING ERRCODE='0A000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_semantics_00_isolation BEFORE INSERT ON person_master.assignment_version_semantics
  FOR EACH ROW EXECUTE FUNCTION person_master.guard_assignment_semantic_write_isolation();

INSERT INTO platform.schema_migration (migration_id) VALUES ('0034_person_assignment_semantic_snapshot_guard');
COMMIT;
