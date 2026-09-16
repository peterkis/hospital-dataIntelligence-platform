# P0-07 Dry-run 与影响预览

接续 main `f97444f77a7d17487540cdc382c5626260a8ca21`，tree `c236589019b5e4e794bfb47b39cf1bed1517fc9c`。用户提供的“P0-07 当前合并基线接续说明”优先于 v3 原票的历史开工观察；原五项 AC 的 ID 和文字保留如下。范围为 local-only 的规划、解释及冻结前复核，不执行 P0-08、持久库迁移、角色部署或领域写入。

## 当前 Owner 接线

`openCatalog(connection, provider)` 提供 closed typed API：`buildDryRun(actor, input)`、`planApplyUnits(actor, input)`、`explainImpact(actor, input)` 和 `freezeApprovalCandidate(actor, {planToken})`。前三者读取相同的受控预览；输入只有精确 job/revision/run、权限维度和显式意图/行引用，不能传入 rows、PASS、unresolvedCount 或依赖已就绪声明。现有调用方为 `tooling/vnext/dry-run-owner.test.ts`，无新增 HTTP/UI 接口。

每条命令绑定解析行位置。局部引用为 `JOB_ALIAS`，仅解释在该 job/revision 中的行，不按业务键、姓名或同名科室 upsert。CREATE 禁止目标永久 ID；其他意图要求显式 typed target 和 expectedVersion。仅生成 `CHANGE_PLAN` 控制平面引用，不生成 Person/Department 身份。全图歧义、未知 alias 或未声明环会返回空单元，不保留“先导成功行”。当前没有已声明业务 bundle；SPLIT/MERGE/TRANSFER 保留意图说明并返回 `BUSINESS_BUNDLE_REQUIRED`，不猜单行原子性或用 SCC 推导事务政策。

真实 ORG/PER adapter 仍为 NOT_READY；当前契约没有已实现的领域意图变换或目标读取 Owner。因此图只解释显式意图依赖，业务 diff 为 `NOT_EVALUABLE`，当前目标版本与受影响关系数为 null。未声明的关系字段另报 `UNDECLARED_RELATION`。不将这些图单元注册为真实 Owner 的可应用计划。关闭意图仍可分析，不调用扩张准入 writer；真实关闭、拆分、合并、调动政策保留给相应领域 Owner。

输出区分 `analysisAvailable`、`prerequisites`（质量/证据/领域/图）、`candidateFreezable` 和 `applyImplemented`。不先要求 P0-06 的 `eligible=true`；L8–L10 NOT_RUN 不阻止 dry-run 分析，也不改写旧 ValidationRun。没有真实领域依赖时，证书保持 BLOCKED，候选不可冻结，Apply 未实现。隔离纯规则目标观察只能证明 expectedVersion 漂移处理，不能证明真实 ORG/PER 目标已读到。

## 证据与冻结边界

Owner 使用 `createValidationEvidenceReader(...).readInTransaction(..., true)` 验签 ERROR_REPORT 和真实 parse provenance；另授权读取绑定的 RAW_FILE。通用 RAW_CELL、缺 key、过期/清理 payload 都不能冒充完整证据。通过提取的窄内部 `qualityEligibilityInTransaction` 复用 P0-06 原 SQL 资格语义，expected/ingested/missing 对应精确 run，历史 unresolved/manual/dependency 仍来自全部同 job/campus/purpose 未解决事项，不复制计数 SQL。

原观察包含精确制品、契约/规则/解析/解释 policy、变换版本、质量事项与处置流水位、目标预期版本、当前契约 head、diff、图和单元。HMAC 绑定这些依据、完整已验签数据、原文件内容、当前 job、原始意图与精确 actor。公开 binding 是域分离 keyed digest，原值和低熵行键不进入公开普通 SHA、日志或 token。token 仅承载技术引用、用户显式意图、观察 R、plan ID 和 binding；它是防篡改的预览复核凭据，不是授权令牌、已批准候选或持久计划表。敏感读取仍按当前 actor 的精确权限执行，别名身份不能复用另一 actor 的 token。

freeze 在一个数据库根事务和既有 `901002` 授权/作业锁内重新读取上述依据，不串接自行开事务的 root API。job revision、文件、质量事项/处置、契约 head 或其他绑定发生变化时返回 STALE/需重建；旧 token 和原观察保持不变。权限撤销直接拒绝；证据过期/清理返回 BLOCKED 或受限读取错误，不产出候选。没有领域 Owner 时，即使绑定未变也返回 BLOCKED、`candidate=null`、`approvalGranted=false`。将来 P0-08 必须独立完成当前授权、依赖与原子 Apply 门禁，不能把本票 token 当作批准。

观察 R 使用 DB 生成的 Asia/Shanghai 无偏移微秒时间，独立于 validationRecordedAt。没有将 R 当作业务 B，或者把未知目标写成“影响 0 条”。

## 写入与环境

无新 DDL、无业务 writer 调用，也不通过回滚业务写入伪装 dry-run。读取会追加既有授权审计、受限读取 outcome/audit；这些是允许的控制平面副作用。计划只作为返回值和签名 token 存在；无新 plan/candidate/evidence 表或 payload 复制。每次分析是新的观察，不承诺跨进程 key 恢复或 token 永久可用。质量事项最多读取 1000 项，超限明确拒绝，不截断后签发候选。

G0 实查唯一持久库 receipt 身份匹配，37 项已安装 checksum 通过。持久库保持 **CURRENT_DB_INTEGRATION_PENDING**，未安装 0038–0048，未配置持久受信 Owner。P0-07 的临时测试使用候选源码最新前缀 0048 和既有临时 Owner，仅增加 P0-07 task allowlist；清理按 receipt/OID/用途校验。未改写已安装 SQL 或旧数据。

## 验收与命令索引

| ID | 必须证明 | 方法与边界 |
|---|---|---|
| P0-07-AC-01 | dry-run不能分配永久Person ID | 规则图只含行/单元引用；真实 DB 预览只生成 CHANGE_PLAN，现有身份/版本/作业/证据/质量行计数不变。 |
| P0-07-AC-02 | 关系对象同批引用可预览 | 纯规则拓扑性质及真实 Owner 同作业局部引用图；没有领域契约映射时明确 BLOCKED/NOT_EVALUABLE，不宣称关系 Apply。 |
| P0-07-AC-03 | 更新期待版本漂移提示STALE | 隔离纯规则目标观察测试，包括超过 JS 安全整数的版本；真实 ORG/PER 读取未实现，仍 NOT_EVALUABLE。 |
| P0-07-AC-04 | 文件改一字审批候选失效 | DB 接收只改一个字符的新修订，旧防篡改预览凭据复核返回 STALE；不冒充已存在可执行批准。 |
| P0-07-AC-05 | dry-run副作用计数为0，允许控制平面审计 | DB 验证领域 schema 不存在、业务/输入/质量元数据行计数不变；允许并明示受限读取审计/outcome。 |

命令：`vnext:dry-run:unit`、`vnext:dry-run:typecheck`、`npm run prototype:db:with -- vnext:dry-run:validate`。专项 runner 在 owned 临时库 fresh 安装 0048，verify 既有生成类型，执行规则及 Owner 测试，最后清理临时库/角色。共享质量 seam 回归使用现有 `vnext:quality:upgrade` 的默认 37→48 路径，只运行一次该组合，不重演历史 prefix 修复矩阵。补充 API typecheck/build 与 module-boundary 检查。

Q02/Q04 与 IMP007/011/012/013/017、A006 在本票仅覆盖可信输入、显式意图/引用、完整绑定与零领域写计划边界；真实领域准入/Apply、扫描、跨进程密钥恢复、阶段浏览器与正式验收不标 PASS。原 P0-02 **BROWSER_BLOCKED** 保留。

实际命令、首次失败、重跑、最终同候选 Spec/Standards 串行自审及 commit/tree 记录在 ignored `.runtime/vnext/p0-07/`。首次失败为测试统计表名错误；后续类型检查曾发现拓扑测试的字面量类型扩大，均保留原日志。最终结果以 handoff 为准，不用原包全 NOT_STARTED 模板覆盖当前状态。

## PR #9 审阅修复

受限 READ 会在拒绝或解密之前写入审计。预览根事务现在通过内部 scope 的只读审计回调，在每次 protected READ 返回后保留 savepoint；后续应用错误或 SQL 中止只回到最近的审计检查点，提交原审计后再传播错误或映射 BLOCKED。仍然只有一个 pool 和根事务，不重新执行读取来伪造原时点审计，也不改变文件、校验或质量写事务的回滚策略。测试覆盖预览/冻结撤权、缺 key、密文认证失败、解析证据到期及后续 SQL 故障；故障注入仅发生在 receipt-owned 临时库。

局部 alias 边还核对唯一声明的 reference 类型和精确目标数据集。GOV09 DECLARED_PARAMETER、其他 dataset、缺失或歧义声明不能指向当前 job 行；不兼容边使整张图 BLOCKED 且没有 apply units。纯规则 fixture 保留同 dataset 关系图的正向证明；真实领域 Owner 的 NOT_READY 边界不变。两项远端反例首先实测失败，原日志与后续回归分别保存在 `pr9-r1-*`。

第二轮将已验签解析行可用性、目标 dataset 和每条命令内的引用字段唯一性统一放入图检查；任何缺失行或歧义标量关系都清空 order/units，并使 graph 前置条件为 false。不同命令可以各自使用同一个引用字段。拓扑规划改为一次排序确定并列顺序，再通过入度/邻接队列逐节点、逐边处理；1000 行/每行最多 100 依赖的对抗图有独立性能反例。变换版本升为 DECLARED_INTENTS_V2，旧观察不能静默复用旧摘要。三项反例先失败再修复，见 `pr9-r2-*`。

第二轮失败运行的临时库曾拒绝清理（UNRELATED_SESSIONS_PRESENT），保留原失败记录；仅对该 P0-07 receipt 与其匹配 Owner receipt 通过 runner 的 `--dispose` 恢复入口核对身份和零会话后清理，不使用 FORCE，不改持久库或其他角色。

第三轮为 closed input 增加公开说明的总编码容量准入：单数组结构上限之外，还按完整意图与 actor 的 UTF-8/base64 长度、固定 ID/HMAC 和保守 R 长度预留检查 1 MiB token 预算。超限返回 PLAN_INPUT_LIMIT，发生在打开事务或读取任何受保护证据之前；准入成功后实际 token 不超过同一上限。该检查不访问 key provider，已有受限读取/缺 key 审计语义不变。1000×100 依赖反例先失败，较小宽图返回有界 token 并可重新复核，见 `pr9-r3-*`。
