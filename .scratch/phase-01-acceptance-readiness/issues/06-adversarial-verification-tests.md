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
- 2026-08-30（AR-12 重基线复核）：Implementation status 保持 `resolved`；Verification status 在候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 上记为 `passed`。`npm run test:verification:adversarial` 退出码为 `0`，结果为 1 file / 142 tests passed、0 failed、0 skipped；本次全新 summary 记录 `mutationCount: 140`、`detectedCount: 140`、`survivedCount: 0`。覆盖当前验证器组合的 `npm run test --workspace @hospital-data-intelligence/verification-tooling` 退出码也为 `0`，结果为 22 files / 495 tests passed、0 failed、0 skipped。不可覆盖汇总 `ar-12-rebaseline-summary.json` 的 SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；该汇总明确记录 `formalAcceptanceEligible=false`、正式 ABG 未执行。Formal acceptance status 仍为 `pending`；本结果只证明已列合成失败关闭路径，不证明真实运行时验收或生产就绪。
- 2026-09-01（AR-12R-05 Initial 当前候选复核）：opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 的 adversarial 为 1 file / 160 tests，Summary 记录 `mutationCount=158`、`detectedCount=158`、`survivedCount=0`；verification 全量为 25 files / 596 tests。Initial Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`，Secret 与副作用扫描均为 0 finding；formal acceptance 继续 `pending`，Final 不得复用 Initial mutation 结果。
