# P0-04 固定文件入口

范围为本地合成数据、同一进程存活期内的 CSV/JSON/XLSX 接收与结构解析。基线 main `0c17b1a463a736abc7d325e14946ca3d527cb371`，tree `cd9062c94f9385519c1b88e5d03da84fc26c8a53`。原 receipt/OID 206108 核实，26 项迁移校验和通过。只在 `codex/p0-04-file-intake` 工作，不 fetch/push，不进入后票。

## 当前接线

现有 `openCatalog(connectionString, provider)` 唯一 Owner 增加 typed `receiveFile`、`inspectEnvelope`、`parseFile`、`exportIssueWorkbook`。显式复用一个 `LocalSyntheticKeyProvider`。没有新增库、业务表、HTTP 文件路由或页面。FILE schema 用于 receiveFile 的内部作业接线；公开 importJobCommand 只接受 METADATA_ONLY，对 FILE 返回 FILE_RECEIVE_REQUIRED。文件入口集成测试为真实调用方。

0027 扩展现有输入元数据为 `{kind: FILE, format: CSV|JSON|XLSX, parserPolicy: STRICT_V1}`，digestStatus 为 PROTECTED_REFERENCE；不填占位 SHA。METADATA_ONLY 历史声明不改写，其反向摘要保护继续执行。metadataDigest 只覆盖格式/策略元数据，不是文件摘要。receiveFile 在一根事务内调用原作业命令和原受限存储，原文件引用绑定本次修订，任一失败回滚。数据库触发器在原授权锁内限制每个 FILE 修订一个 RAW_FILE；换文件请求号不能把新文件挂回旧修订。新文件必须新建修订，expectedCurrentRevision 和原请求重放检查不变。

接收回滚后单独写固定 `FILE_RECEIVE_DENIED` 审计：CREATE 指向原创建请求，REVISE 指向请求 job；只有 UUID、院区、目的及固定 REQUEST_REJECTED，不保存内容或异常文字。拒绝记录提交失败返回固定 FILE_RECEIVE_FAILED。回滚与拒绝审计两个事务间仍存在进程崩溃窗口，不宣称跨事务原子留痕。

解析先通过当前 job 权限及独立 raw READ，再校验加密绑定中的 job/revision/kind。结果以 RAW_CELL 密文保存，包括 sourceArtifactId、CanonicalRow、原单元格值/坐标/来源类型、manifest 和有限问题码；API 只返回受限引用和状态。原始文件字节含 BOM/CSV 转义/JSON lexeme/XLSX cell XML 完整保存在 RAW_FILE。单元格证据中的 row 是规范数据行号，CSV/XLSX header 占物理第 1 行；结构错误坐标按原表行号，字段错误按规范行号。存储时再执行当前权限及修订检查，过期读取由 P0-11 拒绝。

`inspectEnvelope` 执行同一有界结构解析并保存受限证据，没有第二套准入。解析成功仅代表结构 PARSED；文件仍 QUARANTINED、字段规则 NOT_RUN、安全扫描 NOT_RUN、adapter NOT_READY。解析结果、错误报告不进入普通 job、日志或浏览器缓存。

## STRICT_V1 固定契约

这一不可变 parserPolicy 与输入 revision 绑定。字段集合及类型来自 job 冻结的精确契约；只接受精确字段代码，不接受别名。因此未知列及同义别名列均拒绝。每行必须完整提供契约列；空文件、仅 header、空行或全空值行拒绝。值必须是文本，数字和 null 不猜测转换；0012 按文本保留，XLSX 所有数值单元格拒绝。整数/日期等后续业务规则仍由 P0-05 负责。

CSV 为固定逗号 RFC4180 子集、LF/CRLF、双引号转义；JSON 为 flat object 数组，词法解析先拒绝重复键（含 Unicode 转义同义键）。UTF-8 fatal decode；只允许起始 UTF-8 BOM 并在 manifest 记录，原 bytes 不改写。所有字段首尾空白显式拒绝，不 trim、不补零、不改大小写。datetime 只接受 Asia/Shanghai 无 offset 的本地字符串；包括 +08:00 在内的 offset/Z 全部拒绝，遵循现行 ADR-0074，未授予任何 offset 转换政策。

XLSX 固定一个名为 Data 的 sheet，逐行连续、列坐标连续，inlineStr/sharedStrings 文本单元格。校验核心 XML 命名空间，拒绝嵌套重新绑定；Excel 文本转义在受限边界内解码，原 XML 字节仍保留。三格式解码后的非法控制字符和不成对代理字符均拒绝。隐藏 sheet/行/列先记录于受限 manifest 再拒绝，STRICT_V1 不声明隐藏内容。拒绝公式（包括带缓存值的公式）、宏、外链、OLE、未知成员、DTD/实体声明、重复成员、加密、多盘、ZIP64、ZIP 注释、extra/data-descriptor、富文本及非固定结构。此严格子集不承诺所有 Excel 保存器产物都可导入；不尝试修复、猜测或运行计算。

当前 XLSX 部件白名单为 Content Types、根关系、workbook、workbook 关系、sheet1，加可选 sharedStrings；后者须有完整 MIME/关系/结构校验。未实现结构校验的 styles、docProps/core、docProps/app 明确拒绝，相关声明/关系和 s/style 样式引用也拒绝。因此带这些部件的普通 Excel 另存产物不属于此固定子集；不会静默丢弃部件后当作原文件接收。

接收上限 1 MiB，与 P0-11 一致；ZIP 成员 16、单成员展开 2 MiB、总展开 4 MiB、压缩比 100，先核实中央/本地目录一致与 CRC，再解析。100 列、1000 数据行、8192 字符/值；worker 限制 old heap 64 MiB、young heap 16 MiB、stack 2 MiB，2 秒终止、最多两个并行 worker，无无限队列。结果与导出各自不得超过 1 MiB；限额失败不进入领域。

错误导出为真正 ZIP32 XLSX，每个值都显式 inlineStr，无公式节点；不生成 CSV。原值含 =/+/−/@ 等也只作文本写入，不修改受限原值。ERROR_REPORT 同样经 P0-11 授权保存与读取。

## 验证与边界

证据目录 `.runtime/vnext/p0-04/`。初始纯解析测试 5/5；首轮 DB runner 白名单遗漏（01、02）是设施失败，不是 tests-only 初始 RED。02 留下的本票临时空库只按其 receipt 清理（03），保留失败事实。最终专项/升级/类型/生成代码/审阅结果在完成后补记，不预填 PASS。

最终结果：15-final-db-gates 顺序执行 fresh 5/5、26→27 升级 5/5（原 metadata job/审计保持）、P0-11 10/10、P0-03 8/8、原 receipt 前向迁移、生成类型 generate/verify、authority，全部 exit 0。当前 OID 206108、迁移 27、表 29、ORG/PER 业务实例 schema 0。生成 DB 类型与原文件一致，无人为改写。所有本票临时库均有对应 disposal receipt；wrapper 最终 targetExitCode=0、cleanupPassed=true，任务拥有的服务/WSL 已关闭。

首轮真实接线（04）暴露原生 Node worker 不接受 TS parameter property，修正后 07 升级 3/3。独立审阅发现旧 revision 追加原文件、重排 header 的原列坐标、接收拒绝审计回滚，08/09 tests-only RED 实测后修复；11 因新增函数 schema 白名单遗漏失败，15 补齐后通过。16/17 补充解码控制字符和 XML 命名空间 RED/GREEN；随后 18 最终文件接线 5/5。21 最终纯解析 7/7，22 专项类型检查、23 API build 通过；13 module-boundaries 通过。不同轮次证据不冒称同轮重跑，初始实现没有 tests-only RED。

原 AC-01 至 AC-06 分别由 file-parser.test.ts 的拒绝类、ZIP 限额、公式缓存、0012 文本、空白政策、三格式同语义断言覆盖，并由 file-intake.test.ts 证明真实 Owner 存储/读取/修订/拒绝审计/受限错误导出。Spec 和 Standards 两个独立审阅者以固定基线到候选 diff、完整运行时/SQL 调用链及部分纯函数复现复核；原发现均已修复。最终候选 tree、复核结果和日志摘要存 ignored review/handoff，不把源码复核写成独立数据库实测。

最终 Standards 复核又复现 XML t 节点嵌套内容被静默忽略；24 为 tests-only RED，修复同时约束 t/v 文本叶子和 workbook/worksheet 结构容器，禁止非空游离文本及未知嵌套内容。25 纯解析 **8/8**，26 文件 Owner **5/5**，27 类型检查与 28 API build 通过。此轮仅解析器及测试/文档变化，0027 SQL 与已完成的 26→27 升级/原库 checksum 不变，不重复声称 DB 回归全部重跑。

本票责任字段 0，不改 datasets 或 field-routing。Q42/IMP001–004/IMP008–009/A001–004 仅对上述合成固定格式与保护接线提供证据，P0-05 规则、P0-10 集成、P0-09 UI 后票责任不消失。P0-02 BROWSER_BLOCKED 保留；P0 仍 IN_PROGRESS。本票不执行浏览器和服务实际重启，不证明跨进程密钥恢复、病毒扫描或生产安全。

## PR #6 第一轮修复

用户在本地交付后授权完整 push/PR/Codex review/修复/合并/清理流程。远端 Codex 对 `2ef88e0` 提出 4 项 P2：公开 FILE 命令会留下无原文件修订；CSV EOF 末行漏检限额；CSV_SYNTAX 丢失位置；根 relationship 不强制指定 workbook。29/30 为对应 parser/真实 DB 的 tests-only RED。

公开 metadata 命令现在拒绝 FILE；新增前向 0028 延迟约束，确保每个 FILE 修订提交时恰有一个 RAW_FILE。原子 receive 中的暂时无原文件状态可以存在至同根提交；直接 SQL 命令也不能提交孤立修订。0028 安装前遇到既有孤立 FILE 失败关闭且不改写其事实；不会清理或伪造原文件。已安装 0027 字节不变。33 验证 27→28：孤立修订升级拒绝并保留、旧合法制品修订/密文/审计保持，新版专项 7/7。

CSV 通过同一 record 函数完成 EOF/newline 追加并检查 1000 数据行边界；语法错误跟踪物理行号及 UTF-16 字符列（EOF 指向下一字符位置），覆盖多行引号、引号后多余字符、未闭合引号和坏 CRLF。这类语法错误不会被伪造为规范单元格坐标。XLSX 根关系必须有唯一且类型正确的 officeDocument→workbook，workbook 必须引用 worksheet；所有关系 ID/target 唯一、目标存在、Type 与路径吻合。实际使用 sharedStrings 也必须经该 typed relationship，不能消费孤立 ZIP 部件。36 的相邻反例 RED 后，37 纯解析 12/12。

32 fresh 专项 7/7，38–40 原库迁移、类型生成、authority 通过：仍 OID 206108/29 表/零业务实例 schema，迁移数 28。最终运行结果及当前 head 远端复审单独写 ignored pr6-progress/evidence；未把首轮 review 的 Completed 状态当作无发现通过，未把无 GitHub checks 写成 CI 全绿。旧记录中的 27 项迁移与初始测试数字是对应候选的历史结果。

## PR #6 第二轮修复

远端 Codex 对 `928c412` 提出内部 BOM 字符、Content Types 必需声明及总验收遗漏 parser 专项三项 P2。46 实测前两项 RED；47 证明纯解析有失败时旧总验收仍 exit 0。48 先把 parser 专项接入总验收首步，在原缺陷仍存在时确实 exit 1、停止后续 DB 步骤，然后再修复运行时代码。

统一解码后的值入口拒绝任何 U+FEFF，涵盖 JSON/Excel 转义；仅文件开头允许的 UTF-8 BOM 仍记录并保留原 bytes。XLSX Content Types 对 workbook、worksheet 及实际存在的 sharedStrings/styles/docProps 要求正确且唯一的 PartName/MIME 对，未知声明、重复、缺失、错误 MIME 均拒绝；关系部件要求正确 rels 默认类型。原 typed relationship 校验继续执行。

49 总验收完整通过：parser **14/14**、fresh Owner **7/7**、27→28 升级 **7/7**（含既有孤立拒绝和合法文件保留）、P0-11 **10/10**、P0-03 **8/8**、当前库迁移/生成类型/类型 verify/authority；wrapper targetExitCode=0、cleanupPassed=true。50 类型检查及 51 API build 通过。独立 Spec/Standards 增量源码复核无阻断。本轮无新 DDL，当前原库仍为 28 项迁移和 29 表，已安装 SQL 未改写。

## PR #6 第三轮修复

远端 Codex 对 `6b30856` 指出未声明 XML 属性前缀仍被接受。52 tests-only RED 后，解析器按根命名空间声明与隐式 xml 绑定解析元素/属性 QName，拒绝未声明前缀、多冒号 QName、保留 xml/xmlns URI 的错误绑定，并按展开后的命名空间/本地名检测别名前缀重复属性。无前缀属性不继承默认命名空间；原 STRICT_V1 禁止嵌套重绑定的规则保持。

53 第一候选 parser 15/15，54 文件 Owner 7/7；独立 Standards 复核进一步找到 `xmlns:` 空前缀绕过，57 RED 后补非空 NCName 校验，58 最终 parser **16/16**，59 类型检查与 60 API build 通过。独立纯函数检查保留合法 r:id/隐式 xml:space 与正确显式 xml 绑定，重复展开属性拒绝。本轮无新 DDL/存储/权限修改；不将此前总 DB 验证冒称为本轮重跑。

## PR #6 第四轮修复

远端 Codex 对 `f95af60` 指出 styles/docProps 部件有 MIME 声明但缺完整 XML 结构校验。61 tests-only RED 后采取其建议的固定子集方案：在 ZIP、Content Types 和关系三层均拒绝这些尚未支持的可选部件，并拒绝悬空样式引用，避免扩成通用 OOXML 校验器。保留的 sharedStrings 继续接受全部既有检查。62 parser **17/17**，63 文件 Owner **7/7**，64 类型检查和 65 API build 通过；独立 Spec/Standards 窄范围复核无阻断。无 DDL/权限/存储变化；数据库仍 28 项迁移。
