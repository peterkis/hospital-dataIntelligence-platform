# Phase 01 验收就绪整改工作包

Status: active

Scope: 本工作包只修正 Phase 01 验收工具链、场景与证据覆盖关系及后续执行前置条件；不增加业务功能，不进入完整 POC 扩展，也不构成正式 ABG 运行。

## Objective

在不改变领域规则、事务边界、数据库迁移、冻结 OpenAPI 或生成客户端的前提下，建立可审计的 Phase 01 验收整改顺序，并把本地实现完成、当前基线定向验证和正式验收三类结论分开记录。AR-01～AR-06 已完成各自的本地实现和当时规定的定向验证，AR-08～AR-11 已完成并转为 `resolved`；当前 frontier 为仍未认领的 AR-12，AR-07 必须等待 AR-12 完成后再按新的正式授权执行。

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
- 每次只执行获得授权的 current frontier；本轮授权只覆盖 HR-01 对 AR-11 后人工复核结论的记录，不授权认领或执行 AR-12、AR-07、shared readiness 或正式 ABG。Ledger frontier 保持在仍不自动认领的 AR-12。

## AR-10 provenance contract

- Producer source manifest 是生产时验证定义的只读身份记录，必须绑定干净工作区、producer commit、Git blob identity、contract tuple 和完整权威文件摘要；evidence 只保存身份元数据，不携带或执行 producer 代码。
- Run plan、frozen inputs、terminal conclusion、ABG summary、final outcome 和 evidence Manifest 必须绑定同一 producer source manifest；独立复核前后 source evidence tree 不得变化。
- Reviewer 先核验 evidence integrity 和实际文件中的 contract tuple，再用本地 Git object 只读核验 producer commit/blob，最后生成 reviewer source manifest 并比较定义；不得 checkout、自动 fetch、联网或执行 evidence 内任何代码。
- Producer commit 不可用是 provenance `UNVERIFIABLE`，manifest 与可用 commit 的 blob 不一致是 provenance `INVALID`；两者与 evidence integrity failure 和 definition drift 分别记录，不能混称篡改。
- Contract relation 分为 `EXACT`、`COMPATIBLE`、`INCOMPATIBLE`。只有 `EXACT` 且无 definition drift、reviewer 工作区干净、完整 lifecycle/Manifest 均通过时 review 才可能 `PASSED`；可解析但漂移的 `COMPATIBLE` 与未知/混用版本的 `INCOMPATIBLE` 均必须 `FAILED`。
- Review 输出写入独立不可覆盖目录，并由 review output manifest 封存 review、findings 和 reviewer source manifest；不得修改 source evidence。
- AR-10 本地完成不等于正式 ABG 已运行或 Phase 01 accepted。AR-11 仍负责 Podman runtime authority、Docker 排他、restart policy 和 partial-startup hardening。

## AR-11 runtime authority contract

- 唯一机器可读运行权威是`phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json`的`.authority`对象（`schemaVersion: 3`、`authorityId: phase-01.podman-runtime-authority.v1`）；`.observations`和Podman迁移receipt只作历史观察/provenance，不提供正式期望值。
- 运行时装配、代理配置和三只生命周期Shell脚本通过`jq`读取该文件；TypeScript preflight、teardown、Testcontainers适配和证据协议通过严格schema loader读取同一文件。`runtimeAuthoritySha256`和`.authority`规范化语义摘要都进入frozen inputs，并在cleanup后重新核验。
- 所有正式容器显式`restart=no`并在创建后inspect；禁止Docker CLI/daemon/socket alias/systemd unit/process/TCP API、Podman TCP API和第二endpoint。Testcontainers只允许精确`DOCKER_HOST=unix:///run/podman/podman.sock`作为同一Podman Unix socket的协议兼容变量，它不表示Docker Engine authority。
- Partial startup按Keycloak容器、PostgreSQL容器、Keycloak卷、PostgreSQL卷反向收尾；runtime up后的readiness、migration、seed或schema verification失败由bootstrap调用同一`down`路径。每次停止或删除前重新inspect；只有名称属于当前namespace且五个必需标签全部存在并匹配当前run时才允许变更，附加无关元数据标签不影响所有权，缺失/不一致则保留并失败关闭。任何prune/reset均禁止。
- AR-11只使用fake CLI、DI/mock adapter和合成文件系统验证，不产生真实Anolis/Podman readiness。AR-12才在另行授权后冻结当时的当前HEAD，并于真实环境重建baseline/readiness；因此AR-11完成不等于Podman工作包accepted、正式ABG或Phase 01 accepted。

## Completion Criteria

1. AR-01～AR-12 的状态、依赖、实现基线和重新验证要求在 spec、map 与 Ticket 中一致。
2. Implementation、Verification 与 Formal acceptance 三层状态不得互相替代。
3. AR-09～AR-11 完成后，由 AR-12 在新的冻结 HEAD 上重新验证 AR-01～AR-06 及新增整改，不沿用旧提交结论。
4. Podman 工作包在 AR-11 完成后先保持 `ready-for-human`；HR-01 已在 AR-12 或正式运行前记录人工复核 `APPROVED`，工作包转为 `resolved` 只表示 AR-11 实现和人工设计复核完成，不表示真实环境验收、正式 ABG 或生产就绪。
5. 只有 AR-12 通过且取得明确正式执行授权后，AR-07 才可解除阻断并建立新的正式候选；当前未运行正式 ABG。

## Comments

- 2026-08-27：工作包创建。01 已认领；其余任务在明确依赖满足前保持阻断。
- 2026-08-30：AR-08 统一状态语义和后续整改依赖。AR-01～AR-06 的 `resolved` 保留为本地实现与当时定向验证结论；正式候选尚未冻结，Podman 工作包仍待人工复核，AR-07 阻断于 AR-12 和另行正式执行授权。
- 2026-08-30：AR-08 完成复核并转为 `resolved`，当前活动任务改为 AR-09。Prompt 1～Prompt 6 仍须在 AR-12 基于最新终态协议和 Podman 权威重新验证；正式验收状态保持 `pending`。
- 2026-08-30：AR-09 完成终态 lifecycle、ABG-40、summary v4、independent reviewer 和合成 fixture 整改并通过限定验收，转为 `resolved`；current frontier 推进到仍为 `ready-for-agent` 的 AR-10，但本次未实施 AR-10。AR-07 继续阻断于 AR-12 和另行正式执行授权，正式验收状态保持 `pending`。
- 2026-08-30（AR-10 协议影响）：验收工作包新增 producer source manifest、evidence package 交叉绑定、reviewer source manifest、Git object provenance 核验及 `EXACT`/`COMPATIBLE`/`INCOMPATIBLE` 契约关系。Definition drift 即使结构可解析也不能形成正式 review `PASSED`；integrity failure、commit unavailable 和 manifest invalid 分别分类。独立 review output 由自身 Manifest 封存。本条只记录 AR-10 协议边界，不表示正式 ABG 已执行；AR-11 的 runtime authority 责任不变。
- 2026-08-30（AR-10 完成）：AR-10 的统一 contract version authority、35 文件 producer/reviewer source manifest、evidence cross-binding、Git object provenance、compatibility registry、reviewer 双捕获稳定性和独立 review manifest 已通过规定的本地验证及双轴只读 review，转为 `resolved`。110 项 mutation 全部被检测且无 survived case；五条 standalone reviewer 路径均按契约通过或失败关闭。当前 frontier 推进到仍未认领的 AR-11；正式验收状态继续为 `pending`，未执行正式 ABG。
- 2026-08-30（AR-11协议影响）：当前frontier AR-11已认领，范围只包括单一Podman runtime authority、Docker/第二endpoint排他、`restart=no`、partial-startup/bootstrap失败收尾、完整五个必需标签删除前复核及其provenance/对抗性回归。Source manifest从AR-10历史35文件扩展为当前43文件，并以不同角色区分runtime authority、loader/schema、运行脚本、runtime authority provisioning、Testcontainers/live producer和非authority receipt；run plan/authority、summary、terminal conclusion及runtime outcome分别定向升级为v4/v3、v5、v2、v3，以携带runtime authority字节/语义身份及cleanup后稳定性。本条只记录协议影响，不提前改变AR-11状态、frontier或正式验收结论；AR-12和AR-07仍未获授权。
- 2026-08-30（AR-11 完成）：唯一 runtime authority、严格 schema/byte/semantic identity、Docker/第二 endpoint 排他、`restart=no`、12 阶段 state machine、partial-startup/bootstrap reverse cleanup、删除前完整五标签复核、standalone frozen snapshot 恢复及 producer source-manifest/commit/Git blob provenance 绑定均完成。最终 verification 全量 22 files / 495 tests、adversarial 140/140 detected 且 0 survived，Standards/Spec 双轴只读复审均 `APPROVED`；人工复核输入已写入 `.scratch/phase-01-podman-runtime/human-review.md`。AR-11 转为 `resolved` 只表示本地整改与限定验证完成；Podman 工作包仍为 `ready-for-human`，未启动真实服务、shared readiness 或正式 ABG。Current frontier 推进到仍未认领的 AR-12，AR-07 继续 blocked。
- 2026-08-30（HR-01 人工复核）：仓库责任人对候选 `ab48a26463332d6639ab9c642377235e9c8d0062` 作出 `APPROVED` 决策，Podman 工作包及 runtime issue 转为 `resolved`。该结论只覆盖 AR-11 实现、合成失败关闭验证和人工设计复核；未执行真实环境验收或正式 ABG，不声称生产就绪。Podman human review prerequisite 已完成；AR-12 保持 `ready-for-agent` 且未开始，仍为 current frontier；AR-07 继续 `blocked`。
