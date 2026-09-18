# P0-10 合成验证包

状态：以最新 receipt-bound `m0-result.json` 为准。本文件记录可重复的合成验证入口和证据绑定，不把附件中的验收条件预填为通过。

## 范围

P0-10 复用现有 vNext control-plane、文件接收、严格解析、校验、Protected Artifact、workbench 摘要和 receipt-owned 临时数据库。它不会创建 ORG/PER 业务表，也不会把源契约草案当成可执行的业务适配器。

包覆盖原始数据集定义 53 个、`field-routing.csv` 及契约路由共 866 个字段、196 条条件规则，其中 77 条属于 ORG/PER 当前范围。字段责任归属仍为 0；P0-10 只验证包覆盖和平台边界。

ORG01、ORG04、PER01 分别使用 CSV、JSON、XLSX 合成一行走现有严格解析器。三份报告的执行含义均为 `PARSER_REPORT_ONLY`；源契约状态仍是 `DRAFT_NOT_APPROVED`，适配器仍是 `NOT_READY`，引用仍是 `BLOCKED_DEPENDENCY`。

## 命令

```text
npm run vnext:p0-10:unit
npm run prototype:db:with -- vnext:p0-10:validate
```

数据库命令只通过现有 prototype DB wrapper 运行。它覆盖 fresh、当前迁移前缀、类型校验、53 份契约注册、三种文件格式、结构负例、1000/1001 行边界、相同请求的并发重放、输入缓冲区快照、权限拒绝、普通投影不含原值、重复 key、孤立 FILE revision 回滚、控制面零领域 schema/object 写入，以及 0035 历史无 `businessKey` 契约升级后的独立 Node 进程恢复。

## 验收矩阵

| 验收项 | 当前结果 | 证据 |
| --- | --- | --- |
| P0-10-AC-01 控制面验证不改变领域计数 | `PASS`（以最新运行复核） | `db-integration.json`：fresh/legacy 前后 `domainCounts` 相等，领域 schema/object 均为 0 |
| P0-10-AC-02 公式、重复字段、孤立输入和边界负例 | `PASS` | `parser-boundaries.json` 与 DB 集成报告 |
| P0-10-AC-03 问题状态跨重启保留 | `PASS`（以最新运行复核） | `db-integration.json`：receipt-bound `restartEvidence` 为 `PERSISTED_AFTER_PROCESS_RESTART` |
| P0-10-AC-04 不把合成用例称为真实数据质量通过 | `PASS` | 包覆盖与三格式报告均标记 synthetic/report-only |
| P0-10-AC-05 必需证据齐全 | `由最新 m0-result 决定` | 必须同时满足包逐字段保真、A001/A004、Q42 合成包扫描、receipt-bound 集成、候选树浏览器证据和当前树双轴审阅 |

每次验证在 `.runtime/vnext/p0-10/<run>/` 写入独立证据包：`package-coverage.json`、`parser-boundaries.json`、`db-integration.json`、`browser.json`、`review.json` 和 `m0-result.json`。这些文件被 `.gitignore` 忽略，不覆盖历史运行。

## 浏览器与依赖状态

`.runtime/vnext/p0-10/browser-evidence.json` 保存了本轮真实 Chrome 观察：合成 DATASET、SOURCE、CORE 契约的 maker/checker 创建、提交、复核、发布、B/R 有效读取、影响摘要和废止闭环均已观察到；同一维护页还逐项观察了 P0-02 的未知字段拒绝、未解析条件/候选代码集阻断、规则版本不可覆盖、同规则发布回放幂等及历史保留。P0-02 的旧浏览器桥阻断只作为历史记录保留，当前浏览器证据绑定实际 Chrome accessibility tree；真实 ORG/PER adapter 与业务实例仍明确标为 `NOT_READY`，不被合成证据替代。

真实 ORG/PER 业务 Owner 与适配器仍为 `NOT_READY`。P0-10 不会以合成工作台数据替代它们。

只有浏览器证据、当前树 Spec/Standards 审阅、来源逐项保真和 receipt-bound 集成验证都成为 `PASS` 后，`runGateM0` 才会返回 `PASS`；不创建提交、不推送、不推进后续任务。
