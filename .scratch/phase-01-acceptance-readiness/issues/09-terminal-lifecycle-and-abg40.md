# 09 — 终态生命周期与 ABG-40 语义整改

Status: claimed

Blocked by: AR-08 — 工作包状态与验证基线协调（已 `resolved`；保留为历史依赖）

## What to build

为正式运行定义无循环、失败关闭的终态生命周期，协调 pre-seal outcome、manifest seal、seal failure、cleanup 与 ABG-40 的证据语义；明确 40/40、终态完成和正式验收是不同结论。

## Why

现行结构在 evidence seal 前写入 `sealPendingAtWrite: true`，而 ABG-40 的 preconclusion 只聚合前 39 个门禁。若 cleanup、final evidence 或 seal 随后失败，门禁结果与运行终态可能产生歧义；该问题必须在新正式候选冻结前解决。

## Scope

- 正式运行状态机、终态 evidence、manifest/seal 失败语义和稳定错误码。
- ABG-40 的非自证边界、preconclusion 角色及其与运行终态的关系。
- 对 cleanup、final-evidence write、manifest seal 和中断路径的定向/对抗性测试。

## Non-goals

- 不改变 ABG-01～ABG-39 的领域断言或业务行为。
- 不修改数据库迁移、冻结 OpenAPI 或生成客户端。
- 不执行正式 ABG，不关闭原 Phase 01 Ticket。

## Acceptance criteria

- [ ] 存在明确且机器可读的运行状态机，任何 cleanup、终态 evidence 或 seal 失败都不能保留可解释为成功的权威终态。
- [ ] pre-seal、sealed、seal-failed 和 independently-reviewed 结论边界明确，既有终态文件不得被覆盖或补写。
- [ ] ABG-40 保持非自引用，同时不能把前 39 门禁通过单独表述为正式验收；整体 formal acceptance 仍要求成功终态和独立复核。
- [ ] 中断、cleanup 失败、final evidence 写入失败和 manifest 失败均有稳定失败码及失败关闭测试。
- [ ] 定向测试和静态检查通过，未运行正式 ABG。

## Comments

- 2026-08-30（AR-08 建立）：该问题来自当前代码的静态状态复核，尚未实施或运行验证；等待 AR-08 完成后方可认领。
- 2026-08-30：AR-08 已 `resolved`，AR-09 已进入当前 frontier 并认领。本次只授权终态生命周期、ABG-40 和 reviewer 生命周期整改；不授权 AR-10、AR-11、AR-12 或正式 ABG。
