# 01 — ABG-01 至 ABG-40 权威覆盖矩阵

Status: resolved

Blocked by: none

## What to build

建立以 ABG_GATES 为标题和顺序唯一来源的 TypeScript 覆盖矩阵。每项门禁须声明稳定场景、唯一门禁级断言、受控 producer、严格证据选择器、必需引用种类、冻结输入和失败关闭策略，并生成派生 Markdown 覆盖报告。

## Acceptance

- [ ] 恰好覆盖 ABG-01 至 ABG-40，顺序和 evidenceClass 与目录一致。
- [ ] 每项至少有一个真实含义的场景和唯一门禁级断言。
- [ ] 选择器、引用、冻结输入和摘要缺失时自动失败关闭。
- [ ] 不存在占位值、泛化临时场景或第二份 ABG 标题来源。
- [ ] TypeScript 单元测试和派生报告检查通过。

## Comments

- 2026-08-27：AR-01 已认领。
- 2026-08-27：AR-01 已完成；权威矩阵、派生报告和定向校验已通过，提交为 `cf1a78e` 并已推送到 `origin/phase-01-acceptance-readiness`。未执行正式 ABG。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `cf1a78ef07db70ce691dc0c4b271d5db859cd522`。其后证据协议、producer、reviewer、运行时生命周期、数据库/领域修复和 Podman 权威均发生变化，旧评论中的定向验证不能代表当前终态协议基线；AR-12 必须在 AR-09～AR-11 完成后的冻结 HEAD 重新验证。本 Ticket 的验收框保持原状，不凭旧评论补勾；`resolved` 不表示正式 accepted。
- 2026-08-30（AR-12 重基线复核）：Implementation status 保持 `resolved`；Verification status 在候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 上记为 `passed`。`npm run verify:abg-coverage` 退出码为 `0`；`npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/abg-coverage-matrix.test.ts` 退出码为 `0`，结果为 1 file / 8 tests passed、0 failed、0 skipped。不可覆盖汇总 `ar-12-rebaseline-summary.json` 的 SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；该汇总明确记录 `formalAcceptanceEligible=false`、正式 ABG 未执行。Formal acceptance status 仍为 `pending`；本结果不证明真实运行时验收或生产就绪，验收框保持历史原状。
- 2026-09-01（AR-12R-05 Initial 当前候选复核）：Verification status 在 opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 上记为 `passed`。不可覆盖目录 `.runtime/rebaseline/ar-12/20260901-8f0999b-precloseout-r1` 中覆盖报告检查 exit `0`，AR-01 focused 为 1 file / 8 tests，verification 全量为 25 files / 596 tests；Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`。该 Initial 仅证明当前静态/合成基线，`formalAcceptanceEligible=false`，formal acceptance 继续 `pending`；Closeout HEAD Final 仍须独立重跑。
