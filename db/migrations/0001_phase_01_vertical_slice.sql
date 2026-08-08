BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA platform;
CREATE SCHEMA charge_catalog;
CREATE SCHEMA price_list;
CREATE SCHEMA price_resolution;
CREATE SCHEMA release_distribution;
CREATE SCHEMA audit;
CREATE SCHEMA access_control;
CREATE SCHEMA workflow;

CREATE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
VOLATILE
PARALLEL SAFE
RETURN timezone('Asia/Shanghai', statement_timestamp());

CREATE FUNCTION platform.reject_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I.%I is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME);
END;
$function$;

CREATE TABLE platform.schema_migration (
  migration_id varchar(128) PRIMARY KEY,
  applied_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0001_phase_01_vertical_slice');

CREATE TRIGGER schema_migration_append_only
BEFORE UPDATE OR DELETE ON platform.schema_migration
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE platform.security_principal (
  security_principal_id uuid PRIMARY KEY DEFAULT uuidv7(),
  principal_code varchar(128) NOT NULL UNIQUE,
  principal_kind varchar(16) NOT NULL CHECK (principal_kind IN ('PERSON', 'SERVICE')),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE platform.external_identity_binding (
  external_identity_binding_id uuid PRIMARY KEY DEFAULT uuidv7(),
  issuer_url text NOT NULL,
  external_subject varchar(255) NOT NULL,
  external_client_id varchar(255),
  binding_kind varchar(16) NOT NULL CHECK (binding_kind IN ('PERSON', 'SERVICE')),
  security_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  binding_sequence bigint NOT NULL CHECK (binding_sequence > 0),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (issuer_url, external_subject, binding_sequence)
);

CREATE INDEX external_identity_binding_lookup_idx
  ON platform.external_identity_binding (issuer_url, external_subject, binding_sequence DESC);

CREATE TRIGGER external_identity_binding_append_only
BEFORE UPDATE OR DELETE ON platform.external_identity_binding
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE platform.oidc_login_transaction (
  state_digest bytea PRIMARY KEY CHECK (octet_length(state_digest) = 32),
  code_verifier varchar(128) NOT NULL,
  nonce varchar(128) NOT NULL,
  redirect_uri text NOT NULL,
  return_to text NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  expires_at timestamp without time zone NOT NULL,
  consumed_at timestamp without time zone,
  CHECK (expires_at > created_at),
  CHECK (return_to LIKE '/%' AND return_to NOT LIKE '//%')
);

CREATE INDEX oidc_login_transaction_expiry_idx
  ON platform.oidc_login_transaction (expires_at);

CREATE TABLE platform.browser_session (
  session_digest bytea PRIMARY KEY CHECK (octet_length(session_digest) = 32),
  security_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest) = 32),
  session_sequence bigint NOT NULL CHECK (session_sequence > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  expires_at timestamp without time zone NOT NULL,
  revoked_at timestamp without time zone,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX browser_session_principal_idx
  ON platform.browser_session (security_principal_id, session_sequence DESC);
CREATE INDEX browser_session_expiry_idx
  ON platform.browser_session (expires_at);

CREATE TABLE platform.campus (
  campus_id uuid PRIMARY KEY DEFAULT uuidv7(),
  campus_code varchar(64) NOT NULL UNIQUE,
  display_name varchar(256) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE platform.governance_object (
  governance_object_id uuid PRIMARY KEY DEFAULT uuidv7(),
  object_code varchar(128) NOT NULL UNIQUE,
  object_type varchar(32) NOT NULL CHECK (object_type IN ('CHARGE_CATALOG', 'PRICE_LIST')),
  display_name varchar(256) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'GOVERNANCE_SUSPENDED', 'RETIRED')),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE INDEX governance_object_created_by_idx ON platform.governance_object (created_by);

CREATE TABLE access_control.object_permission_grant (
  object_permission_grant_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  security_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  permission_code varchar(64) NOT NULL CHECK (permission_code IN (
    'CHARGE_CATALOG_PUBLISH',
    'PRICE_LIST_PUBLISH',
    'PRICE_RESOLVE',
    'CONSUMER_SUBSCRIPTION_MANAGE',
    'AUDIT_READ'
  )),
  grant_effect varchar(8) NOT NULL CHECK (grant_effect IN ('ALLOW', 'DENY')),
  valid_from timestamp without time zone NOT NULL,
  valid_to timestamp without time zone,
  grant_sequence bigint NOT NULL CHECK (grant_sequence > 0),
  granted_by uuid NOT NULL REFERENCES platform.security_principal,
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (governance_object_id, security_principal_id, permission_code, grant_sequence),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX object_permission_grant_lookup_idx
  ON access_control.object_permission_grant (
    governance_object_id,
    security_principal_id,
    permission_code,
    grant_sequence DESC
  );

CREATE TRIGGER object_permission_grant_append_only
BEFORE UPDATE OR DELETE ON access_control.object_permission_grant
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE workflow.approval_template (
  approval_template_id uuid PRIMARY KEY,
  template_code varchar(128) NOT NULL UNIQUE,
  display_name varchar(256) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE workflow.approval_template_version (
  approval_template_version_id uuid PRIMARY KEY,
  approval_template_id uuid NOT NULL REFERENCES workflow.approval_template,
  version_no bigint NOT NULL CHECK (version_no > 0),
  governance_status varchar(16) NOT NULL CHECK (governance_status = 'PUBLISHED'),
  stage_type varchar(32) NOT NULL CHECK (stage_type = 'OWNER_FINAL_APPROVAL'),
  submitter_may_approve boolean NOT NULL,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  published_at timestamp without time zone NOT NULL,
  UNIQUE (approval_template_id, version_no)
);

INSERT INTO workflow.approval_template (
  approval_template_id,
  template_code,
  display_name,
  status
) VALUES (
  '00000000-0000-7000-8000-000000000001',
  'PHASE01_OWNER_FINAL_V1',
  'Phase 01 Owner终审模板',
  'ACTIVE'
);

INSERT INTO workflow.approval_template_version (
  approval_template_version_id,
  approval_template_id,
  version_no,
  governance_status,
  stage_type,
  submitter_may_approve,
  content_hash,
  published_at
) VALUES (
  '00000000-0000-7000-8000-000000000002',
  '00000000-0000-7000-8000-000000000001',
  1,
  'PUBLISHED',
  'OWNER_FINAL_APPROVAL',
  true,
  digest('PHASE01_OWNER_FINAL_V1|1|OWNER_FINAL_APPROVAL|submitter_may_approve=true', 'sha256'),
  '2026-08-08 00:00:00'
);

CREATE TRIGGER approval_template_version_append_only
BEFORE UPDATE OR DELETE ON workflow.approval_template_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE workflow.change_request (
  change_request_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  stable_entity_id uuid NOT NULL,
  entity_version_id uuid NOT NULL,
  change_kind varchar(32) NOT NULL CHECK (change_kind IN ('INITIAL_PUBLICATION', 'VERSION_CHANGE')),
  approval_template_version_id uuid NOT NULL REFERENCES workflow.approval_template_version,
  submitted_content_hash bytea NOT NULL CHECK (octet_length(submitted_content_hash) = 32),
  submitted_by uuid NOT NULL REFERENCES platform.security_principal,
  change_reason varchar(1000) NOT NULL CHECK (length(btrim(change_reason)) > 0),
  request_status varchar(16) NOT NULL CHECK (request_status IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  decided_at timestamp without time zone
);

CREATE INDEX change_request_object_idx
  ON workflow.change_request (governance_object_id, created_at);
CREATE INDEX change_request_template_version_idx
  ON workflow.change_request (approval_template_version_id);

CREATE TABLE workflow.approval_action (
  approval_action_id uuid PRIMARY KEY DEFAULT uuidv7(),
  change_request_id uuid NOT NULL REFERENCES workflow.change_request,
  action_sequence bigint NOT NULL CHECK (action_sequence > 0),
  stage_type varchar(32) NOT NULL CHECK (stage_type = 'OWNER_FINAL_APPROVAL'),
  actor_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  action_result varchar(16) NOT NULL CHECK (action_result IN ('APPROVED', 'REJECTED')),
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  seen_content_hash bytea NOT NULL CHECK (octet_length(seen_content_hash) = 32),
  occurred_at timestamp without time zone NOT NULL,
  UNIQUE (change_request_id, action_sequence)
);

CREATE TRIGGER approval_action_append_only
BEFORE UPDATE OR DELETE ON workflow.approval_action
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE FUNCTION workflow.protect_terminal_request()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.request_status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'terminal change requests are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER change_request_terminal_immutable
BEFORE UPDATE OR DELETE ON workflow.change_request
FOR EACH ROW EXECUTE FUNCTION workflow.protect_terminal_request();

CREATE TABLE release_distribution.governance_release (
  release_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  release_no bigint NOT NULL CHECK (release_no > 0),
  release_kind varchar(32) NOT NULL DEFAULT 'NORMAL'
    CHECK (release_kind IN ('NORMAL', 'COMPENSATION', 'HISTORICAL_REPUBLICATION', 'CONTRACT_SCHEMA_UPGRADE')),
  business_valid_from timestamp without time zone NOT NULL,
  business_valid_to timestamp without time zone,
  recorded_from timestamp without time zone NOT NULL,
  submitted_by uuid NOT NULL REFERENCES platform.security_principal,
  approved_by uuid NOT NULL REFERENCES platform.security_principal,
  approved_at timestamp without time zone NOT NULL,
  change_reason varchar(1000) NOT NULL CHECK (length(btrim(change_reason)) > 0),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (governance_object_id, release_no),
  UNIQUE (release_id, governance_object_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from)
);

CREATE INDEX governance_release_object_idx
  ON release_distribution.governance_release (governance_object_id, release_no);

CREATE TRIGGER governance_release_append_only
BEFORE UPDATE OR DELETE ON release_distribution.governance_release
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE charge_catalog.priced_object (
  priced_object_id uuid PRIMARY KEY DEFAULT uuidv7(),
  object_kind varchar(24) NOT NULL CHECK (object_kind = 'CHARGE_ITEM'),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE charge_catalog.charge_item (
  charge_item_id uuid PRIMARY KEY REFERENCES charge_catalog.priced_object,
  internal_code varchar(64) NOT NULL UNIQUE,
  origin_scope varchar(24) NOT NULL CHECK (origin_scope IN ('HOSPITAL', 'CAMPUS_EXTENSION')),
  origin_campus_id uuid REFERENCES platform.campus,
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  CHECK (
    (origin_scope = 'HOSPITAL' AND origin_campus_id IS NULL)
    OR (origin_scope = 'CAMPUS_EXTENSION' AND origin_campus_id IS NOT NULL)
  )
);

CREATE INDEX charge_item_origin_campus_idx ON charge_catalog.charge_item (origin_campus_id)
  WHERE origin_campus_id IS NOT NULL;

CREATE TABLE charge_catalog.charge_item_version (
  charge_item_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  charge_item_id uuid NOT NULL REFERENCES charge_catalog.charge_item,
  version_no bigint NOT NULL CHECK (version_no > 0),
  formal_name varchar(256) NOT NULL CHECK (length(btrim(formal_name)) > 0),
  service_definition varchar(2000) NOT NULL CHECK (length(btrim(service_definition)) > 0),
  billing_unit_code varchar(64) NOT NULL,
  charging_method_code varchar(32) NOT NULL,
  governance_status varchar(24) NOT NULL
    CHECK (governance_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED')),
  business_status varchar(24) NOT NULL
    CHECK (business_status IN ('PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED', 'SUPERSEDED')),
  business_valid_from timestamp without time zone NOT NULL,
  business_valid_to timestamp without time zone,
  recorded_from timestamp without time zone NOT NULL,
  recorded_to timestamp without time zone,
  release_id uuid REFERENCES release_distribution.governance_release,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  business_period tsrange GENERATED ALWAYS AS
    (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  recorded_period tsrange GENERATED ALWAYS AS
    (tsrange(recorded_from, recorded_to, '[)')) STORED,
  UNIQUE (charge_item_id, version_no),
  UNIQUE (charge_item_id, charge_item_version_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from),
  CHECK ((governance_status = 'PUBLISHED') = (release_id IS NOT NULL))
);

ALTER TABLE charge_catalog.charge_item_version
  ADD CONSTRAINT charge_item_version_no_bitemporal_overlap
  EXCLUDE USING gist (
    charge_item_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  ) WHERE (governance_status = 'PUBLISHED');

CREATE FUNCTION charge_catalog.protect_published_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.governance_status = 'PUBLISHED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published charge item versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER charge_item_version_published_immutable
BEFORE UPDATE OR DELETE ON charge_catalog.charge_item_version
FOR EACH ROW EXECUTE FUNCTION charge_catalog.protect_published_version();

CREATE TABLE price_list.price_list (
  price_list_id uuid PRIMARY KEY DEFAULT uuidv7(),
  governance_object_id uuid NOT NULL UNIQUE REFERENCES platform.governance_object,
  price_list_code varchar(64) NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE price_list.price_list_release (
  price_list_release_id uuid PRIMARY KEY DEFAULT uuidv7(),
  price_list_id uuid NOT NULL REFERENCES price_list.price_list,
  release_no bigint NOT NULL CHECK (release_no > 0),
  display_name varchar(256) NOT NULL,
  currency_code varchar(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  business_valid_from timestamp without time zone NOT NULL,
  business_valid_to timestamp without time zone,
  recorded_from timestamp without time zone NOT NULL,
  recorded_to timestamp without time zone,
  governance_status varchar(24) NOT NULL
    CHECK (governance_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED')),
  business_status varchar(24) NOT NULL
    CHECK (business_status IN ('PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED')),
  governance_release_id uuid REFERENCES release_distribution.governance_release,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  business_period tsrange GENERATED ALWAYS AS
    (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  recorded_period tsrange GENERATED ALWAYS AS
    (tsrange(recorded_from, recorded_to, '[)')) STORED,
  UNIQUE (price_list_id, release_no),
  UNIQUE (price_list_id, price_list_release_id),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (recorded_to IS NULL OR recorded_to > recorded_from),
  CHECK ((governance_status = 'PUBLISHED') = (governance_release_id IS NOT NULL))
);

ALTER TABLE price_list.price_list_release
  ADD CONSTRAINT price_list_release_no_bitemporal_overlap
  EXCLUDE USING gist (
    price_list_id WITH =,
    business_period WITH &&,
    recorded_period WITH &&
  ) WHERE (governance_status = 'PUBLISHED');

CREATE FUNCTION price_list.protect_published_release()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.governance_status = 'PUBLISHED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published price list releases are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER price_list_release_published_immutable
BEFORE UPDATE OR DELETE ON price_list.price_list_release
FOR EACH ROW EXECUTE FUNCTION price_list.protect_published_release();

CREATE TABLE price_list.price_entry (
  price_entry_id uuid PRIMARY KEY DEFAULT uuidv7(),
  price_list_release_id uuid NOT NULL REFERENCES price_list.price_list_release,
  entry_no bigint NOT NULL CHECK (entry_no > 0),
  priced_object_id uuid NOT NULL REFERENCES charge_catalog.priced_object,
  scope_level varchar(16) NOT NULL CHECK (scope_level IN ('HOSPITAL', 'CAMPUS')),
  campus_id uuid REFERENCES platform.campus,
  encounter_mode varchar(16) NOT NULL CHECK (encounter_mode IN ('GENERAL', 'SPECIFIC')),
  encounter_type varchar(16)
    CHECK (encounter_type IS NULL OR encounter_type IN ('OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP')),
  fixed_unit_price numeric(18,4) NOT NULL CHECK (fixed_unit_price >= 0),
  currency_code varchar(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  billing_unit_code varchar(64) NOT NULL,
  business_valid_from timestamp without time zone NOT NULL,
  business_valid_to timestamp without time zone,
  price_nature varchar(32) NOT NULL CHECK (price_nature IN ('HOSPITAL_DEFAULT', 'CAMPUS_DIFFERENCE')),
  zero_price_reason varchar(500),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  business_period tsrange GENERATED ALWAYS AS
    (tsrange(business_valid_from, business_valid_to, '[)')) STORED,
  scope_key text GENERATED ALWAYS AS
    (CASE scope_level WHEN 'HOSPITAL' THEN 'HOSPITAL' ELSE 'CAMPUS:' || campus_id::text END) STORED,
  encounter_coverage int4multirange GENERATED ALWAYS AS
    (CASE
      WHEN encounter_mode = 'GENERAL' THEN '{[1,5)}'::int4multirange
      WHEN encounter_type = 'OUTPATIENT' THEN '{[1,2)}'::int4multirange
      WHEN encounter_type = 'INPATIENT' THEN '{[2,3)}'::int4multirange
      WHEN encounter_type = 'EMERGENCY' THEN '{[3,4)}'::int4multirange
      WHEN encounter_type = 'CHECKUP' THEN '{[4,5)}'::int4multirange
    END) STORED,
  UNIQUE (price_entry_id, priced_object_id),
  UNIQUE (price_list_release_id, entry_no),
  CHECK (business_valid_to IS NULL OR business_valid_to > business_valid_from),
  CHECK (
    (scope_level = 'HOSPITAL' AND campus_id IS NULL AND price_nature = 'HOSPITAL_DEFAULT')
    OR (scope_level = 'CAMPUS' AND campus_id IS NOT NULL AND price_nature = 'CAMPUS_DIFFERENCE')
  ),
  CHECK (
    (encounter_mode = 'GENERAL' AND encounter_type IS NULL)
    OR (encounter_mode = 'SPECIFIC' AND encounter_type IS NOT NULL)
  ),
  CHECK (
    (fixed_unit_price = 0 AND zero_price_reason IS NOT NULL AND length(btrim(zero_price_reason)) > 0)
    OR (fixed_unit_price > 0 AND zero_price_reason IS NULL)
  )
);

ALTER TABLE price_list.price_entry
  ADD CONSTRAINT price_entry_no_ambiguous_match
  EXCLUDE USING gist (
    price_list_release_id WITH =,
    priced_object_id WITH =,
    scope_key WITH =,
    encounter_coverage WITH &&,
    business_period WITH &&
  );

CREATE TABLE price_list.price_entry_charge_item_target (
  price_entry_id uuid PRIMARY KEY,
  charge_item_id uuid NOT NULL,
  charge_item_version_id uuid NOT NULL,
  FOREIGN KEY (price_entry_id, charge_item_id)
    REFERENCES price_list.price_entry (price_entry_id, priced_object_id),
  FOREIGN KEY (charge_item_id, charge_item_version_id)
    REFERENCES charge_catalog.charge_item_version (charge_item_id, charge_item_version_id)
);

CREATE FUNCTION price_list.validate_price_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_release price_list.price_list_release%ROWTYPE;
BEGIN
  SELECT * INTO STRICT parent_release
  FROM price_list.price_list_release
  WHERE price_list_release_id = NEW.price_list_release_id
  FOR SHARE;

  IF parent_release.governance_status = 'PUBLISHED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published releases cannot receive entries';
  END IF;
  IF parent_release.currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'entry currency must equal release currency';
  END IF;
  IF NOT (parent_release.business_period @> NEW.business_period) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'entry period must be contained by release';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER price_entry_parent_guard
BEFORE INSERT ON price_list.price_entry
FOR EACH ROW EXECUTE FUNCTION price_list.validate_price_entry();

CREATE FUNCTION price_list.protect_published_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_release_id uuid;
  parent_status varchar(24);
BEGIN
  IF TG_TABLE_NAME = 'price_entry' THEN
    parent_release_id := OLD.price_list_release_id;
  ELSE
    SELECT price_list_release_id INTO STRICT parent_release_id
    FROM price_list.price_entry WHERE price_entry_id = OLD.price_entry_id;
  END IF;
  SELECT governance_status INTO STRICT parent_status
  FROM price_list.price_list_release WHERE price_list_release_id = parent_release_id;
  IF parent_status = 'PUBLISHED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published price entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER price_entry_published_immutable
BEFORE UPDATE OR DELETE ON price_list.price_entry
FOR EACH ROW EXECUTE FUNCTION price_list.protect_published_entry();
CREATE TRIGGER price_entry_target_published_immutable
BEFORE UPDATE OR DELETE ON price_list.price_entry_charge_item_target
FOR EACH ROW EXECUTE FUNCTION price_list.protect_published_entry();

CREATE TABLE release_distribution.release_member_charge_item (
  release_member_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  charge_item_id uuid NOT NULL,
  charge_item_version_id uuid NOT NULL,
  snapshot_name varchar(256) NOT NULL,
  member_hash bytea NOT NULL CHECK (octet_length(member_hash) = 32),
  FOREIGN KEY (charge_item_id, charge_item_version_id)
    REFERENCES charge_catalog.charge_item_version (charge_item_id, charge_item_version_id),
  UNIQUE (release_id, charge_item_id)
);

CREATE TABLE release_distribution.release_member_price_list (
  release_member_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  price_list_id uuid NOT NULL,
  price_list_release_id uuid NOT NULL,
  snapshot_name varchar(256) NOT NULL,
  member_hash bytea NOT NULL CHECK (octet_length(member_hash) = 32),
  FOREIGN KEY (price_list_id, price_list_release_id)
    REFERENCES price_list.price_list_release (price_list_id, price_list_release_id),
  UNIQUE (release_id, price_list_id)
);

CREATE TABLE release_distribution.release_snapshot (
  release_snapshot_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL UNIQUE REFERENCES release_distribution.governance_release,
  artifact_role varchar(16) NOT NULL DEFAULT 'CANONICAL' CHECK (artifact_role = 'CANONICAL'),
  envelope_contract_version varchar(32) NOT NULL,
  projection_type varchar(128) NOT NULL,
  projection_schema_version varchar(32) NOT NULL,
  projection_schema_digest bytea NOT NULL CHECK (octet_length(projection_schema_digest) = 32),
  serialization_profile_version varchar(32) NOT NULL,
  artifact_media_type varchar(128) NOT NULL,
  artifact_bytes bytea NOT NULL,
  artifact_byte_length bigint GENERATED ALWAYS AS (octet_length(artifact_bytes)::bigint) STORED,
  projection_payload_digest bytea NOT NULL CHECK (octet_length(projection_payload_digest) = 32),
  snapshot_artifact_digest bytea NOT NULL CHECK (octet_length(snapshot_artifact_digest) = 32),
  item_count bigint NOT NULL CHECK (item_count >= 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (release_snapshot_id, release_id),
  CHECK (artifact_byte_length <= 16777216)
);

CREATE TABLE release_distribution.outbox_event (
  event_id uuid PRIMARY KEY DEFAULT uuidv7(),
  aggregate_type varchar(32) NOT NULL,
  aggregate_id uuid NOT NULL REFERENCES platform.governance_object,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type varchar(32) NOT NULL CHECK (event_type IN ('PUBLISHED', 'SUSPENDED', 'INVALIDATED')),
  release_id uuid NOT NULL,
  release_snapshot_id uuid NOT NULL,
  projection_type varchar(128) NOT NULL,
  projection_schema_version varchar(32) NOT NULL,
  projection_schema_digest bytea NOT NULL CHECK (octet_length(projection_schema_digest) = 32),
  projection_payload_digest bytea NOT NULL CHECK (octet_length(projection_payload_digest) = 32),
  snapshot_artifact_digest bytea NOT NULL CHECK (octet_length(snapshot_artifact_digest) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (release_snapshot_id, release_id)
    REFERENCES release_distribution.release_snapshot (release_snapshot_id, release_id),
  UNIQUE (aggregate_id, aggregate_version),
  UNIQUE (event_id, release_id)
);

CREATE TABLE release_distribution.consumer_subscription (
  consumer_subscription_id uuid PRIMARY KEY DEFAULT uuidv7(),
  subscription_code varchar(128) NOT NULL UNIQUE,
  service_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (consumer_subscription_id, governance_object_id)
);

CREATE INDEX consumer_subscription_service_principal_idx
  ON release_distribution.consumer_subscription (service_principal_id);
CREATE INDEX consumer_subscription_object_idx
  ON release_distribution.consumer_subscription (governance_object_id);

CREATE TABLE release_distribution.consumer_subscription_version (
  consumer_subscription_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  version_no bigint NOT NULL CHECK (version_no > 0),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  recorded_sequence bigint NOT NULL CHECK (recorded_sequence > 0),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (consumer_subscription_id, version_no),
  UNIQUE (consumer_subscription_id, consumer_subscription_version_id)
);

CREATE INDEX consumer_subscription_version_subscription_idx
  ON release_distribution.consumer_subscription_version (consumer_subscription_id, version_no);

CREATE TABLE release_distribution.consumer_projection_support (
  consumer_subscription_version_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription_version,
  projection_type varchar(128) NOT NULL,
  projection_schema_version varchar(32) NOT NULL,
  projection_schema_digest bytea NOT NULL CHECK (octet_length(projection_schema_digest) = 32),
  PRIMARY KEY (consumer_subscription_version_id, projection_type, projection_schema_version)
);

CREATE TABLE release_distribution.release_consumer_compatibility (
  release_consumer_compatibility_id uuid PRIMARY KEY DEFAULT uuidv7(),
  release_id uuid NOT NULL REFERENCES release_distribution.governance_release,
  event_id uuid NOT NULL,
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  consumer_subscription_version_id uuid NOT NULL,
  result varchar(24) NOT NULL CHECK (result IN ('SUPPORTED', 'UNSUPPORTED')),
  result_sequence bigint NOT NULL CHECK (result_sequence > 0),
  evidence_hash bytea NOT NULL CHECK (octet_length(evidence_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (consumer_subscription_id, consumer_subscription_version_id)
    REFERENCES release_distribution.consumer_subscription_version (
      consumer_subscription_id,
      consumer_subscription_version_id
    ),
  FOREIGN KEY (event_id, release_id)
    REFERENCES release_distribution.outbox_event (event_id, release_id),
  UNIQUE (release_id, consumer_subscription_id, result_sequence),
  UNIQUE (event_id, consumer_subscription_id, release_consumer_compatibility_id)
);

CREATE INDEX release_consumer_compatibility_event_idx
  ON release_distribution.release_consumer_compatibility (event_id);
CREATE INDEX release_consumer_compatibility_subscription_idx
  ON release_distribution.release_consumer_compatibility (
    consumer_subscription_id,
    consumer_subscription_version_id
  );

CREATE TABLE release_distribution.outbox_delivery (
  outbox_delivery_id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES release_distribution.outbox_event,
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (event_id, consumer_subscription_id),
  UNIQUE (event_id, consumer_subscription_id, outbox_delivery_id)
);

CREATE TABLE release_distribution.outbox_delivery_state (
  outbox_delivery_state_id uuid PRIMARY KEY DEFAULT uuidv7(),
  outbox_delivery_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer_subscription_id uuid NOT NULL,
  compatibility_id uuid NOT NULL,
  state_sequence bigint NOT NULL CHECK (state_sequence > 0),
  delivery_status varchar(32) NOT NULL
    CHECK (delivery_status IN (
      'PENDING', 'LEASED', 'NOTIFIED', 'DELIVERED',
      'BLOCKED_INCOMPATIBLE', 'ATTENTION_REQUIRED'
    )),
  lease_owner varchar(128),
  lease_expires_at timestamp without time zone,
  next_attempt_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (event_id, consumer_subscription_id, outbox_delivery_id)
    REFERENCES release_distribution.outbox_delivery (
      event_id,
      consumer_subscription_id,
      outbox_delivery_id
    ),
  FOREIGN KEY (event_id, consumer_subscription_id, compatibility_id)
    REFERENCES release_distribution.release_consumer_compatibility (
      event_id,
      consumer_subscription_id,
      release_consumer_compatibility_id
  ),
  UNIQUE (outbox_delivery_id, state_sequence),
  UNIQUE (outbox_delivery_id, outbox_delivery_state_id),
  CHECK (
    (delivery_status = 'LEASED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (delivery_status <> 'LEASED' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX outbox_delivery_subscription_idx
  ON release_distribution.outbox_delivery (consumer_subscription_id, event_id);
CREATE INDEX outbox_delivery_state_latest_idx
  ON release_distribution.outbox_delivery_state (outbox_delivery_id, state_sequence DESC);

CREATE TABLE release_distribution.outbox_delivery_attempt (
  outbox_delivery_attempt_id uuid PRIMARY KEY DEFAULT uuidv7(),
  outbox_delivery_id uuid NOT NULL,
  outbox_delivery_state_id uuid NOT NULL,
  attempt_no bigint NOT NULL CHECK (attempt_no > 0),
  result varchar(32) NOT NULL CHECK (result IN (
    'NOTIFICATION_ACCEPTED', 'RETRYABLE_FAILURE', 'FATAL_FAILURE', 'OFFERED_BY_PULL'
  )),
  error_code varchar(128),
  response_digest bytea CHECK (response_digest IS NULL OR octet_length(response_digest) = 32),
  occurred_at timestamp without time zone NOT NULL,
  correlation_id varchar(128) NOT NULL,
  FOREIGN KEY (outbox_delivery_id, outbox_delivery_state_id)
    REFERENCES release_distribution.outbox_delivery_state (
      outbox_delivery_id,
      outbox_delivery_state_id
    ),
  UNIQUE (outbox_delivery_id, attempt_no)
);

CREATE INDEX outbox_delivery_attempt_delivery_idx
  ON release_distribution.outbox_delivery_attempt (outbox_delivery_id, attempt_no);

CREATE TABLE release_distribution.delivery_operational_issue (
  delivery_operational_issue_id uuid PRIMARY KEY DEFAULT uuidv7(),
  issue_code varchar(128) NOT NULL UNIQUE,
  outbox_delivery_id uuid NOT NULL UNIQUE REFERENCES release_distribution.outbox_delivery,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE release_distribution.delivery_operational_issue_event (
  delivery_operational_issue_event_id uuid PRIMARY KEY DEFAULT uuidv7(),
  delivery_operational_issue_id uuid NOT NULL REFERENCES release_distribution.delivery_operational_issue,
  issue_sequence bigint NOT NULL CHECK (issue_sequence > 0),
  issue_status varchar(16) NOT NULL CHECK (issue_status IN ('OPEN', 'RESOLVED')),
  outbox_delivery_attempt_id uuid NOT NULL REFERENCES release_distribution.outbox_delivery_attempt,
  error_code varchar(128) NOT NULL,
  occurred_at timestamp without time zone NOT NULL,
  correlation_id varchar(128) NOT NULL,
  UNIQUE (delivery_operational_issue_id, issue_sequence)
);

CREATE TABLE release_distribution.consumer_compatibility_issue (
  consumer_compatibility_issue_id uuid PRIMARY KEY DEFAULT uuidv7(),
  issue_code varchar(128) NOT NULL UNIQUE,
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  event_id uuid NOT NULL REFERENCES release_distribution.outbox_event,
  opened_compatibility_id uuid NOT NULL REFERENCES release_distribution.release_consumer_compatibility,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (consumer_subscription_id, event_id)
);

CREATE TABLE release_distribution.consumer_compatibility_issue_event (
  consumer_compatibility_issue_event_id uuid PRIMARY KEY DEFAULT uuidv7(),
  consumer_compatibility_issue_id uuid NOT NULL REFERENCES release_distribution.consumer_compatibility_issue,
  issue_sequence bigint NOT NULL CHECK (issue_sequence > 0),
  issue_status varchar(16) NOT NULL CHECK (issue_status IN ('OPEN', 'RESOLVED')),
  compatibility_id uuid NOT NULL REFERENCES release_distribution.release_consumer_compatibility,
  evidence_hash bytea NOT NULL CHECK (octet_length(evidence_hash) = 32),
  occurred_at timestamp without time zone NOT NULL,
  correlation_id varchar(128) NOT NULL,
  UNIQUE (consumer_compatibility_issue_id, issue_sequence)
);

CREATE TABLE release_distribution.consumer_receipt (
  consumer_receipt_id uuid PRIMARY KEY DEFAULT uuidv7(),
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  event_id uuid NOT NULL REFERENCES release_distribution.outbox_event,
  receipt_sequence bigint NOT NULL CHECK (receipt_sequence > 0),
  receive_result varchar(16) NOT NULL CHECK (receive_result IN ('ACCEPTED', 'REJECTED')),
  validation_result varchar(16) NOT NULL CHECK (validation_result IN ('VALID', 'INVALID')),
  apply_result varchar(16) NOT NULL CHECK (apply_result IN ('APPLIED', 'NOT_APPLIED')),
  processing_digest bytea NOT NULL CHECK (octet_length(processing_digest) = 32),
  processed_at timestamp without time zone NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (event_id, consumer_subscription_id)
    REFERENCES release_distribution.outbox_delivery (event_id, consumer_subscription_id),
  UNIQUE (consumer_subscription_id, event_id, receipt_sequence),
  CHECK (apply_result <> 'APPLIED' OR (receive_result = 'ACCEPTED' AND validation_result = 'VALID')),
  CHECK (receive_result <> 'REJECTED' OR apply_result = 'NOT_APPLIED'),
  CHECK (validation_result <> 'INVALID' OR apply_result = 'NOT_APPLIED')
);

CREATE TABLE release_distribution.consumer_checkpoint (
  consumer_subscription_id uuid NOT NULL REFERENCES release_distribution.consumer_subscription,
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  applied_aggregate_version bigint NOT NULL CHECK (applied_aggregate_version >= 0),
  updated_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY (consumer_subscription_id, governance_object_id)
    REFERENCES release_distribution.consumer_subscription (
      consumer_subscription_id,
      governance_object_id
    ),
  PRIMARY KEY (consumer_subscription_id, governance_object_id)
);

CREATE TRIGGER release_member_charge_item_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_member_charge_item
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER release_member_price_list_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_member_price_list
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER release_snapshot_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_snapshot
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER outbox_event_append_only
BEFORE UPDATE OR DELETE ON release_distribution.outbox_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER subscription_version_append_only
BEFORE UPDATE OR DELETE ON release_distribution.consumer_subscription_version
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER projection_support_append_only
BEFORE UPDATE OR DELETE ON release_distribution.consumer_projection_support
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER release_compatibility_append_only
BEFORE UPDATE OR DELETE ON release_distribution.release_consumer_compatibility
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER delivery_state_append_only
BEFORE UPDATE OR DELETE ON release_distribution.outbox_delivery_state
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER delivery_attempt_append_only
BEFORE UPDATE OR DELETE ON release_distribution.outbox_delivery_attempt
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER delivery_operational_issue_append_only
BEFORE UPDATE OR DELETE ON release_distribution.delivery_operational_issue
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER delivery_operational_issue_event_append_only
BEFORE UPDATE OR DELETE ON release_distribution.delivery_operational_issue_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER compatibility_issue_append_only
BEFORE UPDATE OR DELETE ON release_distribution.consumer_compatibility_issue
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER compatibility_issue_event_append_only
BEFORE UPDATE OR DELETE ON release_distribution.consumer_compatibility_issue_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER consumer_receipt_append_only
BEFORE UPDATE OR DELETE ON release_distribution.consumer_receipt
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE price_resolution.price_resolution (
  price_resolution_id uuid PRIMARY KEY DEFAULT uuidv7(),
  request_id varchar(128) NOT NULL UNIQUE,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  priced_object_id uuid NOT NULL REFERENCES charge_catalog.priced_object,
  price_list_id uuid NOT NULL REFERENCES price_list.price_list,
  price_list_release_id uuid REFERENCES price_list.price_list_release,
  published_view_hash bytea CHECK (published_view_hash IS NULL OR octet_length(published_view_hash) = 32),
  campus_id uuid NOT NULL REFERENCES platform.campus,
  encounter_type varchar(16) NOT NULL
    CHECK (encounter_type IN ('OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP')),
  service_occurred_at timestamp without time zone NOT NULL,
  record_as_of timestamp without time zone NOT NULL,
  resolution_status varchar(24) NOT NULL
    CHECK (resolution_status IN ('SUCCEEDED', 'NO_PRICE', 'CONFLICT', 'SUSPENDED')),
  resolved_at timestamp without time zone NOT NULL,
  input_context_hash bytea NOT NULL CHECK (octet_length(input_context_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE price_resolution.price_resolution_charge_item_target (
  price_resolution_id uuid PRIMARY KEY REFERENCES price_resolution.price_resolution,
  charge_item_id uuid NOT NULL,
  charge_item_version_id uuid NOT NULL,
  FOREIGN KEY (charge_item_id, charge_item_version_id)
    REFERENCES charge_catalog.charge_item_version (charge_item_id, charge_item_version_id)
);

CREATE TABLE price_resolution.price_resolution_step (
  price_resolution_step_id uuid PRIMARY KEY DEFAULT uuidv7(),
  price_resolution_id uuid NOT NULL REFERENCES price_resolution.price_resolution,
  step_no bigint NOT NULL CHECK (step_no > 0),
  scope_checked varchar(16) NOT NULL CHECK (scope_checked IN ('CAMPUS', 'HOSPITAL')),
  encounter_mode_checked varchar(16) NOT NULL CHECK (encounter_mode_checked IN ('SPECIFIC', 'GENERAL')),
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  decision varchar(24) NOT NULL CHECK (decision IN ('MATCHED', 'NO_CANDIDATE', 'CONFLICT', 'SUSPENDED')),
  price_entry_id uuid REFERENCES price_list.price_entry,
  candidate_set_hash bytea NOT NULL CHECK (octet_length(candidate_set_hash) = 32),
  explanation_code varchar(128) NOT NULL,
  UNIQUE (price_resolution_id, step_no),
  CHECK ((decision = 'MATCHED') = (price_entry_id IS NOT NULL))
);

CREATE TABLE price_resolution.price_resolution_result (
  price_resolution_result_id uuid PRIMARY KEY DEFAULT uuidv7(),
  price_resolution_id uuid NOT NULL UNIQUE REFERENCES price_resolution.price_resolution,
  price_entry_id uuid NOT NULL REFERENCES price_list.price_entry,
  price_list_release_id uuid NOT NULL REFERENCES price_list.price_list_release,
  price_list_release_hash bytea NOT NULL CHECK (octet_length(price_list_release_hash) = 32),
  price_entry_hash bytea NOT NULL CHECK (octet_length(price_entry_hash) = 32),
  matched_scope_level varchar(16) NOT NULL CHECK (matched_scope_level IN ('CAMPUS', 'HOSPITAL')),
  matched_encounter_mode varchar(16) NOT NULL CHECK (matched_encounter_mode IN ('SPECIFIC', 'GENERAL')),
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  amount_before_rounding numeric(18,6) NOT NULL CHECK (amount_before_rounding >= 0),
  final_amount numeric(18,4) NOT NULL CHECK (final_amount >= 0),
  currency_code varchar(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  result_hash bytea NOT NULL CHECK (octet_length(result_hash) = 32)
);

CREATE TRIGGER price_resolution_append_only
BEFORE UPDATE OR DELETE ON price_resolution.price_resolution
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER price_resolution_target_append_only
BEFORE UPDATE OR DELETE ON price_resolution.price_resolution_charge_item_target
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER price_resolution_step_append_only
BEFORE UPDATE OR DELETE ON price_resolution.price_resolution_step
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER price_resolution_result_append_only
BEFORE UPDATE OR DELETE ON price_resolution.price_resolution_result
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

CREATE TABLE audit.audit_event (
  audit_event_id uuid PRIMARY KEY DEFAULT uuidv7(),
  audit_stream_id uuid NOT NULL,
  audit_sequence bigint NOT NULL CHECK (audit_sequence > 0),
  governance_object_id uuid NOT NULL REFERENCES platform.governance_object,
  entity_type varchar(64) NOT NULL,
  stable_entity_id uuid NOT NULL,
  entity_version_id uuid,
  action varchar(64) NOT NULL,
  after_hash bytea CHECK (after_hash IS NULL OR octet_length(after_hash) = 32),
  actor_principal_id uuid NOT NULL REFERENCES platform.security_principal,
  authority_scope varchar(128) NOT NULL,
  occurred_at timestamp without time zone NOT NULL,
  request_id varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  event_payload_hash bytea NOT NULL CHECK (octet_length(event_payload_hash) = 32),
  previous_hash bytea NOT NULL CHECK (octet_length(previous_hash) = 32),
  current_hash bytea NOT NULL CHECK (octet_length(current_hash) = 32),
  created_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
  UNIQUE (audit_stream_id, audit_sequence)
);

CREATE FUNCTION audit.verify_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  prior_sequence bigint;
  prior_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.audit_stream_id::text, 0));
  SELECT audit_sequence, current_hash INTO prior_sequence, prior_hash
  FROM audit.audit_event
  WHERE audit_stream_id = NEW.audit_stream_id
  ORDER BY audit_sequence DESC LIMIT 1;

  IF prior_sequence IS NULL THEN
    IF NEW.audit_sequence <> 1 OR NEW.previous_hash <> decode(repeat('00', 32), 'hex') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid first audit chain link';
    END IF;
  ELSIF NEW.audit_sequence <> prior_sequence + 1 OR NEW.previous_hash <> prior_hash THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'audit event does not extend current chain';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER audit_event_chain_guard
BEFORE INSERT ON audit.audit_event
FOR EACH ROW EXECUTE FUNCTION audit.verify_audit_chain();
CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON audit.audit_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();

COMMIT;
