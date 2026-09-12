# P0-00 — vNext 本地研发基线

本轮只建立开发基线、保护入口、替代约束登记及交接，不实现 P0-01 目录或业务能力。用户于 2026-09-12 明确授权未上线项目无需旧实现兼容，并要求保留原开发证据库、禁止 reset/外网/push。规范来源为仓库外 `D:/Agent-Prompts/HDIP-Codex-Multicampus-Development-Pack-v2` 的 START-HERE、MASTER、ENGINEERING_CONTRACT、docs/01–12、P0 phase、P0-00 与 machine/tasks.json。

## 实际 Git 与工作区

- START_HEAD/main：`b84ebca6a1eb277172531014e1fe11e03db7e7b4`。
- START_TREE：`2532339db2da2e22e07fe8cb4ba4bf344f572d00`。
- parents：`c4396bec80f27446ebcc4561724603c4ed584abc`、`040c9e1df9a6a11b74bda0b76958f93696cd9b78`。本地合并提交包含 C-05；不按提交标题推断远端实时状态。
- 初始 index/worktree 干净；本地新建 `development/org-person-space-vnext`。包观察 SHA/tree 与本地一致，差异为 0。
- 本地 `origin/main` 是缓存 ref；remote observation = `NOT_OBSERVED`。没有 fetch/pull/push 或访问项目外网。
- 已读 root AGENTS、完整 CONTEXT、docs/agents 约束与 ADR-0071/0073/0121；文件发现未发现嵌套 AGENTS。

## 数据与 lineage 决策

选独立 `HDIP-MC-VNEXT` 原生版本化 SQL lineage，位置 `db/vnext/`。保留 `db/migrations/0001–0039` 及旧 PV 文档、fixture、报告原文。沿用 TypeScript/Fastify/React/Vite/PostgreSQL 和 Owner port；无需双写或长期兼容 adapter。

只读查询确认旧库 `hdi_prototype`，OID `16389`，PostgreSQL 18，迁移编号与 39 个源码文件一致。`platform.schema_migration` 没有 checksum 列；当前源码 SHA-256 清单与迁移编号清单分别保存，不能宣称已验证历史执行字节完全一致。使用 `default_transaction_read_only=on` 读取旧库元数据，不读取人员明文，不变更角色、权限、表或数据。没有执行旧业务回归写入探针。

新建库 `hdi_mc_vnext_a7049c9e5c2a4364`，OID `206108`，owner `hdi_prototype`，template0；业务表/版本/seed delta 均为 0。`postgres` 本地 WSL peer 仅用于建库与目录查询；建库前重查应用角色仍非 SUPERUSER、非 CREATEDB。原 `.env.prototype.local` 不变。新库保留，不删除。

creation intent 与完成 receipt 使用 exclusive create；既有记录阻止再次创建，避免 ACK 丢失后重复建库。receipt 记录 task/request/time/name/OID/owner/distribution/port 与旧迁移观察。重启后的独立 verify 检查同一 OID、owner、空库与旧 lineage。它不是业务恢复/事务验收。失败不自动删除、接管或重试建库。

本票 CLI 的 closed input 仅为固定命令枚举，无任意 SQL、库名或外部 URL 参数；数据库入口只接受 loopback:55434。清理命令无条件 `DISPOSAL_NOT_AUTHORIZED`，本票未提供删除能力；这比仅检查 receipt 后允许删除更严格。仓库现有历史运维脚本仍属旧票，不因本票获得清理授权。

旧 migration runner 新增 vNext 数据库名前缀拒绝，防止通过该当前入口混链。该保护不声称可阻止管理员手工 SQL；第一张 vNext DDL 票必须先实现 receipt + lineage/checksum 验证的专用 runner、synthetic seed 与独立 codegen配置，按 `db/vnext/README.md` 执行。当前类型验证仍以旧库为目标；新库没有业务类型可生成。

## 替代约束与当前调用方

六项权威替代登记在 `compatibility-replacements.json`；每项含旧约束、替代规则、语义测试迁移锚点。`current-callers.json` 记录现有调用源路径及当前 OpenAPI/client/SDK/路由位置。本票 API/OpenAPI/client/schema 行为 delta=0，所有旧测试仍保留；替代的是永久兼容要求，不是抹去历史发布事实。

后续改动同一提交更新：owner contract → TypeBox/OpenAPI → generated client → SDK → admin-web/sim-consumer → probes/编译负例/行为测试/说明。旧 SHA、七份 bytes、15 条路径可调整，但当前发布版本确定性、不可变历史、错误拒绝、授权及类型负例必须迁移。登记工具检查 closed fields、唯一 ID、非空且存在的测试映射；语义是否充分由同 tree review 判断，存在路径不是测试通过。

旧 PV-005 科室/consumer 和 PV-006 Person A/B/C（含 C-05）只作为源码与历史证据；新计划不继承其 DONE。组织与科室归 P1/P2，Person/E/A 归 P4，原 D/E 的角色/资质归 P5，原 F/G 的投影/消费归 P8；其他票保持 NOT_STARTED，禁止同时两个任务写相同 Owner。

## 不放宽的规则与待决策

身份永久不复用；Person/E/A/Role/Credential/Account 分离；院区不是法人/租户；Owner 单一写主权；审批与业务状态分离；maker-checker、当前 scope/字段/目的授权；真实 R、半开 B、微秒、null 无界；完整期限与局部规则不能混用；事务与审计、不可变版本和隐私规则保持。P0-00 不增加业务写 API，所以业务 B/R、撤权重放、owner 事务 rollback/并发、维护页面/browser 是 NOT_RUN（本票不适用），不伪造 UI。

CONTEXT 的旧数据元“逐行成功不回滚”与包的新有界原子单元不是兼容性豁免可自动覆盖的规则。P0-03/P0-08 必须按数据集明确原子边界并形成适用的领域决定，当前行为未改变。真实 Owner/医院政策/资料/身份/密钥/生产切换/正式 ABG 都未授权；合成测试不替代人工签审。

P0-00 的 implementation-owned source fields、source conditions、原 quality gate IDs 均为 0（machine/tasks.json）；866 字段仍在原 field-routing，未删除或标实现。P0-01 的 53 目录、GOV01、866 字段元数据与外部引用处置由下一票承担。

## 验证与证据

运行日志及命令 start/end/exit：`D:/Agent-State/HDIP-MC-VNEXT/P0-00/`。单一执行状态为 `D:/Agent-State/HDIP-MC-VNEXT/execution-state.json`，包模板保持原样；最终 commit/tree、审查与资源观察写 `.runtime/vnext/handoff.json`，避免自引用 amend。

| Gate | 证据与含义 |
|---|---|
| AC-01 | 真实临时 Git 仓库未跟踪文件保留，inspect 返回 WORKTREE_NOT_CLEAN；red-01 → baseline test |
| AC-02 | 无 receipt/陌生库/伪 receipt 的 cleanup 都拒绝；red-02 → baseline test；未执行任何 DROP |
| AC-03 | 空语义映射拒绝；red-03 → baseline test；六项登记检查，旧 gate 全保留 |
| AC-04 | npm run typecheck 与 build：当前 API、generated client、SDK、两应用一起编译；尚未切业务运行库，不宣称新 API 已交付 |
| AC-05 | 临时仓库存在 origin/main 缓存仍返回 NOT_OBSERVED；该性质初测即 GREEN，未虚构 RED |
| 混链负例 | red-04 表明缺少连接前拒绝；GREEN 返回 VNEXT_LEGACY_LINEAGE_FORBIDDEN；连接错误本身不计领域 RED |
| 包静态 | 1305 检查通过，只是包检查，不是业务验收 |
| 当前边界 | prototype:db:with -- check：runtime/layout/module/contract/database-authority 与当前 codegen verify |

RED 文件保留实际失败/时间/argv/exit；red-01 保存 tests-only 新文件差异，后续为增量循环。DB provisioning 没有另造“领域初始 RED”；使用实库 create/verify 正向证据。Spec/Standards 审查方法和最终结论以 ignored handoff 为准。

首轮审查发现三项并在提交前修复：receipt 父目录缺失、连接 URL query 覆盖本机目标、PGDATABASE 回退绕过旧链保护。`red-review` 是后续修复 RED，不冒称最初 RED；补充测试验证目录自动创建/证据不可覆盖、拒绝 URL overrides 和有效数据库名防护。八项 focused 测试覆盖本票 CLI 与两个实际使用的保护入口。

数据库托管 session 要同时满足 READY、target exit=0、cleanupPassed=true。首次 inspect 的 service stop 命令 exit=1，但实际 service inactive、不可连接且 distribution terminate 成功，runner cleanupPassed=true；不把该退出值改成0。create 的 stop exit=0。最终资源状态见日志；空库作为研发证据保留，task-owned service/WSL 会话恢复至初始停止状态。

## P0-01 进入条件

用户明确选择 P0-01；先核对本票 DONE 的真实 handoff/execution-state、FINAL_COMMIT/tree 和工作区（有未授权改动即保留现场）；重新通过 receipt identity/empty 检查；读取 P0-01、docs/12、external-reference-disposition、原 datasets/contracts。包 next_task 的候选不是授权。首次元数据 DDL 先实现新 lineage 安装/升级/seed/codegen，不能使用旧迁移/seed 指向新库。P0-00 后停止，不自动启动下一票。
