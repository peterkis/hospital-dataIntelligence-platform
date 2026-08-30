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
- 2026-08-30（AR-09 历史影响）：independent reviewer 的通过条件扩展到 Manifest 中完整列出并逐字节验证 preflight、started/final resources、producer snapshot、failure summary、cleanup、terminal conclusion、final outcome、ABG-40 proof、formal-run producer evidence 和顶层 producer index；同时复核身份一致性、零残留/端口释放、终态断言、summary/final-outcome 一致性以及源 evidence 复核前后字节身份。Reviewer 仍只读、不启动服务、不自动修复；AR-10 的 provenance/contract drift 仍未实施，本评论不改变本 Ticket 的正式验收边界。
- 2026-08-30（AR-10 协议影响）：independent reviewer 现在分别记录 evidence integrity、producer provenance、reviewer contract、definition drift、reviewer worktree 和最终 review 状态。它先从 evidence 实际文件提取 tuple 并核验 Manifest/交叉摘要，再用本地 Git object 只读验证 producer commit 与各 blob，随后才生成 reviewer source manifest 并比较定义。Commit unavailable 为 `UNVERIFIABLE`，可用 commit 与 manifest 不符为 `INVALID`；二者不得混报。`EXACT` 才可能 `PASSED`，可解析但漂移的 `COMPATIBLE` 与不受支持的 `INCOMPATIBLE` 都失败关闭。Reviewer 不执行 evidence 内任何代码，独立输出由 review Manifest 封存；本评论不改变本 Ticket 状态或正式验收边界。
- 2026-08-30（AR-12 重基线复核）：Implementation status 保持 `resolved`；Verification status 在候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 上记为 `passed`。`npm run test --workspace @hospital-data-intelligence/verification-tooling` 退出码为 `0`，结果为 22 files / 495 tests passed、0 failed、0 skipped；独立 reviewer provenance/contract 路径的 `npm run test:verification:provenance` 退出码为 `0`，结果为 4 files / 93 tests passed、0 failed、0 skipped。不可覆盖汇总 `ar-12-rebaseline-summary.json` 的 SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；该汇总明确记录 `formalAcceptanceEligible=false`、正式 ABG 未执行。Formal acceptance status 仍为 `pending`；本结果不构成独立正式 evidence acceptance，也不证明真实运行时验收或生产就绪。
