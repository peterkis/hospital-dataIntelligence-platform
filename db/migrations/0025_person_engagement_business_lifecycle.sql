BEGIN;

ALTER TABLE access_control.object_permission_grant
  DROP CONSTRAINT object_permission_grant_permission_code_check;
ALTER TABLE access_control.object_permission_grant
  ADD CONSTRAINT object_permission_grant_permission_code_check CHECK (permission_code IN (
    'CHARGE_CATALOG_DRAFT_READ', 'CHARGE_CATALOG_DRAFT_WRITE', 'CHARGE_CATALOG_PUBLISH',
    'CHARGE_CATALOG_SUBMIT', 'CHARGE_CATALOG_REVIEW', 'CHARGE_CATALOG_APPROVE',
    'PRICE_LIST_DRAFT_READ', 'PRICE_LIST_DRAFT_WRITE', 'PRICE_LIST_PUBLISH',
    'PRICE_LIST_SUBMIT', 'PRICE_LIST_REVIEW', 'PRICE_LIST_APPROVE',
    'DEPARTMENT_MASTER_DRAFT_READ', 'DEPARTMENT_MASTER_DRAFT_WRITE',
    'DEPARTMENT_MASTER_SUBMIT', 'DEPARTMENT_MASTER_REVIEW', 'DEPARTMENT_MASTER_APPROVE', 'DEPARTMENT_MASTER_PUBLISH',
    'DEPARTMENT_HIERARCHY_DRAFT_READ', 'DEPARTMENT_HIERARCHY_DRAFT_WRITE',
    'DEPARTMENT_HIERARCHY_SUBMIT', 'DEPARTMENT_HIERARCHY_REVIEW', 'DEPARTMENT_HIERARCHY_APPROVE', 'DEPARTMENT_HIERARCHY_PUBLISH',
    'CAMPUS_PRICE_CONFIRM', 'SCHEMA_UPGRADE_SUBMIT', 'SCHEMA_UPGRADE_APPROVE', 'PRICE_RESOLVE',
    'CONSUMER_SUBSCRIPTION_MANAGE', 'AUDIT_READ', 'EMERGENCY_SUSPEND', 'IMPACT_REVIEW', 'RECOVERY_APPROVE',
    'PERSON_MASTER_CORE_READ', 'PERSON_MASTER_CORE_WRITE',
    'PERSON_MASTER_IDENTIFIER_READ', 'PERSON_MASTER_IDENTIFIER_WRITE',
    'PERSON_MASTER_SOURCE_MAPPING_READ', 'PERSON_MASTER_SOURCE_MAPPING_WRITE', 'PERSON_MASTER_SOURCE_MAPPING_CORRECT',
    'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE',
    'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ', 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE',
    'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ', 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE',
    'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE'
  ));

ALTER TABLE person_master.engagement
  ADD CONSTRAINT engagement_scope_authority_unique
  UNIQUE (engagement_id, governance_object_id);

ALTER TABLE person_master.engagement_version
  DROP CONSTRAINT engagement_version_revision_reason_code_check;
ALTER TABLE person_master.engagement_version
  ADD CONSTRAINT engagement_version_revision_reason_code_check CHECK (
    revision_reason_code IS NULL OR revision_reason_code IN (
      'FACT_CORRECTION', 'VALIDITY_CORRECTION', 'CONTINUATION_EXTENSION', 'LIFECYCLE_END'
    )
  );

CREATE TABLE person_master.engagement_lifecycle_event (
  engagement_lifecycle_event_id uuid PRIMARY KEY DEFAULT uuidv7()
    CHECK (uuid_extract_version(engagement_lifecycle_event_id) = 7),
  engagement_id uuid NOT NULL,
  governance_object_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('SUSPENDED', 'RESUMED')),
  business_effective_at timestamp without time zone NOT NULL CHECK (
    isfinite(business_effective_at) AND business_effective_at >= TIMESTAMP '0001-01-01'
  ),
  recorded_at timestamp without time zone NOT NULL DEFAULT platform.local_now()
    CHECK (isfinite(recorded_at)),
  sequence_no bigint NOT NULL CHECK (sequence_no > 0),
  created_by uuid NOT NULL REFERENCES platform.security_principal,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 128),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  operation_hash bytea NOT NULL CHECK (octet_length(operation_hash) = 32),
  FOREIGN KEY (engagement_id, governance_object_id)
    REFERENCES person_master.engagement (engagement_id, governance_object_id),
  UNIQUE (engagement_id, sequence_no),
  UNIQUE (engagement_id, request_id)
);

CREATE INDEX engagement_lifecycle_event_business_as_of_idx
  ON person_master.engagement_lifecycle_event (
    engagement_id, business_effective_at DESC, sequence_no DESC, recorded_at
  );
CREATE INDEX engagement_lifecycle_event_record_as_of_idx
  ON person_master.engagement_lifecycle_event (
    engagement_id, recorded_at, sequence_no
  );

COMMENT ON TABLE person_master.engagement_lifecycle_event IS
  'SYNTHETIC NON_PRODUCTION append-only SUSPENDED/RESUMED business evidence. Derived Engagement business state remains separate from governance workflow and Person subject.';
COMMENT ON COLUMN person_master.engagement_lifecycle_event.business_effective_at IS
  'Asia/Shanghai business-effective local timestamp; never replaced by record or creation time.';
COMMENT ON COLUMN person_master.engagement_lifecycle_event.sequence_no IS
  'Monotonic per-Engagement append sequence. Business-state ordering also respects business_effective_at and recordAsOf.';

CREATE FUNCTION person_master.guard_engagement_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  relation person_master.engagement;
  period person_master.engagement_version;
  previous person_master.engagement_lifecycle_event;
  applicable person_master.engagement_lifecycle_event;
BEGIN
  SELECT * INTO relation
  FROM person_master.engagement
  WHERE engagement_id = NEW.engagement_id
    AND governance_object_id = NEW.governance_object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO period
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id
  ORDER BY version_no DESC
  LIMIT 1;
  IF NEW.business_effective_at < period.business_valid_from THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_STARTED' USING ERRCODE = '23514';
  END IF;
  IF period.business_valid_to IS NOT NULL
     AND NEW.business_effective_at >= period.business_valid_to THEN
    RAISE EXCEPTION 'ENGAGEMENT_ENDED' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO previous
  FROM person_master.engagement_lifecycle_event
  WHERE engagement_id = NEW.engagement_id
  ORDER BY sequence_no DESC
  LIMIT 1;
  IF previous.engagement_lifecycle_event_id IS NULL THEN
    IF NEW.sequence_no <> 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.sequence_no <> previous.sequence_no + 1 THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NEW.recorded_at <= previous.recorded_at THEN
      RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.recorded_at > platform.local_now() THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_RECORD_TIME_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO applicable
  FROM person_master.engagement_lifecycle_event
  WHERE engagement_id = NEW.engagement_id
    AND business_effective_at <= NEW.business_effective_at
  ORDER BY business_effective_at DESC, sequence_no DESC
  LIMIT 1;
  IF NEW.event_type = 'SUSPENDED' AND applicable.event_type = 'SUSPENDED' THEN
    RAISE EXCEPTION 'ENGAGEMENT_ALREADY_SUSPENDED' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type = 'RESUMED'
     AND applicable.event_type IS DISTINCT FROM 'SUSPENDED' THEN
    RAISE EXCEPTION 'ENGAGEMENT_NOT_SUSPENDED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_lifecycle_event_guard
BEFORE INSERT ON person_master.engagement_lifecycle_event
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_event();

CREATE FUNCTION person_master.guard_engagement_lifecycle_end_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous person_master.engagement_version;
BEGIN
  IF NEW.revision_reason_code <> 'LIFECYCLE_END' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO previous
  FROM person_master.engagement_version
  WHERE engagement_id = NEW.engagement_id
  ORDER BY version_no DESC
  LIMIT 1;
  IF previous.engagement_version_id IS NULL
     OR NEW.business_valid_from IS DISTINCT FROM previous.business_valid_from
     OR NEW.business_valid_to IS NULL
     OR NEW.business_valid_to <= NEW.business_valid_from
     OR (previous.business_valid_to IS NOT NULL
       AND NEW.business_valid_to > previous.business_valid_to) THEN
    RAISE EXCEPTION 'ENGAGEMENT_LIFECYCLE_END_VERSION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_lifecycle_end_version_guard
BEFORE INSERT ON person_master.engagement_version
FOR EACH ROW EXECUTE FUNCTION person_master.guard_engagement_lifecycle_end_version();

CREATE TRIGGER engagement_lifecycle_event_immutable
BEFORE UPDATE OR DELETE ON person_master.engagement_lifecycle_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_row_mutation();
CREATE TRIGGER engagement_lifecycle_event_no_truncate
BEFORE TRUNCATE ON person_master.engagement_lifecycle_event
FOR EACH STATEMENT EXECUTE FUNCTION platform.reject_row_mutation();

REVOKE UPDATE, DELETE, TRUNCATE
  ON person_master.engagement_lifecycle_event
  FROM PUBLIC;

INSERT INTO platform.schema_migration (migration_id)
VALUES ('0025_person_engagement_business_lifecycle');

COMMIT;
