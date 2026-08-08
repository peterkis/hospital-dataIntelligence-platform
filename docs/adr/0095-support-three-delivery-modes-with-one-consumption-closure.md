---
status: accepted
extends: 0059
clarifies: 0086
extended_by: 0096
---

# 一个规范快照支持三种交付模式并统一消费闭环

平台对一次治理内容只形成一个权威`governance_release`和一个`CANONICAL`规范快照；同一权威来源可以通过`SNAPSHOT_PULL`、`MANAGED_EXPORT_HANDOFF`或`RECORD_PUSH`交付给消费者。`SNAPSHOT_PULL`由第三方服务身份通过平台API取得完整规范制品；`MANAGED_EXPORT_HANDOFF`由获授权的医院操作员从固定发布和快照发起受控导出及交接；`RECORD_PUSH`由平台针对固定快照的成员逐条调用第三方接口并保存进度。三种方式只是交付模式，不得各自产生领域版本、治理发布、权威快照或第二份主数据真相。

消费者初始化必须建模为独立的初始化交付作业，冻结目标消费者及订阅版本、来源发布、规范快照和一种交付模式；日常增量仍由版本化订阅、发布变更通知和逐消费者投递承载，两者不得共用可覆盖的进度或把逐条推送成员膨胀为治理发布事件。初始化和增量拥有各自的执行、失败、重试与证据状态，但都汇入同一个消费者检查点和缺口控制语义。

三种模式都必须经过回执、对账和检查点才能闭环：下载完成、操作员导出或交接完成、单条或全部HTTP请求成功，都不能单独证明消费者已经校验、导入或应用。只有来源范围、版本、数量、摘要和差异得到可审计对账，且不存在未解释缺口时，才可关闭初始化作业并建立或推进消费者检查点；失败、重试和差异证据只追加保留，不得用人工成功标记覆盖。

自动化第三方消费的正式入口仍是平台API，`MANAGED_EXPORT_HANDOFF`不向第三方开放管理界面、网页链接契约或数据库访问。消费者交付配置的语义主权由[ADR-0097](0097-govern-consumer-delivery-profiles-with-integration-owner-and-domain-confirmation.md)进一步确认，受控转换能力及验证门禁由[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)进一步确认；[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)进一步冻结阶段范围：Phase 01只验证`SNAPSHOT_PULL`，完整POC扩展以合成仿真消费者实现`MANAGED_EXPORT_HANDOFF`邻接薄切，`RECORD_PUSH`继续只作长期预留；[ADR-0101](0101-expand-managed-export-acceptance-baseline-to-72-rest-and-20-ui-scenarios.md)为该薄切冻结G01至G12及U17至U20，使完整POC采用72/20验收基线；[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)冻结完整POC受控导出的确定性无压缩ZIP格式；[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)冻结其完整POC PostgreSQL短事务原子存储边界；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)冻结完整POC派生制品保留、取代、禁止选择性删除及环境整体处置边界；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)冻结容量先测后定、以最终ZIP精确字节计量及超限失败关闭的方法；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)冻结前置实验只支撑实施上限、集成后真实链路核验才授予最终容量验收资格；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结七类容量专用画像及其精确最终CSV数据行数；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结画像逐字段非空、长度、宽度、字符/CSV转义类别和适用字段资格；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2容量环境及独占运行门禁。声明式规则语法、重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合、数值上限、逐条推送的接口幂等契约及暂存激活方式仍分别确认。本决策不连接真实消费系统。

[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)进一步确认受控导出可以从固定规范快照生成版本化、不可变且非权威的厂商专用派生交付制品；其具体格式由ADR-0103确认，完整POC物理存储与成功提交原子性由ADR-0104确认，保留与删除生命周期由ADR-0105确认，容量制定方法由ADR-0106确认，两阶段容量证据由ADR-0107确认，容量画像矩阵由ADR-0108确认，逐字段分布由ADR-0109确认，实验环境由ADR-0110确认；重复次数、阈值、结果聚合和数值上限仍待后续决策。
