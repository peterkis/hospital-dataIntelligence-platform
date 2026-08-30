# 12 — 对抗回归与 Prompt 1～Prompt 6 重基线

Status: ready-for-agent

Blocked by: none — AR-11 已满足；本任务未认领或授权执行 AR-12

## What to build

在 AR-09～AR-11 完成后的冻结 HEAD 上，重新执行并留存 AR-01～AR-06 规定的定向单元、类型、静态和对抗性验证；建立最新终态协议、reviewer provenance 与 Podman 权威共同适用的稳定验证基线。

## Why

AR-01～AR-06 的旧评论分别绑定旧提交。之后迁移、生成类型、时间语义、领域实现和容器权威均已变化，AR-09～AR-11 还会继续修改验证协议；只有统一重跑才能决定 AR-07 是否具备解除技术阻断的条件。

## Scope

- 冻结当前 HEAD、覆盖矩阵、证据协议、reviewer、运行时基线和相关输入摘要。
- 重跑 Prompt 1～Prompt 6 的规定检查，以及 AR-09～AR-11 新增的终态、漂移和 Podman 对抗回归。
- 记录命令、退出码、测试计数、mutation count/detected/survived 和稳定产物摘要。
- 向 AR-01～AR-06、AR-09～AR-11 与地图追加重基线结果及 AR-07 阻断处置建议。

## Non-goals

- 不沿用旧 summary 或旧提交评论替代本次执行。
- 不执行正式 ABG、独立正式 evidence acceptance 或关闭原 Phase 01 completion Ticket。
- 不自动解除 Podman `ready-for-human`；人工复核缺失时必须保持阻断。

## Acceptance criteria

- [ ] 所有适用定向、类型、静态与对抗性检查均在同一冻结 HEAD 执行，命令、退出码、计数和产物摘要可核验。
- [ ] Prompt 1～Prompt 6 以及 AR-09～AR-11 的失败关闭路径全部重跑；对抗 mutation `survivedCount` 为 0。
- [ ] AR-01～AR-06 的 Verification status 更新为新基线事实，但不得改写为 Formal acceptance。
- [ ] Podman 工作包已完成 AR-11 后人工复核；否则 AR-12 失败关闭且 AR-07 继续 blocked。
- [ ] 只有全部重基线检查通过时才建议将 AR-07 的技术依赖视为满足；AR-07 仍须另行正式执行授权并使用新的 candidate/run identity。

## Comments

- 2026-08-30（AR-08 建立）：本 Ticket 是解除 AR-07 技术阻断前的最后重基线步骤；尚未执行任何测试、真实服务或正式 ABG，等待 AR-11。
- 2026-08-30（AR-11 closeout）：AR-11 已完成并转为 `resolved`，本 Ticket 的上游依赖已满足，成为仍未认领的 current frontier。该状态变化不构成执行授权；本轮没有冻结 AR-12 candidate、没有启动真实 Anolis/Podman 重基线，也没有执行 shared readiness 或正式 ABG。
