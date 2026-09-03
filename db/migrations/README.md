# PostgreSQL migrations

此目录是 Phase 01 PostgreSQL 物理 Schema 的唯一权威。应用、Kysely 和类型生成工具不得在运行时修改 Schema。

- `0001_phase_01_vertical_slice.sql`：建立模块专属 Schema、声明式核心约束、不可变规范快照、Outbox、解析证据和只追加审计链。
- `0002`至`0003`：允许价表发布版本只执行一次平台记录有效期关闭，同时保持其余内容不可变。
- `0004_charge_item_draft_mutation_guards.sql`：只允许未提交收费项目草稿物理删除，并在数据库层阻断已提交或已发布版本的内容覆盖。
- `0005_charge_item_version_bitemporal_guards.sql`：每个收费项目只允许一个开放版本候选，并只允许已发布版本执行一次平台记录有效期关闭。
- `0006_price_list_draft_mutation_guards.sql`：每个价表只允许一个开放候选，且仅草稿可修改或删除价格条目；已提交和已发布内容保持不可变。
- `0007_object_and_campus_authorization.sql`：将本地对象级授权扩展到全院/院区范围，补齐显式拒绝及授权判定只追加证据。
- `0008_versioned_approval_workflow.sql`：冻结普通、高风险、院区差异价和纯Schema升级审批模板及阶段，将所有持久化审批阶段标识统一保留为`varchar(64)`容量，并追加不可覆盖的审批动作历史。
- `0009_batch_import_jobs.sql`：冻结CSV/JSON导入批次、不可变行身份、行级结果和只追加尝试证据，支持行边界恢复与原批次幂等重试。
- `0010_emergency_suspension_and_recovery.sql`：追加紧急暂停事件、影响事项、事后复核及补偿发布关系，禁止原地恢复已暂停历史版本。
- `0011_charge_item_governance_object_scope.sql`：把收费项目稳定身份显式绑定到唯一治理对象，按对象约束业务代码并阻断跨对象授权混淆。
- `0012_department_master.sql`：新增科室稳定身份、不可变双时态版本、来源别名与映射、质量评分，以及行政、运营、病案独立层级视图版本；通用父科室不进入科室版本。
- `0013_department_master_api_readiness.sql`：追加科室与层级视图治理对象作用域、Workflow发布预留、来源映射终态、Group组合引用、科室院区双时态关系及诊疗科目映射适用性，为后续HTTP生命周期提供失败关闭的领域边界。
- `0014_department_governance_audit_events.sql`：在既有`audit.audit_event`追加无时区记录时间与最小业务事实载荷，复用同一只追加哈希链承载科室、版本、层级、来源映射和院区关系治理事件。
- `0015_department_published_projection.sql`：新增科室对外消费的只读发布投影，冻结已发布版本对应的院区、层级视图与质量分数，并以延迟约束保证发布版本、投影和审计事务共同提交或回滚。
- `0016_department_projection_audit_time.sql`：为只读科室发布投影追加由创建或关闭时间自动派生的`updated_at`生成列，在不开放内容更新的前提下满足科室Schema统一审计时间约束。

迁移按文件名前缀严格升序执行。尚未进入正式证据包的迁移可在开发期修订；进入证据基线后，原文件及摘要不得覆盖，后续只能追加迁移。逻辑表所有权见 `db/table-ownership.json`。
