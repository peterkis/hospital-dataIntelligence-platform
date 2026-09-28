# P1-06 组织空间维护

基线5ef813d；唯一持久库OID206108。先收尾P1-05的0070部署，再开展本票。验收结果见ignored handoff，不预填PASS。

## 确认的边界

合成身份（院办/既有院区管家/独立核验审批/配对管理员）；所有当前主体、证照、院区、范围、关系动作提供入口；不新增恢复/退出。XLSX原文只读，逐行可视化补充清单。51字段主责任不变。

编辑草稿允许不完整，显式保存且仅原编辑人可读写；已暂存输入、冻结候选、正式事实分别管理。来源归责不随角色切换，底层identity阻止自审。所有保存/提交/应用均保持原请求号恢复；并发使用预期版本。浏览器不持久保存敏感载荷。

## 工程及测试

现有vNext React/Fastify/生成客户端和公共Owner。有限草稿结构，不建通用工作流；解密、读写和引用均重查当前权限。共有表单和历史组件采用明确领域字段，业务时间/平台时间分开，统一B/R读取。后台普通资料不含号码和材料正文。

公共UI/API、Owner、数据库角色和真实浏览器为用户确认的测试边界。AC01手工/导入一致；AC02角色不改来源；AC03历史无未来证照；AC04预览无权不能API应用；AC05草稿和历史刷新一致。fresh/实际前缀升级/codegen/当前受影响回归，浏览器必做。UI未验则不完成。

不fetch/push/PR/进入P1-07。最终本地一个提交和ignored handoff；实际服务重启/正式验收分别记证。
## Current implementation notes

- Manual submission prepares a metadata-only transport in the existing catalog Owner. The optional internal workspaceDraft reference must resolve to the current private EDITING revision and recheck exact domain READ/READ_RESTRICTED/WRITE. It does not grant dataset WRITE, permit FILE transport, or bypass ordinary import job permissions. The public job HTTP schema has no workspaceDraft field.
- Workbook submission reuses the original organization bundle receiver with the caller's CatalogTransactionScope. Draft SUBMITTED linkage and received job/revision commit together. Bundle inputId in the workspace submission receipt is the real job ID; it is never a fabricated organization input ID.
- Organization history-details and campus history accept optional R. The Owner filters all corresponding recorded facts before responding; UI filtering is not the authority.
- Role capabilities are necessary permission checks, not a promise that versions/evidence/dependencies remain admissible. Original Owner validation and approval checks remain authoritative.

### 浏览器时间精度调整（用户确认）

组织维护页的结构化时间输入与普通展示统一为 `yyyy-mm-dd hh24:mm:ss`；用户编辑完整时间后，请求使用医院本地时间并补齐 `.000000`。不要求输入毫秒或微秒，日期型证照边界仍可只填日期。已有历史记录只格式化展示，数据库、准确观察时点、原始工作簿和受控材料保留原精度。

临时库真实浏览器证据：`.runtime/vnext/p1-06/browser-seconds.json`，覆盖录入、实际请求补零和保存后刷新恢复。本项不代表 P1-06 全部验收完成；原有后端微秒边界测试继续有效。

## 页面操作与权威矩阵

| 页面/动作 | 资料来源与写入权威 | 当前验证证据（临时库） |
|---|---|---|
| 主体创建、修订、标识、证照、登记核验 | ORG01 原 Owner；私有编辑内容先保存，再暂存输入、独立阅读材料、审批、应用 | browser-vertical.json；P1-06 Owner/HTTP 测试 |
| 院区资料、迁址、计划、取消计划、启用、停用 | ORG02 原 Owner；资料、计划和运营状态独立 | browser-steward.json、browser-lifecycle.json |
| 许可范围、运营关系建立、范围修订、复核、关闭 | ORG03 原 Owner；准确配对授权，准确证照与范围版本 | browser-relations-seconds.json；原 P1-04 回归 |
| 工作簿三表清单、预授权、独立资料核验、整包审批与应用 | 原 P1-05 receiver 与同根事务 Apply；原文件只读 | browser-bundle.json |
| 草稿、申请、审批与结果恢复 | 草稿独立私有记录；申请状态从已有输入、候选、审批、commit 读取 | browser-draft-slice.json；原 IDs 重放及 SQL 审计失败回滚测试 |
| 当前与历史读取 | 原 Owner，同一 B/R；显示到秒，内部精确观察时点不改写 | browser-future-license.json、browser-seconds.json |

以上证据位于 ignored `.runtime/vnext/p1-06/`，仅证明各次运行当时的局部候选。最终持久库及最终候选验收必须单独索引，不能由此矩阵自动宣布完成。

## 审阅修复约束

- 元数据作业的契约必须与准确私有草稿 transport 相同。只有该授权目标的不可变事实实际使用过的准确契约可复用维护例外；新建或更换契约仍走目录契约 WRITE。ORG03 的非空目标必须匹配完整真实配对、治理范围和对象种类，不能退化到 NIL 创建策略。
- 引用选择的迟到结果按最新清单合并，不能覆盖等待期间的其他行编辑。
- 最近 100 条仅限制列表；准确申请与工作簿 revision 深链接独立核权读取。历史工作簿修订只读，仍可恢复原结果。
- 手工关系提供按业务时点选择范围对象与准确历史版本的入口，便于未来安排和证照接续；选择不会自动赋予运营资格。

## 本地交付验收索引

P1-05 的 0069→0070 收尾升级与最新 HTTP/dry-run 已验证；P1-06 在 OID 206108 的唯一持久库前向安装 0071，普通服务 composition 已接线。专项 fresh 与 0070→0071 升级均为 20/20；受影响 P1-01～P1-05、公共受保护材料及 Apply 回归通过。生成契约无漂移，完整类型检查和生成客户端构建通过。

| AC | 证据 |
|---|---|
| AC-01 手工/导入一致 | P1-06 专项正常资料、未知服务、许可缺口、过期预期版本四项一致性；持久主体和七行工作簿真实浏览器闭环 |
| AC-02 身份与来源 | 原提交人及来源保持；持久草稿私有读取、真实迟到响应隔离与管家准确对象授权 |
| AC-03 历史与未来证照 | 同一 B/R 的主体与证照读取；未来安排单列，准确历史 R 排除未来知识 |
| AC-04 预览与发布授权 | 无执行权审批人按钮禁用且真实 HTTP Apply 返回403；原 Owner 当前权限与审批门禁 |
| AC-05 刷新与恢复 | 不完整草稿保存恢复、双标签页冲突保留编辑、单主体及12步整包原 IDs 恢复 |

持久整包新增的三个院区均仍为 PLANNING / NOT_EVALUABLE。预授权授予、撤销和重新授予经浏览器验证。390px 窄屏与键盘焦点检查通过。源 ORG01–03 的51字段原定义与采纳映射未修改，本票新增主责任源字段为0。

准确命令、浏览器和审阅索引在 ignored `.runtime/vnext/p1-06/command-index.json` 与最终 handoff。9月24日长时浏览器进程在关闭前中断，原运行保持 INTERRUPTED / cleanup NOT_CONFIRMED；升级即时保留校验和浏览器证据分别留存。9月27日复用既有数据库及 Owner 恢复原结果，完成新的基线至结束期间的逐行保留、OID、账本、密钥检查及 READY/exit0/cleanupPassed=true，不追认旧中断运行的清理。

实际服务重启验收、正式验收、生产身份和真实医院标准均未完成；不宣称P1阶段或生产就绪。只形成本地完成提交，不push、PR或进入P1-07。
