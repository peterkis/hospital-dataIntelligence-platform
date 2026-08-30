# 08 — 工作包状态与验证基线协调

Status: resolved

Blocked by: none

## What to build

统一 acceptance-readiness spec、执行地图、AR-01～AR-07 和 Podman 工作包的状态语义，建立 Implementation、Verification、Formal acceptance 三层结论；记录当前 Git 基线并新增 AR-09～AR-12 的顺序依赖。

## Why

旧地图仍把 AR-01 视为 frontier，而 AR-01～AR-06 已标记 `resolved`、AR-07 曾进入执行、Podman 又替代了原运行时。若不先协调，旧提交上的定向测试、当前实现完成和正式验收会被错误合并。

## Scope

- `.scratch/phase-01-acceptance-readiness/` 下的 spec、map 和 AR-01～AR-12 Ticket。
- `.scratch/phase-01-podman-runtime/spec.md` 的只追加状态复核评论。
- 记录 AR-08 开工时 `main` 与 `phase-01-acceptance-readiness` SHA、候选冻结状态和正式 ABG 状态。

## Non-goals

- 不修改 TypeScript、Podman shell、数据库迁移、OpenAPI 或生成客户端。
- 不启动 PostgreSQL、Keycloak、Chrome、Podman 容器或正式 ABG。
- 不修改原 Phase 01 completion 的 21 个 Ticket，不执行 AR-09。

## Acceptance criteria

- [x] AR-08 实施完成时，spec、map 和 AR-01～AR-12 的状态与依赖一致，current frontier 为 AR-08；本次复核状态跃迁后推进为 AR-09。
- [x] AR-07 明确 `blocked by AR-12`，且仍需要另行正式执行授权。
- [x] 三层状态语义明确；`resolved` 不得解释为 Phase 01 正式 accepted。
- [x] AR-01～AR-06 各自记录实现提交、基线影响和 AR-12 重新验证要求，不凭旧评论补勾验收框。
- [x] Podman 工作包保持 `ready-for-human`，未执行真实服务或正式 ABG。

## Comments

- 2026-08-30：在干净且与远端同步的 `phase-01-acceptance-readiness` 分支认领；开工 HEAD 为 `5fc00d043dfbad213d647edae7be6df11016ba8a`。本 Ticket 完成后停止，等待复核，不进入 AR-09。
- 2026-08-30（复核完成）：实现提交为 `7ae3541af4c26b5efcd1c89edf1a56e8c5730029`；文档一致性检查、`git diff --check` 检查和两轮 code review 均通过，0 findings。未执行正式 ABG 或真实服务；`resolved` 仅表示本地整改任务完成，不代表 Phase 01 正式验收。
