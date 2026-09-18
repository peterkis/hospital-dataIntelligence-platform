# P0-10 合成验证包

状态：以候选源码匹配且通过完整性复核的 V2 证据包为准，不能单独使用 `m0-result.json` 放行。PR #12 修复前的 PASS 记录保留为历史观察，因覆盖与证据缺口不再作为当前完成凭据。

## 范围

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

## 浏览器与依赖状态

浏览器证据必须包含八个具名流程及 P0-02 AC-01～05，绑定本次候选源码、receipt/OID、服务会话、原始页面观察及步骤引用。review 的两轴报告绑定独立审查者及来源记录。仅填写 PASS 或复制旧摘要不能作为修复后验收；来源真实性仍需核对原始工具记录，文件哈希只验证完整性。

真实 ORG/PER 业务 Owner 与适配器仍为 `NOT_READY`。P0-10 不会以合成工作台数据替代它们。

只有浏览器证据、当前树 Spec/Standards 审阅、来源逐项保真和 receipt-bound 集成验证及清理都成为 PASS 后，M0 才可完成。验证命令本身不执行 Git 发布或推进后续任务。
