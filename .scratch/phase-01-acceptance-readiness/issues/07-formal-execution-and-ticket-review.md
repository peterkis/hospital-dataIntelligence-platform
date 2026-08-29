# 07 — 正式执行与原 Ticket 复核

Status: blocked

Blocked by: 06 — 对抗验证测试；以及明确的正式执行授权

## What to build

在全部前置 Ticket 验收后，执行一次新的正式验证运行，独立复核其不可覆盖证据，并只在证据充分时向原 Phase 01 Ticket 追加 Comments 和更新状态。

## Exit condition

不得在无正式运行证据时关闭任何原 Ticket；不得覆盖既有终态证据或把运行结论扩展为完整 POC 或生产就绪。

## Comments

- 2026-08-27：本 Ticket 不授权当前 AR-01 执行正式 ABG。
- 2026-08-29：Stage 1 空库启动在`0008_versioned_approval_workflow.sql`失败，PostgreSQL返回`SQLSTATE 22001`；`CAMPUS_CONFIRM_REVIEW_OWNER_FINAL`为33字符，而工作流持久列仅为`varchar(32)`。架构确认选择物理容量修复：在尚未进入正式证据包的`0008`中，将`approval_template_version.stage_type`、`approval_action.stage_type`和`approval_template_stage.stage_type`统一为`varchar(64)`，保留全部现有稳定阶段标识、CHECK集合、审批阶段顺序和职责分离语义不变。该修复服从ADR-0070的原生SQL Schema权威，不构成ADR-0091所治理的投影Schema契约升级；AR-07仍须以新候选提交从Stage 0完整重跑，本注记不代表readiness、正式ABG或独立复核通过。
