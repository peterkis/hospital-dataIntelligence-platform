---
status: accepted
extends: 0085
clarifies: 0080
extended_by: 0087
---

# 发布登记与投递由一个深模块拥有

Phase 01建立一个`release-distribution`深模块，统一拥有通用发布包络与成员、快照元数据、不可变Outbox事件、消费者订阅、按消费者独立的投递与尝试、平台侧检查点和回执；不再拆建`publication`、`delivery`或独立`outbox`模块。它通过一个小型逻辑接口承接事务作用域内的不可变发布或暂停事实登记、快照与变化查询、投递状态查询、回执接收和受控重放，内部派发器及状态机不成为第二个公开接口，也不得由其他模块直接查写其表。

模块统一不等于事务统一：领域模块仍在调用方事务中拥有并固化自身版本，`release-distribution`只在该事务内登记通用包络、成员、快照元数据和Outbox事实且不执行网络调用；提交后唤醒只是提示，数据库轮询才是恢复权威；投递依次经过短事务租约认领、事务外网络发送以及新事务追加尝试和更新投递投影。该模块不拥有领域内容版本、工作流决定、审计链或仿真消费者内部应用状态。把发布登记和投递拆成两个浅模块会迫使事件、订阅、投递、顺序和恢复不变量跨接口或跨表泄漏，因此Phase 01保持一个深模块并在实现内部严格隔离各事务阶段。

领域内容如何进入该模块由[ADR-0087](0087-domain-projection-and-release-snapshot-packaging.md)进一步限定：领域模块交付冻结的类型化内容投影，`release-distribution`据此生成通用快照制品，不得回查领域表或要求领域模块直接写入其存储。

消费者如何声明投影支持及隔离不兼容投递由[ADR-0089](0089-use-exact-consumer-projection-support-and-isolated-delivery-blocking.md)进一步限定：版本化订阅、发布前预检、阻断状态和受控重放仍封装于本模块，不拆建兼容转换模块。

[ADR-0095](0095-support-three-delivery-modes-with-one-consumption-closure.md)进一步确认初始化交付作业与日常增量订阅分别保存状态，但三种交付模式的通用作业、回执、对账和检查点责任仍留在本模块；具体模式adapter只有进入已确认实施范围后才作为内部seam建立，不拆新的交付服务或workspace。

[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)允许本模块继续封装受控导出作业、派生制品身份、独立摘要、清单和交接闭环，但不授权其把派生制品建模为规范快照、解释厂商字段映射或改写领域语义。

[ADR-0097](0097-govern-consumer-delivery-profiles-with-integration-owner-and-domain-confirmation.md)进一步确认消费者交付配置由集成交付Owner终审并由来源领域Owner强制前置确认；本模块只能执行作业所冻结的已批准配置版本，不能编辑配置或映射、回查当前领域表、推断含义或自动选用新版本。声明式规则具体语法及私有执行组件物理位置仍须另行确认。

[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)进一步把执行输入限制为已验证的受控声明式计划，禁止任意脚本、SQL、网络调用和运行时当前表查询，高风险语义转换默认禁止。具体声明式语法及私有执行组件物理位置仍未确定。

[ADR-0099](0099-fail-the-entire-managed-export-job-on-any-record-conversion-error.md)进一步确认任一记录确定性转换失败会终止整个导出作业；本模块保留作业及行级错误证据，但不得登记完成制品、交接成功、对账通过或检查点推进。[ADR-0102](0102-retry-transient-managed-export-failures-within-the-same-frozen-job.md)随后确认瞬时技术故障仍由本模块内部的冻结初始化作业状态机处理：同作业有限重试且每次完整重建，不拆独立重试或恢复模块。

[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)进一步确认Phase 01只实现本模块内的`SNAPSHOT_PULL`能力；门禁通过后的完整POC才加入受控导出最小adapter和合成仿真消费者闭环，逐记录推送adapter继续不得预建。阶段不同不改变三种模式都归本深模块所有的边界。
