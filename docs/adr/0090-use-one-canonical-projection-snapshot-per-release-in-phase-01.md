---
status: accepted
extends: 0089
clarifies: 0087
extended_by: 0091
---

# Phase 01每个发布只有一个规范投影快照

Phase 01中，每个`governance_release`必须且只能冻结一个规范发布投影契约，并形成一个权威、不可变的快照制品；全部消费者兼容性预检、事件通知、快照获取和受控重放都引用这一份制品。不得在同一发布下并行生成多个Schema版本、消费者专用快照、降级副本或其他内容变体，也不得为适配消费者复制领域发布事实。

投影Schema升级必须形成新的显式治理发布、新的发布序号、新的投影契约身份和新的快照制品及摘要。若领域内容本身未变化，新发布可以继续引用完全相同的不可变领域内容版本或成员集合，但必须把契约升级作为发布原因留证，并重新完成审批、发布前兼容性预检和分发登记。既有发布、快照字节、契约身份和摘要不得重打包、覆盖或补写。升级的高风险责任、强制证据、消费者无否决权及提交—终审限定例外由[ADR-0091](0091-govern-projection-schema-upgrades-as-high-risk-contract-changes.md)进一步限定。

为保留后续多投影版本或专用快照的扩展性，`governance_release`的领域发布事实身份必须与`release_snapshot`的制品身份分离，不能合并ID、把快照等同发布，或把消费者身份写入Phase 01规范快照。Phase 01对两者执行严格一对一和唯一规范制品约束，但保持现有“领域模块交付投影、`release-distribution`封装制品”的单一接口边界；不预建投影注册器、转换器、变体路由、消费者选择器、专用制品角色或未使用的扩展接口。

未来若确有同一领域发布派生多个投影版本或消费者专用快照的需求，必须另立ADR和验证门禁，显式定义派生制品的角色、受众、契约身份、摘要、路由、退役和语义等价要求。任何派生制品都必须不可变并可追溯到同一规范领域发布，不能取得领域内容主权、改写规范发布或成为第二份主数据真相。当前规范快照的投影载荷摘要、完整制品摘要及领域内容等价证据分工见[ADR-0092](0092-use-separate-projection-payload-and-snapshot-artifact-digests.md)。

[ADR-0095](0095-support-three-delivery-modes-with-one-consumption-closure.md)确认的`SNAPSHOT_PULL`、`MANAGED_EXPORT_HANDOFF`和`RECORD_PUSH`是同一权威发布与规范快照的交付模式，不构成本ADR禁止的同发布多投影或多规范快照。[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)进一步允许受控导出生成厂商专用派生交付制品，但该制品使用独立身份和摘要、明确非权威且不得建模为`release_snapshot`；因此本ADR的一发布一规范快照约束保持不变。
