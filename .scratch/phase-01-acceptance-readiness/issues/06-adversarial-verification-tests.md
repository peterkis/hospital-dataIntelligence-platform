# 06 — 对抗验证测试

Status: resolved

Blocked by: 05 — 运行时预检与生命周期

## What to build

为矩阵、协议、producer、复核与预检增加对抗性测试，证明错误门禁、错配场景、共享断言、摘要漂移、缺失引用和试图覆盖终态都被阻断。

## Exit condition

测试覆盖失败关闭路径，不以文档审阅或总体测试通过替代。

## Comments

- 2026-08-27：等待 05。
- 2026-08-28：Ticket 01～05 已 resolved；开工前确认工作区干净、当前分支为 `phase-01-acceptance-readiness`，开始执行 AR-06。本 Ticket 不启动真实 PostgreSQL、Keycloak、Chrome、Docker 或正式 ABG。
- 2026-08-28：新增固定输入、逐字节确定的 40 门禁合法 fixture；producer validator、正式 summary validator 和独立 reviewer 均接受该 fixture，fixture 明确标记为不得用于正式验收。
- 2026-08-28：`npm run test:verification:adversarial` 已通过 1 个合法基线和 59 个稳定 mutation；`.runtime/test-results/verification-adversarial-summary.json` 记录 `mutationCount: 59`、`detectedCount: 59`、`survivedCount: 0`。每项 mutation 均断言稳定错误码，临时 fixture 副本在测试结束后删除；额外 malformed JSON case 证明解析失败不能绕过裸配置 secret 检测。
- 2026-08-28：验收通过：verification tooling typecheck；workspace 普通测试 13 files / 149 tests；专用对抗测试 1 file / 60 tests；ABG coverage、repository layout、module boundaries 和 `git diff --check`。上述结果只证明验证器的已列失败能力，不是正式 ABG、完整 POC 或生产就绪结论；未执行 AR-07。
