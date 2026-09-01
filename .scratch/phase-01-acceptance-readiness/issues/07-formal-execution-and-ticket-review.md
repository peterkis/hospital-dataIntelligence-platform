# 07 — 正式执行与原 Ticket 复核

Status: blocked

Blocked by: 明确的正式执行授权与正式环境运行；AR-12 技术依赖已由 2026-09-01 Initial 满足，等待 Closeout HEAD Final 确认

## What to build

在全部前置 Ticket 验收后，执行一次新的正式验证运行，独立复核其不可覆盖证据，并只在证据充分时向原 Phase 01 Ticket 追加 Comments 和更新状态。

## Exit condition

不得在无正式运行证据时关闭任何原 Ticket；不得覆盖既有终态证据或把运行结论扩展为完整 POC 或生产就绪。

## Comments

- 2026-08-27：本 Ticket 不授权当前 AR-01 执行正式 ABG。
- 2026-08-29：Stage 1 空库启动在`0008_versioned_approval_workflow.sql`失败，PostgreSQL返回`SQLSTATE 22001`；`CAMPUS_CONFIRM_REVIEW_OWNER_FINAL`为33字符，而工作流持久列仅为`varchar(32)`。架构确认选择物理容量修复：在尚未进入正式证据包的`0008`中，将`approval_template_version.stage_type`、`approval_action.stage_type`和`approval_template_stage.stage_type`统一为`varchar(64)`，保留全部现有稳定阶段标识、CHECK集合、审批阶段顺序和职责分离语义不变。该修复服从ADR-0070的原生SQL Schema权威，不构成ADR-0091所治理的投影Schema契约升级；AR-07仍须以新候选提交从Stage 0完整重跑，本注记不代表readiness、正式ABG或独立复核通过。
- 2026-08-30：readiness runSequence `8` 的 Stage 2 在投影时间文本修复后继续暴露两项独立问题，用户随后明确授权修复双时态语义与故障矩阵夹具，并要求以 runSequence `9` 从 Stage 0 重跑。价表发布现在以最终审批事务的`occurredAt`作为发布版本`recorded_from`，用同一时点关闭上一发布记录，并在领域模块内重新生成发布态内容摘要与投影；提交和各审批动作仍冻结草稿摘要，既有投影字段解释和Schema版本不变。故障矩阵继续复用治理对象已绑定的`HOSPITAL-DEFAULT-PRICE`稳定代码，并以无副作用数据库只读断言验证每个受控写点同时回滚治理状态、记录时点和内容摘要，未放宽稳定身份约束或生产审计。上述修复的本地类型检查、真实PostgreSQL纵切面和全仓测试通过，但仍不代表readiness、正式ABG、Chrome或独立复核通过；后续结论只取 runSequence `9` 的新证据。
- 2026-08-30：用户随后要求将整个现行容器设计迁移为Podman，旧Docker路径及原定`runSequence 9`因此停止且未启动。ADR-0111、Podman运行时、预检、逐项teardown、故障夹具、host-network回环端口与迁移回执完成后，仍需以新的候选提交和新的runSequence从Stage 0取得证据；本次迁移验证不形成readiness、正式ABG、Chrome或独立复核结论。
- 2026-08-30（AR-08 状态复核）：本 Ticket 从已认领执行状态重新归类为 `blocked by AR-12`。AR-09～AR-11 尚需解决终态 lifecycle/ABG-40、reviewer provenance/契约漂移以及 Podman authority/restart/Docker socket/partial-startup 问题，随后由 AR-12 统一重基线；正式候选与新 run identity 均未冻结，未运行新的正式 ABG，不得将本 Ticket 改为 `resolved`。
- 2026-08-30（AR-12 初始 closeout）：opening HEAD `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 的 AR-12 技术重基线已通过，summary SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；AR-12 技术依赖标记为 `satisfied`。本 Ticket 保持 `blocked`，唯一剩余阻断是用户另行明确授权正式执行并在正式环境建立新的 candidate/run identity。该技术结果 `formalAcceptanceEligible=false`，没有启动真实服务、shared readiness 或正式 ABG，也没有关闭或修改原 21 个 completion Ticket；本任务不得执行 AR-07。
- 2026-08-30（AR-12 final failure）：Closeout HEAD `4dca3cacfc98b77e2e805260703a912b0a069d17` 的最终重跑在 `npm run check:repo:layout` 失败关闭，证据保留于 `.runtime/rebaseline/ar-12/20260830-4dca3ca-final`。因此 AR-12 恢复 `claimed`，技术依赖不再视为满足；本 Ticket 保持 `blocked`，仍不得执行。
- 2026-09-01（AR-12R-05 Initial closeout）：opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 的全新 Initial 通过完整42/42、14/14、158/158 mutations且0 survivor，Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`；AR-12 技术依赖标记为 `satisfied`。本 Ticket 保持 `blocked`，Current frontier 为 `AR-07 — awaiting explicit formal execution authorization`；本任务不执行 AR-07，且 Closeout HEAD Final 仍须通过才能保留该技术结论。没有真实服务、shared readiness、正式 ABG或原21个completion Ticket修改。
- 2026-09-01（AR-07R-01 sequence 10失败只读登记）：正式失败身份为runSequence `10`、runId `dbd9bc10-4d0f-4c4a-8cef-1b1e5c7255aa`、冻结HEAD `b341b9761fe7e7016c88e2a2ac4d36775026690b`，目录`.runtime/evidence/ar-07-formal-sequence-10`存在且根及53个条目均无symlink/reparse point。43个文件的规范tree digest为`97705866f5f7791bd37e0e548765271ededd872454a37dc2b57baa980a4423c1`；`abg-results.json`、`runtime/final-outcome.json`、`runtime/cleanup.json` SHA-256分别为`d7ce74c2ac65da21cfd1341405c704166b479bd927a379234bae956a553ad812`、`2ec85a3b8f85c94d73a4fcd3607f522c02e4984e402221ece88b0dd12beb5ecc`、`da3aa06e3a53c65d3f26b932742553c9c13f6edb6d62ea828f96ca202265f2cd`；setup 03 stderr/stdout分别为`32c9937d5e0d5c3c013f4210e99bad6a6f81379cc5597e019445c045d394f269`和空文件摘要`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，该runner未生成`setup/03/result.json`，本任务未补写。setup 03 stack trace定位到recorder共享父目录primitive：两个`Promise.all`写任务同时`lstat`到`shared/raw`缺失，后一`mkdir`得到未解释的`EEXIST`。cleanup的独立根因为teardown把原生rootful Linux上不适用的`podman machine list`任意非零退出解释为`FORMAL_CLEANUP_MACHINE_INSPECTION_FAILED`，而preflight另有stderr特判，形成两套语义。AR-07R-01只修复共享目录primitive和统一typed Machine classifier；sequence 10保持只读，不补Manifest、不改status、不移动或删除。下一次正式运行必须使用本任务新冻结HEAD、新runSequence和新目录，不得复用sequence 10；AR-07继续`blocked`，原21个completion Ticket保持未关闭，本任务未执行完整正式ABG或独立正式review。
