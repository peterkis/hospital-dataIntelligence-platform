BEGIN;

CREATE SCHEMA batch_import;

CREATE TABLE batch_import.import_job (
  import_job_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  import_type varchar(32) NOT NULL CHECK (import_type IN ('CHARGE_ITEM', 'PRICE_ENTRY')),
  source_kind varchar(16) NOT NULL CHECK (source_kind IN ('CSV', 'JSON')),
  schema_version varchar(32) NOT NULL,
  raw_content_digest bytea NOT NULL CHECK (octet_length(raw_content_digest) = 32),
  normalized_content_digest bytea NOT NULL CHECK (octet_length(normalized_content_digest) = 32),
  submitted_by uuid NOT NULL REFERENCES platform.security_principal,
  job_status varchar(24) NOT NULL CHECK (job_status IN (
    'READY', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED'
  )),
  row_count integer NOT NULL CHECK (row_count > 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at timestamp without time zone NOT NULL,
  completed_at timestamp without time zone,
  CHECK (succeeded_count + failed_count <= row_count)
);

CREATE TABLE batch_import.import_row (
  import_row_id uuid PRIMARY KEY DEFAULT uuidv7(),
  import_job_id uuid NOT NULL REFERENCES batch_import.import_job,
  row_no bigint NOT NULL CHECK (row_no > 0),
  source_row_id varchar(128) NOT NULL,
  business_key varchar(512) NOT NULL,
  normalized_payload jsonb NOT NULL,
  normalized_payload_digest bytea NOT NULL CHECK (octet_length(normalized_payload_digest) = 32),
  row_status varchar(24) NOT NULL CHECK (row_status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  retryable boolean NOT NULL DEFAULT true,
  stable_entity_id uuid,
  entity_version_id uuid,
  result_kind varchar(32) CHECK (result_kind IN ('NEW_DRAFT', 'VERSION_CANDIDATE', 'PRICE_ENTRY_APPENDED')),
  current_error_code varchar(128),
  UNIQUE (import_job_id, row_no),
  UNIQUE (import_job_id, source_row_id)
);

CREATE INDEX import_row_next_idx
ON batch_import.import_row (import_job_id, row_status, row_no);

CREATE TABLE batch_import.import_row_attempt (
  import_row_attempt_id uuid PRIMARY KEY DEFAULT uuidv7(),
  import_row_id uuid NOT NULL REFERENCES batch_import.import_row,
  attempt_sequence bigint NOT NULL CHECK (attempt_sequence > 0),
  attempt_result varchar(24) NOT NULL CHECK (attempt_result IN (
    'SUCCEEDED', 'FAILED', 'SKIPPED_ALREADY_SUCCEEDED'
  )),
  error_code varchar(128),
  rule_version varchar(64) NOT NULL,
  evidence jsonb NOT NULL,
  attempted_by uuid NOT NULL REFERENCES platform.security_principal,
  attempted_at timestamp without time zone NOT NULL,
  UNIQUE (import_row_id, attempt_sequence)
);

CREATE TRIGGER import_row_attempt_append_only
BEFORE UPDATE OR DELETE ON batch_import.import_row_attempt
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0009_batch_import_jobs');

COMMIT;
