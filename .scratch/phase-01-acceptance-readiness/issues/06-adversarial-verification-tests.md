# 06 — 对抗验证测试

Status: resolved

Blocked by: none；AR-05 顺序依赖已满足

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
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `615b92e7e298d45c785a2e35ac8328a957cda294`。其后提交 `429b07a`、`7f93bf0`、`4134aeb`、`1da6ac6` 和 `5fc00d0` 改变了迁移、生成类型、时间文本、领域行为和容器权威；Podman 迁移评论中的测试结果也早于 AR-09～AR-11 的待整改终态。AR-12 必须建立最新冻结 HEAD 的新对抗回归产物，不能复用旧 summary；`resolved` 不表示正式 accepted。
