---
status: accepted
extends: 0087
clarifies: 0076
extended_by: 0089
---

# 领域模块拥有版本化投影Schema并进入单一契约链

每个领域模块拥有自己的稳定`projection_type`、投影字段语义、可执行TypeBox Schema和不可变`projection_schema_version`。一个Schema版本一经用于发布就不得修改或删除；字段结构、约束或不改变字段却改变解释的语义变化都必须形成新版本，既有快照继续绑定原版本。版本标识的具体格式不在本决策中锁定，也不得仅凭编号大小或SemVer外观推断兼容性。

每个跨越发布seam的投影都冻结`projection_type`、`projection_schema_version`和按受控规范生成的`projection_schema_digest`，摘要算法标识随契约身份留证。`release-distribution`只核对该三元身份与应用装配时登记的不可变契约一致，并把它写入快照包络、事件和查询结果；它不得定义领域字段、选择Schema版本、重新解释旧内容、执行隐式迁移或自动升降级。只要仍有快照引用某Schema版本，其可执行定义、摘要和对应冻结外部契约证据就必须保持可追溯。

领域模块通过自己的唯一`index.ts`把投影Schema作为模块接口的一部分提供给组合根；组合根在注册Fastify路由时确定性地组合全部已纳入范围的投影Schema，继续由同一TypeBox定义源生成并冻结OpenAPI 3.1。`release-distribution`的外部快照与变化契约必须无歧义地携带投影类型和Schema版本，但不得另建集中定义所有领域字段的Schema模块、手写OpenAPI/JSON Schema/DTO或消费者私有契约。由TypeBox派生的Schema清单、客户端和证据可以保存，但都不是平行可编辑权威。

该分工让领域语义留在领域模块，同时保持消费者只有一条外部契约权威链，并阻止`release-distribution`演变为所有治理域的Schema所有者。消费者精确支持声明、不兼容投递隔离及升级后的受控重放由[ADR-0089](0089-use-exact-consumer-projection-support-and-isolated-delivery-blocking.md)进一步限定；[ADR-0090](0090-use-one-canonical-projection-snapshot-per-release-in-phase-01.md)进一步冻结Phase 01“一发布一规范投影一权威快照”和Schema升级新建发布的基数语义；[ADR-0091](0091-govern-projection-schema-upgrades-as-high-risk-contract-changes.md)进一步冻结升级责任、证据和限定职责分离例外。
