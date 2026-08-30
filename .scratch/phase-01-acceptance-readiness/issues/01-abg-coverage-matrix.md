# 01 — ABG-01 至 ABG-40 权威覆盖矩阵

Status: resolved

Blocked by: none

## What to build

建立以 ABG_GATES 为标题和顺序唯一来源的 TypeScript 覆盖矩阵。每项门禁须声明稳定场景、唯一门禁级断言、受控 producer、严格证据选择器、必需引用种类、冻结输入和失败关闭策略，并生成派生 Markdown 覆盖报告。

## Acceptance

- [ ] 恰好覆盖 ABG-01 至 ABG-40，顺序和 evidenceClass 与目录一致。
- [ ] 每项至少有一个真实含义的场景和唯一门禁级断言。
- [ ] 选择器、引用、冻结输入和摘要缺失时自动失败关闭。
- [ ] 不存在占位值、泛化临时场景或第二份 ABG 标题来源。
- [ ] TypeScript 单元测试和派生报告检查通过。

## Comments

- 2026-08-27：AR-01 已认领。
- 2026-08-27：AR-01 已完成；权威矩阵、派生报告和定向校验已通过，提交为 `cf1a78e` 并已推送到 `origin/phase-01-acceptance-readiness`。未执行正式 ABG。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `cf1a78ef07db70ce691dc0c4b271d5db859cd522`。其后证据协议、producer、reviewer、运行时生命周期、数据库/领域修复和 Podman 权威均发生变化，旧评论中的定向验证不能代表当前终态协议基线；AR-12 必须在 AR-09～AR-11 完成后的冻结 HEAD 重新验证。本 Ticket 的验收框保持原状，不凭旧评论补勾；`resolved` 不表示正式 accepted。
