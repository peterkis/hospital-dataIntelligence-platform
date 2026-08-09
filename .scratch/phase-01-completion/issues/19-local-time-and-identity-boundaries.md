# 19 — 全链路本地时间与身份边界

**What to build:** 在草稿、导入、审批、发布、解析和消费路径统一执行Asia/Shanghai无时区日期时间契约，并完成浏览器会话、服务身份和本地授权负向矩阵。

**Blocked by:** 11 — 原批次幂等重试与新批次版本候选; 12 — 价表条目批量导入与发布前校验; 14 — 补偿发布与暂停恢复; 17 — Outbox与消费者故障恢复.

**Status:** ready-for-agent

- [ ] 所有治理日期时间API、CSV、JSON和界面字段拒绝`Z`、UTC偏移及不符合冻结格式的值。
- [ ] 治理Schema只含`timestamp without time zone`和`tsrange`，驱动结果不转换为JavaScript `Date`。
- [ ] 改变宿主进程时区后，相同fixture的业务时间选择、记录时间查询、顺序和摘要结果不变。
- [ ] OIDC/JWT NumericDate只存在认证适配器协议边界，不进入治理Schema或公开业务契约。
- [ ] 浏览器Cookie安全属性、会话撤销、CSRF、伪造Cookie和无令牌前端扫描全部通过。
- [ ] 人员外部身份、服务Client Credentials和本地主体绑定的允许/拒绝结果覆盖全部新增能力。

## Comments

No comments yet.
