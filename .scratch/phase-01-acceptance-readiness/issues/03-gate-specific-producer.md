# 03 — 门禁特定证据 producer

Status: blocked

Blocked by: 02 — 场景与证据协议

## What to build

将每个 ABG 门禁的 producer 输出接入已冻结的场景、断言和选择器；禁止用共享测试总体通过或 PHASE01-ABG 泛化场景替代门禁级结果。

## Exit condition

每个 producer 必须生成可由矩阵验证的门禁级证据包引用，且不得执行正式 ABG 以外的未授权外部操作。

## Comments

- 2026-08-27：等待 02。
