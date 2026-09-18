# P0-10 合成验证包

状态：以候选源码匹配且通过完整性复核的 V3 证据包为准，不能单独使用 `m0-result.json` 放行。PR #12 修复前的 PASS 记录保留为历史观察，因覆盖与证据缺口不再作为当前完成凭据。

## 范围

本命令的结论为 `LOCAL_SYNTHETIC_STAGE`：用户批准的本地 P0 合成工程门禁。它不是 ADR-0081 的正式 ABG、容量认证或生产验收；正式验收状态始终为 `NOT_RUN`，必须另用其既有权威 runner 和冻结环境。采用证据清单和 Vitest 不会把 prototype wrapper 升格为正式验证环境。

P0-10 复用现有 vNext control-plane、文件接收、严格解析、校验、Protected Artifact、workbench 摘要和 receipt-owned 临时数据库。它不会创建 ORG/PER 业务表，也不会把源契约草案当成可执行的业务适配器。

包覆盖原始数据集定义 53 个、`field-routing.csv` 及契约路由共 866 个字段、196 条条件规则，其中 77 条属于 ORG/PER 当前范围。字段责任归属仍为 0；P0-10 只验证包覆盖和平台边界。

ORG01、ORG04、PER01 分别使用 CSV、JSON、XLSX 合成一行走现有严格解析器。三份报告的执行含义均为 `PARSER_REPORT_ONLY`；源契约状态仍是 `DRAFT_NOT_APPROVED`，适配器仍是 `NOT_READY`，引用仍是 `BLOCKED_DEPENDENCY`。

## 命令

```text
npm run vnext:p0-10:unit
npm run prototype:db:with -- vnext:p0-10:validate
npm run vnext:p0-10:evidence -- <run-directory> <expected-manifest-sha256>
```

数据库命令只通过现有 prototype DB wrapper 运行。编排器调用 Vitest 的模块解析测试和真实 DB 集成测试，收集结构化报告；数据库场景覆盖 fresh、当前迁移前缀、类型校验、53 份契约的逐份公共接口读取与解释、三种文件格式、九个空输入场景、相同请求的并发重放、输入快照、权限、原值保护、重复 key、孤立 FILE revision、旧审批拒绝与零领域写入。0035 历史契约升级保留检查之后，通过 HTTP 服务 A 生成作业与问题，关闭并验证端口退出，再启动服务 B 读取同一作业及问题状态。开发用内存密钥不跨进程恢复，因此不承诺受保护原文可恢复。

## 验收矩阵

| 验收项 | 当前结果 | 证据 |
| --- | --- | --- |
| P0-10-AC-01 控制面验证不改变领域计数 | 由新运行决定 | `db-integration.json`：fresh/legacy 前后 `domainCounts` 相等，领域 schema/object 均为 0 |
| P0-10-AC-02 公式、旧审批、重复键、孤立输入及空输入负例 | 由新运行决定 | 九场景 A001、独立旧审批断言、解析与 DB 集成报告 |
| P0-10-AC-03 问题状态跨重启保留 | 由新运行决定 | `restartEvidence.method=HTTP_SERVICE_RESTART`，含进程退出、端口关闭与状态一致性 |
| P0-10-AC-04 不把合成用例称为真实数据质量通过 | 由新运行决定 | 包覆盖与三格式报告均标记 synthetic/report-only |
| P0-10-AC-05 必需证据齐全 | `由最新 m0-result 决定` | 必须同时满足包逐字段保真、A001/A004、Q42 合成包扫描、receipt-bound 集成、候选树浏览器证据和当前树双轴审阅 |

每次验证在 `.runtime/vnext/p0-10/<run>/` 写入独立证据包：`package-coverage.json`、`parser-boundaries.json`、`db-integration.json`、`browser.json`、`review.json` 和 `m0-result.json`。失败阶段标 BLOCKED，后继未执行阶段标 NOT_RUN。额外收集 Vitest JSON、来源附件、运行版本、fixture、契约及迁移摘要，再以排序路径、字节长度、SHA-256 生成 manifest 和独立摘要。这些文件均被忽略且不覆盖历史运行。外部保留的 manifest 摘要用于检测整个包被替换；包内摘要本身不构成独立可信签名。

浏览器固定流程还要逐项匹配所引用 AX 观察中的选中角色与实际结果：Maker 草稿/提交、Reviewer 发布、契约 ACCEPT 或相应拒绝码、B/R 数量、废止摘要/结果及历史。不得用未选中角色选项冒充当前操作者。重复发布须引用时间先后的两次观察，并比较完整历史行（状态、规则、记录时间、有效期间及下载条目）；AC-02 的批准/发布拒绝分别绑定实际工具动作引用和不同的有序时间。任意非空文本、错误页面或与结论相反的结果不能支撑 PASS。这是来源内容与摘要的一致性检查，不是对本地作者的密码学认证；仍需通过实际浏览器工具原始记录核验来源。

证据格式 V3 将封存移到外层 wrapper 完成清理之后：子进程只写 `pending-finalization.json`，外层写入 `wrapper-cleanup.json` 后再调用终态封存。必须有 READY、目标 exit 0、cleanupPassed=true；缺失、失败或中断均阻断 PASS。只读校验也必须检查这份终态清理记录。既有 V2 包保留为历史，不由新门禁自动认可。

每段浏览器摘录保留工具输出的页面 URL。数据集、来源、契约分别在全过程绑定同一个 URL UUID、SYNTHETIC 范围与当前会话 origin；校验通过、同人拒绝、独立批准、发布/重放、B/R 读取及废止影响还须包含同一个“契约版本”UUID。不得把不同对象或不同版本的成功观察拼成同一生命周期。

成功生命周期的 CORE 候选采用修订后合格的版本（负例草稿仍独立保留），并与校验、批准、发布及废止后详情的版本 UUID 一致。废止证据包括影响、B/R 有效项归零、当前已废止详情三项，避免页面清空详情时推断版本。重放历史必须从 v1 按版本递进、同版本按草稿/批准/发布顺序推进，记录时间递增、定义不变，每行与其版本下载项成对；不能用重复发布行替代真实历史。

## 浏览器与依赖状态

浏览器证据必须包含八个具名流程及 P0-02 AC-01～05，绑定本次候选源码、receipt/OID、服务会话、原始页面观察及步骤引用。review 的两轴报告绑定独立审查者及来源记录。仅填写 PASS 或复制旧摘要不能作为修复后验收；来源真实性仍需核对原始工具记录，文件哈希只验证完整性。

真实 ORG/PER 业务 Owner 与适配器仍为 `NOT_READY`。P0-10 不会以合成工作台数据替代它们。

只有浏览器证据、当前树 Spec/Standards 审阅、来源逐项保真和 receipt-bound 集成验证及清理都成为 PASS 后，M0 才可完成。验证命令本身不执行 Git 发布或推进后续任务。
