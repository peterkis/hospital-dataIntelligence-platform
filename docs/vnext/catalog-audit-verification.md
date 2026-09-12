# 目录审计批次验证

迁移 0004 追加 `vnext_control.audit_chain`。目录命令、原审计行、链事件、outcome 和 identity replay 索引在同一事务内提交；失败全部回滚。唯一的 `GOVERNANCE_CATALOG` 流以 `audit_stream_id + audit_sequence` 正 bigint 确定顺序，事务锁串行分配；时间只用于展示。流、序号、前哈希及完整审计内容共同计算 SHA-256。应用角色没有原始审计或链表的读取、更新、删除、截断权限。

既有审计没有规范流序号。迁移保留原行，在序号 1 记录 **LEGACY_BASELINE**：只对升级时观察到的无序集合保存数量和摘要。UUID 排序仅用于集合的确定性序列化，不代表事件次序。该基线不能证明升级之前未发生过篡改，禁止把它描述为追溯建立的历史哈希链。

审计身份 `auditor / SYNTHETIC_AUDITOR` 仅有 SYNTHETIC 的 AUDIT 权限，无 READ、WRITE、REVIEW；maker、reviewer 和平台普通调用方没有 AUDIT 权限。receipt-bound 本地入口：

```powershell
npm run prototype:db:with -- vnext:catalog:audit:verify
npm run prototype:db:with -- vnext:catalog:audit:verify -- <此前可信 checkpoint 文件的绝对路径>
```

批次验证核对原审计行、基线集合、链顺序、前后哈希以及可选的先前 checkpoint。成功后以 exclusive create 写入仓库忽略目录 `.runtime/vnext/audit-checkpoints/`，绑定数据库 name/OID、流、序号和哈希。审计操作员保管这些 checkpoint，复验时必须传入此前可信文件；无 checkpoint 的首次验证只是本次观察基线，不证明完整数据库未被有权重写全部内容的管理员替换。可信 checkpoint 可检测覆盖其位置的链截断或重新计算；两次 checkpoint 之间尚未锚定的尾部以及同时控制数据库和 checkpoint 文件的攻击者不在该本地 POC 的证明范围。

`vnext:catalog:audit:validate` 在 receipt-owned fresh 库验证既有行升级保留、并发排序、别名重放不增加审计、权限分离、原始行与链的篡改、删除及可信 checkpoint 检测。未建设 WORM、外部 SIEM、异地归档或正式长期保留系统，遵循 ADR 0007 的 POC 边界。
