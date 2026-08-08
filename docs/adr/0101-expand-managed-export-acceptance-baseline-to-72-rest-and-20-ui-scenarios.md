---
status: accepted
extends: 0100
clarifies: 0065
---

# 完整POC采用72个REST场景和20个界面场景

完整POC保留A01至F08共60个既有REST场景和U01至U16共16个既有界面端到端场景，不替换、不抵扣也不重排；为`MANAGED_EXPORT_HANDOFF`邻接薄切新增G01至G12共12个REST场景和U17至U20共4个界面场景，使完整POC强制验收基线固定为72个REST场景和20个界面场景。一个编号可以包含明确列出的参数化子用例，但任一必需子用例失败即判定该编号失败，不能用参数化、场景复用、总体成功率或人工说明减少16个新增编号。

G组必须分别覆盖消费者交付配置的稳定身份、不可变版本和精确来源契约，来源领域Owner前置确认与集成交付Owner终审，默认表示转换及禁止能力的失败关闭，作业对来源发布、规范快照、消费者、订阅和配置版本的冻结，确定性生成且一作业一份不可变非权威派生制品，独立摘要、记录数、清单及非权威标识，对象级发起与下载/交接授权，下载或交接证据与消费者应用回执分离，任一记录转换失败时整作业失败并保持零制品，修正形成新版本及新作业，回执—对账—检查点闭环，以及历史复现和新版不自动传播。U17至U20分别覆盖配置版本治理、成功导出与交接、转换失败与新作业修正、回执对账与检查点闭环。

新增场景只连接合成仿真消费者，只执行已确认的默认受控表示转换，不启用高风险语义转换、不连接真实厂商或真实消费系统，也不实现`RECORD_PUSH`。72/20必须在同一冻结契约、真实依赖、不可覆盖SHA-256证据包和统一通过口径下执行，任一场景失败即阻断完整POC验收；本决策不改变Phase 01的ABG-01至ABG-40，也不决定派生制品容量或声明式规则语法。[ADR-0102](0102-retry-transient-managed-export-failures-within-the-same-frozen-job.md)在不改变72/20总量的前提下，为G05和U19增加同一冻结作业内瞬时技术故障有限重试的必需子用例；[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)同样在不改变总量的前提下，为G05、G06和U18增加确定性无压缩ZIP、内置清单与外置完整制品摘要的必需子用例；[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)为G05、G06、G07、G12和U18增加完整POC PostgreSQL `bytea`、短事务原子提交、平台受控获取及无平行存储的必需子用例；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)为G05、G07、G12和U18增加保留、取代、权限与存在性分离以及禁止选择性删除的必需子用例；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)要求在受控导出实施前完成代表性容量实验并由后续ADR冻结数值，超限失败关闭行为复用既有场景作参数化验证；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)要求前置隔离实验只支撑实施上限，集成后真实链路核验才授予最终验收资格，两阶段证据加入G04、G05、G12和U19参数化子用例；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)把七类画像及其精确最终CSV数据行数、fixture隔离、有限字符串上限和同版本两阶段证据加入相同四个场景的必需参数化子用例；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)把逐字段70%/30%非空、文本70%/25%/5%及目标长度、`W50` 100%/90%、`E50`五类各20%、显式字段资格和失败关闭加入G05、G12及U19的必需参数化断言。完整POC环境整体处置只在证据包导出复核后作为受控收尾程序执行；上述扩展均不新增业务场景编号。
