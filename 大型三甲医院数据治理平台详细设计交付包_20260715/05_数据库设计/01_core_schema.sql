-- 大型三甲医院数据治理平台：核心数据库参考DDL
-- PostgreSQL 16+；生产前按医院命名规范、密码策略、加密扩展和容量压测调整。
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS mdm;
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS meta;
CREATE SCHEMA IF NOT EXISTS dq;
CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TYPE mdm.record_status AS ENUM ('DRAFT','PENDING','ACTIVE','INACTIVE','MERGED','RETIRED','REJECTED');
CREATE TYPE gov.request_status AS ENUM ('DRAFT','SUBMITTED','IN_REVIEW','APPROVED','REJECTED','PUBLISHED','ROLLED_BACK','CANCELLED');
CREATE TYPE dq.severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TABLE mdm.source_system (
    source_system_code varchar(64) PRIMARY KEY,
    source_system_name varchar(200) NOT NULL,
    owner_department varchar(200) NOT NULL,
    vendor_name varchar(200),
    environment varchar(32) NOT NULL DEFAULT 'PROD',
    authority_rank integer NOT NULL DEFAULT 100,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mdm.patient (
    patient_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empi_no varchar(64) NOT NULL UNIQUE,
    golden_name varchar(200) NOT NULL,
    gender_code varchar(32),
    birth_date date,
    deceased_flag boolean NOT NULL DEFAULT false,
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    current_version bigint NOT NULL DEFAULT 1,
    survivorship_rule_version varchar(64),
    quality_score numeric(6,3),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(128) NOT NULL,
    updated_by varchar(128) NOT NULL,
    CHECK (valid_to > valid_from)
);

CREATE TABLE mdm.patient_identifier (
    patient_identifier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_mdm_id uuid NOT NULL REFERENCES mdm.patient(patient_mdm_id),
    identifier_type varchar(64) NOT NULL,
    identifier_ciphertext bytea NOT NULL,
    identifier_hash char(64) NOT NULL,
    issuer_code varchar(128) NOT NULL DEFAULT 'HOSPITAL',
    use_code varchar(32) NOT NULL DEFAULT 'OFFICIAL',
    verified_flag boolean NOT NULL DEFAULT false,
    verified_at timestamptz,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    status mdm.record_status NOT NULL DEFAULT 'ACTIVE',
    UNIQUE(identifier_type, identifier_hash, issuer_code, valid_to)
);

CREATE TABLE mdm.patient_xref (
    patient_xref_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_mdm_id uuid NOT NULL REFERENCES mdm.patient(patient_mdm_id),
    source_system_code varchar(64) NOT NULL REFERENCES mdm.source_system(source_system_code),
    source_record_key varchar(256) NOT NULL,
    source_record_version varchar(128),
    source_authority_rank integer NOT NULL DEFAULT 100,
    match_method varchar(64),
    match_score numeric(8,5),
    mapping_status varchar(32) NOT NULL DEFAULT 'ACTIVE',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    source_payload_hash char(64),
    UNIQUE(source_system_code, source_record_key)
);

CREATE TABLE mdm.patient_link (
    patient_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_patient_mdm_id uuid NOT NULL REFERENCES mdm.patient(patient_mdm_id),
    target_patient_mdm_id uuid NOT NULL REFERENCES mdm.patient(patient_mdm_id),
    link_type varchar(32) NOT NULL,
    match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    approved_change_request_id uuid,
    effective_at timestamptz NOT NULL DEFAULT now(),
    reversed_at timestamptz,
    created_by varchar(128) NOT NULL,
    CHECK (source_patient_mdm_id <> target_patient_mdm_id)
);

CREATE TABLE mdm.organization (
    organization_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_code varchar(64) NOT NULL UNIQUE,
    organization_name varchar(300) NOT NULL,
    organization_type varchar(64) NOT NULL,
    parent_organization_mdm_id uuid REFERENCES mdm.organization(organization_mdm_id),
    campus_code varchar(64),
    clinical_flag boolean NOT NULL DEFAULT false,
    financial_cost_center_code varchar(64),
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    current_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mdm.location (
    location_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_code varchar(64) NOT NULL UNIQUE,
    location_name varchar(300) NOT NULL,
    physical_type varchar(64) NOT NULL,
    managing_organization_mdm_id uuid REFERENCES mdm.organization(organization_mdm_id),
    part_of_location_mdm_id uuid REFERENCES mdm.location(location_mdm_id),
    bed_category varchar(64),
    licensed_flag boolean,
    operational_flag boolean,
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    current_version bigint NOT NULL DEFAULT 1
);

CREATE TABLE mdm.practitioner (
    practitioner_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_master_no varchar(64) NOT NULL UNIQUE,
    display_name varchar(200) NOT NULL,
    employee_no varchar(64),
    id_number_hash char(64),
    professional_license_hash char(64),
    employment_status varchar(32) NOT NULL,
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    current_version bigint NOT NULL DEFAULT 1
);

CREATE TABLE mdm.practitioner_role (
    practitioner_role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    practitioner_mdm_id uuid NOT NULL REFERENCES mdm.practitioner(practitioner_mdm_id),
    organization_mdm_id uuid NOT NULL REFERENCES mdm.organization(organization_mdm_id),
    role_code varchar(64) NOT NULL,
    specialty_code varchar(64),
    primary_flag boolean NOT NULL DEFAULT false,
    authorized_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    status mdm.record_status NOT NULL DEFAULT 'ACTIVE',
    EXCLUDE USING gist (
      practitioner_mdm_id WITH =,
      organization_mdm_id WITH =,
      role_code WITH =,
      tstzrange(valid_from, valid_to, '[)') WITH &&
    ) WHERE (status = 'ACTIVE')
);

CREATE TABLE mdm.medication (
    medication_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_master_code varchar(64) NOT NULL UNIQUE,
    generic_name varchar(300) NOT NULL,
    trade_name varchar(300),
    dosage_form_code varchar(64),
    strength_text varchar(200),
    package_text varchar(200),
    manufacturer_mdm_id uuid,
    national_drug_code varchar(128),
    medical_insurance_code varchar(128),
    prescription_category varchar(64),
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity',
    current_version bigint NOT NULL DEFAULT 1
);

CREATE TABLE mdm.material (
    material_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_master_code varchar(64) NOT NULL UNIQUE,
    material_name varchar(300) NOT NULL,
    category_code varchar(64),
    specification varchar(300),
    model_no varchar(200),
    package_unit_code varchar(64),
    udi_di varchar(256),
    high_value_flag boolean NOT NULL DEFAULT false,
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity'
);

CREATE TABLE mdm.device (
    device_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_master_code varchar(64) NOT NULL UNIQUE,
    device_name varchar(300) NOT NULL,
    device_model varchar(200),
    serial_no_ciphertext bytea,
    serial_no_hash char(64),
    udi_di varchar(256),
    location_mdm_id uuid REFERENCES mdm.location(location_mdm_id),
    managing_organization_mdm_id uuid REFERENCES mdm.organization(organization_mdm_id),
    lifecycle_status varchar(64) NOT NULL,
    commissioned_at date,
    retired_at date
);

CREATE TABLE mdm.supplier (
    supplier_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_master_code varchar(64) NOT NULL UNIQUE,
    supplier_name varchar(300) NOT NULL,
    unified_social_credit_hash char(64),
    supplier_type varchar(64),
    qualification_status varchar(64),
    qualification_expiry_date date,
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    UNIQUE(unified_social_credit_hash, status)
);

CREATE TABLE mdm.service_item (
    service_item_mdm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_item_master_code varchar(64) NOT NULL UNIQUE,
    service_item_name varchar(300) NOT NULL,
    service_item_type varchar(64) NOT NULL,
    clinical_code varchar(128),
    billing_code varchar(128),
    insurance_code varchar(128),
    performing_organization_mdm_id uuid REFERENCES mdm.organization(organization_mdm_id),
    status mdm.record_status NOT NULL DEFAULT 'DRAFT',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity'
);

CREATE TABLE mdm.entity_version (
    entity_version_id bigserial PRIMARY KEY,
    domain_code varchar(64) NOT NULL,
    entity_type varchar(64) NOT NULL,
    entity_id uuid NOT NULL,
    version_no bigint NOT NULL,
    valid_time tstzrange NOT NULL,
    transaction_time tstzrange NOT NULL,
    entity_snapshot jsonb NOT NULL,
    source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
    change_request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(128) NOT NULL,
    UNIQUE(entity_type, entity_id, version_no)
);

CREATE TABLE ref.code_system (
    code_system_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_uri varchar(512) NOT NULL,
    code_system_name varchar(300) NOT NULL,
    version_no varchar(128) NOT NULL,
    publisher varchar(300),
    license_note text,
    status varchar(32) NOT NULL,
    effective_from date,
    effective_to date,
    checksum char(64),
    UNIQUE(canonical_uri, version_no)
);

CREATE TABLE ref.concept (
    concept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_system_id uuid NOT NULL REFERENCES ref.code_system(code_system_id),
    concept_code varchar(256) NOT NULL,
    display_name varchar(500) NOT NULL,
    definition text,
    parent_concept_id uuid REFERENCES ref.concept(concept_id),
    status varchar(32) NOT NULL DEFAULT 'ACTIVE',
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(code_system_id, concept_code)
);

CREATE TABLE ref.value_set (
    value_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_uri varchar(512) NOT NULL,
    value_set_name varchar(300) NOT NULL,
    version_no varchar(128) NOT NULL,
    compose_definition jsonb NOT NULL,
    owner_department varchar(200) NOT NULL,
    status varchar(32) NOT NULL,
    effective_from timestamptz,
    effective_to timestamptz,
    published_at timestamptz,
    checksum char(64),
    UNIQUE(canonical_uri, version_no)
);

CREATE TABLE ref.concept_map (
    concept_map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_uri varchar(512) NOT NULL,
    concept_map_name varchar(300) NOT NULL,
    version_no varchar(128) NOT NULL,
    source_scope_uri varchar(512) NOT NULL,
    target_scope_uri varchar(512) NOT NULL,
    status varchar(32) NOT NULL,
    UNIQUE(canonical_uri, version_no)
);

CREATE TABLE ref.concept_map_element (
    concept_map_element_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_map_id uuid NOT NULL REFERENCES ref.concept_map(concept_map_id),
    source_code varchar(256) NOT NULL,
    target_code varchar(256),
    equivalence varchar(32) NOT NULL,
    context_expression jsonb NOT NULL DEFAULT '{}'::jsonb,
    confidence numeric(6,4),
    human_verified_flag boolean NOT NULL DEFAULT false,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz NOT NULL DEFAULT 'infinity'
);

CREATE TABLE meta.data_asset (
    data_asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_urn varchar(1000) NOT NULL UNIQUE,
    asset_type varchar(64) NOT NULL,
    business_name varchar(300),
    technical_name varchar(500) NOT NULL,
    domain_code varchar(64) NOT NULL,
    owner_user_id varchar(128) NOT NULL,
    steward_user_id varchar(128) NOT NULL,
    classification_level varchar(64) NOT NULL,
    source_system_code varchar(64),
    lifecycle_status varchar(64) NOT NULL,
    quality_score numeric(6,3),
    usage_score numeric(12,3),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE meta.data_element (
    data_element_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    data_asset_id uuid NOT NULL REFERENCES meta.data_asset(data_asset_id),
    element_name varchar(300) NOT NULL,
    business_name varchar(300),
    definition text,
    logical_data_type varchar(128),
    physical_data_type varchar(128),
    standard_data_element_code varchar(128),
    value_set_uri varchar(512),
    privacy_level varchar(64) NOT NULL,
    masking_policy_code varchar(128),
    owner_department varchar(200),
    UNIQUE(data_asset_id, element_name)
);

CREATE TABLE meta.lineage_edge (
    lineage_edge_id bigserial PRIMARY KEY,
    source_urn varchar(1000) NOT NULL,
    target_urn varchar(1000) NOT NULL,
    lineage_level varchar(32) NOT NULL,
    operation_type varchar(64),
    job_urn varchar(1000),
    transform_expression text,
    confidence numeric(6,4),
    observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dq.rule (
    rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code varchar(128) NOT NULL UNIQUE,
    domain_code varchar(64) NOT NULL,
    target_urn varchar(1000) NOT NULL,
    quality_dimension varchar(64) NOT NULL,
    rule_expression text NOT NULL,
    threshold_expression varchar(500),
    severity dq.severity NOT NULL,
    blocking_flag boolean NOT NULL DEFAULT false,
    owner_user_id varchar(128) NOT NULL,
    steward_user_id varchar(128) NOT NULL,
    version_no varchar(64) NOT NULL,
    status varchar(32) NOT NULL,
    effective_from timestamptz,
    effective_to timestamptz
);

CREATE TABLE dq.execution (
    execution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id uuid NOT NULL REFERENCES dq.rule(rule_id),
    batch_id varchar(128) NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    total_count bigint,
    failed_count bigint,
    pass_rate numeric(9,6),
    result_status varchar(32) NOT NULL,
    evidence_uri varchar(1000),
    execution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE dq.issue (
    issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no varchar(64) NOT NULL UNIQUE,
    rule_id uuid REFERENCES dq.rule(rule_id),
    execution_id uuid REFERENCES dq.execution(execution_id),
    domain_code varchar(64) NOT NULL,
    object_token varchar(256),
    severity dq.severity NOT NULL,
    owner_user_id varchar(128) NOT NULL,
    root_cause_category varchar(128),
    issue_status varchar(32) NOT NULL,
    due_at timestamptz,
    closed_at timestamptz,
    corrective_action text,
    evidence_uri varchar(1000)
);

CREATE TABLE gov.change_request (
    change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no varchar(64) NOT NULL UNIQUE,
    domain_code varchar(64) NOT NULL,
    entity_type varchar(64) NOT NULL,
    entity_id uuid,
    change_type varchar(64) NOT NULL,
    proposal jsonb NOT NULL,
    impact_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
    rollback_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
    requester_user_id varchar(128) NOT NULL,
    owner_user_id varchar(128) NOT NULL,
    status gov.request_status NOT NULL DEFAULT 'DRAFT',
    submitted_at timestamptz,
    approved_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gov.approval_task (
    approval_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    change_request_id uuid NOT NULL REFERENCES gov.change_request(change_request_id),
    step_no integer NOT NULL,
    step_name varchar(200) NOT NULL,
    approver_user_id varchar(128),
    approver_role_code varchar(128),
    decision varchar(32),
    decision_comment text,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    due_at timestamptz,
    completed_at timestamptz,
    UNIQUE(change_request_id, step_no)
);

CREATE TABLE gov.publication (
    publication_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_code varchar(64) NOT NULL,
    entity_type varchar(64) NOT NULL,
    entity_id uuid NOT NULL,
    version_no bigint NOT NULL,
    change_request_id uuid REFERENCES gov.change_request(change_request_id),
    publication_status varchar(32) NOT NULL,
    package_uri varchar(1000),
    checksum char(64),
    rollback_token uuid NOT NULL DEFAULT gen_random_uuid(),
    published_at timestamptz NOT NULL DEFAULT now(),
    published_by varchar(128) NOT NULL,
    UNIQUE(entity_type, entity_id, version_no)
);

CREATE TABLE gov.subscription (
    subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_code varchar(128) NOT NULL,
    domain_code varchar(64) NOT NULL,
    event_type varchar(128) NOT NULL,
    delivery_mode varchar(32) NOT NULL,
    endpoint_uri varchar(1000),
    field_projection jsonb NOT NULL DEFAULT '[]'::jsonb,
    filter_expression jsonb NOT NULL DEFAULT '{}'::jsonb,
    sla_minutes integer NOT NULL,
    owner_user_id varchar(128) NOT NULL,
    status varchar(32) NOT NULL,
    UNIQUE(subscriber_code, domain_code, event_type, endpoint_uri)
);

CREATE TABLE integration.outbox_event (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type varchar(64) NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL,
    event_type varchar(128) NOT NULL,
    event_time timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL,
    trace_id varchar(128),
    publication_status varchar(32) NOT NULL DEFAULT 'PENDING',
    retry_count integer NOT NULL DEFAULT 0,
    next_retry_at timestamptz,
    published_at timestamptz,
    UNIQUE(aggregate_type, aggregate_id, aggregate_version, event_type)
);

CREATE TABLE integration.inbox_event (
    inbox_event_id bigserial PRIMARY KEY,
    consumer_code varchar(128) NOT NULL,
    event_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    processing_status varchar(32) NOT NULL,
    result_hash char(64),
    UNIQUE(consumer_code, event_id)
);

CREATE TABLE integration.dead_letter (
    dead_letter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type varchar(32) NOT NULL,
    source_name varchar(256) NOT NULL,
    event_id uuid,
    payload_encrypted bytea,
    error_code varchar(128),
    error_message text,
    retry_count integer NOT NULL DEFAULT 0,
    owner_user_id varchar(128) NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'OPEN',
    first_failed_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE TABLE audit.event (
    audit_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
    event_time timestamptz NOT NULL,
    actor_id varchar(128) NOT NULL,
    actor_type varchar(32) NOT NULL,
    action_code varchar(128) NOT NULL,
    purpose_code varchar(128),
    resource_type varchar(128) NOT NULL,
    resource_id_token varchar(256),
    decision varchar(32) NOT NULL,
    client_ip inet,
    trace_id varchar(128),
    before_hash char(64),
    after_hash char(64),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (audit_event_id, event_time)
) PARTITION BY RANGE (event_time);

CREATE TABLE audit.export_request (
    export_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no varchar(64) NOT NULL UNIQUE,
    requester_user_id varchar(128) NOT NULL,
    purpose_code varchar(128) NOT NULL,
    data_scope jsonb NOT NULL,
    deidentification_policy varchar(128),
    output_format varchar(64),
    watermark_text varchar(300),
    approval_status varchar(32) NOT NULL,
    approved_until timestamptz,
    result_uri varchar(1000),
    result_checksum char(64),
    result_review_status varchar(32),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.service_slo (
    service_slo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_code varchar(128) NOT NULL,
    slo_name varchar(300) NOT NULL,
    sli_expression text NOT NULL,
    target numeric(9,6) NOT NULL,
    window_days integer NOT NULL,
    error_budget_policy jsonb NOT NULL,
    owner_team varchar(128) NOT NULL,
    status varchar(32) NOT NULL,
    UNIQUE(service_code, slo_name)
);
