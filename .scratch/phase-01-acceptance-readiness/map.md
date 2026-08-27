# Phase 01 验收就绪整改执行地图

Status: active

Source spec: spec.md

## Scope

本地图只安排 Phase 01 验收就绪整改，不授权业务功能、完整 POC 或正式 ABG 运行。

## Dependency sequence

01 权威覆盖矩阵 -> 02 场景证据协议 -> 03 门禁特定 producer -> 04 独立证据复核 -> 05 运行时预检生命周期 -> 06 对抗验证测试 -> 07 正式执行与 Ticket 复核

## Tickets

| Order | Ticket | Status | Dependency |
| ---: | --- | --- | --- |
| 01 | 权威 ABG 覆盖矩阵 | claimed | none |
| 02 | 场景与证据协议 | blocked | 01 |
| 03 | 门禁特定 producer | blocked | 02 |
| 04 | 独立证据复核 | blocked | 03 |
| 05 | 运行时预检生命周期 | blocked | 04 |
| 06 | 对抗验证测试 | blocked | 05 |
| 07 | 正式执行与原 Ticket 复核 | blocked | 06 and explicit execution authorization |

## Current frontier

- 01-abg-coverage-matrix.md is claimed. It establishes the machine-readable coverage authority and may not execute a formal run.
- The prior phase-01-completion browser-frontier note is historical: the baseline now contains its development assets, but no formal PostgreSQL, Keycloak, Chrome, fault, capacity, or ABG run has been accepted.

## Comments

- 2026-08-27：本地图明确采用 01 to 02 to 03 to 04 to 05 to 06 to 07 的顺序依赖。后续工作不得越过当前 Ticket。
