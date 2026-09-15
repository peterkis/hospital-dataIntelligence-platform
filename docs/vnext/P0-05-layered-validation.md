# P0-05 有限分层校验

## 范围与来源

从 merged main `fe078b800586199d068d840a697108dd8c453543` / tree `d45f686e7db05c54e2fbe7971a672299ce8aa362` 接续。唯一持久研发库仍为原 creation receipt、OID 206108；本票 mutating tests 全部使用 P0-05 或原回归票的 receipt-owned 临时库。原包不可变，字段/条件来源通过现有 manifest 校验后生成 `validation-sources.generated.ts`。

本票交付 typed Owner API，无新增 HTTP 文件路由/页面。原 P0-02 browser `BROWSER_BLOCKED`、ADR0081 容器环境 NOT_RUN、扫描 NOT_RUN、跨进程密钥恢复 NOT_READY 继续保留。P0 仍 IN_PROGRESS。不创建 ORG/PER 业务实例，不执行计划、审批或业务 Apply。

## 解析与文本解释

`openCatalog(connection, provider)` 共用一个 P0-11 key provider。`parseFile` 在同根事务保存 RAW_CELL 和只追加的 parse_provenance。解析签名使用 provider.lookup 的域分离 HMAC，绑定解析制品、job、revision、exact contract 与完整密文解开后的 payload。通用 RAW_CELL 不构成解析证明；旧制品无出处时拒绝，不回填。原文件仍可授权读取且同一 provider 尚存时才可重新解析。

校验同时核对来源记录、RAW_FILE/RAW_CELL 的加密绑定、policy、完整 rows/cells/manifest/问题结构。REJECTED 不是零行成功。新结果接受前仍持有共享授权锁，重新检查 revision、WRITE/READ/STORE 权限、原始/解析/结果制品保留状态。解析、校验都不改变 QUARANTINED。

STRICT_V1 保持原行为。显式 STRICT_V2 只把空 datetime 的必填判定移交字段层，非空非法日期仍拒绝；格式/ZIP/XML/XLSX 限制不变。空 JSON null、缺列不转换。EXACT_TEXT_V1 使用严格十进制词法、真实日历及现有无 offset 本地时间原语；代码/id 保留 `0012`。金额以字符串核对源 DECIMAL(18,6)，整数检查源 32 位范围。无 trim、Number/Boolean 全量强转或小数舍入。可空只接受 exact 契约 O/C 声明；C 的适用性未知时继续阻断。当前 field schema 无 boolean 类型，yes/no 等按 adopted 枚举文本检查。

## 有限规则与状态

新契约规则仍由原 contract Owner 管理，不另建规则表/发布流程。UNRESOLVED 历史定义不变；MACHINE/MANUAL_EVIDENCE 只接受原 source snapshot 中同 dataset/field/id/text 的条件，绑定 P0_05_SOURCE_V1。C 字段的 EVALUATED 必须有唯一 MACHINE 条件。实际可执行的 SRC-COND-061 仅解释已采纳 HUMAN/SERVICE，其他/空/未采纳代码为 UNKNOWN。未就绪的 references 和人工证据仍阻断原契约发布，53 份 DRAFT 不自动发布。

77 条映射逐条保留原文、字段、证据责任 Owner、所需判断/材料、true/false/unknown 处置与版本。76 条自然语言条件涉及行外事实或专业认定，形成具名人工证据要求；本票没有可认证这些材料的 Owner，故实际运行只产生 BLOCKED_DEPENDENCY，不接受客户端勾选。原文未被自动翻译成机器事实；没有声称这些业务条件已判断为真/假。119 条非 ORG/PER 源条件只保留范围外参考。

L0 来源/结构、L1 字段集合、L2 类型/空缺/条件、L3 批内源标识、L4 typed 引用、L5 半开期间、L6 领域能力、L7 当前授权安全状态、L8 dry-run、L9 Apply、L10 reconciliation 保持原编号。未实现领域 Owner 使整体 decision 为 BLOCKED；FAIL 表示已有确定错误。即使所有已执行字段检查通过，也不声称整体业务准入通过。L8–10 NOT_RUN，扫描独立 NOT_RUN。

typed 引用核对目标类型、scope、stable identity、版本及完整期间。真实 GOV09 定义读取通过 parameter_read 公共 Owner；ORG/PER/REF/BIZ/PAT 能力不注册 READY。隔离纯规则测试提供依赖观察证明错类型/期间拒绝，不作为真实 Owner 已实现的证据。完整窗口分段保留微秒及 null 无界；oracle 通过离散微秒集合独立对照。

## 不可变运行与受限解释

`validateRevision` 输入为封闭的 job/revision/解析 artifact 引用、权限维度、request/outputRequest 和 retention；不接客户端 rows、结论或依赖快照。`evaluateRuleSet` 是 Owner 内部纯计算边界。`explainIssue` 按当前权限返回受限详细解释，明确 historical/isCurrentRevision；`compareValidationRuns` 在同一授权事务读取两者，只输出是否同结论及版本差异。

每个 run 绑定 job/revision、原文件/解析/结果制品、exact contract、rule/parser/interpretation policy、依赖观察与数据库评价时点。结果明细在 P0-11 ERROR_REPORT 中加密保存；普通元数据只保留有限状态/计数/技术引用。运行 HMAC 同时覆盖全部上述绑定元数据和完整结果字节，解释、比较、ACK replay 均验签。低熵原值不生成公开普通 SHA。

两张新增表启用 RLS、禁止应用直接写入，Owner 通过有限 SECURITY DEFINER 函数访问。与 P0-11 的本地合成可信应用边界一致，SQL envelope/签名参数本身不是证明：只有持有当前 provider 的 Owner 验签后才能输出可信运行。数据库管理员可绕过物理约束，不声明抵抗管理员；直接 SQL 造出的无有效签名记录不能通过公共解释或重放验签。

结果制品、run、request/outcome、audit 同根提交。相同 request 同意图重放旧 run 并重查当前权限；不同意图冲突。新 request 新 run，不覆盖旧记录。job 冻结契约不可替换：新契约版本重评同一文件时创建新 job/FILE revision，不修改旧 job 的绑定。历史读取并不恢复过期/已清理制品或遗失密钥。

执行限额复用 1000 行/100 列/1 MiB 制品，额外限制 100 条契约规则、1000 依赖观察、10000 个结果定位。超限失败，不截断后通过。现有全局授权锁串行化有限计算，属于本地合成范围，不作生产吞吐承诺。

## 验收与证据

日志在 ignored `.runtime/vnext/p0-05/`，最终 handoff 记录精确 tree/commit。原 AC 保留：

| AC | 证据边界 |
|---|---|
| P0-05-AC-01 | validation.test：独立离散微秒 oracle、缺口及无界窗口 |
| P0-05-AC-02 | 未知账号类别及 77 条证据门禁；UNKNOWN 不按 false 放行 |
| P0-05-AC-03 | validation-owner：新规则/新 job/new run，旧 run 和解释不变，数据库不可变保护 |
| P0-05-AC-04 | typed reference helper 与 evaluateRuleSet 接线的错类型/scope/version/完整期间断言 |
| P0-05-AC-05 | 相同输入/规则/观察的业务结果一致；两个 run 身份独立，ACK 重放相同 |
| P0-05-AC-06 | 77 项逐条源对应、119 范围外、BIZ/PAT 拒绝和真实 adapter NOT_READY |

`vnext:p0-05:validate` 顺序运行来源、parser、规则、真实 fresh/30-prefix upgrade、P0-04/11/03/02 回归、类型及 API build；任一步非零整体失败。它不迁移当前持久库。最终安装单独经 wrapper 前向迁移、types verify、authority，并保存回执。

历史失败如实保留：01 为日期语义实测 RED；04 为新模块尚不存在的入口 RED；06/08 为临时库任务白名单设施失败（08 的 receipt-owned 空库由 10 精确清理）；11 为内部 SQL 授权调用缺陷；13 为 fixture stale head/非法过期时间；15 为 decimal 源精度 RED；16 为无效 weight 样本；19 为 fixture 漏声明 account_kind 源引用。它们不冒充同一种领域 RED。最终门禁结论以 handoff 索引为准，不根据日志文件名推断 PASS。

## PR7 第一轮修复

远端 Codex 对初始 head `5b5d7b3` 提出三项 P2，分别为重复行、复用结果 request 和 V2 报表接线。`pr7-r1-*-red.log` 保存纯规则/导出及真实 Owner 反例。

按照 ADR0011，同键完整内容相同的行记录为 duplicates 并忽略后续处理；不同内容仍为 CONFLICTING_SOURCE_ID，首行已有错误不会被其重复行抵消。新的受限结果显式标记 EXACT_ROW_V1；历史结果不补写 duplicates 或政策版本，原 HMAC/解释保留。

新 validation request 需要未使用的 outputRequestId；0034 在原授权锁内、计算和存储前检查同一 underlying identity 的请求占用，返回 REQUEST_CONFLICT。相同 validation request 的 ACK replay 仍返回原运行。0031–0033 已安装文件未改写；33-prefix 升级测试保留旧 run、解释和重放。

issueWorkbook 接受明确的 STRICT_V1/STRICT_V2，真实受保护 File Owner 验证 V2 结构拒绝后仍可导出问题工作簿；其他格式政策仍拒绝。
