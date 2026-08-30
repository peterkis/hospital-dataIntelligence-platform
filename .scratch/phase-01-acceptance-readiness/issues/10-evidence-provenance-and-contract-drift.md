# 10 — Evidence provenance 与契约漂移整改

Status: claimed

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

- [ ] Evidence 明确冻结 producer commit、authority identity 和必需工具/协议摘要，reviewer 明确记录自身 commit 与工具身份。
- [ ] Producer 与 reviewer 定义不一致时产生稳定、可定位的 contract-drift 结论，不静默替换语义，也不误称 evidence 已正式通过。
- [ ] Review 结果绑定 source manifest SHA、终态协议版本和复核前后相同的 source tree identity，并保存在独立不可覆盖目录。
- [ ] 兼容与不兼容 schema/version 路径均有失败关闭测试；reviewer 不执行 evidence 内代码。
- [ ] 定向测试和静态检查通过，未运行正式 ABG。

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
