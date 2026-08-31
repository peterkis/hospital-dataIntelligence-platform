# 12 — 对抗回归与 Prompt 1～Prompt 6 重基线

Status: claimed

Blocked by: none — AR-11 与 Podman human review 已满足；Closeout HEAD 最终重跑失败，AR-12 保持 current frontier

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
- [ ] Closeout HEAD 在新的不可覆盖目录完成全部最终重跑；当前 `4dca3cacfc98b77e2e805260703a912b0a069d17` 运行已失败关闭。

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
- 2026-08-30（Closeout HEAD 最终重跑失败）：候选 `4dca3cacfc98b77e2e805260703a912b0a069d17` 在新目录 `.runtime/rebaseline/ar-12/20260830-4dca3ca-final` 通过 init、`npm ci` 与 `check:runtime`，随后命令 03 `npm run check:repo:layout` 以 exit `1` 失败，稳定编排错误码为 `AR12_COMMAND_EXIT_UNEXPECTED`。直接原因是布局检查在仓库内保留的初始执行 clone `.runtime/rebaseline/ar-12/worktrees/db57406-precloseout/package-lock.json` 与根 `package-lock.json` 之间发现第二份 lockfile；39 条后续命令未执行。失败证据为 `.runtime/rebaseline/ar-12/20260830-4dca3ca-final/run-commands-result.json`、`failure-run-commands.json` 与 `commands/03-check-repo-layout/{command.json,stdout.log,stderr.log,result.json}`，目录保持不可覆盖且不修补。按任务约定，本 Ticket 用本非覆盖历史恢复为 `claimed`，Current frontier 恢复为 AR-12；AR-07 继续 `blocked`，不得宣称 AR-12 完成。该失败未启动真实服务、shared readiness 或正式 ABG，也未修改原 21 个 completion Ticket。
- 2026-08-30（AR-12R-01 修改前根因确认）：开工 HEAD `0267bba32cc439d68863b7e6ee24e6386d2d9ce7` 为 clean、remote-synced `0 0`。初始 execution clone 被创建在被验证仓库物理目录树内的 `.runtime/rebaseline/ar-12/worktrees/db57406-precloseout`；`.runtime` 虽不进入 Git status，却不构成文件系统隔离。Closeout HEAD 在主仓库执行未放宽的 `npm run check:repo:layout` 时正确同时发现根 `package-lock.json` 和该嵌套 clone 的 `package-lock.json`，当前反馈环连续两次以 exit `1` 重现同一断言。因此 Git worktree `CLEAN` 不等于仓库物理执行目录未受污染，根因是 execution workspace 位置违反 source repository / execution workspace 隔离原则。本修复不得忽略 `.runtime`、降低单 lockfile/单 Git root 门禁或跳过命令 03；既有初始 summary 和 `.runtime/rebaseline/ar-12/20260830-4dca3ca-final` 失败目录继续不可覆盖保留。AR-12 保持 `claimed`，AR-07 保持 `blocked`；本任务不执行完整 AR-12、真实服务、shared readiness 或正式 ABG。
- 2026-08-31（AR-12R-01 受控外移）：经 stale clone 身份校验后，仓库内 `.runtime/rebaseline/ar-12/worktrees/db57406-precloseout` 已原子外移到仓库外部的隔离归档；本文不记录外部绝对路径。外移前后 tree digest 均为 `03c6f5f4f3afe50eb9864e71e179fc90d02b8fe66d5772932900d3360700f67f`，恢复记录以排他创建方式保存在 `.runtime/rebaseline/ar-12/recovery/20260830-0267bba/execution-workspace-relocation.json`。`precloseout`、`r2`、`r3`、`r4` 与 `final` 的 evidence content digests 均保持不变；失败证据仍被保留，未删除、覆盖或修补。当前 `npm run check:repo:layout` 已通过，`check-repo-layout.mjs` 的规则未修改，单 Git root、单 lockfile 与命令 03 门禁均未降级。该修复仅消除 execution workspace 对 source repository 的物理自污染，不构成完整 AR-12 重跑或验收：AR-12 仍为 `claimed` 且是 current frontier，AR-07 仍为 `blocked`；未启动真实服务，未执行 shared readiness 或正式 ABG，不得据此宣称本任务 `resolved` 或 `accepted`。
- 2026-08-31（AR-12R-02 summary 契约整改）：opening HEAD `1d1204aa228a38a2862f9d8eaa7fa3428be6eab7` 的新 initial 运行 `.runtime/rebaseline/ar-12/20260831-1d1204a-precloseout-r2` 完成 42/42 commands、14/14 standalone、24 files / 559 verification tests、152 adversarial tests 和 150/150 mutation 检出，但不可覆盖 summary 缺少任务强制的 `repositoryContaminationGuard`、`repoLayoutStatus`、`historyEvidenceStable` 顶层字段，因此没有创建 Closeout 提交或 final 运行。后续整改使 `init` 在当前run创建前强制核验指定历史目录、失败final六个关键artifact固定SHA、固定recovery SHA与旧stale clone缺失，再冻结并SHA绑定全部既有evidence/recovery物理身份；合法repository-boundary artifact字节SHA在命令前绑定进context，42条命令后与`finalize`阶段均重新核验source contamination、`npm run check:repo:layout`与历史身份，最终失败关闭写入三个字段。该整改只形成新的候选实现，不复用上述initial结果、不执行完整AR-12、真实服务、shared readiness或正式ABG；本Ticket继续`claimed`且仍是current frontier，AR-07继续`blocked`。
- 2026-08-31（AR-12R-04 修改前根因记录）：`historyEvidenceStable` 当前依赖通用目录发现以及运行前后整体指纹相等，但通用指纹只能证明当时发现的集合没有变化，不能证明指定历史目录必须存在。权威 `requiredDirectoryNames` 仍只列出原五个目录，未把 `.runtime/rebaseline/ar-12/20260831-1d1204a-precloseout-r2` 显式声明为 required history。该目录的不可覆盖 `ar-12-rebaseline-summary.json` 字节 SHA-256 固定为 `be19b1557dc75dc2adae612fefdd5088116677acc3414f151feddf0d10ad2cff`；它内部技术执行 `status=PASSED`，但缺少强制顶层 `repositoryContaminationGuard`、`repoLayoutStatus`、`historyEvidenceStable`，因此外层必须稳定分类为 `SUMMARY_CONTRACT_FAILED_HISTORY`，且 `contractDisposition=REJECTED`。当前目录恰好存在不能替代 required contract。本修复不得修改、补字段或重建该 Summary，不得削弱 repo-layout、Summary validator 或不可覆盖 evidence 规则；AR-12 保持 `claimed`，AR-07 保持 `blocked`，本任务不执行完整重基线、真实服务、shared readiness 或正式 ABG。
- 2026-08-31（AR-12R-04 historical evidence contract closeout）：新增唯一 `tooling/verification/src/rebaseline/ar-12-history-evidence-contract.ts` authority，以稳定顺序显式冻结六个 required history、第六 Summary 固定 SHA-256、`SUMMARY_CONTRACT_FAILED_HISTORY`/`REJECTED` 处置、failed-final 固定 artifacts、Recovery SHA/等树摘要/failed-final preserved 语义及 stale clone absence。pre-run gate 现在位于 Initial 目录和外部 clone 创建之前；opening baseline 与 finalize 复核共同要求 required tree、artifact、classification、recovery、stale-clone 和整体 set digest 稳定，额外目录只进入审计发现且不能替代 required entry。当前实际只读核验为 `requiredHistoryCount=6`、`requiredHistoryPassedCount=6`，contract digest `5feee8cea2b939d3a321911c207f6c1255a86155cfa69724ade6cba6c15dae14`，historical set digest `412a548ebbe65861fd3cb0323810e0815193bb93ff313348aaecba16529f5367`；Recovery SHA 仍为 `735e5ea48cdadecad043573c6e75f263b73f04b411465944fc4d7c215f86f75e`。新增21项contract单测和1项pre-run编排测试；全量verification 25 files / 592 tests、lifecycle 10/218、provenance 4/94、Podman fake runtime 5/173、158/158 mutations detected且0 survived、定向history contract 2 files / 42 tests以及规定静态门禁均通过。正式ABG contract tuple未改变；source authority file count由45增至46。本任务没有创建Initial/Final目录、执行完整AR-12或14项standalone、启动真实服务、执行shared readiness/正式ABG、修改原21个completion Ticket或进入AR-07；旧历史目录与Recovery artifact保持只读。AR-12继续`claimed`且仍是current frontier，AR-07继续`blocked`。
