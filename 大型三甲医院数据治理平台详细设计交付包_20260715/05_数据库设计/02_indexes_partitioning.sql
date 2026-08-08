-- 索引、分区与维护参考
CREATE INDEX idx_patient_status_birth ON mdm.patient(status, birth_date);
CREATE INDEX idx_patient_name_trgm_hint ON mdm.patient(lower(golden_name));
CREATE INDEX idx_patient_identifier_hash ON mdm.patient_identifier(identifier_hash, identifier_type) WHERE status='ACTIVE';
CREATE INDEX idx_patient_xref_patient ON mdm.patient_xref(patient_mdm_id);
CREATE INDEX idx_patient_link_target ON mdm.patient_link(target_patient_mdm_id, link_type) WHERE reversed_at IS NULL;
CREATE INDEX idx_org_parent ON mdm.organization(parent_organization_mdm_id, status);
CREATE INDEX idx_location_parent ON mdm.location(part_of_location_mdm_id, status);
CREATE INDEX idx_practitioner_license ON mdm.practitioner(professional_license_hash) WHERE professional_license_hash IS NOT NULL;
CREATE INDEX idx_medication_codes ON mdm.medication(national_drug_code, medical_insurance_code);
CREATE INDEX idx_concept_code_display ON ref.concept(code_system_id, concept_code, display_name);
CREATE INDEX idx_lineage_source ON meta.lineage_edge(source_urn, observed_at DESC);
CREATE INDEX idx_lineage_target ON meta.lineage_edge(target_urn, observed_at DESC);
CREATE INDEX idx_dq_issue_open ON dq.issue(owner_user_id, severity, due_at) WHERE issue_status NOT IN ('CLOSED','CANCELLED');
CREATE INDEX idx_change_request_status ON gov.change_request(domain_code, status, created_at DESC);
CREATE INDEX idx_outbox_pending ON integration.outbox_event(publication_status, next_retry_at, event_time);
CREATE INDEX idx_dlq_open ON integration.dead_letter(owner_user_id, status, first_failed_at);

-- 示例：按月创建审计分区。生产建议由pg_partman或受控作业自动创建未来6个月分区。
CREATE TABLE IF NOT EXISTS audit.event_2026_07 PARTITION OF audit.event
FOR VALUES FROM ('2026-07-01 00:00:00+08') TO ('2026-08-01 00:00:00+08');

-- 维护建议：
-- 1) audit.event在线保留12-24个月，之后导出Parquet到WORM对象存储；
-- 2) dq.execution保留12个月在线，证据与汇总长期保留；
-- 3) integration.outbox_event成功记录保留30天，失败记录必须闭环后归档；
-- 4) 高频表监控膨胀、autovacuum、WAL、长事务和热点索引；
-- 5) 不允许仅凭“created_at”删除主数据历史，实体版本与审批审计需长期保留。
