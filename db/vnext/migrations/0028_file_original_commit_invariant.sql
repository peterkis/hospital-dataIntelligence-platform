-- FILE revisions may exist transiently only inside the atomic receive root.
-- Installed 0027 remains immutable; reject inconsistent prior state without deleting it.
SELECT pg_advisory_xact_lock(901002);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM governance_catalog.import_input_revision r WHERE r.metadata->>'kind'='FILE'
  AND (SELECT count(*) FROM governance_catalog.protected_artifact a WHERE a.revision_id=r.id AND a.kind='RAW_FILE')<>1)
 THEN RAISE EXCEPTION 'FILE_ORIGINAL_REQUIRED'; END IF;
END $$;
CREATE FUNCTION governance_catalog.require_file_original() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,governance_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(901002);
 IF NEW.metadata->>'kind'='FILE' AND
  (SELECT count(*) FROM governance_catalog.protected_artifact WHERE revision_id=NEW.id AND kind='RAW_FILE')<>1
 THEN RAISE EXCEPTION 'FILE_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER file_original_required AFTER INSERT ON governance_catalog.import_input_revision
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION governance_catalog.require_file_original();
REVOKE ALL ON FUNCTION governance_catalog.require_file_original() FROM PUBLIC,hdi_prototype;
