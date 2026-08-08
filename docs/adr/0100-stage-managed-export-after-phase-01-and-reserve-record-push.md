---
status: accepted
extends: 0099
clarifies: 0068
---

# Phase 01只验证快照拉取，受控导出延后为完整POC邻接薄切

Phase 01继续只实现并验证`SNAPSHOT_PULL`，以现有收费项目—价表—解析—审计—仿真消费纵向切片通过ABG-01至ABG-40；本阶段不实现`MANAGED_EXPORT_HANDOFF`或`RECORD_PUSH`，不预建消费者交付配置编辑能力、受控导出转换与制品adapter、逐记录推送adapter或相关未使用port，也不因本决策增加Phase 01门禁。

全部Phase 01架构门禁通过后，完整POC扩展把`MANAGED_EXPORT_HANDOFF`作为邻接薄切纳入同一工程基线。该薄切必须以固定规范快照、冻结消费者交付配置、不可变非权威派生制品、下载或交接证据、消费者回执、对账和检查点形成完整闭环，不能退化为静态文件或界面演示；但只连接合成仿真消费者，只允许[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)已确认的默认受控表示转换，不启用任何高风险语义转换，也不连接真实厂商或真实消费系统。

`RECORD_PUSH`继续只保留长期架构模型、对象边界和扩展接缝，不进入Phase 01或本次完整POC，不实现逐记录进度、第三方HTTP推送、暂存激活或接口幂等能力。模式归属仍统一在`release-distribution`深模块内，不因阶段拆分新服务或workspace。

本决策只冻结阶段归属，不重排现有A01至F08共60个REST场景和U01至U16共16个界面场景。[ADR-0101](0101-expand-managed-export-acceptance-baseline-to-72-rest-and-20-ui-scenarios.md)在此基础上为受控导出新增G01至G12和U17至U20，把完整POC验收基线固定为72个REST场景和20个界面场景；[ADR-0102](0102-retry-transient-managed-export-failures-within-the-same-frozen-job.md)进一步把瞬时技术故障恢复加入G05和U19，[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)把确定性ZIP格式加入G05、G06和U18，[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)把完整POC的PostgreSQL原子存储加入G05、G06、G07、G12和U18，[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)把保留、取代、禁止选择性删除加入G05、G07、G12和U18，[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)把容量先测后定和超限失败关闭加入实施前置及G04、G05、G12、U19参数化验证，[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)进一步把前置可行性实验置于实施前、把真实链路核验置于薄切集成后且最终验收前，[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结七类容量画像且明确Phase 01不预建画像生成器或fixture，[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结逐字段分布且明确Phase 01不预建字段分布资产，[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2容量环境及非生产证据边界，均不改变72/20或Phase 01门禁。声明式规则语法、私有执行组件位置，以及重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合和数值上限仍继续分别确认。
