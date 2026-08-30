# 02 — 场景与证据协议

Status: resolved

Blocked by: none

## What to build

把矩阵中的场景、断言、引用、制品定位和状态编码形成可供静态、集成、实时和浏览器 producer 使用的正式证据协议。

## Exit condition

协议必须由已接受的矩阵驱动，不能自行新增 ABG 标题、替换门禁级断言或放宽失败关闭规则。

## Comments

- 2026-08-27：等待 01 的矩阵和校验结果。
- 2026-08-27：已实现 `phase-01.producer-evidence.v2` 与 producer evidence index；static、database、integration、live、browser、fault、consumer、capacity 和 formal-run 采用同一结构。共享编排只记录编排状态，门禁仍由矩阵选择的场景、断言、引用和制品证据失败关闭决定。
- 2026-08-27：已为集成故障写点、16 MiB 边界、实时汇总和 Playwright metadata 接入稳定观察；协议/录制器/adapter 单测 20 项通过，覆盖重复 ID、矩阵不匹配、严格 JSON Pointer、摘要/占位符、路径与覆盖、符号链接、敏感字段和子进程失败记录。
- 2026-08-27：已执行定向类型、协议测试、E2E 场景列举、覆盖报告、仓库布局和模块边界检查；未启动 PostgreSQL、Keycloak 或 Chrome，未执行正式 ABG，也未修改原 Phase 01 Ticket 状态。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `5f59fd611cc7195365505b217f64d12f917a7d60`。其后 gate proof、独立 reviewer、终态生命周期、冻结输入和 Podman 运行时消费者均已变化，协议与最新消费者的组合尚未形成 AR-12 稳定重基线产物；AR-12 必须重新执行规定的定向验证。当前 `resolved` 只保留本地实现和原提交验证含义，不表示正式 accepted。
- 2026-08-30（AR-12 重基线复核）：Implementation status 保持 `resolved`；Verification status 在候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 上记为 `passed`。`npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/evidence` 退出码为 `0`，结果为 3 files / 16 tests passed、0 failed、0 skipped；覆盖协议消费者的 `npm run test --workspace @hospital-data-intelligence/verification-tooling` 退出码也为 `0`，结果为 22 files / 495 tests passed、0 failed、0 skipped。不可覆盖汇总 `ar-12-rebaseline-summary.json` 的 SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；该汇总明确记录 `formalAcceptanceEligible=false`、正式 ABG 未执行。Formal acceptance status 仍为 `pending`；本结果不证明真实运行时验收或生产就绪。
