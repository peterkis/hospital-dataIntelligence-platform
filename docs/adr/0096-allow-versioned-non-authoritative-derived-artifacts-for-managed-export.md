---
status: accepted
extends: 0095
clarifies: 0090
extended_by: 0097
---

# 受控导出允许版本化非权威派生交付制品

`MANAGED_EXPORT_HANDOFF`允许从固定`governance_release`及其唯一`CANONICAL`规范快照生成面向指定厂商或消费者的派生交付制品。派生交付制品只是受控交付表达，不是`release_snapshot`、规范投影、治理发布或领域版本；它必须使用独立稳定身份并明确标记为非权威，不能取得主数据主权、冒称规范制品或放宽“一发布一规范快照”的基数。

每个成功的受控导出作业必须且只能形成一个不可变派生交付制品，并冻结目标消费者及订阅版本、来源发布与快照、来源快照摘要、适用的精确消费者交付配置版本、交付契约版本、模板版本、映射版本、制品媒体类型、记录数量和不可变清单。派生制品使用自己的摘要算法及摘要覆盖最终派生字节，摘要保存在其覆盖字节之外；不得复用、覆盖或改名使用`projection_payload_digest`或`snapshot_artifact_digest`。任何内容、格式、配置、模板或映射变化都必须创建新的导出作业和新制品，既有字节、摘要及清单不得重写。

[ADR-0099](0099-fail-the-entire-managed-export-job-on-any-record-conversion-error.md)进一步确认：任一记录发生确定性转换失败时，整个作业失败且没有完成派生交付制品；失败记录只形成行级错误证据，不能通过部分导出、错误清单或人工跳过放宽本ADR的“一成功作业一制品”语义。

清单必须使派生制品可追溯回唯一规范快照，并明确其目标消费者、用途、来源范围、精确消费者交付配置版本、转换契约身份、记录数量和非权威性质；表示转换不得静默改写领域含义。消费者交付配置的版本、审批和执行主权由[ADR-0097](0097-govern-consumer-delivery-profiles-with-integration-owner-and-domain-confirmation.md)进一步限定。生成成功、下载或交接均不等于消费者应用完成，作业仍必须取得回执、完成来源—派生制品—下游结果对账并在无未解释差异时才能闭环及推进检查点。

[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)随后把完整POC的具体格式冻结为只含`manifest.json`和`records.csv`的确定性无压缩ZIP，并把完整ZIP摘要保存在制品外部；XLSX、裸CSV、分片和同作业多格式不进入本POC。[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)进一步确认完整POC在`release-distribution`专属且与`release_snapshot`分离的PostgreSQL `bytea`中保存精确ZIP，并以短本地事务原子提交制品、成功状态、审计及可交付资格；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)确认完成制品保留到完整POC证据基线整体处置，新作业只追加新制品，取代和权限变化均不产生选择性删除资格；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)确认容量以最终ZIP精确字节先测后定并对超限失败关闭；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)确认前置隔离试验只支撑实施上限，集成后真实链路核验才授予最终容量资格；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)确认七类容量专用画像、精确最终CSV数据行数、生成输入及业务fixture隔离边界；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)确认逐字段非空、文本长度、宽度、字符/转义类别及适用字段身份；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)确认受限本机WSL2容量环境、独占运行门禁和非生产证据边界。声明式规则的具体语法、重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合、最终数值上限或生成组件内部组织仍未由本决策确定。允许的默认转换、高风险禁区和验证门禁由[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)限定；阶段范围由[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)限定为Phase 01不实现、架构门禁通过后以合成仿真消费者进入完整POC邻接薄切，且不启用高风险语义转换或连接真实厂商；[ADR-0101](0101-expand-managed-export-acceptance-baseline-to-72-rest-and-20-ui-scenarios.md)以G01至G12和U17至U20验证该薄切。Phase 01规范快照的16 MiB护栏不得自动套用于派生交付制品；其余实现事项仍须分别确认。
