# 09 — 终态生命周期与 ABG-40 语义整改

Status: resolved

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

- [x] 存在明确且机器可读的运行状态机，任何 cleanup、终态 evidence 或 seal 失败都不能保留可解释为成功的权威终态。
- [x] pre-seal、sealed、seal-failed 和 independently-reviewed 结论边界明确，既有终态文件不得被覆盖或补写。
- [x] ABG-40 保持非自引用，同时不能把前 39 门禁通过单独表述为正式验收；整体 formal acceptance 仍要求成功终态和独立复核。
- [x] 中断、cleanup 失败、final evidence 写入失败和 manifest 失败均有稳定失败码及失败关闭测试。
- [x] 定向测试和静态检查通过，未运行正式 ABG。

## Comments

- 2026-08-30（AR-08 建立）：该问题来自当前代码的静态状态复核，尚未实施或运行验证；等待 AR-08 完成后方可认领。
- 2026-08-30：AR-08 已 `resolved`，AR-09 已进入当前 frontier 并认领。本次只授权终态生命周期、ABG-40 和 reviewer 生命周期整改；不授权 AR-10、AR-11、AR-12 或正式 ABG。
- 2026-08-30（AR-09 开工基线）：以下命令在任何修改前执行；`git status --short` 无输出，当前分支为 `phase-01-acceptance-readiness`，本地与 `origin/phase-01-acceptance-readiness` 的差异为 `0 0`：

  ```text
  git status --short

  git branch --show-current
  phase-01-acceptance-readiness
  git log -1 --oneline
  a2efeee docs(verification): advance acceptance frontier to AR-09
  git rev-parse HEAD
  a2efeee3eccdcd661497f2858ebd2d9d14d6f1a1
  git remote -v
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (fetch)
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (push)
  git rev-list --left-right --count origin/phase-01-acceptance-readiness...HEAD
  0       0
  ```

- 2026-08-30（AR-09 修改前缺陷复述）：以下均为静态审阅发现的**当前实现缺陷**，不是已经发生的正式运行事故：
  1. 当前 `executeFormalAbg` 在 cleanup 之前生成 formal-run preliminary conclusion。
  2. 当前 ABG-40 只证明前 39 个门禁通过。
  3. 当前 ABG-40 没有证明 cleanup `PASSED`、当前 run 零残留资源、固定端口全部释放、cleanup 后 frozen inputs 稳定、cleanup 后 verification authority 稳定，以及 evidence 具备 seal eligibility。
  4. 当前 `writeFinalEvidence` 只是将 `cleanupStatus` 追加到旧 summary。
  5. 因此当前实现存在 `abg-results.status=PASSED` 与 `cleanupStatus=FAILED` 并存的内部矛盾可能。
  6. 当前独立 reviewer 主要复核 run plan、gate proof、producer evidence 和 Manifest，没有把完整 runtime lifecycle 作为通过条件。
  7. 当前合成合法 fixture 没有完整模拟正式终态生命周期。

- 2026-08-30（AR-09 实施边界）：已按 TDD 将 lifecycle callback 拆为 cleanup 前执行、cleanup 前 producer evidence 持久化、cleanup 后终态生成和只读 Manifest 封存。新增 `phase-01.formal-terminal-conclusion.v1`，ABG-40 改为 cleanup 后精确引用 terminal lifecycle 与 seal eligibility 两个断言，正式 summary 升级为 `phase-01.abg-run.v4`，final outcome 升级为带 `sealPendingAtWrite: true` 的 v2；旧 preliminary conclusion 不再生成或接受。independent reviewer 与合成 fixture 同步覆盖完整 runtime lifecycle。本条只记录实现内容；最终状态仍等待全部限定验收与独立代码审查，不构成正式 ABG 或 Phase 01 acceptance。
- 2026-08-30（AR-09 验收与关闭）：verification-tooling typecheck、15 文件 220/220 全量测试、6 文件 43/43 lifecycle 专项、80 mutation 对抗专项（81/81 测试，detected 80/80，survived 0）、ABG coverage、仓库布局、模块边界和 `git diff --check` 均通过；合法 v4、cleanup-failed、missing-terminal 三项 standalone reviewer CLI 验证 3/3 通过。Standards 与 Spec 两轴只读复审均为 `APPROVED`。所有测试仅使用 DI、mock、fake adapter 或合成 evidence fixture；未启动 PostgreSQL、Keycloak、Chrome 或 Podman 容器，未执行 shared readiness 或正式 ABG，未触发架构停止线。AR-09 仅表示本地整改及规定验证完成，不表示 Phase 01 accepted。
- 2026-08-30（AR-10 协议影响）：AR-09 的 summary v4、terminal conclusion v1、runtime outcome v2、cleanup 后 ABG-40 及两个终态 assertion 保持不变；AR-10 只在这些终态文件上增加同一 producer source manifest digest 和 cleanup 后稳定性绑定，并将稳定性纳入 seal eligibility。Reviewer 同时区分 evidence integrity、producer provenance 与 definition drift，且不执行 producer/evidence 代码。AR-10 本地完成仍不表示正式 ABG 通过；AR-11 继续负责 Podman runtime authority、Docker 排他、restart policy 和 partial-startup hardening。本评论不改变 AR-09 的 `resolved` 状态或正式验收边界。
- 2026-08-30（AR-11协议影响）：AR-09建立的cleanup前producer落盘、cleanup后terminal conclusion、ABG-40双断言和只读Manifest seal顺序不变。为绑定单一Podman runtime authority，run plan/authority、summary、terminal conclusion和runtime outcome分别定向升级为v4/v3、v5、v2、v3；terminal及outcome现在携带同一`runtimeAuthoritySha256`、`runtimeAuthoritySemanticDigest`和cleanup后稳定性，任一漂移都取消seal eligibility。该升级不把AR-09历史结果解释为当前协议通过，也不改变本Ticket的`resolved`状态；AR-12仍须以当前HEAD真实环境重跑。
- 2026-08-30（AR-12 当前候选重验证）：初始重基线候选为 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`；不可覆盖运行目录为 `.runtime/rebaseline/ar-12/20260830-db57406-precloseout-r4`，`ar-12-rebaseline-summary.json` SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`。以下 AR-09 相关命令均为当前候选重新执行且 exit `0`：仓库根目录的 `npm run test --workspace @hospital-data-intelligence/verification-tooling`（22 files / 495 passed）、`npm run test:verification:lifecycle`（10 files / 218 passed）、`npm run test:verification:adversarial`（1 file / 142 passed；`mutationCount=140`、`detectedCount=140`、`survivedCount=0`），以及 `tooling/verification` 下的 `node ../../node_modules/vitest/vitest.mjs run src/runtime/formal-teardown-cli.test.ts`（1 file / 6 passed）。三项 terminal standalone 均使用 `node ../../node_modules/vitest/vitest.mjs run src/review-formal-abg-evidence.test.ts` 并分别追加精确的 `--testNamePattern=accepts a complete synthetic 40-gate package and leaves every source byte unchanged`、`--testNamePattern=returns a stable cleanup code for a cleanup-failed v4 fixture`、`--testNamePattern=returns a stable code when terminal conclusion is missing`，各为 1 file / 1 passed、exit `0`；其余 skip 均为聚焦选择产生的预期 skip。该 summary 明确 `formalAcceptanceEligible=false`、`formalAbgExecuted=false`、`realServicesStarted=false`；未启动 PostgreSQL、Keycloak、Chrome 或真实 Podman，未执行 shared readiness 或正式 ABG。AR-09 保持 `resolved`，这里只表示当前候选的合成/静态重验证通过，formal acceptance 继续 `pending`。
- 2026-09-01（AR-12R-05 Initial 当前候选复核）：opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 的 verification 全量为 25 files / 596 tests、lifecycle 为 10 files / 218 tests、adversarial 为 1 file / 160 tests且158/158 mutation detected、0 survived；三项 AR-09 terminal standalone 及 teardown 6/6 均通过。Initial Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`，三个运行边界字段均为 `false`。AR-09 保持 `resolved`，formal acceptance 继续 `pending`，Closeout HEAD Final 必须独立重跑。
