# 03 — 门禁特定证据 producer

Status: resolved

Blocked by: none

## What to build

将每个 ABG 门禁的 producer 输出接入已冻结的场景、断言和选择器；禁止用共享测试总体通过或 PHASE01-ABG 泛化场景替代门禁级结果。

## Exit condition

每个 producer 必须生成可由矩阵验证的门禁级证据包引用，且不得执行正式 ABG 以外的未授权外部操作。

## Comments

- 2026-08-27：等待 02。
- 2026-08-27：已实现 `phase-01.abg-gate-result.v3` 与 `phase-01.abg-run.v3`。每个门禁从覆盖矩阵和 producer evidence index 解析自己的 selector、场景、断言、JSON Pointer、直接引用和摘要；共享编排总体状态不再决定门禁通过，也不再复制四份共享完整制品到 40 个门禁目录。
- 2026-08-27：formal runner 现拒绝旧版或跨门禁结果，并在 setup 前后复核覆盖矩阵及 producer 协议身份；证据引用须留在根目录内、非符号链接、摘要/长度/媒体类型/claim 一致。ABG-40 以 39 项非自引用 preconclusion 形成自身的最小证明，避免循环自证。
- 2026-08-27：纯合成 fixture 的 26 项验证通过，覆盖 40 项独立 proof、ABG-16/37/40 专属断言缺失、FAILED/BLOCKED、错误 selector/producer/gate、缺失引用与冻结摘要、摘要篡改、路径穿越、符号链接、目标重用和 40 项相同 selector 集合；未启动 PostgreSQL、Keycloak 或 Chrome，未执行正式 ABG，未更新原 Phase 01 Ticket。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `2f6315bea64cea253e3be54dea81f6efcaab463f`。其后 reviewer、终态 lifecycle、业务/迁移冻结输入和 Podman 运行路径均发生变化，且 AR-09 将重新处理终态语义与 ABG-40；原 26 项合成验证不能替代最新协议重跑。AR-12 必须重新验证，本 Ticket 不得据此标为正式 accepted。
- 2026-08-30（AR-09 历史影响）：AR-09 保留 ABG-01～ABG-39 的 gate-specific producer 语义，但废止 ABG-40 的旧 preliminary conclusion 来源。ABG-40 改为 cleanup 后由 formal-run producer 精确引用 `runtime/terminal-conclusion.json` 的 terminal lifecycle 与 seal eligibility 两个断言；这只证明预封存资格，不改变本 Ticket 的历史 `resolved` 含义，也不等于正式验收完成。
