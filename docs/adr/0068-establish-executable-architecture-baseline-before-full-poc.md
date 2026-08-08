---
status: accepted
extended_by: 0069
---

# 完整POC扩展前先建立可执行架构基线

在技术中立详细设计完成后，下一阶段定义为“POC可执行架构基线阶段”：先打通收费项目输入与治理、价表完整发布、价格解析、只追加审计、事务Outbox和仿真消费回执的一条纵向切片，并以阻断性架构门禁验证公共治理内核、事务边界和服务契约确实可执行；只有门禁全部通过后，才在同一工程基线上扩展全部POC对象及完整验收范围。该顺序拒绝先完成全量DDL、横向铺开所有模块或提前建设生产部署设施，因为这些方案会在核心不变量尚未被运行验证前放大返工和伪集成风险；基线通过也不得被表述为完整POC或生产验收通过。

[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)进一步限定交付模式的阶段顺序：Phase 01纵向切片只实现`SNAPSHOT_PULL`，门禁通过后的完整POC才加入`MANAGED_EXPORT_HANDOFF`邻接薄切，`RECORD_PUSH`继续只作长期预留。[ADR-0101](0101-expand-managed-export-acceptance-baseline-to-72-rest-and-20-ui-scenarios.md)把完整POC验收基线固定为72个REST场景和20个界面场景，但不向Phase 01的ABG-01至ABG-40增加门禁。
