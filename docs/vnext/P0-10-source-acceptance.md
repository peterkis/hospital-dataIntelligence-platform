# P0-10 来源验收映射

本映射把 P0-10 附件要求的来源验收 A001/A004 绑定到可执行证据。它不把合成数据标成真实质量通过。

| 验收 | 来源要求 | 本票可执行断言 | 证据字段 |
| --- | --- | --- | --- |
| A001 | 原文：`来源质量门禁：Q42；来源验收：A001, A004。所有原条件/字段的责任映射保持，未覆盖部分按明确后票/范围处置，不伪报PASS。`（P0-04/P0-10 附件来源行 47/45） | CSV/JSON/XLSX parser 对 `EMPTY_FILE`、`EMPTY_ROW`、`NO_DATA` 均拒绝；每个拒绝场景均在 receipt-bound APP+DB 路径逐案比较领域计数，且保持不变 | `parser.a001`, `db-integration.sourceAcceptance.A001`, `db-integration.domainCounts` |
| A004 | 原文同上；A004 的结构/活动内容/定位断言由 P0-04 文件入口契约与 parser 负例具体化 | 未知/缺失字段、错误 Sheet、公式/宏活动内容均拒绝；公式保留实际单元格位置（A2 反例断言 Data/2/1），错误 Sheet 另保留实际 Sheet 名，工作簿级问题不冒充单元格问题 | `parser.a004` |

Q42 同时要求交付包与三格式合成样例仅含明确 `DEMO` 值；包扫描覆盖 package-v2 下全部 CSV/JSON/XLSX，另核验三格式 in-memory receipt demo manifest、逐值 `DEMO_PREFIX_OR_TYPED_SAFE_LITERAL` 策略与敏感值反例，真实 ORG/PER 数据质量执行仍为 `NOT_RUN`、adapter 仍为 `NOT_READY`。

来源定义不是样例行：`p0-10-delivery-authority.json` 固定已审阅的 61 份来源元数据路径与内容摘要，拒绝新增、缺失或改动的交付文件；三份样例只允许 manifest 声明的内存生成方式，并逐值检查 DEMO 前缀或固定类型安全字面量。不能用“未命中手机号/身份证模式”代替 DEMO 策略。格式字符（Unicode Cf）、常见分隔符和全角字符仅在扫描副本中归一化，不改动源值、不跨字段拼接。
