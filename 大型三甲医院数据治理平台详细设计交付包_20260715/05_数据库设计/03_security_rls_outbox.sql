-- 安全、RLS与事务性Outbox示例
CREATE ROLE hdgp_app NOLOGIN;
CREATE ROLE hdgp_readonly NOLOGIN;
CREATE ROLE hdgp_auditor NOLOGIN;
CREATE ROLE hdgp_steward NOLOGIN;

REVOKE ALL ON SCHEMA mdm,ref,meta,dq,gov,integration,audit,ops FROM PUBLIC;
GRANT USAGE ON SCHEMA ref,meta TO hdgp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA ref,meta TO hdgp_readonly;
GRANT USAGE ON SCHEMA audit TO hdgp_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO hdgp_auditor;

ALTER TABLE audit.export_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY export_request_owner_policy ON audit.export_request
USING (
  requester_user_id = current_setting('app.user_id', true)
  OR current_setting('app.security_role', true) IN ('DATA_SECURITY','AUDITOR')
);

CREATE OR REPLACE FUNCTION integration.enqueue_domain_event(
    p_aggregate_type varchar,
    p_aggregate_id uuid,
    p_aggregate_version bigint,
    p_event_type varchar,
    p_payload jsonb,
    p_trace_id varchar
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_event_id uuid;
BEGIN
  INSERT INTO integration.outbox_event(
      aggregate_type, aggregate_id, aggregate_version, event_type, payload, trace_id
  ) VALUES (
      p_aggregate_type, p_aggregate_id, p_aggregate_version, p_event_type, p_payload, p_trace_id
  ) RETURNING event_id INTO v_event_id;
  RETURN v_event_id;
END $$;

-- 生产要求：
-- * 敏感标识仅保存KMS加密密文和不可逆HMAC/哈希，明文不得写入日志、事件或索引；
-- * 应用连接使用短期凭据/动态密钥，禁止共享超级用户；
-- * 数据库审计、网关审计和业务审计均写入独立安全链路；
-- * 导出、合并、回滚、规则变更采用MFA和四眼原则；
-- * SECURITY DEFINER函数必须固定search_path并单独代码审查。
