---
status: accepted
extends: 0096
clarifies: 0087
extended_by: 0098
---

# 消费者交付配置由集成交付Owner治理并冻结执行

平台把`消费者交付配置`建立为独立版本化治理对象，用于定义固定领域投影如何形成面向指定消费者和交付用途的非权威表达；它不是领域投影Schema、消费者订阅、初始化作业或派生交付制品。配置具有稳定身份和不可变版本，每个配置版本必须冻结目标消费者、交付用途、精确来源`projection_type + projection_schema_version`、交付契约版本、模板版本和映射版本，不得在作业运行时解析“当前”或`latest`配置。

来源领域Owner必须对配置版本执行强制语义前置确认，确认字段含义、约束和来源投影未被静默改义；集成交付Owner是该配置的唯一最终内容Owner，负责确认面向消费者的交付表达、契约、模板和映射组合。只有完成必需前置确认及终审并被冻结的配置版本才可被交付作业使用，既有对象级授权、动作独立留痕和职责分离规则继续适用，本决策不建立新的审批例外。

每个使用厂商专用转换的初始化导出作业及其派生交付制品必须固定引用一个精确配置版本。配置内容、来源投影契约、交付契约、模板或映射发生变化时必须形成新的配置版本；新版本不得自动传播到既有作业、派生制品、摘要、清单、回执或对账证据，也不得触发历史重生成。

在`MANAGED_EXPORT_HANDOFF`链路中，`release-distribution`只能执行已经批准并冻结的配置，封装派生制品、独立摘要、不可变清单及交付闭环；它不得编辑配置或映射、推断领域含义、查询当前领域表、自动选择其他版本或用执行结果取得语义主权。允许的默认转换、高风险禁区、绝对禁止能力及发布前验证由[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)进一步限定；[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)把该配置的最小可执行薄切延后到Phase 01门禁通过后的完整POC，并限制为合成仿真消费者和默认受控表示转换；[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)冻结派生交付格式版本及确定性无压缩ZIP表示；[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)冻结完整POC的PostgreSQL `bytea`存储及短事务成功提交边界；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)冻结完成制品保留、取代和环境整体处置语义；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)冻结容量先测后定及超限失败关闭方法；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)冻结两阶段容量证据及真实链路最终核验；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结容量专用画像矩阵，并要求画像引用精确消费者交付配置与格式版本；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结画像逐字段分布和适用字段资格；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2容量环境。声明式规则具体语法、私有执行组件位置、重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合和最终数值上限仍须分别确认。
