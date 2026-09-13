# P0-02 数据集契约注册表（维护页门禁阻断）

2026-09-13。当前不是完成报告；没有完成提交。执行规范为 `D:/Agent-Prompts/HDIP-MC-P0-02-single-active-db/P0-02-contract-registry.current-main.single-active-db.prompt.md`，原开发包继续作为来源资料。P0-03 未执行。

## 基线和数据库

开工实际 main HEAD `50cc76c8a6f87b24c6b35d2865f3c4c734ada226`，tree `5004c7eba6b412d32505c1b848a517e1960d0de7`，worktree/index 干净，随后建立 `codex/p0-02-contract-registry`。没有回退 4137cc6a，没有联网查询项目远端。

当前 creation receipt 绑定既有 `hdi_mc_vnext_a7049c9e5c2a4364`、OID 206108、lineage HDIP-MC-VNEXT。开工 live ledger 0001–0011 全部与当前源码 checksum 相符。旧 handoff/execution-state 原件复制到 `D:/Agent-State/HDIP-MC-VNEXT/P0-02/`，未把旧两迁移交付报告改写成当前事实。

旧库为 LEGACY_OUT_OF_CURRENT_EXECUTION。vNext npm 目标的托管 readiness/final probe 使用 receipt 身份、lineage、已知完整前缀和明确对象清单；保留 WSL/service/keepalive/finally 资源所有权。`vnext:db:inspect` 改为当前 verify；移除当前持久建库 npm 入口，历史 P0-00 源文件仍保留。authority 不再读旧 39 SQL，而是比较当前真实表名与生成类型，仍检查 schema 和 owner。

0012–0014 已在 receipt-owned 临时库及现有持久研发库安装验证，持久库 OID 仍为 206108，14 项迁移 checksum 全部相符（65/66 日志）。这些迁移从此不得改写已应用字节。同一 governance_catalog owner 增加三张契约表、一张契约影响事件表，以及参数身份、版本、批准和精确授权四表，总表数 24。无 ORG/PER 业务实例，无第三座持久库，无旧数据迁移。临时库依 creation receipt 精确清理，旧数据库未物理删除。

当前 wrapper 拒绝旧 prototype 目标；允许 vnext、test:vnext 和明确的静态编译目标，均使用 vNext readiness。所有 PG 环境覆盖变量按大小写不敏感方式拒绝。连接证据 V2 在原 Pool/Client 原型 connect 上检查 receipt 的数据库名，涵盖 ESM named import；V1 构造器替换记录保留为历史证据，不作为最终排除旧库的证明。最终门禁使用唯一 run ID、独占 trace 文件和逐步骤记录，匹配精确数据库名/预期 receipt OID；实际 OID 由 inspect 核对。66 日志的本次 15 次连接均为当前持久 vNext，旧库连接为 0，codegen 与 24 张真实表 authority 检查通过。

## 模型与接口

ImportContract 只引用已有 DATASET 身份与独立 CORE/FULL profile；ImportContractVersion 固定目录版本、来源草案 snapshot、FieldUsage、CodeSetAdoption、RuleVersion、references、模板版本、完整 B 期间、实际 R。schemas 随版本在数据库内生成并持久化，历史下载不依赖后来重写的生成器。审批摘要包含上述内容、源 snapshot、持久 schema 及实现语义的 migration checksum。

当前公开 owner 为 governance-catalog/index.ts。`contractCommand` 提供 CREATE、REVISE、VALIDATE、APPROVE、PUBLISH、RETIRE；`contractRead` 提供 CURRENT、HISTORY、EFFECTIVE。新 stable ID 为 DB uuidv7，输入不能指定。修订新增完整版本，已有 ruleVersion 不能覆盖。VALIDATE 保存结果和审计而不发布；APPROVE 要求不同真实合成 identity；PUBLISH 重查当前授权、原审批人权限及完整依赖期间。同规则版本重复发布不增加发布事件。

读取先按 R 选择最近的已发布完整版本，再检查 B；新候选不顶替已发布版本，新的完整期间不覆盖指定 B 时不回退旧开放期间。发布未来起始的完整替代版本，会立即使当前 R 下较早 B 不再匹配；这不是保留前版至起始日的预约激活。源影响计算使用同一完整版本解释。RETIRE 以当前总体 head 防竞态，明确废止最新有效 publication，即使存在更新的候选也可关闭。已废止身份不恢复，后续更替/业务 apply 不属于本票。

写入共享目录授权锁 901002，复用 scope、精确 DATASET 对象、METADATA 用途和 DEFINITION 字段组权限。这里的字段组是契约定义元数据权限，不是读取真实字段值的授权。来源引用复用指定已接受版本的授权与全期间 source chain。原请求重放也重查原固定来源当前访问权限。业务版本、事件、request identity、outcome、最小审计及审计链在同一数据库事务中；审计故障测试验证全部回滚。

API：GET `/api/vnext/contracts`；POST `/api/vnext/contracts/commands`；GET `/api/vnext/contracts/:id/schema?scope=...&versionId=...`。schema 下载必须指定版本；CREATE sourceAlias 与 UPDATE platformRef/expectedVersion 分开。JSON schema 只证明规范暂存值的结构，不取代条件、日历、引用或业务 owner 校验，不执行 CSV/XLSX 解析或 apply。

维护页面 `/admin/vnext/contracts` 使用同一真实 API 和生成客户端，包含候选、字段选择、合成代码集、校验、独立批准、发布/废止、新规则版本、B/R 查询、完整历史和 schema 下载。当前合成身份切换不是正式认证/SSO。

## 来源与未就绪边界

`db/vnext/sources/contract-inputs/manifest.json` 固定 53 份原始 FULL 草案及条件/标准队列文件的字节摘要；原包未修改。`contract-sources.mjs` 将 866 个源字段声明、77 条条件及逐字段 routing 保留为可检查映射。`contract-seed.mjs` 复用 P0-01 DATASET 身份导入 53 份 DRAFT，不创建第二份数据集身份目录。

未编译条件为 UNRESOLVED 或 MANUAL_EVIDENCE，阻断批准/发布；人工材料未获批准，不能由技术校验替代。CodeSet 只支持 CANDIDATE 和明确的 SYNTHETIC_ADOPTED；候选不能发布，也不接受 NATIONAL_LATEST 等官方最新声明。真实标准仍待核验，adapter 一律 NOT_READY。契约 PUBLISHED 不构成医院来源批准或实际导入就绪。

GOV01 复用来源版本授权。GOV09 提供参数身份、不可变值结构定义、精确 source-owner 与 parameter 授权、独立批准、指定版本及摘要和完整期间校验。只有合成元数据声明，无运营参数值或表达式执行。已批准结构版本可并存；新版未批准时不顶替既有批准引用。运营参数激活、撤回及消费语义留给 P3-08。维护页 `/admin/vnext/parameter-definitions` 和 `/api/vnext/parameter-definitions` 使用同一 owner。REF01、BIZ02、poly 等未知 owner 依赖仍为 BLOCKED_DEPENDENCY，保留原 target；错误参数版本或摘要失败关闭。

0013 将固定契约、代码集及 GOV09 所属来源纳入来源影响图。来源预览的 contractOpening/Closing 与历史 SOURCE 项并列，采用 EVENT_DELTA_V1 固定义务。发布/废止通过审批摘要固定关闭集合；新的契约影响事件与来源审批或契约发布事件同事务追加。原来源请求重放复用 0010 的冻结 assessment 再授权，扩展 helper 后同样检查原契约消费者。

## 已运行与剩余门禁

命令原始日志在 `D:/Agent-State/HDIP-MC-VNEXT/P0-02/`，各次失败和重跑分文件保留。01/04/07/09/11/13/16/18/26/28 为实际执行的 RED 或缺陷暴露记录，不能把其中环境/工具失败算作领域 RED。最早 tests-only diff/tree/time 没有独立冻结文件；不得把后补快照宣称为当时已保存的证据。

| 原 AC | 当前证据位置 | 范围 |
|---|---|---|
| P0-02-AC-01 | contract-registry.test.ts；29 日志 | 未知字段、定义枚举、生成 schema 错枚举/未知字段 |
| P0-02-AC-02 | 同上 | C 条件 UNRESOLVED 阻断批准 |
| P0-02-AC-03 | 同上 | 发布同一规则版本不新增发布事件 |
| P0-02-AC-04 | 同上 | 原 ruleVersion 不可覆盖，持久历史 schema 保留 |
| P0-02-AC-05 | 同上 | CANDIDATE 代码集不可升级为采纳发布 |

29 验证了 actual fresh、并发 stale loser、最终审计写失败完整回滚、撤来源访问后的原请求重放拒绝、pending draft 下废止 publication、旧 R 可重现。27 为较早候选的 11→12 前缀升级及 codegen；12 为来源映射测试；25 为较早候选 typecheck。上述均须在最终代码上完成适用复验，不能自动视为最终 tree PASS。

真实维护页门禁 BLOCKED：浏览器工具返回 `privileged native pipe bridge is not available; browser-client is not trusted`。没有改平台权限或改走通道绕过拒绝，也没有用 HTTP inject 冒充浏览器通过。

后续证据：44 日志的八组受影响 vNext 回归全部通过；51 为 11→14 前缀升级、codegen 和专项/权限/事务/API 测试通过；46/47 使用连接 guard V2；54 为旧 wrapper 入口拒绝测试；55/57/64/68 为当前 OpenAPI 生成、维护页构建、typecheck、完整构建。61 实际执行 fresh，npm.ps1 消耗了两个参数，因此不算前缀升级；63 改用 npm.cmd，实际完成 11→14 和 codegen，新增期间断言在两次均通过。59 验证实际 PostgreSQL postmaster 变化后，历史 schema、参数批准定义、旧 R 与 ACK 丢失重放一致。实际浏览器证据与构建、HTTP inject 分开记录。

首轮独立审查固定 tree `995c6868465a7720010582d0090f1f556a5ce723`。Spec 四项、Standards 四项阻断已进入修复：API 输入/输出矛盾、参数定义缺口、契约来源影响缺口、原请求授权、废止来源授权及代码集来源检查。修复不能代替最终树复核。Standards 另有摘要表达式重复的低优先级维护建议。

原会话事件导出为 `original-red-events.export.json`，保存原时间戳和原工具输入/输出；`commands-through-43.json` 保存前 43 日志摘要。导出发生于后续，未补造初始 Git tree。49 文件名含 red，但实际 PASS，仅为原有重放再授权的预防回归；50 才是闭合动作/重复枚举的实际 RED，51 对应 GREEN。01 shell 未独立传播 Node 退出码，以原测试 reporter 失败记录为准。

第二轮审查 tree `afd7ec1a985ab23da6ef804ef5ce9928111e7806`：Spec 无代码阻断；Standards 指出累积 trace 不能隔离本次运行。修复后的 tree `355f3e7fd97f021c36ee283dd1a681682bc09fb4` 经 Standards 定向复核，P2 闭合，无新增阻断；66 为其实际运行证据。审查原报告与后续修复分别保存于外部 `review-rounds.md` 和原会话，不追改历史结论。低优先级重复表达式建议保留。

机器映射位于外部 `coverage.json`：53 份契约、866 个字段描述、77 个本票条件 ID 与原 fieldRouting、未就绪引用、标准队列和代码入口相互对应。源条件清单共 196 项；77 是本票契约引用的集合，不把整个源包的条件数说成 77。完整日志索引为 `commands-current.json`，保留每次原调用时间、日志 hash、实际 targetExitCode/cleanupPassed；null 不代表通过。

67 日志最终八组受影响 vNext 回归全部 exit 0；68 完整构建 exit 0。最后托管会话 cleanupPassed=true，serviceInactiveAfterCleanup=true，databaseReachableAfterCleanup=false。运行时资源按本次所有权恢复，不能把临时库清理说成物理清除旧库。

维护页仍是未通过的必需门禁。全部必需门禁通过前，不写 DONE、不创建完成提交。预期唯一提交仍为 `feat(vnext): add governed import contract registry`。后续只能在浏览器信任桥恢复后接续本票；不得因此开始 P0-03。最终 tree 与双轴复核结果写外部阻断交接 receipt，避免文档自引用 tree 哈希。
