-- Forward-only correction: validate existing rows and fail without rewriting evidence.
SELECT pg_advisory_xact_lock(901002);
ALTER TABLE governance_catalog.import_input_revision
 DROP CONSTRAINT import_input_revision_digest_status_check;
ALTER TABLE governance_catalog.import_input_revision
 ADD CONSTRAINT import_input_revision_digest_status_check CHECK (
  ((metadata->>'kind'='METADATA_ONLY' AND digest_status='DECLARED') OR
   (metadata->>'kind'='FILE' AND digest_status='PROTECTED_REFERENCE')) IS TRUE
 );
CREATE UNIQUE INDEX protected_artifact_raw_file_revision_unique
 ON governance_catalog.protected_artifact(revision_id) WHERE kind='RAW_FILE';
