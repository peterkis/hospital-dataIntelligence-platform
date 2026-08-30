# 10 — Evidence provenance 与契约漂移整改

Status: ready-for-agent

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
