# 12 — 对抗回归与 Prompt 1～Prompt 6 重基线

Status: resolved

Blocked by: none — AR-11、Podman human review 与当前候选初始技术重基线均已满足

## What to build

在 AR-09～AR-11 完成后的冻结 HEAD 上，重新执行并留存 AR-01～AR-06 规定的定向单元、类型、静态和对抗性验证；建立最新终态协议、reviewer provenance 与 Podman 权威共同适用的稳定验证基线。

## Why

AR-01～AR-06 的旧评论分别绑定旧提交。之后迁移、生成类型、时间语义、领域实现和容器权威均已变化，AR-09～AR-11 还会继续修改验证协议；只有统一重跑才能决定 AR-07 是否具备解除技术阻断的条件。

## Scope

- 冻结当前 HEAD、覆盖矩阵、证据协议、reviewer、运行时基线和相关输入摘要。
- 重跑 Prompt 1～Prompt 6 的规定检查，以及 AR-09～AR-11 新增的终态、漂移和 Podman 对抗回归。
- 记录命令、退出码、测试计数、mutation count/detected/survived 和稳定产物摘要。
- 向 AR-01～AR-06、AR-09～AR-11 与地图追加重基线结果及 AR-07 阻断处置建议。

## Non-goals

- 不沿用旧 summary 或旧提交评论替代本次执行。
- 不执行正式 ABG、独立正式 evidence acceptance 或关闭原 Phase 01 completion Ticket。
- 不自动解除 Podman `ready-for-human`；人工复核缺失时必须保持阻断。

## Acceptance criteria

- [x] 所有适用定向、类型、静态与对抗性检查均在同一冻结 HEAD 执行，命令、退出码、计数和产物摘要可核验。
- [x] Prompt 1～Prompt 6 以及 AR-09～AR-11 的失败关闭路径全部重跑；对抗 mutation `survivedCount` 为 0。
- [x] AR-01～AR-06 的 Verification status 更新为新基线事实，但不得改写为 Formal acceptance。
- [x] Podman 工作包已完成 AR-11 后人工复核；否则 AR-12 失败关闭且 AR-07 继续 blocked。
- [x] 只有全部重基线检查通过时才建议将 AR-07 的技术依赖视为满足；AR-07 仍须另行正式执行授权并使用新的 candidate/run identity。

## Comments

- 2026-08-30（AR-08 建立）：本 Ticket 是解除 AR-07 技术阻断前的最后重基线步骤；尚未执行任何测试、真实服务或正式 ABG，等待 AR-11。
- 2026-08-30（AR-11 closeout）：AR-11 已完成并转为 `resolved`，本 Ticket 的上游依赖已满足，成为仍未认领的 current frontier。该状态变化不构成执行授权；本轮没有冻结 AR-12 candidate、没有启动真实 Anolis/Podman 重基线，也没有执行 shared readiness 或正式 ABG。
- 2026-08-30（HR-01 人工复核）：Podman human review prerequisite 已完成；AR-12 尚未开始；下一次实施必须在新的 clean、remote-synced HEAD 上进行。
- 2026-08-30（AR-12 开工认领）：开工 HEAD 为 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`；`git status --short` 无输出；当前分支为 `phase-01-acceptance-readiness`；本地与 `origin/phase-01-acceptance-readiness` 的差异为 `0 0`；历史包含 `ab48a26463332d6639ab9c642377235e9c8d0062` 及后续 `db57406 docs(runtime): record Podman human review approval`。Podman human review 已完成，但 real-environment acceptance、formal ABG 和 production readiness 均未建立。本任务只执行静态、单元、类型、构建、合成 fixture、fake/mock runtime 和列表检查，不授权启动 PostgreSQL、Keycloak、Chrome、真实 Podman、shared readiness 或正式 ABG。所有最终结论必须来自本次当前 HEAD 的新运行，不沿用旧 Comments。

  ```text
  git status --short

  git branch --show-current
  phase-01-acceptance-readiness
  git log -3 --oneline
  db57406 docs(runtime): record Podman human review approval
  ab48a26 docs(runtime): close AR-11 Podman authority readiness
  fd8f0d7 fix(review): bind runtime authority to frozen run commit
  git rev-parse HEAD
  db57406592b5afe18ac2e95f3ddd0e1bf40173ea
  git remote -v
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (fetch)
  origin  https://github.com/peterkis/hospital-dataIntelligence-platform.git (push)
  git rev-list --left-right --count origin/phase-01-acceptance-readiness...HEAD
  0       0
  ```
- 2026-08-30（AR-12 初始 closeout）：在 clean execution clone 的同一分支与 opening HEAD `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 上完成当前技术重基线。有效目录为 `.runtime/rebaseline/ar-12/20260830-db57406-precloseout-r4`；`ar-12-rebaseline-summary.json` 为 `PASSED`，SHA-256 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`。42/42 允许命令 exit 0；verification 22 files / 495 tests，lifecycle 10/218，Podman fake runtime 5/173，provenance 4/93，Testcontainers guard 8 passed / 3 个授权范围外真实 runtime skipped，standalone teardown 6/6；14/14 standalone 通过；140/140 mutations detected、0 survived；Secret 与副作用扫描均 0 finding；结束 identity、source manifest、contract tuple、runtime authority、lockfile 和原 completion tree 均稳定，worktree `CLEAN`。保留了两个失败关闭目录和一个安全复审后废弃的 init-only 目录，均未覆盖；细节见 `prompt-01-06-revalidation.md`。本次 `formalAcceptanceEligible=false`，没有启动 PostgreSQL、Keycloak、Chrome 或真实 Podman，没有执行 shared readiness、正式 ABG 或独立正式 evidence acceptance，也未修改原 21 个 completion Ticket。初始技术依赖满足，AR-12 随 closeout 提交转为 `resolved`；AR-07 仍 `blocked`，仅等待用户另行明确正式执行授权与正式环境运行。Closeout 提交改变 SHA 后必须从新目录完整重跑；若失败则按约定用非覆盖提交恢复本 Ticket 为 `claimed`。
