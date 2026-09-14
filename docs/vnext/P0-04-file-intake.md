# P0-04 固定文件入口

范围为本地合成数据、同一进程存活期内的 CSV/JSON/XLSX 接收与结构解析。基线 main `0c17b1a463a736abc7d325e14946ca3d527cb371`，tree `cd9062c94f9385519c1b88e5d03da84fc26c8a53`。原 receipt/OID 206108 核实，26 项迁移校验和通过。只在 `codex/p0-04-file-intake` 工作，不 fetch/push，不进入后票。

## 当前接线

本票验证环境遵循用户指定的 v3 P0-04 §4–5（唯一当前研发库或 owned 临时测试库、DOMAIN 档位）及 `docs/agents/prototype-database.md` 当前执行策略：通过 managed wrapper 在 receipt-owned 临时库验证。本轮属于本地合成工程验证，未执行 ADR-0081 所述 Testcontainers/PostgreSQL 18.4/Keycloak/Toxiproxy 容器集成环境验证，不声称满足该 ADR 的全部环境要求，也不构成正式验收、容量证据或部署认证。本说明记录任务范围与证据边界，不改写或废止 ADR-0081；Vitest 运行器统一不代表依赖环境同时通过。

现有 `openCatalog(connectionString, provider)` 唯一 Owner 增加 typed `receiveFile`、`inspectEnvelope`、`parseFile`、`exportIssueWorkbook`。显式复用一个 `LocalSyntheticKeyProvider`。没有新增库、业务表、HTTP 文件路由或页面。FILE schema 用于 receiveFile 的内部作业接线；公开 importJobCommand 只接受 METADATA_ONLY，对 FILE 返回 FILE_RECEIVE_REQUIRED。文件入口集成测试为真实调用方。

0027 扩展现有输入元数据为 `{kind: FILE, format: CSV|JSON|XLSX, parserPolicy: STRICT_V1}`，digestStatus 为 PROTECTED_REFERENCE；不填占位 SHA。METADATA_ONLY 历史声明不改写，其反向摘要保护继续执行。metadataDigest 只覆盖格式/策略元数据，不是文件摘要。receiveFile 在一根事务内调用原作业命令和原受限存储，原文件引用绑定本次修订，任一失败回滚。数据库触发器在原授权锁内限制每个 FILE 修订一个 RAW_FILE；换文件请求号不能把新文件挂回旧修订。新文件必须新建修订，expectedCurrentRevision 和原请求重放检查不变。

接收回滚后单独写固定 `FILE_RECEIVE_DENIED` 审计：CREATE 指向原创建请求，REVISE 指向请求 job；只有 UUID、院区、目的及固定 REQUEST_REJECTED，不保存内容或异常文字。拒绝记录提交失败返回固定 FILE_RECEIVE_FAILED。回滚与拒绝审计两个事务间仍存在进程崩溃窗口，不宣称跨事务原子留痕。

解析先通过当前 job 权限及独立 raw READ，再校验加密绑定中的 job/revision/kind。结果以 RAW_CELL 密文保存，包括 sourceArtifactId、CanonicalRow、原单元格值/坐标/来源类型、manifest 和有限问题码；API 只返回受限引用和状态。原始文件字节含 BOM/CSV 转义/JSON lexeme/XLSX cell XML 完整保存在 RAW_FILE。单元格证据中的 row 是规范数据行号，CSV/XLSX header 占物理第 1 行；结构错误坐标按原表行号，字段错误按规范行号。存储时再执行当前权限及修订检查，过期读取由 P0-11 拒绝。

单元格 sourceRow 保存 CSV 记录实际起始物理行／XLSX 原表行（JSON 为对象序号），与规范 row 分开。CSV 多行引号记录后的字段数量错误使用 tokenizer 保留的物理起始行，不从规范数组索引倒推。

sourceType 为 CSV、JSON 或 XLSX 原始 t 值 inlineStr/s；XLSX 共享与内联表示不再合并成 TEXT，且随源列而非契约列顺序保存。共享字符串表的每个条目（包括未引用条目）在加载时即解码一次并检查字符/BOM/8192 长度；引用时不再二次解码。

`inspectEnvelope` 执行同一有界结构解析并保存受限证据，没有第二套准入。解析成功仅代表结构 PARSED；文件仍 QUARANTINED、字段规则 NOT_RUN、安全扫描 NOT_RUN、adapter NOT_READY。解析结果、错误报告不进入普通 job、日志或浏览器缓存。

## STRICT_V1 固定契约

这一不可变 parserPolicy 与输入 revision 绑定。字段集合及类型来自 job 冻结的精确契约；只接受精确字段代码，不接受别名。因此未知列及同义别名列均拒绝。每行必须完整提供契约列；空文件、仅 header、空行或全空值行拒绝。值必须是文本，数字和 null 不猜测转换；0012 按文本保留，XLSX 所有数值单元格拒绝。整数/日期等后续业务规则仍由 P0-05 负责。

CSV 为固定逗号 RFC4180 子集、LF/CRLF、双引号转义；JSON 为 flat object 数组，词法解析先拒绝重复键（含 Unicode 转义同义键）。UTF-8 fatal decode；只允许起始 UTF-8 BOM 并在 manifest 记录，原 bytes 不改写。所有字段首尾空白显式拒绝，不 trim、不补零、不改大小写。datetime 只接受 Asia/Shanghai 无 offset 的本地字符串；包括 +08:00 在内的 offset/Z 全部拒绝，遵循现行 ADR-0074，未授予任何 offset 转换政策。

XLSX 固定一个名为 Data 的 sheet，逐行连续、列坐标连续，inlineStr/sharedStrings 文本单元格。校验核心 XML 命名空间，拒绝嵌套重新绑定；Excel 文本转义在受限边界内解码，原 XML 字节仍保留。三格式解码后的非法控制字符和不成对代理字符均拒绝。隐藏 sheet/行/列先记录于受限 manifest 再拒绝，STRICT_V1 不声明隐藏内容。拒绝公式（包括带缓存值的公式）、宏、外链、OLE、未知成员、DTD/实体声明、重复成员、加密、多盘、ZIP64、ZIP 注释、extra/data-descriptor、富文本及非固定结构。此严格子集不承诺所有 Excel 保存器产物都可导入；不尝试修复、猜测或运行计算。

当前 XLSX 部件白名单为 Content Types、根关系、workbook、workbook 关系、sheet1，加可选 sharedStrings；后者须有完整 MIME/关系/结构校验。未实现结构校验的 styles、docProps/core、docProps/app 明确拒绝，相关声明/关系和 s/style 样式引用也拒绝。因此带这些部件的普通 Excel 另存产物不属于此固定子集；不会静默丢弃部件后当作原文件接收。

当前 workbook 仅接收 sheets；worksheet 仅接收 sheetData、cols 和显式 zeroHeight 的 sheetFormatPr。dimension、视图、页边距、workbookPr、bookViews、calcPr 等未实现节点即使为空也拒绝。关系 Id 限定为本子集的 ASCII NCName，不接受空白或无效名称。

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

## PR #6 第五轮修复

远端 Codex 对 `a64696e` 提出 CSV 多行后 FIELD_CONTRACT 位置、worksheet 默认 zeroHeight 隐藏、已声明外来命名空间三项 P2。66 RED 后保留记录物理起始行，并在受限 manifest 中记录 defaultRowsHidden 和受影响行；zeroHeight 为 true/1 时拒绝，即使部分行显式可见也不放行未声明的默认隐藏政策。命名空间声明仅允许支持的 SpreadsheetML/package/relationship/XML URI，带前缀属性仅支持 xml:space 和 sheet 的 relationship id，未知扩展内容不能被静默忽略。

67 parser 20/20，68 文件 Owner 7/7；独立复核又复现重复 sheetFormatPr 后值覆盖隐藏标志，71 RED 后对 workbook/worksheet 单例子节点统一拒绝重复，72 最终 parser **21/21**，73 类型检查与 74 API build 通过。此前 Owner 验证与最后两行单例检查的纯函数验证分开记录。无 DDL、权限或存储修改。

## PR #6 第六轮修复

远端 Codex 对 `47f4304` 指出无前缀未知 XML 属性仍被忽略。75 tests-only RED 后，为固定子集内每种元素定义封闭的无前缀属性集合；row/c/t/workbook 与元数据节点均不能静默接收额外属性。命名空间声明及 r:id/xml:space 继续走既有独立校验。尚未实现的视图、计算、排版属性明确拒绝，空元数据容器不授予额外语义，不扩成通用 XSD 验证器。76 parser **22/22**、77 文件 Owner **7/7**、78 类型检查与 79 API build 通过，独立 Spec/Standards 窄范围复核无阻断。无 DDL/权限/存储变化。

## PR #6 第七轮修复

远端 Codex 对 `422e9c3` 提出 sharedStrings 数量声明与必需 sheetId 未验证两项 P2。80 tests-only RED 后，sheetId 必须为正 uint32 十进制整数；可选 count/uniqueCount 提供时必须为有效无符号整数，分别等于实际 s 单元格引用数（包括表头）和 si 条目数，不按声明值分配内存。省略计数的合法共享字符串仍可解析。81 parser **24/24**、82 文件 Owner **7/7**、83 类型检查和 84 API build 通过；独立 Spec/Standards 窄范围复核无阻断。无 DDL/权限/存储变化，既有资源限额不变。

## PR #6 第八轮修复

远端 Codex 对 `9824284` 提出 XML 成员 BOM 变换未记录及列范围未验证两项 P2。85 RED 后在 XML 处理前收集 bomMembers 并设置 bomDetected，原 ZIP bytes 不修改；列 min/max 必须为正整数，且 min≤max≤16384，不按声明范围展开单元格。86 parser 26/26、87 Owner 7/7。

独立复核发现 XML declaration 的宽泛空白正则会先吞掉内部 FEFF，90 RED 后改为仅去首个 BOM、立即检查其余 FEFF、再处理 declaration。XML 语法空白仅允许空格/TAB/CR/LF；非法字符及数值实体、字面 `]]>` 不接受。95 RED 进一步关闭根外字符引用冒充空白。96 最终 parser **28/28**，97 类型检查和 98 API build 通过；92 Owner **7/7** 在最后根外引用检查之前。独立 Spec/Standards 窄复核无阻断。无 DDL、授权或存储改变，验收仍限于既有固定子集。

## PR #6 第九轮修复

远端 Codex 对 `84c9e24` 指出 dimension/pageMargins 等已允许元数据未验证。99 RED 后明确拒绝所有未实现的视图、尺寸、页边距与 workbook 设置节点，替代早期允许空容器的策略；保留 cols 范围和显式 zeroHeight 的实际校验，隐藏 manifest 不变。相邻关系 Id 空白名称也由 ASCII NCName 校验拒绝。100 parser **30/30**，101 Owner **7/7**，102 类型检查和 103 API build 通过；独立 Spec/Standards 窄复核无阻断。无 DDL/授权/存储变化。

## PR #6 第十轮修复

远端 Codex 对 `9e8ff56` 提出 JSON 拒绝值位置缺失、空可见性属性被当缺省、解构 inspectEnvelope 丢失 this 三项 P2。104/105 分别为纯函数与真实 Owner 解构调用 RED。JSON 对象内的标量/语法/长度错误带当前对象及属性序号；sheet state、row/col hidden 仅在属性缺失时使用默认值，显式值必须匹配精确枚举。inspectEnvelope 和 parseFile 共用不依赖 receiver 的闭包，保留原授权/修订/受保护读写路径。

106 parser **32/32**，107 Owner **7/7**（包含解构 inspectEnvelope），108 类型检查及 109 API build 通过，独立 Spec/Standards 窄复核无阻断。无 DDL或权限放宽。

## PR #6 第十一轮修复

远端 Codex 对 `96681d3` 提出 TargetMode 空值及不可能 datetime 两项 P2。110 RED 后，关系 TargetMode 仅允许缺省或精确 Internal；datetime 复用平台 parseLocalDateTime，校验真实月日、闰年及钟表分量，保留原文本与微秒，不使用 Date 或时区转换。原生 TS worker／编译 JS worker 仅选择两个固定本地 helper 路径，不接受输入控制的模块地址。

111 parser **34/34**，112 Owner **7/7**，113 类型检查、114 API build 通过；115 编译后 JS worker 的合法/非法历法值 **2/2**。独立 Spec/Standards 窄复核无阻断。没有扩展其他字段业务规则或改变数据库。

## PR #6 第十二轮修复

远端 Codex 对 `5f8de8d` 提出未引用 sharedStrings 绕过解码/限额与原来源表示丢失两项 P2。116 RED 后统一检查所有共享条目，拒绝未引用的控制字符、FEFF、孤立代理和超长值；内联与共享值分别只解码一次。原单元格 sourceType 改为精确 inlineStr/s，沿源列映射进入规范证据。117 parser **36/36**、118 Owner **7/7**、119 类型检查和 120 API build 通过；121 补强字面转义不得二次解码、重排字段仍保留原表示的断言。独立 Spec/Standards 窄复核无阻断，无 DDL/授权/存储变化。

## PR #6 第十三轮修复

远端 Codex 对 `2528efa` 指出 DEFLATE 流后尾随数据被原 inflater 忽略。123 RED 覆盖正常压缩、尾随任意字节及填充压缩长度以降低表面压缩比。现在使用 Node info 返回的实际消耗字节数，必须与完整声明 payload 长度相等；运行时返回结构不符合预期同样拒绝。原展开上限、比例、长度和 CRC 检查保持。

124 parser **38/38**、125 Owner **7/7**；126/127 记录 TypeScript unknown 收窄问题，调整显式失败返回后 128 类型检查和 129 API build 通过。独立 Spec/Standards 窄复核无阻断。本轮无 DDL/权限/存储变化。

## PR #6 第十四轮修复

远端 Codex 对 `daad18f` 指出 ZIP 本地头/中央目录的修改时间和日期未比较。130 RED 后增加 time/date 对应字段比较，并补齐同样成对出现的 needed version；原头部范围检查在读取这些字段之前执行。131 parser **39/39** 覆盖每个不匹配拒绝及匹配通过，132 Owner **7/7**，133 类型检查与 134 API build 通过，独立 Spec/Standards 窄复核确认偏移和边界无阻断。ZIP 时间字段不作为平台业务时间依据，无 DDL/权限/存储变化。

## PR #6 第十五轮修复

远端 Codex 对 `4b745d4` 指出 worksheet 支持的子节点未校验顺序。135 tests-only RED 后，使用严格递增位置校验要求 sheetFormatPr → cols → sheetData，前两项可省略；同一检查拒绝重复，既有 sheetData 必需性检查保留。136 parser **40/40** 覆盖元数据放在数据之后、前置元数据互换及合法顺序；137 Owner **7/7** 且临时数据库清理成功，138 类型检查和 139 API build 通过。独立 Spec/Standards 窄复核无发现，无 DDL/授权/存储变化。

## PR #6 第十六轮修复

远端 Codex 对 `004d9c7` 提出空 cols 未拒绝及字符限额按 UTF-16 单元误算两项 P2。140 tests-only RED 后要求已出现的 cols 至少含一个 col；8192 字符限额统一按 Unicode code points 计数，合法代理对计为一个码点，不是按字素簇计数。CSV 单元格完成时精确计数，循环内仅保留 16384 UTF-16 单元粗上限，避免每次追加都重新扫描；JSON、XLSX（含未引用共享字符串）使用同一精确计数。非法代理字符仍拒绝。

141 parser **42/42** 覆盖空容器及 8192/8193 个码点、混合 BMP/非 BMP 边界；142 Owner **7/7** 且临时数据库清理成功，143 类型检查与 144 API build 通过。独立 Spec/Standards 窄复核无发现，无 DDL/授权/存储变化。

## PR #6 第十七轮修复

远端 Codex 对 `b81bd54` 提出 CSV 限额列位置及 XML 字面换行两项 P2。145 tests-only RED 后，CSV CELL_LIMIT/COLUMN_LIMIT 使用源字段序号，语法错误仍使用物理字符位置；XML 成员在分词前把字面 CR/CRLF 规范为 LF，随后解析字符引用，因此 `&#13;` 保留 CR，受保护原文件 bytes 不改写。146 parser **44/44**、147 Owner **7/7**；148 记录测试索引属性访问的类型失败，修正后 150 类型检查通过，149 API build 通过。

独立 Spec 复核发现关联的错误工作簿直接写 CR 会在规范读取时丢失原值。151 RED 后，导出器在普通 XML 转义之后把 CR 写为 `&#13;`；152 parser **45/45** 覆盖真实错误工作簿 CR、CRLF 和字面转义文本的回读，153 类型检查、154 API build、155 最终 Owner **7/7** 通过且临时数据库清理成功。最终独立 Spec/Standards 窄复核无阻断；先前 Spec 发现已关闭。无 DDL/授权/存储变化。

## PR #6 第十八轮修复

远端 Codex 对 `f64e841` 指出多行 CSV 记录的限额错误仍使用结束物理行。156 tests-only RED 后，精确/粗 CELL_LIMIT 与 COLUMN_LIMIT 均使用已跟踪的 recordStart，列仍为源字段序号；语法位置保持物理字符位置。157 parser **46/46** 覆盖多行值精确/粗限额的 EOF、逗号、换行结束以及第 101 列；158 Owner **7/7** 且临时数据库清理成功，159 类型检查及 160 API build 通过。独立 Spec/Standards 窄复核无发现，无 DDL/授权/存储变化。

## PR #6 第十九轮修复

远端 Codex 对 `eb66ef7` 指出新增测试没有遵循 ADR-0081 的 Vitest 权威。161 记录仅把两套测试导入改为 Vitest 后旧 Node runner 的真实失败；随后将 P0-04 单元入口、聚合中的 parser 入口及 fresh/upgrade 的 Owner 子进程统一接到现有固定 Vitest **4.1.6**，未新增依赖或替代 ADR。专用配置限定两套文件测试、forks 顺序执行；原生 TS worker 保留 tsx，Owner 测试前通过 setupFiles 加载现有 receipt 连接保护，原临时库 finally 清理保持。

162 Vitest parser **46/46**、163 类型检查通过。164 完整聚合通过：Vitest parser **46/46**、fresh Owner **7/7**、upgrade Owner **7/7**（27 孤立修订升级拒绝及合法原文件保留）、既有 P0-11 **10/10** 与 P0-03 **8/8** 回归、当前 receipt 迁移/类型生成及验证/authority；持久库仍 OID 206108、28 migrations、29 tables、0 业务实例 schema。既有两票回归运行器保持原状，本轮统一的是 P0-04 新增套件，不将历史 Node 实测重新标成 Vitest。

聚合后补充 Vitest setup 对非 receipt 连接的拒绝回归，并将配置纳入类型检查：165 类型检查、166 最终 fresh Owner **8/8** 通过，wrapper cleanupPassed=true。没有改动业务运行时，上一轮 API build 160 的结果保留，不冒称本轮重跑。最终独立 Spec/Standards 窄复核无阻断。

## PR #6 第二十轮修复与范围澄清

远端 Codex 对 `d98db68` 指出整数形式字段代码会被 JS 对象枚举重排。167 tests-only RED 后，内部 SourceObject 显式保存 values 与原始 columns：CSV/XLSX 使用表头顺序，JSON 每个对象使用词法属性顺序，持久单元格列号及 XLSX 原来源类型按此定位。168 Vitest parser **47/47** 覆盖数值字段代码、逐对象 JSON 次序变化及混合 inlineStr/s；169 Vitest Owner **8/8** 且临时数据库清理成功，170 类型检查、171 API build 通过。独立 Spec/Standards 窄复核无阻断。

同轮 Testcontainers 评论按原票显式授权及当前 runbook 处理为验证环境边界澄清，依据已写入本文当前接线开头；保留 receipt-owned 本地测试路径，ADR-0081 容器环境验证为未执行。没有将未执行项目改称通过，也未新增 Keycloak/Toxiproxy 或改变数据库权限。

## PR #6 第二十一轮修复

远端 Codex 对 `b48f077` 指出 CSV 表头和 JSON 属性名绕过解码文本安全检查。172 tests-only RED 后，JSON 键在词法解码后、重复/契约匹配前执行 assertTextSafety；表格 header 同样在匹配前逐列检查。173 Vitest parser **48/48** 覆盖 FEFF、转义控制字符、非字符及孤立代理，且含匹配/不匹配契约的 JSON 键；174 Vitest Owner **8/8** 且临时数据库清理成功，175 类型检查与 176 API build 通过，独立 Spec/Standards 窄复核无阻断。无 DDL/授权/存储变化。

## PR #6 第二十二轮修复

远端 Codex 对 `f5a8a63` 指出 CSV 行限额定位、引号内 bare CR 行计数及 XLSX 限额坐标三项 P2。177 tests-only RED 后，CSV ROW_LIMIT 使用 recordStart（无具体字段时列 0），引号内 CR 仅在不属于 CRLF 时计行；LF 与未引号 CRLF 的原行为保留。XLSX COLUMN_LIMIT 附当前 rowNum/col，ROW_LIMIT 附 rowNum。178 Vitest parser **51/51** 覆盖多行超限、CR/CRLF/LF 后续来源坐标及 XLSX 超限位置；179 Vitest Owner **8/8** 且临时数据库清理成功，180 类型检查和 181 API build 通过。独立 Spec/Standards 窄复核无阻断，无 DDL/授权/存储变化。
