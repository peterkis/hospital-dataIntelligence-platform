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
