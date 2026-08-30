# Phase 01 验收就绪整改工作包

Status: active

Scope: 本工作包只修正 Phase 01 验收工具链、场景与证据覆盖关系及后续执行前置条件；不增加业务功能，不进入完整 POC 扩展，也不构成正式 ABG 运行。

## Objective

在不改变领域规则、事务边界、数据库迁移、冻结 OpenAPI 或生成客户端的前提下，建立可审计的 Phase 01 验收整改顺序，并把本地实现完成、当前基线定向验证和正式验收三类结论分开记录。AR-01～AR-06 已完成各自的本地实现和当时规定的定向验证，AR-08 与 AR-09 已完成并转为 `resolved`；当前 frontier 为 AR-10，AR-07 必须等待 AR-10～AR-12 完成后再按新的正式授权执行。

## Status semantics

### Implementation status

记录代码、测试和文档资产是否已经在一个明确提交上实现。它回答“资产是否存在并完成本地整改”，不回答这些资产是否已在当前 HEAD 重跑，也不构成 Phase 01 正式验收。

### Verification status

记录规定的定向单元、类型、静态和对抗性检查是否在一个明确 HEAD 上执行，并保留可定位的命令、结果和稳定产物。旧提交上的通过评论只对其记录的基线有效；运行时、证据协议、验证权威或冻结输入变化后，必须重新验证。

### Formal acceptance status

记录是否在冻结的真实环境、冻结候选提交和新的正式运行身份下执行完整 ABG，并由独立 reviewer 对不可覆盖证据完成复核。只有正式 evidence 能用于逐项关闭原 Phase 01 completion 的 21 个 Ticket；本工作包 Ticket 的本地 `resolved` 状态不能替代该证据。当前正式验收状态仍为 `pending`。

## Status rules

- `resolved` 只表示该本地整改 Ticket 的实现及其规定的定向验证已经完成。
- `resolved` 不等于 Phase 01 正式验收通过，也不得据此把 Phase 01 表述为 accepted、完整 POC 或生产就绪。
- 原 Phase 01 completion 的 21 个 Ticket 保持独立状态，必须依据新的正式 evidence 逐项关闭。
- Prompt 1～Prompt 6 对应的 AR-01～AR-06 必须在 AR-09～AR-11 完成后的最新终态协议和 Podman 权威上由 AR-12 重新验证；不得只沿用旧提交评论。
- `ready-for-agent` 表示 Ticket 已具备可执行规格，不会覆盖 `Blocked by` 依赖。依赖未满足时不得越过 current frontier。
- AR-07 当前为 `blocked`，阻断项为 AR-12 及另行给出的正式执行授权；不得保持 `claimed`。

## Triage compatibility

- 本工作包的 `Status:` 行是既有 acceptance-readiness lifecycle ledger。AR-08 已完成对历史值 `resolved`、执行占用值 `claimed`、阻断值 `blocked` 和 canonical 值 `ready-for-agent` 的协调；前三者仅为本工作包内状态，不新增或修改 `docs/agents/triage-labels.md` 的全局 canonical triage vocabulary。
- 对 AR-09～AR-12，`ready-for-agent` 只表示规格已经完整；实际执行资格必须同时满足 `Blocked by`。上游未满足时不得认领或实施，因此不会把“规格可交给 agent”误写成“可以越过依赖执行”。
- 其他工作包继续使用全局 canonical triage labels；不得把本工作包的 legacy lifecycle 值复制为仓库通用标签。

## Boundaries

- 不修改收费项目、价表、审批、发布、消费者或业务领域行为。
- 不启动 PostgreSQL、Keycloak 或 Chrome，不执行正式 ABG。
- 不修改原 phase-01-completion Ticket 的历史正文或将其改为 resolved。
- Markdown 覆盖报告只能从 TypeScript 覆盖矩阵生成或由其严格校验。
- 每次只执行获得授权的 current frontier；当前只实施 AR-10 的 producer/evidence/reviewer provenance、contract compatibility 与 definition drift，不进入 AR-11、AR-12 或 AR-07。

## AR-10 provenance contract

- Producer source manifest 是生产时验证定义的只读身份记录，必须绑定干净工作区、producer commit、Git blob identity、contract tuple 和完整权威文件摘要；evidence 只保存身份元数据，不携带或执行 producer 代码。
- Run plan、frozen inputs、terminal conclusion、ABG summary、final outcome 和 evidence Manifest 必须绑定同一 producer source manifest；独立复核前后 source evidence tree 不得变化。
- Reviewer 先核验 evidence integrity 和实际文件中的 contract tuple，再用本地 Git object 只读核验 producer commit/blob，最后生成 reviewer source manifest 并比较定义；不得 checkout、自动 fetch、联网或执行 evidence 内任何代码。
- Producer commit 不可用是 provenance `UNVERIFIABLE`，manifest 与可用 commit 的 blob 不一致是 provenance `INVALID`；两者与 evidence integrity failure 和 definition drift 分别记录，不能混称篡改。
- Contract relation 分为 `EXACT`、`COMPATIBLE`、`INCOMPATIBLE`。只有 `EXACT` 且无 definition drift、reviewer 工作区干净、完整 lifecycle/Manifest 均通过时 review 才可能 `PASSED`；可解析但漂移的 `COMPATIBLE` 与未知/混用版本的 `INCOMPATIBLE` 均必须 `FAILED`。
- Review 输出写入独立不可覆盖目录，并由 review output manifest 封存 review、findings 和 reviewer source manifest；不得修改 source evidence。
- AR-10 本地完成不等于正式 ABG 已运行或 Phase 01 accepted。AR-11 仍负责 Podman runtime authority、Docker 排他、restart policy 和 partial-startup hardening。

## Completion Criteria

1. AR-01～AR-12 的状态、依赖、实现基线和重新验证要求在 spec、map 与 Ticket 中一致。
2. Implementation、Verification 与 Formal acceptance 三层状态不得互相替代。
3. AR-09～AR-11 完成后，由 AR-12 在新的冻结 HEAD 上重新验证 AR-01～AR-06 及新增整改，不沿用旧提交结论。
4. Podman 工作包在 AR-11 完成并经人工复核前保持 `ready-for-human`。
5. 只有 AR-12 通过且取得明确正式执行授权后，AR-07 才可解除阻断并建立新的正式候选；当前未运行正式 ABG。

## Comments

- 2026-08-27：工作包创建。01 已认领；其余任务在明确依赖满足前保持阻断。
- 2026-08-30：AR-08 统一状态语义和后续整改依赖。AR-01～AR-06 的 `resolved` 保留为本地实现与当时定向验证结论；正式候选尚未冻结，Podman 工作包仍待人工复核，AR-07 阻断于 AR-12 和另行正式执行授权。
- 2026-08-30：AR-08 完成复核并转为 `resolved`，当前活动任务改为 AR-09。Prompt 1～Prompt 6 仍须在 AR-12 基于最新终态协议和 Podman 权威重新验证；正式验收状态保持 `pending`。
- 2026-08-30：AR-09 完成终态 lifecycle、ABG-40、summary v4、independent reviewer 和合成 fixture 整改并通过限定验收，转为 `resolved`；current frontier 推进到仍为 `ready-for-agent` 的 AR-10，但本次未实施 AR-10。AR-07 继续阻断于 AR-12 和另行正式执行授权，正式验收状态保持 `pending`。
- 2026-08-30（AR-10 协议影响）：验收工作包新增 producer source manifest、evidence package 交叉绑定、reviewer source manifest、Git object provenance 核验及 `EXACT`/`COMPATIBLE`/`INCOMPATIBLE` 契约关系。Definition drift 即使结构可解析也不能形成正式 review `PASSED`；integrity failure、commit unavailable 和 manifest invalid 分别分类。独立 review output 由自身 Manifest 封存。本条只记录 AR-10 协议边界，不表示正式 ABG 已执行；AR-11 的 runtime authority 责任不变。
