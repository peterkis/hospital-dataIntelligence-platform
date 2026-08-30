# Phase 01 验收就绪整改执行地图

Status: active

Source spec: spec.md

## Scope

本地图只安排 Phase 01 验收就绪整改，不授权业务功能、完整 POC 或正式 ABG 运行。

## Dependency sequence

AR-01 权威覆盖矩阵
→ AR-02 场景证据协议
→ AR-03 门禁特定 producer
→ AR-04 独立证据复核
→ AR-05 运行时预检生命周期
→ AR-06 对抗验证测试
→ AR-08 状态与基线协调
→ AR-09 终态生命周期与 ABG-40
→ AR-10 evidence provenance 与契约漂移
→ AR-11 Podman 运行时权威加固
→ AR-12 对抗回归与重基线
→ AR-07 正式执行与原 Ticket 复核

## Tickets

| Order | Ticket | Status | Dependency |
| ---: | --- | --- | --- |
| 01 | AR-01 权威 ABG 覆盖矩阵 | resolved | none；AR-12 重新验证 |
| 02 | AR-02 场景与证据协议 | resolved | AR-01 已满足；AR-12 重新验证 |
| 03 | AR-03 门禁特定 producer | resolved | AR-02 已满足；AR-12 重新验证 |
| 04 | AR-04 独立证据复核 | resolved | AR-03 已满足；AR-12 重新验证 |
| 05 | AR-05 运行时预检生命周期 | resolved | AR-04 已满足；AR-12 重新验证 |
| 06 | AR-06 对抗验证测试 | resolved | AR-05 已满足；AR-12 重新验证 |
| 07 | AR-08 状态与基线协调 | resolved | AR-06 已满足 |
| 08 | AR-09 终态生命周期与 ABG-40 | resolved | AR-08 已满足；本地整改及限定验证完成 |
| 09 | AR-10 evidence provenance 与契约漂移 | resolved | AR-09 已满足；本地整改及限定验证完成 |
| 10 | AR-11 Podman 运行时权威加固 | claimed | AR-10 已满足；当前 frontier，已认领 |
| 11 | AR-12 对抗回归与重基线 | ready-for-agent | blocked by AR-11 |
| 12 | AR-07 正式执行与原 Ticket 复核 | blocked | blocked by AR-12 and explicit formal execution authorization |

## Current frontier

- Current frontier 为 `AR-11`。本轮只实施已认领的 AR-11；AR-12 继续 blocked by AR-11，AR-07 继续 blocked by AR-12 和另行正式执行授权。
- AR-01～AR-06 的实现提交和旧定向验证评论保留，但 Prompt 1～Prompt 6 尚未在最新终态协议和 Podman 权威下完成 AR-12 重新验证。
- Podman 运行时工作包仍为 `ready-for-human`；AR-11 完成并经人工复核前不得解除该边界。
- AR-07 为 `blocked by AR-12`，并继续要求另行正式执行授权。

## Baseline snapshot

- Snapshot date: 2026-08-30。
- `main`: `c4396bec80f27446ebcc4561724603c4ed584abc`。
- `phase-01-acceptance-readiness`: `5fc00d043dfbad213d647edae7be6df11016ba8a`；与 `origin/phase-01-acceptance-readiness` 同步，作为 AR-08 开工基线记录。
- 正式候选尚未冻结；AR-08 文档变更不构成正式 candidate freeze。
- 未运行新的正式 ABG；既有迁移、定向测试或 dry-run 结果均不构成正式验收。

## Comments

- 2026-08-27：本地图明确采用 01 to 02 to 03 to 04 to 05 to 06 to 07 的顺序依赖。后续工作不得越过当前 Ticket。
- 2026-08-30：AR-08 将依赖顺序改为 AR-01 → AR-02 → AR-03 → AR-04 → AR-05 → AR-06 → AR-08 → AR-09 → AR-10 → AR-11 → AR-12 → AR-07；旧顺序作为历史评论保留。
- 2026-08-30：AR-08 复核完成并转为 `resolved`；AR-09 转为 `claimed` 并成为 current frontier。AR-10 继续由 AR-09 阻断，AR-07 继续由 AR-12 和另行正式执行授权阻断。
- 2026-08-30：AR-09 终态 lifecycle 与 ABG-40 整改通过限定验收并转为 `resolved`；current frontier 推进到 AR-10，AR-10 仍为 `ready-for-agent` 且本轮未执行。AR-07 继续由 AR-12 和另行正式执行授权阻断。
- 2026-08-30：AR-10 在开工 Git/Ticket 门禁全部满足后转为 `claimed` 并保持 current frontier；本轮不认领 AR-11、AR-12 或 AR-07，不执行正式 ABG。
- 2026-08-30：AR-10 完成 producer/evidence/reviewer provenance、contract compatibility、definition drift 和 review output seal 的本地实现及限定验证，转为 `resolved`；current frontier 推进到仍为 `ready-for-agent` 且未认领的 AR-11。AR-07 继续阻断于 AR-12 和另行正式执行授权，未执行正式 ABG。
- 2026-08-30：AR-11 在开工 Git/Ticket 门禁全部满足后转为 `claimed` 并保持 current frontier；AR-12 继续 blocked by AR-11，AR-07 继续 blocked by AR-12 和另行正式执行授权。本轮不执行真实服务、shared readiness 或正式 ABG。
