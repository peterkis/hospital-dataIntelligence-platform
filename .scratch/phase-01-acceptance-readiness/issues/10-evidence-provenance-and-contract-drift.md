# 10 — Evidence provenance 与契约漂移整改

Status: resolved

Blocked by: AR-09 — 终态生命周期与 ABG-40 语义整改

## What to build

冻结 producer、证据包和独立 reviewer 各自的可核验 provenance，定义 reviewer checkout、覆盖矩阵、协议/schema、gate proof 与终态契约发生漂移时的失败关闭行为，并把复核结果绑定到精确 source manifest。

## Why

现行 reviewer 会读取执行 reviewer 时当前 checkout 的验证定义。若它与证据 producer 的冻结提交不同，必须显式区分“证据无效”“reviewer 契约不兼容”和“待审定义漂移”，不能静默用当前源码替代生产时权威或把漂移误报为正式通过。

## Scope

- Producer-time Git/authority identity、协议与工具源码摘要。
- Reviewer-time Git/tool identity、兼容性判断和稳定 drift findings。
- AR-09 终态证据、manifest SHA、源 evidence tree 与独立 review 输出之间的绑定。
- 对矩阵、协议、schema、reviewer 工具和 source manifest 漂移的对抗性测试。

## Non-goals

- 不让 evidence 包携带或执行不可信代码。
- 不允许 reviewer 修改、修补或覆盖 source evidence。
- 不执行正式 ABG，不修改业务、迁移、OpenAPI 或生成客户端。

## Acceptance criteria

- [x] Evidence 明确冻结 producer commit、authority identity 和必需工具/协议摘要，reviewer 明确记录自身 commit 与工具身份。
- [x] Producer 与 reviewer 定义不一致时产生稳定、可定位的 contract-drift 结论，不静默替换语义，也不误称 evidence 已正式通过。
- [x] Review 结果绑定 source manifest SHA、终态协议版本和复核前后相同的 source tree identity，并保存在独立不可覆盖目录。
- [x] 兼容与不兼容 schema/version 路径均有失败关闭测试；reviewer 不执行 evidence 内代码。
- [x] 定向测试和静态检查通过，未运行正式 ABG。

## Comments

- 2026-08-30（AR-08 建立）：该 Ticket 只登记 provenance/契约漂移整改依赖；尚未修改 reviewer 或证据协议，等待 AR-09。
- 2026-08-30（AR-10 修改前问题定义）：以下均为静态审阅识别的**当前设计缺口**，不是已经发生的正式证据事故：
  1. 正式证据已经保存 producer Git SHA、部分 authority identity、协议版本和源文件摘要，但这些信息尚未形成一个完整、单独、可核验的 producer source manifest。
  2. 当前 reviewer 会使用执行 reviewer 时当前 checkout 中的覆盖矩阵、协议和验证器代码来解释旧证据。
  3. 当 producer commit 与 reviewer 当前 checkout 不同时，当前实现尚不能清晰区分 evidence 自身被篡改或内部不一致、producer provenance 无法核验、reviewer 不支持该 evidence contract、producer 定义与 reviewer 当前定义发生漂移，以及 reviewer 自身工作区或工具定义不稳定。
  4. Reviewer 不得静默以当前源码替代 producer 运行时的权威定义。
  5. 不得仅因为新 reviewer 能解析旧 JSON，就把定义已经漂移的 evidence 结论标为正式 `PASSED`。
  6. Evidence 包不得携带并执行 producer 的 TypeScript、JavaScript、Shell 或其他代码。
  7. AR-09 已经建立 terminal conclusion、ABG-40、summary v4 和 runtime outcome v2；AR-10 必须保持这些终态语义，不得退回 preliminary conclusion。
- 2026-08-30（AR-10 开工基线）：以下命令在任何实现修改前执行；`git status --short` 无输出，当前分支为 `phase-01-acceptance-readiness`，本地与 `origin/phase-01-acceptance-readiness` 的差异为 `0 0`：

  ```text
  git status --short

  git branch --show-current
  phase-01-acceptance-readiness
  git log -1 --oneline
  f041f04 fix(verification): bind ABG-40 to terminal runtime lifecycle
  git rev-parse HEAD
  f041f048f2261dea68725cfcbea02e467e4e85c0
  git remote -v
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (fetch)
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (push)
  git rev-list --left-right --count origin/phase-01-acceptance-readiness...HEAD
  0       0
  ```

- 2026-08-30（AR-10 实施边界）：AR-09 已 `resolved`，本 Ticket 已认领且为 current frontier。本轮只实施 producer/evidence/reviewer provenance、contract tuple/compatibility、definition drift、review output seal 与相应合成/对抗测试；不授权 AR-11、AR-12、AR-07、shared readiness 或正式 ABG。
- 2026-08-30（AR-10 完成）：实现提交为 `22d09d4be007dd7aa34c821d0a9add808b05fe08`（`feat(verification): bind evidence review to source provenance`）。统一 current evidence contract tuple 保持 run plan v3 / authority v2 / producer evidence v2 / producer index v2 / gate result v3 / run summary v4 / terminal conclusion v1 / runtime outcome v2 / evidence manifest v1；新增 source manifest v1、review v2、review manifest v1 和 compatibility policy v1，未提升 AR-09 的既有终态版本。
- 2026-08-30（AR-10 provenance 结果）：producer/reviewer 使用同一 35 文件、28 角色权威注册表；clean-HEAD source-manifest 自检通过并绑定每个 Git blob。Reviewer 从实际 evidence 提取 tuple，使用本地 Git object 只读核验 producer commit/blob，前后双捕获 reviewer 状态，并实现 `EXACT`、`COMPATIBLE`、`INCOMPATIBLE`、六个独立状态轴、稳定 findings 及独立 review output manifest。五条 standalone CLI 分别得到 exact `PASSED/VERIFIED/EXACT/NONE/CLEAN`、内部篡改 `FAILED`、commit unavailable `UNVERIFIABLE`、compatible drift `COMPATIBLE/DRIFTED`、unknown tuple `INCOMPATIBLE`；五条 source evidence tree 复核前后均一致。
- 2026-08-30（AR-10 验证）：typecheck exit 0；verification workspace 为 18 files / 290 tests；lifecycle 为 6 files / 46 tests；provenance 为 4 files / 90 tests；adversarial 为 1 file / 112 tests，`mutationCount=110`、`detectedCount=110`、`survivedCount=0`。`verify:verification-source-manifest`、`verify:abg-coverage`、repo layout、module boundaries、`git diff --check` 均 exit 0；Standards 与 Spec 双轴只读 review 均 `APPROVED`。
- 2026-08-30（AR-10 边界结论）：未执行 evidence 内代码，未启动 PostgreSQL、Keycloak、Chrome、Podman 容器或其他真实服务，未执行 shared readiness 或正式 ABG，未触发业务架构停止线。AR-10 的 `resolved` 只表示本地整改和规定验证完成，不表示 Phase 01 正式验收通过；AR-11 仍负责运行时权威加固。
- 2026-08-30（AR-11协议影响）：AR-10历史完成时的35文件清单事实保持不变；当前registry扩展为43个Git-blob绑定文件，新增或纳入runtime authority provisioning、`RUNTIME_AUTHORITY`文件、严格loader/schema、authority verify CLI、三只生命周期脚本、Testcontainers集成producer、live producer和非authority `RUNTIME_RECEIPT`。Receipt与`.observations`进入provenance不等于取得运行权威；正式期望只来自`runtime-baseline.lock.json`的`.authority`。因新增reader-visible runtime identity字段，run plan/authority、summary、terminal conclusion及runtime outcome分别定向升级为v4/v3、v5、v2、v3，producer evidence、gate result、evidence manifest及review协议版本保持不变。Reviewer继续要求同一source manifest、Git object provenance、`EXACT`契约和clean worktree；本条不改变AR-10的`resolved`边界，也不表示正式ABG已运行。
- 2026-08-30（AR-12 当前候选重验证）：初始重基线候选为 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`；不可覆盖运行目录为 `.runtime/rebaseline/ar-12/20260830-db57406-precloseout-r4`，`ar-12-rebaseline-summary.json` SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`。当前候选重新执行 `npm run verify:verification-source-manifest`（43 个 Git-blob 绑定 source files，`sourceFilesDigest=48a6fd9a67f13a02df0bb46b56ddcbb87b1b78765e488e364155062d83365415`）、`npm run test:verification:provenance`（4 files / 93 passed）、`npm run test --workspace @hospital-data-intelligence/verification-tooling`（22 files / 495 passed）和 `npm run test:verification:adversarial`（1 file / 142 passed；140/140 mutation detected、0 survived），全部 exit `0`。EXACT、producer commit unavailable、compatible drift、unsupported tuple 四项分别在 `tooling/verification` 下使用 `node ../../node_modules/vitest/vitest.mjs run src/review-formal-abg-evidence.test.ts` 并追加精确的 `--testNamePattern=accepts the exact contract through the public reviewer seam without host Git coupling`、`--testNamePattern=distinguishes an unavailable producer commit from evidence tampering`、`--testNamePattern=classifies parseable definition drift as compatible but never passed`、`--testNamePattern=limits an unknown tuple to incompatible envelope review`；各为 1 file / 1 passed、exit `0`，其余 skip 均为聚焦选择产生的预期 skip。内部篡改场景以 `node --import tsx --input-type=module --eval` 运行完整的合成 tamper assertion，精确 argv 保存在 `commands/36-ar10-evidence-tamper-observed/command.json`，exit `0`，观察值为 `evidenceIntegrityStatus=FAILED`、`producerProvenanceStatus=VERIFIED`、`reviewStatus=FAILED`。五项 AR-10 standalone 均符合预期。该 summary 明确 `formalAcceptanceEligible=false`、`formalAbgExecuted=false`、`realServicesStarted=false`；未执行 evidence 内代码、真实服务、shared readiness 或正式 ABG。AR-10 保持 `resolved`，formal acceptance 继续 `pending`。
- 2026-09-01（AR-12R-05 Initial 当前候选复核）：opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 的 source manifest 为46 files、`sourceFilesDigest=6f4d3c25c1a6079a70db98117186b2f3ec327470927f2fa384b0329abfa1bbc9`，provenance 为4 files / 94 tests，五项 AR-10 standalone 均通过；contract tuple 与统一版本常量完全一致。Initial Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`。未执行 evidence 内代码、真实服务、shared readiness 或正式 ABG；AR-10 保持 `resolved`，formal acceptance 继续 `pending`。
