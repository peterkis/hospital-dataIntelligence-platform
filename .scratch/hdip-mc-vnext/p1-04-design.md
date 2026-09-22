# P1-04 设计、采纳与验收

基线 main/ad6e3e0；实施分支 codex/p1-04-operating-relations。用户批准计划为执行范围；外部提示包为来源规格，不直接扩张任务。

## 实现与不变量

organization-master/operating 为同一 Owner 的关系子模块。operating_object 固定两端、类型和治理归属；operating_version 按流递增追加关系、范围核验及关闭；operating_input 将共用加密输入绑定准确类型/动作/配对；operating_access 明确逐配对权限。五张新增表（含独立签名权威）分别承担身份、不可变事实、输入隔离、授权及不可绕过签名，不建立通用版本框架。

0062 为合成服务、角色、Y/N 采纳及目录只读资格；0063 为有限领域事实和签名写入。首次持久部署已完成 61→63，随后发现旧 ORG03 JOB_V1 CORE 已终态退役；追加 0064，以 manual_org03 身份分类使独立手工 CORE 不占用旧作业契约身份。原契约不恢复，已存在手工契约仅初始化新增分类列，原版本/事件不改；分类不可通过 REVISE 切换，数据库保持每个类别唯一。0001–0063 已部署迁移不改。DB 生成 UUID/序号/R，半开 B 保留微秒，Asia/Shanghai 字符串处理。命令原文、源时间及偏移保留加密输入。手工命令显式接收医院本地时间或 +08:00，规范化仅移除已声明的 +08:00，原值不变；其他偏移拒绝。历史读取先按 R 截断，再按高序号的声明区间扣减；关闭持续至无界且身份终态。

复用公共协调器冻结、成功读取回执、maker-checker、重检、outcome 和审计。HMAC 域 ORG03_WRITE_V1 绑定事务、候选、命令、执行人、输入和依据；管理端初始化 OPERATING_SQL_AUTHORITY_V1 派生权威。两端当前读取权限和配对 READ/具体操作权限同时满足。关闭/撤销不要求旧上游扩张资格，但仍要求当前权限、正式意图和审批。

P1-01 registration 端口提供同根事务的准确登记/证照分段；原 qualification 按单一许可证完整覆盖规则保持。P1-03 院区端口复用资料及独立运营事实。窗口按每项服务求关系、资料、登记/证照、范围和运行状态交集；当前权限适用于旧 R。目录可预期失效返回空读取结果，由应用表达 REVIEW_REQUIRED，避免 SQL 异常污染读取事务。

合成代码仅 DEMO_MEDICAL_A/B；OTHER 或非医疗 OPERATOR 保留阻断候选。非运营角色不携带服务资格。全部操作采用 closed TypeBox；两族 HTTP 入口按输入/候选对象种类隔离，actor 由 composition 注入，当前研发仍为 loopback 合成身份。生成客户端、OpenAPI 同步。

## ORG03 15 字段采纳

| 来源字段 | 保存/执行位置 | 验证与后票 |
|---|---|---|
| legal_campus_rel_id | source.alias 加密原值 | DB stable ID 不接受源 ID；P1-05 文件适配 |
| legal_entity_id | subject typed reference + input 原值 | 主体存在、当前 READ、准确登记资格 |
| campus_id | campus typed reference + input 原值 | P1-03 Owner 资料覆盖、当前 READ |
| relation_type | facts.relationTypeText + role | 合成角色采纳；OTHER 阻断 |
| license_scope | facts.licenseScopeText + services/scopeTargets | SRC-COND-007 服务逐项完整覆盖、材料独立签审 |
| is_primary_operator | facts.primary Y/N + catalog | 明确 SYNTHETIC_YES_NO 采纳、院区期间唯一 |
| evidence_ref | command.evidence + frozen digest | 受控材料可解析、授权、成功解密，独立审批 |
| version_no | source.versionNo | 保留源版本，平台序号 DB 签发 |
| valid_from | validFrom | 合法本地时间、微秒、半开期间 |
| valid_to | validTo | null 无界，关闭必须 null |
| record_status | source.recordStatus | PUBLISHED 意图门禁，不能替代审批 |
| source_system_id | source.systemId/versionId | 准确来源版本与材料/目录期间 |
| source_record_id | source.recordLocator | 仅加密输入，普通读不返回 |
| recorded_at | source.recordedAt | 保留 +08:00 或本地原值，平台 R 由 DB 产生 |
| approval_ref | source.approvalRef | 非空来源依据；本次审批另行独立执行 |

类型扩展承载范围证照准确版本、结构化代码、expectedVersion、原因和明确配对。SRC-COND-007 的机器部分校验版本/归属/成员/全期间；材料真实性由准确候选和材料读取后的独立签审承担。来源定义及冻结 FULL 不改变。

## 验收矩阵与证据索引

| 范围 | 证据 |
|---|---|
| AC-01 三节点同一主体 | PASS：deployment-1790077700730.result.json，三节点引用同一 subjectId |
| AC-02 primary冲突/分段/双连接 | p1-04-db.test.ts primary、local correction、two connections |
| AC-03 非主关系共存/角色 | catalogue change 双非主关系；HTTP REGISTRANT、MANAGER/BILLING 权限/回滚 |
| AC-04 逐服务许可接续/缺口 | different licenses 精确接续、一微秒缺口、第二服务缺证 |
| AC-05 关闭/旧R | primary conflict + close 历史重现 |
| 权限、SQL、原子性 | pair access、application SQL、audit failure |
| 复核与状态 | changed scope、catalogue change、independent activation |
| 工程 | fresh、61→64 与实际续接 63→64 升级保留、生成客户端真实HTTP、类型检查、受影响回归 |

运行日志保留在 ignored `.runtime/vnext/p1-04-*.log`。真正 RED 包括 catalog-red2（FINITE_RULE_REQUIRED）、owner-red（缺 Owner）、evaluate-red（缺评估）、unsupported-red（非医疗候选提前失败）、http-red（404）、review-required-red（25P02）、reasons-red（缺少具体运行状态原因）、offset-red（手工业务时间未接纳已声明偏移）、retired-contract-red（已退役旧作业契约不能被修订为手工契约）。此前 fixture 枚举/缺登记代码、PLpgSQL CASE 语法及 Python 编码失败如实属于设置/实现错误，不计领域 RED。后续 GREEN 日志对应各次修正。

最终成功证据须同时包含 READY、目标 exit 0、cleanupPassed=true。最终 commit/tree、精确运行和独立两轴复审绑定写 ignored handoff；不以中期审查替代最终候选结论。

## 保留边界

Q06/A011 仅证明合成主体、物理节点、关系和范围核验闭环。真实服务标准、真实证照映射、院方材料真实性及真实地点适用性未验；P1-07 全生命周期未交付。ORG03 文件适配 NOT_READY；FULL BLOCKED_DEPENDENCY；维护 UI、实际服务重启、正式验收 NOT_RUN。不 push、不创建 PR、不进入 P1-05，不宣称 P1 或生产就绪。


持久部署记录：首次 `.runtime/vnext/p1-04-persistent-deploy.log` 在 61→63 迁移、数据保留、角色身份核实及授权后，准备 ORG03 手工契约时 INVALID_TRANSITION；未创建本票关系。只读诊断确认旧模板 JOB_V1/RETIRED。保留该失败与 `.runtime/vnext/p1-04/deployment-1790071622544.*`，0064 以前向方式处理契约身份分类，不重建数据库。


## 最终运行结果

- 持久库 OID 206108：61→63 首次迁移已校验保留，63→64 前向接续成功；`.runtime/vnext/p1-04/deployment-1790077700730.result.json` 证明原行及密钥权威保留、新增 1 主体/3 物理节点、生成客户端真实 HTTP 全闭环。
- 专项 20 项通过；`p1-04-upgrade-61-64.log`、`p1-04-upgrade-63-green.log` 分别证明两次实际前缀升级；63 路径额外带入已发布手工契约，验证分类初始化及原事实保留。
- 受影响回归：P1-01 28 项、P1-02 36 项、P1-03 16 项、公共 Apply 18 项通过；0064 后契约目录回归通过（`p1-04-contracts-64.log`）。P1-03 原固定总数 61 的回归入口调整为依赖已安装最低基线，不修改该票无 DDL 的历史结论。
- 单元、专项 typecheck、API/client build、模块边界和 codegen 已验证。每个列为成功的数据库命令均需在 verification-index.json 对应 READY、exit 0、cleanupPassed=true；完整日志、失败及修复记录保留。
- 独立 Spec/Standards 复审：静态审查发现部署授权顺序 P2，已修正并复审关闭；0064 增量复审无新 P0/P1/P2。最终代码及文档 tree 绑定另见 ignored handoff，正式验收不因静态 review 自动通过。

保留事实：UI、实际服务重启、正式验收 NOT_RUN；ORG03 文件适配 NOT_READY，FULL BLOCKED_DEPENDENCY。不把本票完成等同 P1 完成或真实医疗许可结论。
