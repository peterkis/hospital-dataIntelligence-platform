-- 三甲医院数据治理平台核心物理模型（PostgreSQL 15+参考实现）
-- 版本 V1.0；执行前须由医院DBA、数据架构师、安全负责人联合评审。
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS cdr;
CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS kb;
CREATE SCHEMA IF NOT EXISTS mdm;
CREATE SCHEMA IF NOT EXISTS research;
CREATE SCHEMA IF NOT EXISTS sec;
CREATE SCHEMA IF NOT EXISTS svc;
CREATE SCHEMA IF NOT EXISTS workflow;

CREATE TABLE IF NOT EXISTS gov.gov_standard_source (
    standard_source_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_code varchar(64) NOT NULL,
    source_name varchar(256) NOT NULL,
    publisher varchar(256),
    version_no varchar(64) NOT NULL,
    source_url text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_standard_source PRIMARY KEY (standard_source_id)
);
COMMENT ON TABLE gov.gov_standard_source IS '标准来源；国家/行业/院内标准及版本';
COMMENT ON COLUMN gov.gov_standard_source.standard_source_id IS '标准来源ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.source_code IS '来源代码；标准编号；标准/值域：标准编号；安全：公开';
COMMENT ON COLUMN gov.gov_standard_source.source_name IS '来源名称；标准全称；标准/值域：正式名称；安全：公开';
COMMENT ON COLUMN gov.gov_standard_source.publisher IS '发布机构；发布机构；标准/值域：机构名；安全：公开';
COMMENT ON COLUMN gov.gov_standard_source.version_no IS '版本号；标准年份/版本；标准/值域：版本；安全：公开';
COMMENT ON COLUMN gov.gov_standard_source.source_url IS '官方链接；官方来源；标准/值域：URL；安全：公开';
COMMENT ON COLUMN gov.gov_standard_source.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_standard_source.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_standard_source_source_code ON gov.gov_standard_source (source_code) WHERE source_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_standard_source_source_system_code ON gov.gov_standard_source (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_standard_source_created_at ON gov.gov_standard_source (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_data_element (
    data_element_id uuid DEFAULT gen_random_uuid() NOT NULL,
    element_code varchar(100) NOT NULL,
    element_name_cn varchar(256) NOT NULL,
    definition text NOT NULL,
    data_type varchar(32) NOT NULL,
    representation varchar(128),
    value_set_id uuid,
    owner_dept_id uuid NOT NULL,
    version_no varchar(32) DEFAULT '1.0' NOT NULL,
    approval_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_data_element PRIMARY KEY (data_element_id)
);
COMMENT ON TABLE gov.gov_data_element IS '数据元注册表；数据元定义、类型、格式、值域、责任和版本';
COMMENT ON COLUMN gov.gov_data_element.data_element_id IS '数据元ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.element_code IS '数据元代码；院级/行业唯一代码；标准/值域：WS/T363/院标；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.element_name_cn IS '中文名称；标准名称；标准/值域：标准定义；安全：公开';
COMMENT ON COLUMN gov.gov_data_element.definition IS '定义；无歧义业务定义；标准/值域：标准定义；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.data_type IS '数据类型；string/date/decimal/code等；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.representation IS '表示格式；长度/精度/日期格式；标准/值域：WS/T363；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.value_set_id IS '值域ID；关联值域；标准/值域：值域中心；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.owner_dept_id IS '责任科室；业务Owner；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.version_no IS '版本；数据元版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.approval_status IS '审批状态；草稿/评审/发布/废止；标准/值域：治理状态；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_element.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_data_element_element_code ON gov.gov_data_element (element_code) WHERE element_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_data_element_source_system_code ON gov.gov_data_element (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_data_element_created_at ON gov.gov_data_element (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_value_set (
    value_set_id uuid DEFAULT gen_random_uuid() NOT NULL,
    value_set_code varchar(100) NOT NULL,
    value_set_name varchar(256) NOT NULL,
    description text,
    owner_dept_id uuid NOT NULL,
    governance_mode varchar(20) DEFAULT 'AUTHORITATIVE' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_value_set PRIMARY KEY (value_set_id)
);
COMMENT ON TABLE gov.gov_value_set IS '值域主表；值域主信息和责任';
COMMENT ON COLUMN gov.gov_value_set.value_set_id IS '值域ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.value_set_code IS '值域代码；院级唯一代码；标准/值域：院标/行业；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.value_set_name IS '值域名称；标准名称；标准/值域：标准定义；安全：公开';
COMMENT ON COLUMN gov.gov_value_set.description IS '说明；适用范围；标准/值域：标准说明；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.owner_dept_id IS '责任科室；业务Owner；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.governance_mode IS '治理模式；权威下发/映射/补充；标准/值域：治理模式；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_value_set_value_set_code ON gov.gov_value_set (value_set_code) WHERE value_set_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_value_set_source_system_code ON gov.gov_value_set (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_value_set_created_at ON gov.gov_value_set (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_value_set_version (
    value_set_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    value_set_id uuid NOT NULL,
    version_no varchar(32) NOT NULL,
    release_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    change_summary text,
    approved_by varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_value_set_version PRIMARY KEY (value_set_version_id)
);
COMMENT ON TABLE gov.gov_value_set_version IS '值域版本表；值域版本、生效范围和发布状态';
COMMENT ON COLUMN gov.gov_value_set_version.value_set_version_id IS '值域版本ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.value_set_id IS '值域ID；主值域；标准/值域：gov_value_set；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.version_no IS '版本号；语义化版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.release_status IS '发布状态；草稿/发布/撤回；标准/值域：治理状态；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.change_summary IS '变更摘要；新增停用和映射变化；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.approved_by IS '批准人；发布批准人；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_value_set_version.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_value_set_version_version_no ON gov.gov_value_set_version (version_no) WHERE version_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_value_set_version_source_system_code ON gov.gov_value_set_version (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_value_set_version_created_at ON gov.gov_value_set_version (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_code_concept (
    concept_id uuid DEFAULT gen_random_uuid() NOT NULL,
    value_set_version_id uuid NOT NULL,
    concept_code varchar(128) NOT NULL,
    display_name varchar(256) NOT NULL,
    synonyms jsonb DEFAULT '[]'::jsonb,
    parent_concept_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_code_concept PRIMARY KEY (concept_id)
);
COMMENT ON TABLE gov.gov_code_concept IS '值域概念代码；代码、名称、同义词和层级';
COMMENT ON COLUMN gov.gov_code_concept.concept_id IS '概念ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.value_set_version_id IS '值域版本ID；所属版本；标准/值域：值域版本；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.concept_code IS '概念代码；代码值；标准/值域：值域；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.display_name IS '显示名称；标准显示名；标准/值域：值域；安全：公开';
COMMENT ON COLUMN gov.gov_code_concept.synonyms IS '同义词；别名简称历史名；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.parent_concept_id IS '上级概念；层级结构；标准/值域：本表；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_code_concept.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_code_concept_concept_code ON gov.gov_code_concept (concept_code) WHERE concept_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_code_concept_source_system_code ON gov.gov_code_concept (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_code_concept_created_at ON gov.gov_code_concept (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_concept_map (
    concept_map_id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_value_set_code varchar(100) NOT NULL,
    source_code varchar(128) NOT NULL,
    target_value_set_code varchar(100) NOT NULL,
    target_code varchar(128) NOT NULL,
    equivalence varchar(20) DEFAULT 'EQUIVALENT' NOT NULL,
    confidence_score numeric(5,4),
    review_status varchar(20) DEFAULT 'PENDING' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_concept_map PRIMARY KEY (concept_map_id)
);
COMMENT ON TABLE gov.gov_concept_map IS '术语映射表；源代码到目标标准代码映射';
COMMENT ON COLUMN gov.gov_concept_map.concept_map_id IS '映射ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.source_value_set_code IS '源值域；源字典；标准/值域：院内字典；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.source_code IS '源代码；源值；标准/值域：院内字典；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.target_value_set_code IS '目标值域；目标标准值域；标准/值域：标准值域；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.target_code IS '目标代码；目标代码；标准/值域：标准值域；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.equivalence IS '等价关系；等价/更宽/更窄/相关；标准/值域：FHIR ConceptMap；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.confidence_score IS '置信度；自动映射分数；标准/值域：0-1；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.review_status IS '审核状态；待审/通过/拒绝；标准/值域：治理状态；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_concept_map.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_gov_concept_map_source_system_code ON gov.gov_concept_map (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_concept_map_created_at ON gov.gov_concept_map (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_data_asset (
    asset_id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_type varchar(32) NOT NULL,
    asset_urn varchar(500) NOT NULL,
    asset_name varchar(256) NOT NULL,
    domain_code varchar(20) NOT NULL,
    owner_dept_id uuid NOT NULL,
    certification_status varchar(20) DEFAULT 'UNVERIFIED' NOT NULL,
    quality_score numeric(5,2),
    security_class varchar(20) DEFAULT 'INTERNAL' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_data_asset PRIMARY KEY (asset_id)
);
COMMENT ON TABLE gov.gov_data_asset IS '数据资产目录；数据库、表、字段、API、指标和数据产品登记';
COMMENT ON COLUMN gov.gov_data_asset.asset_id IS '资产ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.asset_type IS '资产类型；TABLE/COLUMN/API/REPORT等；标准/值域：资产类型；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.asset_urn IS '资产URN；全局定位符；标准/值域：URI；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.asset_name IS '资产名称；业务可读名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.domain_code IS '数据域代码；D01-D15；标准/值域：数据域；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.owner_dept_id IS '责任科室；资产Owner；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.certification_status IS '认证状态；未认证/认证/废止；标准/值域：治理状态；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.quality_score IS '质量评分；0-100；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.security_class IS '安全等级；公开/内部/敏感/高度敏感；标准/值域：分类分级；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_data_asset.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_data_asset_asset_urn ON gov.gov_data_asset (asset_urn) WHERE asset_urn IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_data_asset_source_system_code ON gov.gov_data_asset (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_data_asset_created_at ON gov.gov_data_asset (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_lineage_edge (
    lineage_edge_id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_asset_id uuid NOT NULL,
    to_asset_id uuid NOT NULL,
    lineage_type varchar(20) NOT NULL,
    transform_expression text,
    job_name varchar(256),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_lineage_edge PRIMARY KEY (lineage_edge_id)
);
COMMENT ON TABLE gov.gov_lineage_edge IS '数据血缘边；资产之间有向血缘';
COMMENT ON COLUMN gov.gov_lineage_edge.lineage_edge_id IS '血缘边ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.from_asset_id IS '上游资产；上游节点；标准/值域：资产目录；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.to_asset_id IS '下游资产；下游节点；标准/值域：资产目录；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.lineage_type IS '血缘类型；READ/WRITE/TRANSFORM/CALL/PUBLISH；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.transform_expression IS '转换表达式；SQL/表达式；标准/值域：SQL/DSL；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.job_name IS '作业/服务名；产生血缘的作业；标准/值域：调度/服务；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_lineage_edge.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_gov_lineage_edge_source_system_code ON gov.gov_lineage_edge (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_lineage_edge_created_at ON gov.gov_lineage_edge (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_quality_rule (
    quality_rule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_code varchar(100) NOT NULL,
    asset_id uuid NOT NULL,
    dimension varchar(20) NOT NULL,
    rule_expression text NOT NULL,
    threshold_operator varchar(10) DEFAULT '>=' NOT NULL,
    threshold_value numeric(12,4) DEFAULT 1 NOT NULL,
    severity varchar(10) DEFAULT 'MEDIUM' NOT NULL,
    owner_dept_id uuid NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_quality_rule PRIMARY KEY (quality_rule_id)
);
COMMENT ON TABLE gov.gov_quality_rule IS '数据质量规则；规则、阈值、调度和严重级别';
COMMENT ON COLUMN gov.gov_quality_rule.quality_rule_id IS '规则ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.rule_code IS '规则编码；DQ-PAT-001等；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.asset_id IS '目标资产；校验对象；标准/值域：资产目录；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.dimension IS '质量维度；完整/准确/一致/唯一/及时/合规；标准/值域：维度值域；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.rule_expression IS '规则表达式；SQL/DSL/服务规则；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.threshold_operator IS '阈值操作符；比较符；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.threshold_value IS '阈值；通过阈值；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.severity IS '严重级别；CRITICAL/HIGH/MEDIUM/LOW；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.owner_dept_id IS '责任科室；规则Owner；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_rule.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_quality_rule_rule_code ON gov.gov_quality_rule (rule_code) WHERE rule_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_quality_rule_source_system_code ON gov.gov_quality_rule (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_quality_rule_created_at ON gov.gov_quality_rule (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_quality_run (
    quality_run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    quality_rule_id uuid NOT NULL,
    window_start timestamptz,
    window_end timestamptz,
    started_at timestamptz DEFAULT now() NOT NULL,
    finished_at timestamptz,
    run_status varchar(20) DEFAULT 'RUNNING' NOT NULL,
    total_count bigint,
    failed_count bigint,
    pass_rate numeric(8,6),
    CONSTRAINT pk_gov_quality_run PRIMARY KEY (quality_run_id)
);
COMMENT ON TABLE gov.gov_quality_run IS '质量运行批次；规则执行批次和结果';
COMMENT ON COLUMN gov.gov_quality_run.quality_run_id IS '运行ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.quality_rule_id IS '规则ID；关联规则；标准/值域：质量规则；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.window_start IS '窗口开始；数据窗口；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.window_end IS '窗口结束；数据窗口；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.started_at IS '开始时间；运行开始；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.finished_at IS '结束时间；运行结束；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.run_status IS '状态；RUNNING/PASSED/FAILED/ERROR；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.total_count IS '总数；扫描数；标准/值域：计数；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.failed_count IS '失败数；不合格数；标准/值域：计数；安全：内部';
COMMENT ON COLUMN gov.gov_quality_run.pass_rate IS '通过率；0-1；标准/值域：比例；安全：内部';

CREATE TABLE IF NOT EXISTS gov.gov_issue (
    issue_id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_no varchar(64) NOT NULL,
    issue_type varchar(20) NOT NULL,
    asset_id uuid,
    severity varchar(10) NOT NULL,
    title varchar(256) NOT NULL,
    description text NOT NULL,
    owner_dept_id uuid NOT NULL,
    assignee_user_id varchar(64),
    due_at timestamptz,
    issue_status varchar(20) DEFAULT 'OPEN' NOT NULL,
    root_cause text,
    resolution text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_issue PRIMARY KEY (issue_id)
);
COMMENT ON TABLE gov.gov_issue IS '数据问题工单；质量、标准、主数据、安全和接口问题闭环';
COMMENT ON COLUMN gov.gov_issue.issue_id IS '问题ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_issue.issue_no IS '问题单号；可读编号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_issue.issue_type IS '问题类型；QUALITY/STANDARD/MDM/SECURITY/INTERFACE；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN gov.gov_issue.asset_id IS '关联资产；问题对象；标准/值域：资产目录；安全：内部';
COMMENT ON COLUMN gov.gov_issue.severity IS '严重级别；严重程度；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_issue.title IS '标题；问题摘要；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_issue.description IS '描述；现象影响样本；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN gov.gov_issue.owner_dept_id IS '责任科室；整改部门；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_issue.assignee_user_id IS '处理人；当前处理人；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_issue.due_at IS 'SLA截止；整改截止；标准/值域：SLA；安全：内部';
COMMENT ON COLUMN gov.gov_issue.issue_status IS '状态；OPEN/ASSIGNED/RESOLVED/VERIFIED/CLOSED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_issue.root_cause IS '根因；确认根因；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_issue.resolution IS '整改说明；处理措施；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_issue.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_issue.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_issue.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_issue.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_issue.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_issue.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_issue.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_issue.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_issue_issue_no ON gov.gov_issue (issue_no) WHERE issue_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_issue_source_system_code ON gov.gov_issue (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_issue_created_at ON gov.gov_issue (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_change_request (
    change_request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_no varchar(64) NOT NULL,
    change_type varchar(20) NOT NULL,
    target_object_id uuid,
    change_reason text NOT NULL,
    impact_summary text NOT NULL,
    risk_level varchar(10) DEFAULT 'MEDIUM' NOT NULL,
    approval_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    rollback_plan text NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_change_request PRIMARY KEY (change_request_id)
);
COMMENT ON TABLE gov.gov_change_request IS '治理变更申请；标准、主数据、规则、接口和模型变更';
COMMENT ON COLUMN gov.gov_change_request.change_request_id IS '变更申请ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.request_no IS '申请单号；变更编号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.change_type IS '变更类型；STANDARD/MDM/RULE/API/MODEL；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.target_object_id IS '目标对象；变更对象；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.change_reason IS '变更原因；业务原因和依据；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.impact_summary IS '影响摘要；下游、数据、报表和风险；标准/值域：血缘分析；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.risk_level IS '风险等级；HIGH/MEDIUM/LOW；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.approval_status IS '审批状态；DRAFT/REVIEW/APPROVED/REJECTED/IMPLEMENTED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.rollback_plan IS '回退方案；回退步骤和条件；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_change_request.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gov_change_request_request_no ON gov.gov_change_request (request_no) WHERE request_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gov_change_request_source_system_code ON gov.gov_change_request (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_change_request_created_at ON gov.gov_change_request (created_at);

CREATE TABLE IF NOT EXISTS gov.gov_evidence_item (
    evidence_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_code varchar(32) NOT NULL,
    requirement_code varchar(100) NOT NULL,
    evidence_type varchar(32) NOT NULL,
    title varchar(256) NOT NULL,
    file_uri text,
    hash_sha256 char(64),
    evidence_date date,
    owner_dept_id uuid NOT NULL,
    review_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_gov_evidence_item PRIMARY KEY (evidence_item_id)
);
COMMENT ON TABLE gov.gov_evidence_item IS '评测证据条目；评级条款、测试和证据文件关联';
COMMENT ON COLUMN gov.gov_evidence_item.evidence_item_id IS '证据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.framework_code IS '评价体系；INTEROP-5B/EMR-6；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.requirement_code IS '条款编号；内部映射编号；标准/值域：评测映射；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.evidence_type IS '证据类型；POLICY/SCREENSHOT/LOG/REPORT/TEST/VIDEO；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.title IS '证据标题；证据名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.file_uri IS '文件地址；受控位置；标准/值域：URI；安全：敏感';
COMMENT ON COLUMN gov.gov_evidence_item.hash_sha256 IS 'SHA256；完整性摘要；标准/值域：SHA-256；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.evidence_date IS '证据日期；形成日期；标准/值域：日期；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.owner_dept_id IS '责任科室；证据Owner；标准/值域：组织MDM；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.review_status IS '复核状态；DRAFT/VERIFIED/EXPIRED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN gov.gov_evidence_item.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_gov_evidence_item_source_system_code ON gov.gov_evidence_item (source_system_code);
CREATE INDEX IF NOT EXISTS ix_gov_evidence_item_created_at ON gov.gov_evidence_item (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_source_system (
    source_system_code varchar(64) NOT NULL,
    source_system_name varchar(256) NOT NULL,
    vendor_name varchar(256),
    authority_domains jsonb DEFAULT '[]'::jsonb,
    interface_owner varchar(64),
    connection_profile text,
    CONSTRAINT pk_mdm_source_system PRIMARY KEY (source_system_code)
);
COMMENT ON TABLE mdm.mdm_source_system IS '来源系统注册；来源系统、主权范围、接口和联系人';
COMMENT ON COLUMN mdm.mdm_source_system.source_system_code IS '来源系统代码；全院唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_source_system.source_system_name IS '来源系统名称；系统名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_source_system.vendor_name IS '厂商；厂商名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_source_system.authority_domains IS '权威数据域；主权数据域/字段；标准/值域：D01-D15；安全：内部';
COMMENT ON COLUMN mdm.mdm_source_system.interface_owner IS '接口责任人；技术联系人；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_source_system.connection_profile IS '连接配置引用；仅保存密钥引用；标准/值域：密钥管理；安全：高度敏感';
CREATE INDEX IF NOT EXISTS ix_mdm_source_system_source_system_code ON mdm.mdm_source_system (source_system_code);

CREATE TABLE IF NOT EXISTS mdm.mdm_master_patient (
    enterprise_patient_id uuid DEFAULT gen_random_uuid() NOT NULL,
    mpi_no varchar(64) NOT NULL,
    name varchar(128) NOT NULL,
    gender_code varchar(16),
    birth_date date,
    primary_id_type varchar(32),
    primary_id_hash char(64),
    mobile_masked varchar(32),
    merge_state varchar(20) DEFAULT 'NORMAL' NOT NULL,
    survivorship_version varchar(32) DEFAULT '1.0' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_master_patient PRIMARY KEY (enterprise_patient_id)
);
COMMENT ON TABLE mdm.mdm_master_patient IS '患者黄金记录；企业患者ID和黄金人口学';
COMMENT ON COLUMN mdm.mdm_master_patient.enterprise_patient_id IS '企业患者ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.mpi_no IS 'MPI号码；主索引号；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.name IS '姓名；黄金姓名；标准/值域：患者身份；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.gender_code IS '性别代码；标准性别；标准/值域：GB/T2261.1；安全：敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.birth_date IS '出生日期；出生日期；标准/值域：日期；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.primary_id_type IS '主证件类型；证件类型；标准/值域：值域；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.primary_id_hash IS '主证件哈希；不可逆索引；标准/值域：SHA-256+盐；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.mobile_masked IS '脱敏手机号；掩码展示；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_master_patient.merge_state IS '合并状态；NORMAL/MERGED/REVIEW；标准/值域：MDM状态；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.survivorship_version IS '生存规则版本；黄金记录规则版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_master_patient.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_master_patient_mpi_no ON mdm.mdm_master_patient (mpi_no) WHERE mpi_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_master_patient_enterprise_patient_id ON mdm.mdm_master_patient (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_mdm_master_patient_source_system_code ON mdm.mdm_master_patient (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_master_patient_created_at ON mdm.mdm_master_patient (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_patient_xref (
    patient_xref_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    source_patient_id varchar(128) NOT NULL,
    match_method varchar(20) NOT NULL,
    match_score numeric(8,6),
    link_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    review_case_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_patient_xref PRIMARY KEY (patient_xref_id)
);
COMMENT ON TABLE mdm.mdm_patient_xref IS '患者交叉索引；企业患者与源患者ID关系';
COMMENT ON COLUMN mdm.mdm_patient_xref.patient_xref_id IS '交叉索引ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.enterprise_patient_id IS '企业患者ID；黄金患者；标准/值域：患者主表；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_xref.source_patient_id IS '源患者ID；源系统主键；标准/值域：源系统；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_xref.match_method IS '匹配方式；DETERMINISTIC/PROBABILISTIC/MANUAL；标准/值域：匹配方式；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.match_score IS '匹配分数；概率分数；标准/值域：0-1；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.link_status IS '关联状态；ACTIVE/UNLINKED/MERGED；标准/值域：MDM状态；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.review_case_id IS '审核案例ID；人工仲裁任务；标准/值域：MDM工作流；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_xref.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_patient_xref_source_patient_id ON mdm.mdm_patient_xref (source_patient_id) WHERE source_patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_patient_xref_enterprise_patient_id ON mdm.mdm_patient_xref (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_mdm_patient_xref_source_system_code ON mdm.mdm_patient_xref (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_patient_xref_created_at ON mdm.mdm_patient_xref (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_patient_identifier (
    patient_identifier_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    identifier_type varchar(32) NOT NULL,
    identifier_hash char(64) NOT NULL,
    identifier_ciphertext text,
    issuer varchar(256),
    is_primary boolean DEFAULT false NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_patient_identifier PRIMARY KEY (patient_identifier_id)
);
COMMENT ON TABLE mdm.mdm_patient_identifier IS '患者标识符；证件、医保卡、电子健康卡和就诊卡';
COMMENT ON COLUMN mdm.mdm_patient_identifier.patient_identifier_id IS '标识符ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者主表；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_identifier.identifier_type IS '标识符类型；ID_CARD/PASSPORT/INSURANCE/CARD；标准/值域：类型值域；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_identifier.identifier_hash IS '标识符哈希；不可逆匹配值；标准/值域：SHA-256+盐；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_identifier.identifier_ciphertext IS '标识符密文；必要时可解密；标准/值域：KMS；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_patient_identifier.issuer IS '签发机构；签发机构；标准/值域：机构名称；安全：敏感';
COMMENT ON COLUMN mdm.mdm_patient_identifier.is_primary IS '是否主标识；首选标识；标准/值域：布尔；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_patient_identifier.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_mdm_patient_identifier_enterprise_patient_id ON mdm.mdm_patient_identifier (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_mdm_patient_identifier_source_system_code ON mdm.mdm_patient_identifier (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_patient_identifier_created_at ON mdm.mdm_patient_identifier (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_organization (
    organization_id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_code varchar(64) NOT NULL,
    organization_name varchar(256) NOT NULL,
    organization_type varchar(32) NOT NULL,
    parent_organization_id uuid,
    address_json jsonb DEFAULT '{}'::jsonb,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_organization PRIMARY KEY (organization_id)
);
COMMENT ON TABLE mdm.mdm_organization IS '机构与院区；法人、医院、院区和组织层级';
COMMENT ON COLUMN mdm.mdm_organization.organization_id IS '组织ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.organization_code IS '组织代码；统一社会信用/院内代码；标准/值域：组织代码；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.organization_name IS '组织名称；正式名称；标准/值域：院标；安全：公开';
COMMENT ON COLUMN mdm.mdm_organization.organization_type IS '组织类型；LEGAL_ENTITY/HOSPITAL/CAMPUS/CENTER；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.parent_organization_id IS '上级组织；层级关系；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.address_json IS '地址；结构化地址；标准/值域：行政区划；安全：敏感';
COMMENT ON COLUMN mdm.mdm_organization.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_organization.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_organization_organization_code ON mdm.mdm_organization (organization_code) WHERE organization_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_organization_source_system_code ON mdm.mdm_organization (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_organization_created_at ON mdm.mdm_organization (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_department (
    department_id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_code varchar(64) NOT NULL,
    department_name varchar(256) NOT NULL,
    department_type varchar(32) NOT NULL,
    organization_id uuid NOT NULL,
    parent_department_id uuid,
    clinical_specialty_code varchar(64),
    cost_center_code varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_department PRIMARY KEY (department_id)
);
COMMENT ON TABLE mdm.mdm_department IS '科室主数据；行政、临床、医技科室及历史层级';
COMMENT ON COLUMN mdm.mdm_department.department_id IS '科室ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.department_code IS '科室代码；企业统一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.department_name IS '科室名称；正式名称；标准/值域：院标；安全：公开';
COMMENT ON COLUMN mdm.mdm_department.department_type IS '科室类型；CLINICAL/MED_TECH/NURSING/ADMIN；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.organization_id IS '所属组织；院区/组织；标准/值域：机构MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.parent_department_id IS '上级科室；组织树；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.clinical_specialty_code IS '临床专科；专科映射；标准/值域：专科值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.cost_center_code IS '成本中心；财务映射；标准/值域：HRP；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_department.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_department_department_code ON mdm.mdm_department (department_code) WHERE department_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_department_source_system_code ON mdm.mdm_department (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_department_created_at ON mdm.mdm_department (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_staff (
    enterprise_staff_id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_no varchar(64) NOT NULL,
    staff_name varchar(128) NOT NULL,
    id_hash char(64),
    staff_type varchar(32) NOT NULL,
    employment_status varchar(20) NOT NULL,
    primary_department_id uuid,
    title_code varchar(64),
    license_no_ciphertext text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_staff PRIMARY KEY (enterprise_staff_id)
);
COMMENT ON TABLE mdm.mdm_staff IS '人员主数据；员工、医务人员、外聘和规培人员身份';
COMMENT ON COLUMN mdm.mdm_staff.enterprise_staff_id IS '企业人员ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.employee_no IS '工号；主工号；标准/值域：HR；安全：敏感';
COMMENT ON COLUMN mdm.mdm_staff.staff_name IS '姓名；人员姓名；标准/值域：HR；安全：敏感';
COMMENT ON COLUMN mdm.mdm_staff.id_hash IS '证件哈希；证件哈希；标准/值域：SHA-256+盐；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_staff.staff_type IS '人员类型；EMPLOYEE/CONTRACTOR/TRAINEE；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.employment_status IS '在岗状态；ACTIVE/LEAVE/TERMINATED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.primary_department_id IS '主科室；行政归属；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.title_code IS '职称代码；专业职称；标准/值域：职称值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.license_no_ciphertext IS '执业证密文；加密执业证号；标准/值域：KMS；安全：高度敏感';
COMMENT ON COLUMN mdm.mdm_staff.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_staff.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_staff_employee_no ON mdm.mdm_staff (employee_no) WHERE employee_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_staff_source_system_code ON mdm.mdm_staff (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_staff_created_at ON mdm.mdm_staff (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_practitioner_role (
    practitioner_role_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_staff_id uuid NOT NULL,
    department_id uuid NOT NULL,
    role_code varchar(64) NOT NULL,
    specialty_code varchar(64),
    authorization_scope jsonb DEFAULT '{}'::jsonb,
    on_duty_flag boolean DEFAULT true NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_practitioner_role PRIMARY KEY (practitioner_role_id)
);
COMMENT ON TABLE mdm.mdm_practitioner_role IS '人员执业角色；人员在科室和时间段内的临床角色与授权';
COMMENT ON COLUMN mdm.mdm_practitioner_role.practitioner_role_id IS '执业角色ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.enterprise_staff_id IS '人员ID；人员；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN mdm.mdm_practitioner_role.department_id IS '科室ID；执业科室；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.role_code IS '角色代码；医师/护士/药师/技师等；标准/值域：角色值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.specialty_code IS '专业代码；执业专业；标准/值域：专业值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.authorization_scope IS '授权范围；处方/手术/会诊等；标准/值域：权限标准；安全：敏感';
COMMENT ON COLUMN mdm.mdm_practitioner_role.on_duty_flag IS '当前在岗；是否可执业；标准/值域：布尔；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_practitioner_role.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_mdm_practitioner_role_source_system_code ON mdm.mdm_practitioner_role (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_practitioner_role_created_at ON mdm.mdm_practitioner_role (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_location (
    location_id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_code varchar(64) NOT NULL,
    location_name varchar(256) NOT NULL,
    location_type varchar(32) NOT NULL,
    parent_location_id uuid,
    managing_department_id uuid,
    physical_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_location PRIMARY KEY (location_id)
);
COMMENT ON TABLE mdm.mdm_location IS '位置/病区/护理单元；院区、楼栋、病区、护理单元、房间和手术间';
COMMENT ON COLUMN mdm.mdm_location.location_id IS '位置ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.location_code IS '位置代码；全院代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.location_name IS '位置名称；正式名称；标准/值域：院标；安全：公开';
COMMENT ON COLUMN mdm.mdm_location.location_type IS '位置类型；CAMPUS/BUILDING/WARD/NURSING_UNIT/ROOM/OR；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.parent_location_id IS '上级位置；位置层级；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.managing_department_id IS '管理科室；责任科室；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.physical_status IS '物理状态；ACTIVE/INACTIVE/MAINTENANCE；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_location.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_location_location_code ON mdm.mdm_location (location_code) WHERE location_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_location_source_system_code ON mdm.mdm_location (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_location_created_at ON mdm.mdm_location (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_bed (
    bed_id uuid DEFAULT gen_random_uuid() NOT NULL,
    bed_code varchar(64) NOT NULL,
    bed_name varchar(128) NOT NULL,
    location_id uuid NOT NULL,
    bed_type varchar(32) NOT NULL,
    capacity_status varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
    temporary_flag boolean DEFAULT false NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_bed PRIMARY KEY (bed_id)
);
COMMENT ON TABLE mdm.mdm_bed IS '床位主数据；编制、开放、临时和隔离床位及状态';
COMMENT ON COLUMN mdm.mdm_bed.bed_id IS '床位ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.bed_code IS '床位代码；全院唯一床位码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.bed_name IS '床位名称；显示名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.location_id IS '位置ID；房间/病区；标准/值域：位置MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.bed_type IS '床位类型；GENERAL/ICU/ISOLATION/OBSERVATION；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.capacity_status IS '容量状态；AVAILABLE/OCCUPIED/BLOCKED/OUT_OF_SERVICE；标准/值域：床位状态；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.temporary_flag IS '临时床；是否临时；标准/值域：布尔；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_bed.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_bed_bed_code ON mdm.mdm_bed (bed_code) WHERE bed_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_bed_source_system_code ON mdm.mdm_bed (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_bed_created_at ON mdm.mdm_bed (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_drug (
    drug_id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_code varchar(100) NOT NULL,
    master_name varchar(256) NOT NULL,
    specification varchar(512),
    standard_code varchar(128),
    owner_dept_id uuid NOT NULL,
    mapping_json jsonb DEFAULT '{}'::jsonb,
    replacement_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_drug PRIMARY KEY (drug_id)
);
COMMENT ON TABLE mdm.mdm_drug IS '药品主数据；药品主数据黄金记录、标准映射、生命周期和下发';
COMMENT ON COLUMN mdm.mdm_drug.drug_id IS '药品主数据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.master_code IS '药品代码；企业统一代码；标准/值域：院标/国家；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.master_name IS '药品名称；标准名称；标准/值域：院标/国家；安全：公开';
COMMENT ON COLUMN mdm.mdm_drug.specification IS '规格/描述；规格型号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.standard_code IS '外部标准代码；国家/医保/本位码；标准/值域：外部标准；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.owner_dept_id IS '责任科室；业务Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.mapping_json IS '源系统映射；源代码映射；标准/值域：MDM XREF；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.replacement_id IS '替代对象；停用替代项；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_drug.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_drug_master_code ON mdm.mdm_drug (master_code) WHERE master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_drug_source_system_code ON mdm.mdm_drug (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_drug_created_at ON mdm.mdm_drug (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_charge_item (
    charge_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_code varchar(100) NOT NULL,
    master_name varchar(256) NOT NULL,
    specification varchar(512),
    standard_code varchar(128),
    owner_dept_id uuid NOT NULL,
    mapping_json jsonb DEFAULT '{}'::jsonb,
    replacement_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_charge_item PRIMARY KEY (charge_item_id)
);
COMMENT ON TABLE mdm.mdm_charge_item IS '收费项目主数据；收费项目主数据黄金记录、标准映射、生命周期和下发';
COMMENT ON COLUMN mdm.mdm_charge_item.charge_item_id IS '收费项目主数据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.master_code IS '收费项目代码；企业统一代码；标准/值域：院标/国家；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.master_name IS '收费项目名称；标准名称；标准/值域：院标/国家；安全：公开';
COMMENT ON COLUMN mdm.mdm_charge_item.specification IS '规格/描述；规格型号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.standard_code IS '外部标准代码；国家/医保/本位码；标准/值域：外部标准；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.owner_dept_id IS '责任科室；业务Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.mapping_json IS '源系统映射；源代码映射；标准/值域：MDM XREF；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.replacement_id IS '替代对象；停用替代项；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_charge_item.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_charge_item_master_code ON mdm.mdm_charge_item (master_code) WHERE master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_charge_item_source_system_code ON mdm.mdm_charge_item (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_charge_item_created_at ON mdm.mdm_charge_item (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_lab_item (
    lab_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_code varchar(100) NOT NULL,
    master_name varchar(256) NOT NULL,
    specification varchar(512),
    standard_code varchar(128),
    owner_dept_id uuid NOT NULL,
    mapping_json jsonb DEFAULT '{}'::jsonb,
    replacement_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_lab_item PRIMARY KEY (lab_item_id)
);
COMMENT ON TABLE mdm.mdm_lab_item IS '检验项目主数据；检验项目主数据黄金记录、标准映射、生命周期和下发';
COMMENT ON COLUMN mdm.mdm_lab_item.lab_item_id IS '检验项目主数据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.master_code IS '检验项目代码；企业统一代码；标准/值域：院标/国家；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.master_name IS '检验项目名称；标准名称；标准/值域：院标/国家；安全：公开';
COMMENT ON COLUMN mdm.mdm_lab_item.specification IS '规格/描述；规格型号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.standard_code IS '外部标准代码；国家/医保/本位码；标准/值域：外部标准；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.owner_dept_id IS '责任科室；业务Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.mapping_json IS '源系统映射；源代码映射；标准/值域：MDM XREF；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.replacement_id IS '替代对象；停用替代项；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_lab_item.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_lab_item_master_code ON mdm.mdm_lab_item (master_code) WHERE master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_lab_item_source_system_code ON mdm.mdm_lab_item (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_lab_item_created_at ON mdm.mdm_lab_item (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_exam_item (
    exam_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_code varchar(100) NOT NULL,
    master_name varchar(256) NOT NULL,
    specification varchar(512),
    standard_code varchar(128),
    owner_dept_id uuid NOT NULL,
    mapping_json jsonb DEFAULT '{}'::jsonb,
    replacement_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_exam_item PRIMARY KEY (exam_item_id)
);
COMMENT ON TABLE mdm.mdm_exam_item IS '检查项目主数据；检查项目主数据黄金记录、标准映射、生命周期和下发';
COMMENT ON COLUMN mdm.mdm_exam_item.exam_item_id IS '检查项目主数据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.master_code IS '检查项目代码；企业统一代码；标准/值域：院标/国家；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.master_name IS '检查项目名称；标准名称；标准/值域：院标/国家；安全：公开';
COMMENT ON COLUMN mdm.mdm_exam_item.specification IS '规格/描述；规格型号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.standard_code IS '外部标准代码；国家/医保/本位码；标准/值域：外部标准；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.owner_dept_id IS '责任科室；业务Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.mapping_json IS '源系统映射；源代码映射；标准/值域：MDM XREF；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.replacement_id IS '替代对象；停用替代项；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_exam_item.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_exam_item_master_code ON mdm.mdm_exam_item (master_code) WHERE master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_exam_item_source_system_code ON mdm.mdm_exam_item (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_exam_item_created_at ON mdm.mdm_exam_item (created_at);

CREATE TABLE IF NOT EXISTS mdm.mdm_device_material (
    device_material_id uuid DEFAULT gen_random_uuid() NOT NULL,
    master_code varchar(100) NOT NULL,
    master_name varchar(256) NOT NULL,
    specification varchar(512),
    standard_code varchar(128),
    owner_dept_id uuid NOT NULL,
    mapping_json jsonb DEFAULT '{}'::jsonb,
    replacement_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_mdm_device_material PRIMARY KEY (device_material_id)
);
COMMENT ON TABLE mdm.mdm_device_material IS '设备耗材主数据；设备耗材主数据黄金记录、标准映射、生命周期和下发';
COMMENT ON COLUMN mdm.mdm_device_material.device_material_id IS '设备耗材主数据ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.master_code IS '设备/耗材代码；企业统一代码；标准/值域：院标/国家；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.master_name IS '设备/耗材名称；标准名称；标准/值域：院标/国家；安全：公开';
COMMENT ON COLUMN mdm.mdm_device_material.specification IS '规格/描述；规格型号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.standard_code IS '外部标准代码；国家/医保/本位码；标准/值域：外部标准；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.owner_dept_id IS '责任科室；业务Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.mapping_json IS '源系统映射；源代码映射；标准/值域：MDM XREF；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.replacement_id IS '替代对象；停用替代项；标准/值域：本表；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN mdm.mdm_device_material.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_device_material_master_code ON mdm.mdm_device_material (master_code) WHERE master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_device_material_source_system_code ON mdm.mdm_device_material (source_system_code);
CREATE INDEX IF NOT EXISTS ix_mdm_device_material_created_at ON mdm.mdm_device_material (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_encounter (
    enterprise_encounter_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    source_encounter_id varchar(128) NOT NULL,
    encounter_type varchar(32) NOT NULL,
    department_id uuid,
    attending_staff_id uuid,
    admit_at timestamptz NOT NULL,
    discharge_at timestamptz,
    encounter_status varchar(20) NOT NULL,
    bed_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_encounter PRIMARY KEY (enterprise_encounter_id)
);
COMMENT ON TABLE cdr.cdr_encounter IS '就诊主表；就诊主表的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_encounter.enterprise_encounter_id IS '企业就诊ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_encounter.source_encounter_id IS '源就诊ID；源就诊号；标准/值域：源系统；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_encounter.encounter_type IS '就诊类型；OUTPATIENT/EMERGENCY/INPATIENT/PHYSICAL/ONLINE；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_encounter.department_id IS '就诊科室；主科室；标准/值域：科室MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_encounter.attending_staff_id IS '责任人员；主诊/主管；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_encounter.admit_at IS '开始/入院；开始时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_encounter.discharge_at IS '结束/出院；结束时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_encounter.encounter_status IS '就诊状态；PLANNED/IN_PROGRESS/FINISHED/CANCELLED；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_encounter.bed_id IS '床位ID；床位；标准/值域：床位MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_encounter.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_encounter.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cdr_encounter_source_encounter_id ON cdr.cdr_encounter (source_encounter_id) WHERE source_encounter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cdr_encounter_enterprise_patient_id ON cdr.cdr_encounter (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_encounter_enterprise_encounter_id ON cdr.cdr_encounter (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_encounter_source_system_code ON cdr.cdr_encounter (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_encounter_created_at ON cdr.cdr_encounter (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_diagnosis (
    diagnosis_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    diagnosis_type varchar(32) NOT NULL,
    diagnosis_code varchar(64) NOT NULL,
    diagnosis_name varchar(256) NOT NULL,
    coding_system varchar(64) DEFAULT 'ICD-10' NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    onset_at timestamptz,
    present_on_admission_code varchar(16),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_diagnosis PRIMARY KEY (diagnosis_id)
);
COMMENT ON TABLE cdr.cdr_diagnosis IS '诊断事实；诊断事实的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_diagnosis.diagnosis_id IS '诊断ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.diagnosis_type IS '诊断类型；入院/出院/门诊/并发症；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.diagnosis_code IS '诊断代码；标准代码；标准/值域：ICD/中医病名；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.diagnosis_name IS '诊断名称；标准/原始名；标准/值域：术语中心；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.coding_system IS '编码体系；体系和版本；标准/值域：术语中心；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.is_primary IS '主诊断；是否主诊断；标准/值域：布尔；安全：敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.onset_at IS '发生时间；发生/诊断时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.present_on_admission_code IS '入院病情；入院病情代码；标准/值域：标准值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_diagnosis.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_diagnosis.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_diagnosis_enterprise_patient_id ON cdr.cdr_diagnosis (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_diagnosis_enterprise_encounter_id ON cdr.cdr_diagnosis (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_diagnosis_source_system_code ON cdr.cdr_diagnosis (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_diagnosis_created_at ON cdr.cdr_diagnosis (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_order (
    order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    source_order_id varchar(128) NOT NULL,
    order_type varchar(32) NOT NULL,
    item_code varchar(128) NOT NULL,
    item_name varchar(256) NOT NULL,
    ordered_by uuid NOT NULL,
    ordered_at timestamptz NOT NULL,
    frequency_code varchar(64),
    route_code varchar(64),
    order_status varchar(20) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_order PRIMARY KEY (order_id)
);
COMMENT ON TABLE cdr.cdr_order IS '医嘱事实；医嘱事实的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_order.order_id IS '企业医嘱ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_order.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_order.source_order_id IS '源医嘱ID；源医嘱号；标准/值域：源系统；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_order.order_type IS '医嘱类型；药品/检验/检查/治疗/护理；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.item_code IS '标准项目代码；统一项目；标准/值域：MDM/术语；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.item_name IS '项目名称；显示名；标准/值域：MDM/术语；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.ordered_by IS '开立人员；开立者；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.ordered_at IS '开立时间；开立时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_order.frequency_code IS '频次；标准频次；标准/值域：频次值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.route_code IS '途径；给药/治疗途径；标准/值域：途径值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.order_status IS '状态；ACTIVE/COMPLETED/STOPPED/CANCELLED；标准/值域：状态值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_order.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_order.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cdr_order_source_order_id ON cdr.cdr_order (source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cdr_order_enterprise_patient_id ON cdr.cdr_order (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_order_enterprise_encounter_id ON cdr.cdr_order (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_order_source_system_code ON cdr.cdr_order (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_order_created_at ON cdr.cdr_order (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_observation (
    observation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    order_id uuid,
    observation_code varchar(128) NOT NULL,
    observation_name varchar(256) NOT NULL,
    value_type varchar(20) NOT NULL,
    value_number numeric(20,6),
    value_text text,
    unit_code varchar(64),
    reference_range varchar(256),
    abnormal_flag varchar(16),
    critical_flag boolean DEFAULT false NOT NULL,
    observed_at timestamptz NOT NULL,
    issued_at timestamptz,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_observation PRIMARY KEY (observation_id)
);
COMMENT ON TABLE cdr.cdr_observation IS '临床观察结果；临床观察结果的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_observation.observation_id IS '观察ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.order_id IS '关联医嘱；申请医嘱；标准/值域：CDR医嘱；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.observation_code IS '标准观察代码；检验/体征/量表；标准/值域：LOINC/院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_observation.observation_name IS '观察名称；显示名；标准/值域：术语中心；安全：敏感';
COMMENT ON COLUMN cdr.cdr_observation.value_type IS '值类型；NUMBER/TEXT/CODE/BOOLEAN/DATETIME；标准/值域：值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.value_number IS '数值结果；数值；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.value_text IS '文本结果；文本/代码；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.unit_code IS '单位；统一单位；标准/值域：UCUM/院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_observation.reference_range IS '参考范围；参考范围；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_observation.abnormal_flag IS '异常标志；H/L/HH/LL；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_observation.critical_flag IS '危急值；是否危急；标准/值域：布尔；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.observed_at IS '观察时间；采集/检测时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.issued_at IS '报告时间；发布结果；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_observation.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_observation.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_observation_enterprise_patient_id ON cdr.cdr_observation (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_observation_enterprise_encounter_id ON cdr.cdr_observation (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_observation_source_system_code ON cdr.cdr_observation (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_observation_created_at ON cdr.cdr_observation (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_report (
    report_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    order_id uuid,
    report_type varchar(32) NOT NULL,
    item_code varchar(128) NOT NULL,
    finding_text text,
    conclusion_text text NOT NULL,
    critical_flag boolean DEFAULT false NOT NULL,
    reported_by uuid,
    verified_by uuid,
    verified_at timestamptz,
    study_uid varchar(128),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_report PRIMARY KEY (report_id)
);
COMMENT ON TABLE cdr.cdr_report IS '检查/病理报告；检查/病理报告的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_report.report_id IS '报告ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.order_id IS '申请医嘱；检查/病理申请；标准/值域：CDR医嘱；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.report_type IS '报告类型；IMAGING/PATHOLOGY/ENDOSCOPY/ECG；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_report.item_code IS '检查项目；统一项目；标准/值域：检查MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_report.finding_text IS '所见；报告所见；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.conclusion_text IS '结论；报告结论；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.critical_flag IS '危急结果；是否危急；标准/值域：布尔；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.reported_by IS '报告人员；报告医师；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_report.verified_by IS '审核人员；审核医师；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_report.verified_at IS '审核时间；审核发布；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.study_uid IS '影像UID；DICOM Study UID；标准/值域：DICOM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_report.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_report.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_report_enterprise_patient_id ON cdr.cdr_report (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_report_enterprise_encounter_id ON cdr.cdr_report (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_report_source_system_code ON cdr.cdr_report (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_report_created_at ON cdr.cdr_report (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_procedure (
    procedure_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    procedure_code varchar(64) NOT NULL,
    procedure_name varchar(256) NOT NULL,
    procedure_level_code varchar(16),
    body_site_code varchar(64),
    performer_staff_id uuid,
    location_id uuid,
    start_at timestamptz,
    end_at timestamptz,
    procedure_status varchar(20) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_procedure PRIMARY KEY (procedure_id)
);
COMMENT ON TABLE cdr.cdr_procedure IS '手术与操作事实；手术与操作事实的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_procedure.procedure_id IS '操作ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.procedure_code IS '手术操作代码；标准代码；标准/值域：ICD-9-CM-3/国家；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.procedure_name IS '名称；标准/原始名；标准/值域：术语中心；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.procedure_level_code IS '手术级别；级别；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_procedure.body_site_code IS '操作部位；标准部位；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_procedure.performer_staff_id IS '主刀/执行者；执行者；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_procedure.location_id IS '执行地点；手术间/治疗室；标准/值域：位置MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_procedure.start_at IS '开始时间；实际开始；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.end_at IS '结束时间；实际结束；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_procedure.procedure_status IS '状态；PLANNED/IN_PROGRESS/COMPLETED/ABORTED；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_procedure.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_procedure.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_procedure_enterprise_patient_id ON cdr.cdr_procedure (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_procedure_enterprise_encounter_id ON cdr.cdr_procedure (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_procedure_source_system_code ON cdr.cdr_procedure (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_procedure_created_at ON cdr.cdr_procedure (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_specimen (
    specimen_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid NOT NULL,
    order_id uuid NOT NULL,
    specimen_barcode varchar(128) NOT NULL,
    specimen_type_code varchar(64) NOT NULL,
    collected_at timestamptz,
    received_at timestamptz,
    specimen_status varchar(20) NOT NULL,
    reject_reason_code varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_specimen PRIMARY KEY (specimen_id)
);
COMMENT ON TABLE cdr.cdr_specimen IS '标本事实；标本事实的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_specimen.specimen_id IS '标本ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.order_id IS '检验医嘱；申请医嘱；标准/值域：CDR医嘱；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.specimen_barcode IS '标本条码；唯一条码；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.specimen_type_code IS '标本类型；标准类型；标准/值域：标本值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_specimen.collected_at IS '采集时间；采集时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.received_at IS '签收时间；实验室签收；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_specimen.specimen_status IS '状态；COLLECTED/IN_TRANSIT/RECEIVED/REJECTED/PROCESSED；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_specimen.reject_reason_code IS '退样原因；退样原因；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_specimen.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_specimen.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cdr_specimen_specimen_barcode ON cdr.cdr_specimen (specimen_barcode) WHERE specimen_barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cdr_specimen_enterprise_patient_id ON cdr.cdr_specimen (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_specimen_enterprise_encounter_id ON cdr.cdr_specimen (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_specimen_source_system_code ON cdr.cdr_specimen (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_specimen_created_at ON cdr.cdr_specimen (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_medication_administration (
    med_admin_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    drug_id uuid NOT NULL,
    administered_by uuid NOT NULL,
    administered_at timestamptz NOT NULL,
    dose_value numeric(20,6),
    dose_unit varchar(64),
    route_code varchar(64),
    verification_json jsonb DEFAULT '{}'::jsonb,
    administration_status varchar(20) NOT NULL,
    exception_reason text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_medication_administration PRIMARY KEY (med_admin_id)
);
COMMENT ON TABLE cdr.cdr_medication_administration IS '给药执行事实；给药执行事实的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_medication_administration.med_admin_id IS '给药执行ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.order_id IS '药品医嘱；医嘱；标准/值域：CDR医嘱；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.drug_id IS '药品ID；统一药品；标准/值域：药品MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.administered_by IS '执行人员；护士/医师；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.administered_at IS '实际时间；给药时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.dose_value IS '剂量；实际剂量；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.dose_unit IS '剂量单位；统一单位；标准/值域：UCUM/院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.route_code IS '途径；实际途径；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.verification_json IS '核对信息；五正确核对；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.administration_status IS '执行状态；COMPLETED/NOT_DONE/STOPPED/ERROR；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.exception_reason IS '异常原因；未执行/错误/中止；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_medication_administration.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_medication_administration.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_medication_administration_enterprise_patient_id ON cdr.cdr_medication_administration (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_medication_administration_source_system_code ON cdr.cdr_medication_administration (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_medication_administration_created_at ON cdr.cdr_medication_administration (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_document (
    document_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    document_type_code varchar(64) NOT NULL,
    document_title varchar(256) NOT NULL,
    current_version_id uuid,
    author_staff_id uuid,
    custodian_department_id uuid,
    confidentiality_code varchar(20) DEFAULT 'NORMAL' NOT NULL,
    document_status varchar(20) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_document PRIMARY KEY (document_id)
);
COMMENT ON TABLE cdr.cdr_document IS '临床文档索引；临床文档索引的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_document.document_id IS '文档ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document.document_type_code IS '文档类型；病历/共享文档类型；标准/值域：WS445/共享文档；安全：敏感';
COMMENT ON COLUMN cdr.cdr_document.document_title IS '标题；标题；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document.current_version_id IS '当前版本；有效版本；标准/值域：文档版本；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document.author_staff_id IS '作者；文档作者；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_document.custodian_department_id IS '保管科室；责任科室；标准/值域：科室MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_document.confidentiality_code IS '保密级别；NORMAL/RESTRICTED/VERY_RESTRICTED；标准/值域：保密值域；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document.document_status IS '状态；DRAFT/FINAL/AMENDED/ARCHIVED/ERROR；标准/值域：FHIR状态；安全：敏感';
COMMENT ON COLUMN cdr.cdr_document.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_document_enterprise_patient_id ON cdr.cdr_document (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_document_enterprise_encounter_id ON cdr.cdr_document (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_document_source_system_code ON cdr.cdr_document (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_document_created_at ON cdr.cdr_document (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_document_version (
    document_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    version_no integer NOT NULL,
    content_uri text NOT NULL,
    content_hash char(64) NOT NULL,
    structured_summary jsonb DEFAULT '{}'::jsonb,
    signed_by uuid,
    signed_at timestamptz,
    signature_reference text,
    amendment_reason text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_document_version PRIMARY KEY (document_version_id)
);
COMMENT ON TABLE cdr.cdr_document_version IS '临床文档版本；临床文档版本的标准化临床事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_document_version.document_version_id IS '文档版本ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.document_id IS '文档ID；逻辑文档；标准/值域：文档索引；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.version_no IS '版本号；递增版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.content_uri IS '内容地址；对象存储/档案引用；标准/值域：受控URI；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.content_hash IS '内容SHA256；完整性校验；标准/值域：SHA-256；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.structured_summary IS '结构化摘要；可检索数据；标准/值域：WS445/FHIR；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.signed_by IS '签名人；电子签名人；标准/值域：人员MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.signed_at IS '签名时间；签名时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.signature_reference IS '签名引用；验签材料；标准/值域：电子签名；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.amendment_reason IS '修订原因；归档后修订原因；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_document_version.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_document_version.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cdr_document_version_version_no ON cdr.cdr_document_version (version_no) WHERE version_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cdr_document_version_source_system_code ON cdr.cdr_document_version (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_document_version_created_at ON cdr.cdr_document_version (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_allergy (
    allergy_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    allergen_code varchar(128) NOT NULL,
    reaction_text text,
    criticality varchar(20),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_allergy PRIMARY KEY (allergy_id)
);
COMMENT ON TABLE cdr.cdr_allergy IS '过敏与不良反应；过敏与不良反应的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_allergy.allergy_id IS '过敏与不良反应ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_allergy.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_allergy.allergen_code IS '过敏源；标准过敏源；标准/值域：术语中心；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_allergy.reaction_text IS '反应；反应描述；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_allergy.criticality IS '严重性；高/低/未知；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_allergy.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_allergy.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_allergy_enterprise_patient_id ON cdr.cdr_allergy (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_allergy_enterprise_encounter_id ON cdr.cdr_allergy (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_allergy_source_system_code ON cdr.cdr_allergy (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_allergy_created_at ON cdr.cdr_allergy (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_vital_sign (
    vital_sign_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    vital_code varchar(128) NOT NULL,
    value_number numeric(20,6) NOT NULL,
    unit_code varchar(64) NOT NULL,
    measured_at timestamptz NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_vital_sign PRIMARY KEY (vital_sign_id)
);
COMMENT ON TABLE cdr.cdr_vital_sign IS '生命体征；生命体征的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_vital_sign.vital_sign_id IS '生命体征ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.vital_code IS '体征代码；体温/脉搏/血压等；标准/值域：LOINC/院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.value_number IS '数值；测量值；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.unit_code IS '单位；统一单位；标准/值域：UCUM/院标；安全：敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.measured_at IS '测量时间；测量时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_vital_sign.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_vital_sign.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_vital_sign_enterprise_patient_id ON cdr.cdr_vital_sign (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_vital_sign_enterprise_encounter_id ON cdr.cdr_vital_sign (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_vital_sign_source_system_code ON cdr.cdr_vital_sign (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_vital_sign_created_at ON cdr.cdr_vital_sign (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_nursing_assessment (
    assessment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    assessment_type varchar(64) NOT NULL,
    score numeric(12,4),
    risk_level_code varchar(32),
    assessed_at timestamptz NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_nursing_assessment PRIMARY KEY (assessment_id)
);
COMMENT ON TABLE cdr.cdr_nursing_assessment IS '护理评估；护理评估的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.assessment_id IS '护理评估ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.assessment_type IS '评估类型；跌倒/压疮/VTE/自理等；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.score IS '评分；量表总分；标准/值域：量表；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.risk_level_code IS '风险等级；风险分层；标准/值域：值域；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.assessed_at IS '评估时间；评估时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_nursing_assessment.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_nursing_assessment_enterprise_patient_id ON cdr.cdr_nursing_assessment (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_nursing_assessment_enterprise_encounter_id ON cdr.cdr_nursing_assessment (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_nursing_assessment_source_system_code ON cdr.cdr_nursing_assessment (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_nursing_assessment_created_at ON cdr.cdr_nursing_assessment (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_transfusion (
    transfusion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    blood_product_code varchar(64) NOT NULL,
    unit_identifier varchar(128) NOT NULL,
    start_at timestamptz,
    end_at timestamptz,
    reaction_code varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_transfusion PRIMARY KEY (transfusion_id)
);
COMMENT ON TABLE cdr.cdr_transfusion IS '输血事实；输血事实的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_transfusion.transfusion_id IS '输血事实ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.blood_product_code IS '血制品；血制品种类；标准/值域：输血值域；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.unit_identifier IS '血袋标识；血袋唯一标识；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.start_at IS '开始输注；开始时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.end_at IS '结束输注；结束时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.reaction_code IS '输血反应；反应代码；标准/值域：值域；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_transfusion.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_transfusion.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cdr_transfusion_unit_identifier ON cdr.cdr_transfusion (unit_identifier) WHERE unit_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cdr_transfusion_enterprise_patient_id ON cdr.cdr_transfusion (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_transfusion_enterprise_encounter_id ON cdr.cdr_transfusion (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_transfusion_source_system_code ON cdr.cdr_transfusion (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_transfusion_created_at ON cdr.cdr_transfusion (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_appointment (
    appointment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    service_code varchar(128) NOT NULL,
    slot_start timestamptz NOT NULL,
    slot_end timestamptz NOT NULL,
    appointment_status varchar(20) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_appointment PRIMARY KEY (appointment_id)
);
COMMENT ON TABLE cdr.cdr_appointment IS '预约事实；预约事实的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_appointment.appointment_id IS '预约事实ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_appointment.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_appointment.service_code IS '服务项目；号源/检查/手术等；标准/值域：MDM；安全：敏感';
COMMENT ON COLUMN cdr.cdr_appointment.slot_start IS '开始时段；预约开始；标准/值域：ISO 8601；安全：敏感';
COMMENT ON COLUMN cdr.cdr_appointment.slot_end IS '结束时段；预约结束；标准/值域：ISO 8601；安全：敏感';
COMMENT ON COLUMN cdr.cdr_appointment.appointment_status IS '状态；BOOKED/ARRIVED/FULFILLED/CANCELLED；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN cdr.cdr_appointment.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_appointment.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_appointment_enterprise_patient_id ON cdr.cdr_appointment (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_appointment_enterprise_encounter_id ON cdr.cdr_appointment (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_appointment_source_system_code ON cdr.cdr_appointment (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_appointment_created_at ON cdr.cdr_appointment (created_at);

CREATE TABLE IF NOT EXISTS cdr.cdr_consent (
    consent_id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    consent_type varchar(64) NOT NULL,
    scope_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    signed_at timestamptz,
    revoked_at timestamptz,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cdr_consent PRIMARY KEY (consent_id)
);
COMMENT ON TABLE cdr.cdr_consent IS '知情同意与授权；知情同意与授权的标准化事实和来源追溯';
COMMENT ON COLUMN cdr.cdr_consent.consent_id IS '知情同意与授权ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.consent_type IS '同意类型；诊疗/研究/数据共享；标准/值域：值域；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.scope_json IS '授权范围；数据/用途/期限；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.signed_at IS '签署时间；签署时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.revoked_at IS '撤回时间；撤回时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN cdr.cdr_consent.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN cdr.cdr_consent.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_cdr_consent_enterprise_patient_id ON cdr.cdr_consent (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_cdr_consent_enterprise_encounter_id ON cdr.cdr_consent (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_cdr_consent_source_system_code ON cdr.cdr_consent (source_system_code);
CREATE INDEX IF NOT EXISTS ix_cdr_consent_created_at ON cdr.cdr_consent (created_at);

CREATE TABLE IF NOT EXISTS kb.kb_rule (
    rule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_code varchar(100) NOT NULL,
    rule_name varchar(256) NOT NULL,
    rule_category varchar(32) NOT NULL,
    owner_dept_id uuid NOT NULL,
    clinical_intent text NOT NULL,
    active_version_id uuid,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_kb_rule PRIMARY KEY (rule_id)
);
COMMENT ON TABLE kb.kb_rule IS '知识规则主表；临床规则、指南和状态';
COMMENT ON COLUMN kb.kb_rule.rule_id IS '规则ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN kb.kb_rule.rule_code IS '规则编码；唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN kb.kb_rule.rule_name IS '规则名称；业务名；标准/值域：院标；安全：内部';
COMMENT ON COLUMN kb.kb_rule.rule_category IS '规则类别；MEDICATION/DIAGNOSIS/RISK/PATHWAY/QUALITY；标准/值域：分类；安全：内部';
COMMENT ON COLUMN kb.kb_rule.owner_dept_id IS '责任科室；知识Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN kb.kb_rule.clinical_intent IS '临床意图；目的和适用场景；标准/值域：指南/制度；安全：内部';
COMMENT ON COLUMN kb.kb_rule.active_version_id IS '当前版本；生效版本；标准/值域：规则版本；安全：内部';
COMMENT ON COLUMN kb.kb_rule.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN kb.kb_rule.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN kb.kb_rule.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN kb.kb_rule.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_kb_rule_rule_code ON kb.kb_rule (rule_code) WHERE rule_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_kb_rule_source_system_code ON kb.kb_rule (source_system_code);
CREATE INDEX IF NOT EXISTS ix_kb_rule_created_at ON kb.kb_rule (created_at);

CREATE TABLE IF NOT EXISTS kb.kb_rule_version (
    rule_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    version_no varchar(32) NOT NULL,
    logic_expression jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence_reference text NOT NULL,
    test_cases jsonb DEFAULT '[]'::jsonb NOT NULL,
    release_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    approved_by varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_kb_rule_version PRIMARY KEY (rule_version_id)
);
COMMENT ON TABLE kb.kb_rule_version IS '知识规则版本；规则表达式、依据、测试和发布版本';
COMMENT ON COLUMN kb.kb_rule_version.rule_version_id IS '规则版本ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.rule_id IS '规则ID；主规则；标准/值域：知识规则；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.version_no IS '版本号；语义化版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.logic_expression IS '规则逻辑；可执行DSL；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN kb.kb_rule_version.evidence_reference IS '依据；指南制度共识；标准/值域：引用；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.test_cases IS '测试用例；正反例边界回归；标准/值域：院标；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.release_status IS '发布状态；DRAFT/VALIDATED/PUBLISHED/RETIRED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.approved_by IS '批准人；业务批准人；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN kb.kb_rule_version.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_kb_rule_version_version_no ON kb.kb_rule_version (version_no) WHERE version_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_kb_rule_version_source_system_code ON kb.kb_rule_version (source_system_code);
CREATE INDEX IF NOT EXISTS ix_kb_rule_version_created_at ON kb.kb_rule_version (created_at);

CREATE TABLE IF NOT EXISTS workflow.closure_definition (
    closure_definition_id uuid DEFAULT gen_random_uuid() NOT NULL,
    closure_type varchar(64) NOT NULL,
    version_no varchar(32) NOT NULL,
    state_machine_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_dept_id uuid NOT NULL,
    release_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_closure_definition PRIMARY KEY (closure_definition_id)
);
COMMENT ON TABLE workflow.closure_definition IS '闭环定义；闭环类型、状态机、节点和SLA定义';
COMMENT ON COLUMN workflow.closure_definition.closure_definition_id IS '闭环定义ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.closure_type IS '闭环类型；MED_ADMIN/SPECIMEN/CRITICAL_VALUE等；标准/值域：类型值域；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.version_no IS '版本号；状态机版本；标准/值域：院标；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.state_machine_json IS '状态机；状态、迁移、责任和SLA；标准/值域：闭环DSL；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.owner_dept_id IS '责任科室；流程Owner；标准/值域：科室MDM；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.release_status IS '发布状态；DRAFT/PUBLISHED/RETIRED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_definition.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_closure_definition_closure_type ON workflow.closure_definition (closure_type) WHERE closure_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_closure_definition_version_no ON workflow.closure_definition (version_no) WHERE version_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_closure_definition_source_system_code ON workflow.closure_definition (source_system_code);
CREATE INDEX IF NOT EXISTS ix_closure_definition_created_at ON workflow.closure_definition (created_at);

CREATE TABLE IF NOT EXISTS workflow.closure_instance (
    closure_instance_id uuid DEFAULT gen_random_uuid() NOT NULL,
    closure_type varchar(64) NOT NULL,
    business_key varchar(256) NOT NULL,
    enterprise_patient_id uuid NOT NULL,
    enterprise_encounter_id uuid,
    current_state varchar(64) NOT NULL,
    responsible_staff_id uuid,
    responsible_department_id uuid,
    due_at timestamptz,
    closed_at timestamptz,
    outcome_code varchar(64),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_closure_instance PRIMARY KEY (closure_instance_id)
);
COMMENT ON TABLE workflow.closure_instance IS '闭环实例；患者/医嘱/标本/报告的状态机实例';
COMMENT ON COLUMN workflow.closure_instance.closure_instance_id IS '闭环实例ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.closure_type IS '闭环类型；闭环类型；标准/值域：闭环定义；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.business_key IS '业务主键；医嘱/标本/报告唯一键；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_instance.enterprise_patient_id IS '企业患者ID；患者；标准/值域：患者MDM；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_instance.enterprise_encounter_id IS '企业就诊ID；就诊；标准/值域：CDR就诊；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_instance.current_state IS '当前状态；当前节点；标准/值域：闭环定义；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.responsible_staff_id IS '责任人；当前处理人；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.responsible_department_id IS '责任科室；责任科室；标准/值域：科室MDM；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.due_at IS '节点SLA；超时点；标准/值域：SLA；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.closed_at IS '完成时间；最终闭环时间；标准/值域：ISO 8601；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.outcome_code IS '结局代码；闭环结局；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN workflow.closure_instance.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_instance.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_closure_instance_business_key ON workflow.closure_instance (business_key) WHERE business_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_closure_instance_enterprise_patient_id ON workflow.closure_instance (enterprise_patient_id);
CREATE INDEX IF NOT EXISTS ix_closure_instance_enterprise_encounter_id ON workflow.closure_instance (enterprise_encounter_id);
CREATE INDEX IF NOT EXISTS ix_closure_instance_source_system_code ON workflow.closure_instance (source_system_code);
CREATE INDEX IF NOT EXISTS ix_closure_instance_created_at ON workflow.closure_instance (created_at);

CREATE TABLE IF NOT EXISTS workflow.closure_event (
    closure_event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    closure_instance_id uuid NOT NULL,
    event_type varchar(64) NOT NULL,
    from_state varchar(64),
    to_state varchar(64) NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    actor_staff_id uuid,
    event_payload jsonb DEFAULT '{}'::jsonb,
    evidence_uri text,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_closure_event PRIMARY KEY (closure_event_id)
);
COMMENT ON TABLE workflow.closure_event IS '闭环事件；闭环状态迁移和证据不可变日志';
COMMENT ON COLUMN workflow.closure_event.closure_event_id IS '闭环事件ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN workflow.closure_event.closure_instance_id IS '闭环实例ID；所属实例；标准/值域：闭环实例；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_event.event_type IS '事件类型；迁移/提醒/升级/处理/撤销；标准/值域：值域；安全：敏感';
COMMENT ON COLUMN workflow.closure_event.from_state IS '原状态；迁移前；标准/值域：闭环定义；安全：敏感';
COMMENT ON COLUMN workflow.closure_event.to_state IS '新状态；迁移后；标准/值域：闭环定义；安全：敏感';
COMMENT ON COLUMN workflow.closure_event.occurred_at IS '发生时间；业务事件时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_event.actor_staff_id IS '操作人员；操作人；标准/值域：人员MDM；安全：敏感';
COMMENT ON COLUMN workflow.closure_event.event_payload IS '事件载荷；最小业务上下文；标准/值域：事件契约；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_event.evidence_uri IS '证据引用；签名/文档/扫码证据；标准/值域：受控URI；安全：高度敏感';
COMMENT ON COLUMN workflow.closure_event.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN workflow.closure_event.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_event.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_event.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN workflow.closure_event.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_event.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN workflow.closure_event.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN workflow.closure_event.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_closure_event_source_system_code ON workflow.closure_event (source_system_code);
CREATE INDEX IF NOT EXISTS ix_closure_event_created_at ON workflow.closure_event (created_at);
CREATE INDEX IF NOT EXISTS ix_closure_event_occurred_at ON workflow.closure_event (occurred_at);

CREATE TABLE IF NOT EXISTS svc.svc_subscription (
    subscription_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_system_code varchar(64) NOT NULL,
    resource_type varchar(32) NOT NULL,
    resource_name varchar(256) NOT NULL,
    version_no varchar(32) NOT NULL,
    delivery_endpoint text,
    sla_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    approval_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_svc_subscription PRIMARY KEY (subscription_id)
);
COMMENT ON TABLE svc.svc_subscription IS '数据服务订阅；API/事件/批量/数据产品订阅和SLA';
COMMENT ON COLUMN svc.svc_subscription.subscription_id IS '订阅ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.subscriber_system_code IS '订阅系统；消费方；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.resource_type IS '资源类型；API/EVENT/BATCH/DATA_PRODUCT；标准/值域：值域；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.resource_name IS '资源名称；路径/topic/数据集；标准/值域：服务目录；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.version_no IS '版本；契约版本；标准/值域：语义化版本；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.delivery_endpoint IS '投递地址；回调/队列/文件地址；标准/值域：受控URI；安全：敏感';
COMMENT ON COLUMN svc.svc_subscription.sla_json IS 'SLA；时效可用性重试保留；标准/值域：院标；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.approval_status IS '审批状态；DRAFT/APPROVED/SUSPENDED/REVOKED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN svc.svc_subscription.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_svc_subscription_source_system_code ON svc.svc_subscription (source_system_code);
CREATE INDEX IF NOT EXISTS ix_svc_subscription_created_at ON svc.svc_subscription (created_at);

CREATE TABLE IF NOT EXISTS svc.svc_outbox_event (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    aggregate_type varchar(64) NOT NULL,
    aggregate_id varchar(128) NOT NULL,
    event_type varchar(128) NOT NULL,
    event_version varchar(16) DEFAULT '1' NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    publish_status varchar(20) DEFAULT 'PENDING' NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    published_at timestamptz,
    CONSTRAINT pk_svc_outbox_event PRIMARY KEY (event_id)
);
COMMENT ON TABLE svc.svc_outbox_event IS '可靠事件发件箱；事务内记录待发布事件，保障至少一次投递';
COMMENT ON COLUMN svc.svc_outbox_event.event_id IS '事件ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.aggregate_type IS '聚合类型；PATIENT/DEPARTMENT/ORDER等；标准/值域：事件契约；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.aggregate_id IS '聚合ID；对象ID；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN svc.svc_outbox_event.event_type IS '事件类型；topic事件类型；标准/值域：事件目录；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.event_version IS '版本；载荷版本；标准/值域：语义化版本；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.payload IS '载荷；最小必要载荷；标准/值域：JSON Schema；安全：高度敏感';
COMMENT ON COLUMN svc.svc_outbox_event.occurred_at IS '业务时间；事件时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.publish_status IS '发布状态；PENDING/PUBLISHED/FAILED/DEAD；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.retry_count IS '重试次数；重试次数；标准/值域：计数；安全：内部';
COMMENT ON COLUMN svc.svc_outbox_event.published_at IS '发布时间；成功时间；标准/值域：ISO 8601；安全：内部';
CREATE INDEX IF NOT EXISTS ix_svc_outbox_event_occurred_at ON svc.svc_outbox_event (occurred_at);

CREATE TABLE IF NOT EXISTS sec.sec_api_client (
    client_id varchar(128) NOT NULL,
    client_name varchar(256) NOT NULL,
    owner_system_code varchar(64) NOT NULL,
    allowed_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    certificate_thumbprint varchar(256),
    client_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    expires_at timestamptz,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_sec_api_client PRIMARY KEY (client_id)
);
COMMENT ON TABLE sec.sec_api_client IS '接口客户端；服务账号、证书、授权范围和状态';
COMMENT ON COLUMN sec.sec_api_client.client_id IS '客户端ID；OIDC客户端ID；标准/值域：统一身份；安全：高度敏感';
COMMENT ON COLUMN sec.sec_api_client.client_name IS '客户端名称；系统/应用名；标准/值域：院标；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.owner_system_code IS '归属系统；来源系统；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.allowed_scopes IS '授权范围；OAuth scopes/API范围；标准/值域：授权模型；安全：高度敏感';
COMMENT ON COLUMN sec.sec_api_client.certificate_thumbprint IS '证书指纹；mTLS证书指纹；标准/值域：X.509；安全：高度敏感';
COMMENT ON COLUMN sec.sec_api_client.client_status IS '状态；ACTIVE/SUSPENDED/REVOKED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.expires_at IS '到期时间；客户端/证书到期；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN sec.sec_api_client.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_api_client.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE INDEX IF NOT EXISTS ix_sec_api_client_source_system_code ON sec.sec_api_client (source_system_code);
CREATE INDEX IF NOT EXISTS ix_sec_api_client_created_at ON sec.sec_api_client (created_at);

CREATE TABLE IF NOT EXISTS sec.sec_access_audit (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamptz DEFAULT now() NOT NULL,
    actor_type varchar(20) NOT NULL,
    actor_id varchar(128) NOT NULL,
    action varchar(64) NOT NULL,
    resource_type varchar(64) NOT NULL,
    resource_id_hash char(64),
    purpose_of_use varchar(64),
    decision varchar(16) NOT NULL,
    client_ip inet,
    correlation_id varchar(64),
    details jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT pk_sec_access_audit PRIMARY KEY (audit_id)
);
COMMENT ON TABLE sec.sec_access_audit IS '访问审计日志；查询、导出、合并和高风险操作审计';
COMMENT ON COLUMN sec.sec_access_audit.audit_id IS '审计ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN sec.sec_access_audit.occurred_at IS '发生时间；操作时间；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.actor_type IS '主体类型；USER/SERVICE/SYSTEM；标准/值域：值域；安全：内部';
COMMENT ON COLUMN sec.sec_access_audit.actor_id IS '主体ID；用户/客户端；标准/值域：统一身份；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.action IS '操作；READ/SEARCH/EXPORT/MERGE/UPDATE；标准/值域：值域；安全：内部';
COMMENT ON COLUMN sec.sec_access_audit.resource_type IS '资源类型；PATIENT/DOCUMENT/API；标准/值域：资产目录；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.resource_id_hash IS '资源ID哈希；避免暴露患者ID；标准/值域：SHA-256+盐；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.purpose_of_use IS '使用目的；TREATMENT/OPERATIONS/RESEARCH；标准/值域：用途值域；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.decision IS '授权结果；PERMIT/DENY；标准/值域：值域；安全：内部';
COMMENT ON COLUMN sec.sec_access_audit.client_ip IS '客户端IP；来源IP；标准/值域：IP；安全：高度敏感';
COMMENT ON COLUMN sec.sec_access_audit.correlation_id IS '追踪ID；跨服务关联；标准/值域：Trace ID；安全：内部';
COMMENT ON COLUMN sec.sec_access_audit.details IS '详情；最小审计详情；标准/值域：院标；安全：高度敏感';
CREATE INDEX IF NOT EXISTS ix_sec_access_audit_occurred_at ON sec.sec_access_audit (occurred_at);

CREATE TABLE IF NOT EXISTS sec.sec_export_approval (
    export_approval_id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_no varchar(64) NOT NULL,
    requester_user_id varchar(64) NOT NULL,
    purpose_of_use varchar(64) NOT NULL,
    dataset_scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    legal_basis text NOT NULL,
    masking_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    approval_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    approved_by varchar(64),
    expires_at timestamptz,
    watermark_text varchar(256),
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_sec_export_approval PRIMARY KEY (export_approval_id)
);
COMMENT ON TABLE sec.sec_export_approval IS '敏感数据导出审批；敏感数据用途、范围、审批、脱敏和到期';
COMMENT ON COLUMN sec.sec_export_approval.export_approval_id IS '导出审批ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.request_no IS '申请单号；审批编号；标准/值域：院标；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.requester_user_id IS '申请人；申请人；标准/值域：统一身份；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.purpose_of_use IS '使用目的；治疗/管理/科研/监管；标准/值域：用途值域；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.dataset_scope IS '数据范围；字段人群时间；标准/值域：资产目录；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.legal_basis IS '处理依据；授权/法规/伦理；标准/值域：合规依据；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.masking_policy IS '脱敏策略；去标识和掩码；标准/值域：安全策略；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.approval_status IS '审批状态；DRAFT/REVIEW/APPROVED/REJECTED/EXPIRED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.approved_by IS '批准人；数据Owner/安全/伦理；标准/值域：统一身份；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.expires_at IS '授权到期；下载窗口；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.watermark_text IS '水印内容；下载水印；标准/值域：院标；安全：高度敏感';
COMMENT ON COLUMN sec.sec_export_approval.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN sec.sec_export_approval.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_export_approval_request_no ON sec.sec_export_approval (request_no) WHERE request_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sec_export_approval_source_system_code ON sec.sec_export_approval (source_system_code);
CREATE INDEX IF NOT EXISTS ix_sec_export_approval_created_at ON sec.sec_export_approval (created_at);

CREATE TABLE IF NOT EXISTS research.research_cohort (
    cohort_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_code varchar(100) NOT NULL,
    cohort_name varchar(256) NOT NULL,
    definition_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    purpose_of_use varchar(64) NOT NULL,
    ethics_approval_no varchar(128),
    owner_user_id varchar(64) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_research_cohort PRIMARY KEY (cohort_id)
);
COMMENT ON TABLE research.research_cohort IS '科研队列；人群定义、版本、用途和审批';
COMMENT ON COLUMN research.research_cohort.cohort_id IS '队列ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN research.research_cohort.cohort_code IS '队列代码；唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.research_cohort.cohort_name IS '队列名称；名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.research_cohort.definition_json IS '队列定义；入排标准和时间窗；标准/值域：队列DSL；安全：高度敏感';
COMMENT ON COLUMN research.research_cohort.purpose_of_use IS '研究用途；研究目的；标准/值域：用途值域；安全：高度敏感';
COMMENT ON COLUMN research.research_cohort.ethics_approval_no IS '伦理批件号；伦理批准；标准/值域：伦理管理；安全：高度敏感';
COMMENT ON COLUMN research.research_cohort.owner_user_id IS '负责人；课题负责人；标准/值域：统一身份；安全：敏感';
COMMENT ON COLUMN research.research_cohort.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN research.research_cohort.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_cohort.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_cohort.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN research.research_cohort.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_cohort.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN research.research_cohort.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_cohort.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_research_cohort_cohort_code ON research.research_cohort (cohort_code) WHERE cohort_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_research_cohort_source_system_code ON research.research_cohort (source_system_code);
CREATE INDEX IF NOT EXISTS ix_research_cohort_created_at ON research.research_cohort (created_at);

CREATE TABLE IF NOT EXISTS research.research_dataset (
    dataset_id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_code varchar(100) NOT NULL,
    dataset_name varchar(256) NOT NULL,
    cohort_id uuid,
    schema_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    deidentification_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    storage_uri text NOT NULL,
    expires_at timestamptz,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_research_dataset PRIMARY KEY (dataset_id)
);
COMMENT ON TABLE research.research_dataset IS '研究数据集；经审批的去标识化数据集和版本';
COMMENT ON COLUMN research.research_dataset.dataset_id IS '数据集ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN research.research_dataset.dataset_code IS '数据集代码；唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.research_dataset.dataset_name IS '数据集名称；名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.research_dataset.cohort_id IS '队列ID；来源队列；标准/值域：科研队列；安全：高度敏感';
COMMENT ON COLUMN research.research_dataset.schema_json IS '数据Schema；字段和类型；标准/值域：数据契约；安全：高度敏感';
COMMENT ON COLUMN research.research_dataset.deidentification_policy IS '去标识策略；去标识和重识别风险；标准/值域：安全策略；安全：高度敏感';
COMMENT ON COLUMN research.research_dataset.storage_uri IS '安全存储地址；受控环境；标准/值域：受控URI；安全：高度敏感';
COMMENT ON COLUMN research.research_dataset.expires_at IS '到期时间；数据集到期；标准/值域：ISO 8601；安全：高度敏感';
COMMENT ON COLUMN research.research_dataset.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN research.research_dataset.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_dataset.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_dataset.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN research.research_dataset.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_dataset.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN research.research_dataset.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.research_dataset.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_research_dataset_dataset_code ON research.research_dataset (dataset_code) WHERE dataset_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_research_dataset_source_system_code ON research.research_dataset (source_system_code);
CREATE INDEX IF NOT EXISTS ix_research_dataset_created_at ON research.research_dataset (created_at);

CREATE TABLE IF NOT EXISTS research.feature_definition (
    feature_id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature_code varchar(100) NOT NULL,
    feature_name varchar(256) NOT NULL,
    definition text NOT NULL,
    expression text NOT NULL,
    source_asset_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    version_no varchar(32) NOT NULL,
    owner_user_id varchar(64) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_feature_definition PRIMARY KEY (feature_id)
);
COMMENT ON TABLE research.feature_definition IS '特征定义；AI/分析特征定义、血缘和版本';
COMMENT ON COLUMN research.feature_definition.feature_id IS '特征ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN research.feature_definition.feature_code IS '特征代码；唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.feature_definition.feature_name IS '特征名称；业务名称；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.feature_definition.definition IS '定义；计算口径；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN research.feature_definition.expression IS '计算表达式；SQL/DSL；标准/值域：院标；安全：敏感';
COMMENT ON COLUMN research.feature_definition.source_asset_ids IS '来源资产；源资产列表；标准/值域：血缘；安全：敏感';
COMMENT ON COLUMN research.feature_definition.version_no IS '版本；特征版本；标准/值域：语义化版本；安全：内部';
COMMENT ON COLUMN research.feature_definition.owner_user_id IS 'Owner；负责人；标准/值域：统一身份；安全：敏感';
COMMENT ON COLUMN research.feature_definition.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN research.feature_definition.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.feature_definition.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.feature_definition.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN research.feature_definition.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.feature_definition.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN research.feature_definition.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.feature_definition.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_feature_definition_feature_code ON research.feature_definition (feature_code) WHERE feature_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_feature_definition_source_system_code ON research.feature_definition (source_system_code);
CREATE INDEX IF NOT EXISTS ix_feature_definition_created_at ON research.feature_definition (created_at);

CREATE TABLE IF NOT EXISTS research.model_registry (
    model_id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_code varchar(100) NOT NULL,
    model_name varchar(256) NOT NULL,
    model_version varchar(32) NOT NULL,
    training_dataset_id uuid NOT NULL,
    intended_use text NOT NULL,
    metrics_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    release_status varchar(20) DEFAULT 'DRAFT' NOT NULL,
    owner_user_id varchar(64) NOT NULL,
    record_status varchar(20) DEFAULT 'ACTIVE' NOT NULL,
    effective_start timestamptz DEFAULT now() NOT NULL,
    effective_end timestamptz,
    source_system_code varchar(64) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    created_by varchar(64) DEFAULT 'SYSTEM' NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT pk_model_registry PRIMARY KEY (model_id)
);
COMMENT ON TABLE research.model_registry IS '模型注册；模型卡、训练数据版本、性能和退役';
COMMENT ON COLUMN research.model_registry.model_id IS '模型ID；全局唯一标识；标准/值域：UUID；安全：内部';
COMMENT ON COLUMN research.model_registry.model_code IS '模型代码；唯一代码；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.model_registry.model_name IS '模型名称；模型名；标准/值域：院标；安全：内部';
COMMENT ON COLUMN research.model_registry.model_version IS '模型版本；版本；标准/值域：语义化版本；安全：内部';
COMMENT ON COLUMN research.model_registry.training_dataset_id IS '训练数据集；训练数据版本；标准/值域：研究数据集；安全：高度敏感';
COMMENT ON COLUMN research.model_registry.intended_use IS '预期用途；适用范围和禁忌；标准/值域：模型卡；安全：敏感';
COMMENT ON COLUMN research.model_registry.metrics_json IS '性能指标；区分度/校准/公平性；标准/值域：模型评估；安全：敏感';
COMMENT ON COLUMN research.model_registry.release_status IS '发布状态；DRAFT/VALIDATED/PUBLISHED/RETIRED；标准/值域：状态值域；安全：内部';
COMMENT ON COLUMN research.model_registry.owner_user_id IS 'Owner；模型负责人；标准/值域：统一身份；安全：敏感';
COMMENT ON COLUMN research.model_registry.record_status IS '记录状态；生命周期状态；标准/值域：院标状态值域；安全：内部';
COMMENT ON COLUMN research.model_registry.effective_start IS '生效时间；业务生效起点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.model_registry.effective_end IS '失效时间；业务失效终点；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.model_registry.source_system_code IS '来源系统代码；来源系统注册代码；标准/值域：来源系统MDM；安全：内部';
COMMENT ON COLUMN research.model_registry.created_at IS '创建时间；平台写入时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.model_registry.created_by IS '创建人；用户或服务账号；标准/值域：统一身份；安全：内部';
COMMENT ON COLUMN research.model_registry.updated_at IS '更新时间；最近更新时间；标准/值域：ISO 8601；安全：内部';
COMMENT ON COLUMN research.model_registry.row_version IS '乐观锁版本；并发更新版本；标准/值域：院标；安全：内部';
CREATE UNIQUE INDEX IF NOT EXISTS ux_model_registry_model_code ON research.model_registry (model_code) WHERE model_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_model_registry_source_system_code ON research.model_registry (source_system_code);
CREATE INDEX IF NOT EXISTS ix_model_registry_created_at ON research.model_registry (created_at);

ALTER TABLE mdm.mdm_patient_xref ADD CONSTRAINT fk_mdm_patient_xref_enterprise_patient_id FOREIGN KEY (enterprise_patient_id) REFERENCES mdm.mdm_master_patient(enterprise_patient_id) NOT VALID;
ALTER TABLE cdr.cdr_encounter ADD CONSTRAINT fk_cdr_encounter_enterprise_patient_id FOREIGN KEY (enterprise_patient_id) REFERENCES mdm.mdm_master_patient(enterprise_patient_id) NOT VALID;
ALTER TABLE cdr.cdr_order ADD CONSTRAINT fk_cdr_order_enterprise_encounter_id FOREIGN KEY (enterprise_encounter_id) REFERENCES cdr.cdr_encounter(enterprise_encounter_id) NOT VALID;
ALTER TABLE cdr.cdr_diagnosis ADD CONSTRAINT fk_cdr_diagnosis_enterprise_encounter_id FOREIGN KEY (enterprise_encounter_id) REFERENCES cdr.cdr_encounter(enterprise_encounter_id) NOT VALID;
ALTER TABLE cdr.cdr_observation ADD CONSTRAINT fk_cdr_observation_order_id FOREIGN KEY (order_id) REFERENCES cdr.cdr_order(order_id) NOT VALID;
ALTER TABLE cdr.cdr_report ADD CONSTRAINT fk_cdr_report_order_id FOREIGN KEY (order_id) REFERENCES cdr.cdr_order(order_id) NOT VALID;
ALTER TABLE cdr.cdr_specimen ADD CONSTRAINT fk_cdr_specimen_order_id FOREIGN KEY (order_id) REFERENCES cdr.cdr_order(order_id) NOT VALID;
ALTER TABLE cdr.cdr_medication_administration ADD CONSTRAINT fk_cdr_medication_administration_order_id FOREIGN KEY (order_id) REFERENCES cdr.cdr_order(order_id) NOT VALID;
ALTER TABLE mdm.mdm_practitioner_role ADD CONSTRAINT fk_mdm_practitioner_role_enterprise_staff_id FOREIGN KEY (enterprise_staff_id) REFERENCES mdm.mdm_staff(enterprise_staff_id) NOT VALID;
ALTER TABLE mdm.mdm_bed ADD CONSTRAINT fk_mdm_bed_location_id FOREIGN KEY (location_id) REFERENCES mdm.mdm_location(location_id) NOT VALID;
ALTER TABLE kb.kb_rule_version ADD CONSTRAINT fk_kb_rule_version_rule_id FOREIGN KEY (rule_id) REFERENCES kb.kb_rule(rule_id) NOT VALID;

-- 建议先装载、清洗历史数据，再逐项 VALIDATE CONSTRAINT，避免一次性阻断迁移。
COMMIT;