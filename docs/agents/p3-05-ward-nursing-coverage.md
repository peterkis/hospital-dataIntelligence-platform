# P3-05 病区护理覆盖操作手册

本手册用于执行 `.scratch/p3-05-ward-nursing-coverages/spec.md` 的合成 CORE
验证和保留部署。基线为 `f3778f73b9765e356f7aa44798685ec486147ed3`，
前驱为 0196；领域决定见根 `CONTEXT.md` 和 ADR0142。
以下描述脚本的完成条件，实际结果必须引用本次运行日志。

## 执行顺序

在仓库根目录核对分支、基线、工作区和写入范围，保留无关改动及
`.codex-remote-attachments`。数据库操作先取得独占执行时段，再按
[Prototype PostgreSQL](prototype-database.md) 使用包装器；每次包装器结束后再开始下一次。
先完成临时库验证与受影响回归，达到当前候选的验证条件后执行保留部署和保留校验。

| 脚本与准确命令 | 目的及完成条件 |
| --- | --- |
| `npm.cmd run vnext:p3-05:unit` | 无数据库的契约、解析与真实只读 HTTP 单元检查；检查实际测试结果与退出码。 |
| `npm.cmd run vnext:p3-05:typecheck` | 票内 TypeScript 编译检查；退出 0。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:validate` | 创建自有临时库，安装完整当前迁移，核对生成 DB 类型及数据库权限，执行 Owner/HTTP/受限 SQL 矩阵，再处置自有库、角色和密钥。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:upgrade` | 用本地 Git 对象的离线归档及原始 Catalog/Owner 在 0196 建立真实 Ward、Nursing、UnitWard 事实，再升级；逐项核对旧行、旧账本、密钥、公共历史、精确版本及原 B/R 查询。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:handover` | 专项真实 Owner、生成 HTTP 与受限 SQL 护理确认权限反例；这是专项检查，不替代完整矩阵。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:handover:upgrade` | 准确 b6515b22/0199 离线源码提交无新确认依据的旧交接并冻结待发候选，升级0200；核对旧行、账本、密钥、历史/B-R/Apply/resume/MATCHED 原样及无回填，旧待发候选须补确认并重新冻结。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:regression` | 顺序运行脚本内的全部受影响检查，分别保留日志；全部退出 0 才是完整回归通过。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:deploy` | 保留库前向升级、角色配置、实际工作台启动；生成客户端通过真实 loopback HTTP 完成 Scope 注册、互斥分区覆盖、确认交接、独立 END、历史读取及恢复核验。 |
| `npm.cmd run prototype:db:with -- vnext:p3-05:preservation` | 只读比对原 0196 部署快照；每个原始行哈希及其重复数量、旧账本、密钥字节和 OID 均须保留。 |

数据库运行成功必须同时具备 `DATABASE_SESSION_READY`、目标退出码 0，以及
最终 `DATABASE_SESSION_CLOSED` 的 `cleanupPassed=true`。仅监听端口、单项
PASS 或中间输出不足以证明成功；检查最终包装器记录。

生成类型需更新时，使用 `vnext:p3-05:validate --generate` 的同一包装器入口。
回归恢复入口为 `vnext:p3-05:regression --from <脚本名>`；它明确记录
`omittedChecks` 并输出 `PARTIAL_PASS`，不能据此声称整组回归已完成。

回归的 authority 项为 `vnext:p3-05:authority`：同一受管运行检查全部模块的
源码 SQL 所有权，再在自有临时 vNext 库核对当前生成类型与 receipt 绑定的
数据库权威。旧 `check:database-authority` 仍保留完整旧谱系检查；旧库类型漂移
属于单独的继承结果，不能据本票 vNext 通过而改写。

## 保留库前置条件与证据

部署必须使用 `.runtime/vnext/creation.json` 绑定的原数据库 OID `206108`，
保留既有 P3-04 至少 0196 的正确校验和前缀，以及 receipt 绑定的
`.runtime/vnext/p0-09/owner-service.json` 和原密钥库。部署复用
`prepareWorkspaceDeployment`，先写原始行/账本/密钥摘要，再安装当前完整迁移；
启动要求当前迁移清单与 Owner 权限均完整。0001–0196 的安装字节保持不变，
后续修复使用前向迁移。保留库部署失败后的重跑沿用原 0196 快照。

临时库 receipt 位于 `.runtime/vnext/fresh/`；升级证据附在该 receipt 后的
`.p3-05-predecessor.json` 与 `.p3-05-upgrade.json`。固定前驱源归档、摘要及
失败诊断位于 `.runtime/vnext/p3-05/`。部署的 `deployment-*.before.json`、
`.migration.json`、`.preservation.json`、`.http.json` 与独立
`original-0196-preservation-*.json` 分别记录各自实际完成的检查。
回归日志和包含每步退出码的摘要位于该目录的 `regression/` 子目录。
连接信息、密钥和受保护源定位信息留在原有受保护或 ignored 存储中。

中断后仅使用该次自有临时库的准确 receipt 恢复处置：

```powershell
npm.cmd run prototype:db:with -- vnext:p3-05:validate --dispose .runtime/vnext/fresh/hdi_mc_vnext_<16hex>.json
```

处置器核对数据库请求、角色 receipt/OID 和密钥归属；缺失或冲突的归属证据
阻止处置。保留库与其他进程、数据库和用户文件不属于该临时处置入口。
原失败日志与后续成功日志分别保存。

## AC 与工程矩阵索引

同一 `vnext:p3-05:validate` / `vnext:p3-05:upgrade` 包装器入口顺序执行
[core](../../tooling/vnext/p3-05-db.test.ts) 和
[extended](../../tooling/vnext/p3-05-extended-db.test.ts)，配置为
[vitest.p3-05-db.config.ts](../../tooling/vnext/vitest.p3-05-db.config.ts)。
同时执行 [handover](../../tooling/vnext/p3-05-handover-db.test.ts) 的护理确认专项。
下列 core 8、extended 56、handover 9 是当前测试定义的展开数量，不是通过数。
完整结论须关联当前候选 SHA/tree、三套 verbose 日志和包装器最终记录；
升级保留、部署、回归及静态检查各自提供独立证据。

| 核心编号 | core 中的实际测试名称 | 对应要求与补充扩展编号 |
| --- | --- | --- |
| C01 | `AC01: independently approved disjoint partitions have separate primary Nursing coverage` | 独立 Scope、互斥分区主覆盖；多病区见 E16，有限 Scope 完整前缀见 E32。 |
| C02 | `AC02: same, partially intersecting and whole-Ward primary coverage are blocked` | 同范围、部分相交、整病区冲突；并发见 E12。 |
| C03 | `AC03: unknown, foreign and wrong-version partitions are not guessed or published` | 未知分区、错误病区与版本；原文/闭合类型见 E05、E11。 |
| C04 | `AC04: END has exact microsecond boundaries and preserves original B/R and terminal cancellation` | 半开微秒 END、原 B/R、起点取消；有限/空结束见 C07、E01、E24、E30。 |
| C05 | `AC05: unconfirmed handover rejects the entire revision; exact confirmed handover is atomic` | 未确认整批拒绝、准确确认原子交接；未来与独立 END 见 C06、E19、E27–E29。 |
| C06 | `ending first cannot bypass independent confirmation for a later replacement primary` | 独立 END 后普通 CREATE 不能绕过确认。 |
| C07 | `latest finite declarations do not fall back to the original unbounded version` | 最新完整有限声明不回退旧开放版本。 |
| C08 | `current underlying identity, source aliases and exact durable replay govern the public Owner` | 同人别名分离；真实 authority fixture 切为 SERVICE 后 Owner 核验/审阅/审批及受限 SQL VERIFY/REVIEW 拒绝，恢复 HUMAN 后继续同候选；准确重放、resume、MATCHED 与 outsider 拒绝。补充 E06–E10、E15。 |

下表名称与 extended 源码一致；`%s` 和 `${identity} ${permission}` 按列中参数
展开，37 个定义共 56 个用例。工程验证使用真实 Owner、生成客户端 loopback
HTTP，以及实际受限应用角色的签名 SQL；SQL 探测回滚，不代替实际 Apply。

| 编号 | extended 中的实际测试名称 | 展开数 / 验证面 |
| --- | --- | --- |
| E01 | `actual generated HTTP %s preserves all 14 fields, raw bytes, null/empty and timestamp lexemes through Apply` | 3：CSV/JSON/XLSX；真实文件、原字节、隐私、14 字段。 |
| E02 | `partition source order and equivalent review time lexemes remain evidence after publication` | 1：原分区顺序与等价时间词法。 |
| E03 | `actual XLSX %s barrier retains rejected evidence and publishes no coverage` | 4：MACRO/FORMULA/HIDDEN/EXTERNAL。 |
| E04 | `actual JSON duplicate keys, escaped duplicate keys and unknown fields cannot become last-write-wins coverage` | 1：重复/转义重复键、未知字段。 |
| E05 | `protected Owner retains unknown raw scope %s for review and refuses publication` | 3：自由文本、重复 kind、bedNumber 额外字段。 |
| E06 | `actual %s repeated source aliases block the complete reviewed batch` | 3：CSV/JSON/XLSX；整批源别名冲突。 |
| E07 | `actual restricted signed SQL rechecks current ${identity} ${permission}` | 5：maker WRITE/READ_RESTRICTED；reviewer REVIEW/VERIFY/READ_RESTRICTED。 |
| E08 | `a semantically equal new verification invalidates the frozen exact verification pin in Owner and signed SQL` | 1：语义等价也须重新冻结核验 pin。 |
| E09 | `equivalent complete Ward revision requires new frozen dependency pins in Owner and signed SQL` | 1：上游等价新版本仍令旧候选过期。 |
| E10 | `restricted application role rejects forged SQL authority and direct table mutation` | 1：伪造授权/直接表写拒绝；reserved/state/group_validate 三个内部函数的受限角色 EXECUTE 权限均为 false。 |
| E11 | `actual HTTP closed typed anchors reject wrong Owner, unsupported purpose and extraneous fields` | 1：准确 Owner/用途/闭合字段。 |
| E12 | `real concurrent primary candidates cannot both commit for the same logical coverage` | 1：并发主覆盖仅一方提交。 |
| E13 | `real concurrent revisions use expected head and preserve the losing outcome as absent` | 1：期待 head、败方无结果。 |
| E14 | `%s failure rolls back identities, versions, audit and durable outcome together` | 2：LATE_ROW/AUDIT；全部原子回滚。 |
| E15 | `ACK loss recovers exact committed result without a second version and current access still gates recovery` | 1：ACK 丢失、准确恢复、当前权限。 |
| E16 | `one Nursing identity may cover multiple Wards in its campus but cannot cross campus by assertion` | 1：同护理身份多病区及跨院区拒绝。 |
| E17 | `Nursing pause preserves declared primary coverage and history while precise current-admission gaps block expansion and allow END` | 1：暂停影响、原占位/历史、准确缺口与安全 END。 |
| E18 | `Ward closure inside a request window retains its admitted prefix and blocks only the uncovered suffix` | 1：病区关闭后的准确窗口与影响。 |
| E19 | `future independent confirmed handover is scheduled before cutover and effective at cutover; standalone END stays not completed` | 1：scheduled/effective 与独立 END。 |
| E20 | `non-primary intersecting peers use one complete independently reviewed collaboration and do not require invented primary continuity` | 1：完整非主协作；主连续性单独呈现。 |
| E21 | `unknown collaboration and incomplete intersecting participants cannot ALLOW a complete revision` | 1：未知协作/不全参与者阻断。 |
| E22 | `extra declared collaboration participant requires current full-window admission in Owner and signed SQL` | 1：额外参与者全期间准入。 |
| E23 | `same-set scope and period reduction remains possible after Nursing suspension without rewriting the old accepted declaration` | 1：同集子集/缩期安全收缩。 |
| E24 | `generated endpoint impacts retain original scope and digest while finite reduction, END and cancellation change only current obligations` | 1：原 Scope/digest、当前义务、结束/空窗口及 outsider。 |
| E25 | `exact committed successor CREATE proof may satisfy the old coverage case while wrong case Owner and request remain rejected` | 1：科室暂停窗口、准确已提交接替证明、错误事项/请求拒绝；补充断言要求：同 Owner 但另一 Ward 的普通 CREATE proof 须拒绝。 |
| E26 | `a live non-primary responsibility may add a reviewed collaboration participant without a handover or removal` | 1：在用非主协作新增参与者。 |
| E27 | `standalone END of a positive non-primary responsibility cannot authorize an ordinary replacement CREATE` | 1：非主独立 END 不授予普通接替。 |
| E28 | `signed SQL rejects a frozen additive non-primary CREATE after the live predecessor is independently ended` | 1：冻结后前驱结束的 SQL 重审。 |
| E29 | `independently confirmed equal-scope non-primary END and CREATE commit as one exact atomic handover` | 1：非主同 Scope 交接、同根 R/change、准确恢复。 |
| E30 | `cancellation at a future %s primary-marker start leaves zero responsibility and permits later ordinary initial coverage` | 2：Y/N；起点取消后零责任及后续初始覆盖。 |
| E31 | `full-window %s source gaps use current exact versions without older-open fallback and preserve historical admission` | 2：LEAF/PARENT；准确当前来源/父版本与旧 R。 |
| E32 | `a finite approved scope set preserves covered primary partition prefixes in a longer whole-Ward request` | 1：Jan–Mar 完整主分区仍保留 SATISFIED 前缀；Jan–Apr 整病区请求的三类 gap 只覆盖 Mar–Apr 后缀。 |
| E33 | `R1: explicit PARTITIONS finite scope prefix remains in a longer current window` | 1：真实生成 HTTP 的显式分区长窗口保留 Jan–Mar 前缀，三类 gap 仅为 Mar–Apr；对应 PR35 外部审查 R1。 |
| E34 | `R1: explicit PARTITIONS %s %s windows retain microsecond prefixes and definition gaps` | 4：CURRENT_ADMISSION/HISTORICAL × FINITE/UNBOUNDED；定义之前与之后的缺口、最后一微秒及结束切点；历史 R 在后续 END 后仍保留原声明。 |
| E35 | `R1: explicit PARTITIONS read identity still rejects wrong Ward, version, members and current access` | 1：两种模式均拒绝错误 Ward、版本、未知集合/分区及当前无权人员。 |
| E36 | `R1: finite PARTITIONS reads do not relax full-period revision or restricted SQL admission` | 1：超出定义期间的 REVISE/plan 仍阻断；实际受限 SQL 的完整窗口约束保持；旧事实/版本不变。 |
| E37 | `R1: whole-Ward coverage cannot extend an explicit partition past its frozen definition` | 1：全病区声明仍不能使已失效冻结定义的显式分区在定义之外满足。 |

E10 的准确内部签名为 `care_organization.ward_nursing_reserved(uuid,timestamp)`、
`care_organization.ward_nursing_state(uuid,timestamp,timestamp)` 和
`care_organization.ward_nursing_group_validate(uuid,timestamp)`；撤去应用角色的
直接内部授予后，逐项要求 `has_function_privilege(current_user,signature,'EXECUTE')=false`。
E25 的同 Owner/别 Ward 普通 CREATE proof 反例须关联新增断言及其实际日志；
此映射不登记其结果。E32 同样须验证真实生成 HTTP 的完整前缀和准确后缀，
不能把有限 Scope 不覆盖整个请求窗口解释成整窗无覆盖。显式 PARTITIONS
读取先在定义自身的批准期间内核验准确身份、版本、成员、Ward/Campus 与访问权，
随后按请求窗口与定义期间的交集评估；定义之外保留指定分区 ID 的明确缺口。
这不放宽写入：CREATE/扩张等仍调用原 SQL 完整期间包含约束。

无数据库 unit 还覆盖范围登记 applicability 与 CREATE/REVISE/END 文件操作的
未知属性拒绝、真实请求超限413，以及共享错误处理器413/500的公开Schema声明。
Type.Omit 的闭合选项须显式保留，ScopeSet响应同样闭合；OpenAPI与客户端只由
官方单向生成器更新。实际413 HTTP与500源码分支/声明核对分开记录，静态声明
不是已运行500业务错误的证明。生成物正文与全部变更应独立读取，生成器一致性
PASS也不能替代该静态审阅。

护理确认由 `POST /api/vnext/nursing-units/handover/confirm` 的护理 Owner 独立处理，
生成客户端调用 `confirmCoverageHandover`。请求绑定已接收覆盖输入的 ID、摘要、
原输入行及完整交接，返回不可变确认 ID/摘要；覆盖核验在 CONFIRMED_HANDOVER
中引用 `nursingConfirmation`。确认须护理 REVIEW、当前 HUMAN、与输入提交人底层
身份分离；护理 READ 和覆盖 VERIFY 均不足以签认。新 Apply 在同一事务重新核验
确认人的当前权限、身份、准确依据与材料。0200 为前向迁移，旧已提交事实及原
结果不补写确认，恢复仍按当前调用方访问权检查。待发布旧候选需补确认并重建
冻结候选。单独安全 END 不要求新的护理交接确认。

| 护理确认专项 | 实际动作与断言 |
| --- | --- |
| H01 | 覆盖 VERIFY 加护理 READ 无法确认及提交切换；旧关系保持单版本。 |
| H02 | 覆盖核验 `confirmed:true` 无护理依据拒绝；受限签名 SQL 缺依据亦拒绝。 |
| H03 | 真实护理 HTTP 准确确认、同授权核验人组合角色、原子 END/CREATE；撤护理 REVIEW 后已提交结果恢复及安全 END 可用。 |
| H04 | 同底层人账号别名及实际 SERVICE 身份拒绝护理确认，恢复 HUMAN 后正向确认。 |
| H05 | 批准冻结后撤护理 REVIEW，Owner 与受限签名 SQL 均整批拒绝，无结果及半个切换。 |
| H06 | 独立护理确认人仅持护理 REVIEW 与准确读取权限；仅该人变 SERVICE 后拒绝，覆盖核验人仍 HUMAN。 |
| H07 | 错原输入行、接收方、输入、摘要及篡改确认依据拒绝，正确依据正向提交。 |
| H08 | 真实 XLSX CREATE 在输入首行时仍按原核验行绑定；END 排序及物理源行不改确认语义。内部 helper/base 与确认表的实际应用/PUBLIC 权限拒绝。 |
| H09 | 已独立 END 的当前头允许同点再次 END 加准确确认的原子接替；不得延后历史最早 END，原 CREATE/END 精确事实保留。 |

矩阵之外仍须单独核对 fresh/真实 populated0196 upgrade 的生成类型与数据库权限、
根 typecheck/build、契约、模块边界、完整启动及受影响回归；保留部署必须另取
OID/旧行/账本/密钥保留和生成 HTTP 证据。测试存在、单套绿色或部分回归不替代这些要求。

## 结果边界与停止条件

ORG11 的全部 14 字段、源字节/词法/顺序及 null/空值区别保留为证据。
逻辑 Scope 由完整且互斥的分区独立批准；同用途主覆盖的相交声明冲突。
确认交接绑定原始准确 head、相同 Scope、接替护理身份及准确切点，原子
END+CREATE；独立 END 不构成已完成交接。原业务时间 B 与数据库发出的 R
可回读，精确重放不产生新事实，恢复与对账要求原结果及 `MATCHED`。

结果只覆盖 TEST POLICY ONLY 合成 CORE：院方政策 `NOT_ADOPTED`、临床
`NOT_READY`、FULL `BLOCKED_DEPENDENCY`。专用浏览器验收、完整重启、容量和
正式验收保持 `NOT_RUN`，继承的待验证证据保持待验证；Q09/A019 仅记实际完成的
ORG11 病区护理关系部分。
本票完成后停在用户授权的本地提交及 ignored 精确 SHA/tree/证据交接。
不执行 fetch、push、PR、merge、工作区/分支清理或下一票。
