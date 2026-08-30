# 04 — 独立证据复核

Status: resolved

Blocked by: none

## What to build

实现独立于 producer 的证据完整性复核，核验制品摘要、JSON Pointer、门禁级断言归属、引用完整性和失败关闭结果。

## Exit condition

复核者不能以 producer 自报状态替代制品摘要、选择器或引用的独立核验。

## Comments

- 2026-08-27：等待 03。
- 2026-08-27：新增独立命令 `npm run verify:phase-01:evidence -- --evidence-dir <正式证据目录> --review-output-dir <新的复核目录>`。复核器只读取证据包和当前仓库冻结验证定义，不启动应用、PostgreSQL、Keycloak、浏览器或网络客户端。
- 2026-08-27：复核内容覆盖目录与输出边界、manifest 逐文件摘要、run plan 与冻结输入、ABG-01～ABG-40 顺序和 gate-specific assertion、selector 到具体 claim 的 JSON Pointer 解析、producer 原始制品摘要链、汇总统计与结论范围；失败关闭并在独立目录保留稳定错误码 findings。
- 2026-08-27：合成完整 40 门禁证据包通过；manifest、文件摘要/长度、缺失/额外文件、门禁/selector/claim、冻结摘要、汇总、runId、路径穿越、符号链接、已存在输出目录及原始制品篡改等用例失败。专项测试 27/27 通过，复核前后源证据逐字节摘要一致。
- 2026-08-27：已通过 verification-tooling typecheck/test、ABG coverage、仓库布局、模块边界和 `git diff --check`；未执行正式 ABG，未进入 AR-05。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `384ad60fee7742fb452876173a7ec662b22c740f`。其后终态 lifecycle、对抗夹具、冻结输入和 Podman 权威均已改变，AR-10 还将明确 reviewer provenance 与契约漂移处理；旧 27/27 评论没有覆盖该最终组合。AR-12 必须重新验证，`resolved` 不构成独立正式复核已经通过的声明。
