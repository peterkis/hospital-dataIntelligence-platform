# P0-11 受限文件保护

## PR #5 第一轮审阅修复（2026-09-14）

用户在初始本地交付后明确授权推送、创建 PR、修复 Codex 意见至通过、合并和分支清理；以下初始 local-only 记录保持为历史事实。远端 Codex 对 `0424015` 提出一项 P2：READ/MASKED/PURGE 在最初 scope 授权被拒绝时，旧函数用 requestId 作 audit.object_id，无法追溯请求制品。

新增前向迁移 0024，只替换有限函数中的审计目标表达式：非 STORE 始终用输入 artifactId；STORE 成功用新制品 ID，拒绝用所引用 jobId。不为审计额外查询目标存在性，不改变拒绝结果、权限、payload 或既有审计。已安装 0023 的 checksum 保持 `47b9aca0a43b26250eeaabda31fefb390895bc241adb974a6f1dc97f7a7d7b66`，不改写历史错指向的记录。

`.runtime/vnext/p0-11/17-pr5-denial-red.log` 是真实 tests-only RED：object_id 实测为 request UUID。18-pr5-upgrade 与 20-pr5-fresh 修复后均 6/6，通过 scope 无权/未知 actor、存在/不存在制品、READ/MASKED/PURGE 与 STORE 拒绝的目标断言。23→24 升级另逐字核对原制品 metadata、密文和 audit，旧 job/契约读取不变，旧密文仍可读取，审计链验证通过。19 为专项类型检查；21–23 为当前原库迁移、生成类型 verify 和 authority。未改变表结构和 TS 运行时代码，沿用初始全仓 build/类型检查与作业回归，不把它们记成本轮重跑。当前迁移数 24，OID 206108/29 表/零业务实例 schema 保持。

本地独立增量 Spec/Standards 复核未发现剩余阻断项；它不代替远端 Codex 的新 head 复审。最终远端审查、合并及本地/远端分支清理事实另存 ignored 交接。P0-02 BROWSER_BLOCKED、P0 IN_PROGRESS 和 P0-04 未开始均保留。

## PR #5 第二轮：公开摘要旁路（2026-09-14）

Codex 对 `b21ec8e` 提出 P1：绑定作业的公开 declaredSha256 若等于受限 bytes 的普通 SHA，HMAC 隔离仍被旧 metadata 绕过。24-pr5-public-digest-red 真实复现旧代码接受该组合；新增同根事务保护后 25 为 7/7。存储先执行原权限/接收命令，再在提交前经同 Owner 读取该 job 全部历史修订，在内存比对普通 SHA；命中则 `PUBLIC_DIGEST_CONFLICT` 回滚 artifact/payload/outcome/request_identity 及暂存成功审计。普通 SHA 不作为 SQL 参数、不持久化、不进入错误；原 metadata 不改写。SQL 正常授权拒绝仍先提交原非敏感拒绝 ledger，再向调用方抛错。入参和 bytes 在异步前复制，901002 持有至提交。

相邻反向顺序也单独由 27-pr5-reverse-digest-red 复现：先保护、再新增匹配摘要。因此 0025 对 import_input_revision 增加有限 INSERT guard：job 有任意 protected_artifact 后，只能复用该 job 既有 declaredSha256 集合，不能追加新的普通摘要。清理 payload 后也保留约束；无受限制品的 job 保持 P0-03 行为。沿用已有非内容 marker 的修订仍可追加，后续解析票不能把真实敏感 bytes 摘要放回普通 job。该限制没有通用策略引擎或业务 Apply。

28-pr5-digest-upgrade 的 24→25 与专项 8/8 通过，原 job/契约/制品/审计仍保留。测试覆盖 RAW_FILE/RAW_CELL/ERROR_REPORT、历史声明命中、反向追加、同事务全回滚、并发两命令只能提交一个且最终不得同时存在 payload 和匹配公开 SHA；入参突变不能改变已验证 payload/AAD。后续 29–36 为最终 fresh、当前库25迁移/types/authority、P0-03回归、专项类型检查、API build 和 lineage 检查。审阅、最终合并状态以 ignored 交接的对应 head 为准；不将先前候选的测试冒充为本轮重跑。

## PR #5 第三轮：旧冲突升级与拒绝证据（2026-09-14）

Codex 对 `8a59319` 新增两项发现：旧版本可能已存在冲突制品，0025 只限制后续写入；摘要冲突回滚也丢掉拒绝审计。37 的真实 RED 证明少一条拒绝 audit；38 使用 0024 原 SQL 服务路径和真实 AES 密文复现两种旧顺序，并证明原升级没有拒绝这些状态。

0026 首次安装时发现任何既有 protected_artifact（包括 payload 已清理的引用）便以 `PROTECTED_LEGACY_SCAN_REQUIRED` 阻断，整次 0026 及 ledger 不提交。这个保守准入不猜测旧密文安全、不要求回填密钥、不删除或恢复旧记录；有既有制品的库须另行受控扫描与处置才能升级，本票没有自动绕过标志或生产扫描器。当前唯一研发库没有持久制品，允许正常升级；先前临时库“旧合法制品仍可读”的 23/24→25 结果是历史验证，不代表带旧制品的库自动获准进入 26。

摘要冲突先整体回滚 payload/outcome，再通过 closed `protected_digest_denial` 记录固定拒绝原因、job/revision/request 引用及目的/院区；临时普通 SHA、bytes 和自由文字不进入该命令。拒绝记录失败返回 `PROTECTED_OPERATION_FAILED`，不宣称审计成功。只有拒绝证据已提交后才向调用方返回 `PUBLIC_DIGEST_CONFLICT`；这不声称两个事务间进程崩溃时仍具备原子记录，实际重启/恢复门禁保持本阶段既有边界。

39 的 upgrade runner 顺序使用两座 owned 临时库：第一座含真实旧冲突，25→26 必须拒绝且原 metadata/密文/audit 不变；清理后才创建第二座，无旧制品的 25→26 正常升级，原契约/job/audit 保留且专项 8/8。41 为补强拒绝审计故障和非法输入后的最终 fresh；40/45 为专项 tsc/API build；42–44 为当前库26迁移、types verify 与 authority。已有 0023–0025 checksum 保持，最终合并事实另存 ignored handoff。

## PR #5 第四轮：拒绝原因的可信来源（2026-09-14）

Codex 对 `6f0f61b` 指出，自定义 KeyProvider 抛出同名 `PUBLIC_DIGEST_CONFLICT` 错误可能被误认作真实比较结果。46 真实 RED 证明未执行授权/摘要比对也能多出审计。现在用模块私有 Symbol，只有实际内存比较命中才能抛出；catch 仅按标记身份进入审计分支，提交成功后才产生对外错误码。同名字串已从通用错误白名单移除，provider 异常仅为 `PROTECTED_OPERATION_FAILED`。

47 最终 fresh 专项 9/9，无 SKIP，覆盖 provider.current/lookup 两路径及真实冲突审计；48 tsc、49 API build 通过。本轮无 DDL，26 迁移及此前升级/authority 证据保留，不重复报告为新执行。本地实际增量 Spec/Standards 复核无阻断，远端当前 head 的最终结论仍单独核验。

## PR #5 第五轮：完整准入的文档补齐（2026-09-14）

Codex 对 `803494d` 指出 STORE 的 READ 依赖未在本页存储条件中写全。此处接受文档遗漏，保留既有 Owner 的完整准入，而不是绕过已有授权：P0-11 §2/§4 要求复用当前 owner、当前权限及新建完整准入，并未要求 write-only STORE。0021 的 job 写入明确要求 READ + WRITE；0012 的 `contract_require_access(...,'WRITE')` 仍要求 definition/source/parameter 读取许可，0008 的来源访问也明确要求 scope READ。允许 P0-11 绕过这些 owner 检查会改变已合并依赖的契约。

因此存储明确要求 **scope READ + WRITE、本人 underlying identity、当前精确契约/依赖访问、对象 WRITE、独立 STORE grant**。READ_JOB 不赋予 STORE，也不赋予受限 payload READ。50 新增撤 READ 负例：保留 WRITE/STORE 仍拒绝、不增加 payload/outcome/request_identity、拒绝 audit 保留；恢复 READ 后原请求可成功，普通 job READ 仍不能获取 raw。50 最终 fresh 10/10，51 专项类型检查通过。该既有行为是 GREEN 契约回归，不伪称 runtime 修复或 tests-only RED；本轮只改文档和测试，无 DDL/运行时代码变化。

## 初始本地交付

范围：v3 P0-11，仅本地合成保护底座。基线 `00612a81f7b2221d0f4bd4f12670de15b5df1968` / tree `6162d77c457158aac26724e955241d7f71b6efcd`，进入时 main 工作树干净。当前 receipt OID 206108，22 项已安装 checksum 核实。P0-02 **BROWSER_BLOCKED** 保留，P0 仍 **IN_PROGRESS**；P0-04 未开始。

## 设计及调用

`openCatalog(connectionString, keyProvider)` 暴露 `storeProtectedArtifact`、`readMasked`、`authorizeSensitiveRead`、`purgeOwnedExpiredArtifact`，均为当前唯一 governance-catalog Owner 的 typed API。无 HTTP 上传/下载、新页面、解析、规则引擎、业务 Apply 或 ORG/PER 实例。P0-04 将消费这些接口，本票测试是实际调用方。

0023 新增三个表，对应不可绕过的不变量：protected_artifact 保存不可变作业/修订、院区、目的、请求与到期事实；protected_payload 独立保存可删除的 AES-256-GCM 密文；protected_grant 扩展现有 actor/授权锁，限定 dataset × campus × purpose × operation。没有新 identity、审计链、持久数据库或授权管理页面。应用角色表读取受 RLS 默认拒绝，不能直接写表，有限 SECURITY DEFINER 函数复核当前授权。管理员仍可运维数据库，不宣称能抵御管理员或受信服务进程失陷。

本地 `LocalSyntheticKeyProvider` 仅在内存生成随机密钥，**非生产、进程存活期内使用**；rotate 保留本实例旧 payload key，独立 lookup key 只用于 HMAC 请求去重。调用方必须保有同一 provider；未提供、丢失实例或旧 key 不可用均失败关闭，不自动替换为新 key 解密。密钥不入数据库、仓库、日志或默认配置。此实现没有磁盘密钥托管与进程重启后可读承诺；真实文件进入前仍需生产 key-provider 和扫描能力，不能据本票宣称生产就绪。

使用 Node 内置 OpenSSL AES-GCM/HMAC，无自制算法或新增依赖。每次加密有随机 96-bit nonce 与 128-bit tag；AAD 绑定 job、revision、kind、campus、purpose、存储 requestId，防止跨制品替换。输入上限 1 MiB，仅允许 RAW_FILE/RAW_CELL/ERROR_REPORT 的不透明 bytes，不解析字段。普通 job 接口仍只接受 METADATA_ONLY。掩码固定 `[REDACTED]`，不会泄露短值或尾号。所有制品永远 QUARANTINED，没有 CLEAN 命令或假扫描结果；敏感读取仅供明确目的下受限检查，不产生扫描/业务准入资格。

现有 READ_JOB 不赋予 raw 读取。新存储要求 scope READ + WRITE、当前 exact 契约及 definition/source/parameter 依赖访问、当前修订、本人 underlying identity、对象 WRITE 和独立 STORE grant；明文读取要求当前对象/契约访问、本人身份、精确院区/目的 READ grant。认证来自受信调用方，与现有 Owner 同边界。没有可重用授权 token；读取与授权锁同根事务，审计提交后才返回 bytes。grant 变更复用 901002 锁并留审计。生产/BASELINE 存储尚未开放。

PURGE 要求当前 WRITE 主体、本人作业、独立精确 PURGE grant 和 DB 到期时间（1–2592000 秒），不重检上游契约/对象资格，避免上游撤权阻挡非扩张清理；过期即拒绝明文，即使尚未物理清理。只删除 payload；metadata/outcome/audit 保留。该删除不承诺擦除 PostgreSQL WAL、备份或介质。原请求重放返回原接收结果，不代表 payload 当前仍存在；实际读取每次重检。

审计仅含技术引用与受控维度：存储、读/掩码请求、拒绝和删除均追加现有链；action 含 purpose/campus，reason 为有限结果。`REQUEST_AUTHORIZED` 表示请求权限已核验，**不表示 bytes 成功释放**，例如 key 不可用时仍有请求证据。SQL/crypto 异常统一为有限错误，不传播原错误、密码或 raw 内容；原值普通 SHA 不入 audit，存储请求 HMAC 不可作为外部身份 token。本票未开放标识检索；未来精确检索需受控 namespace/keyed lookup，不能把普通 SHA 用于低熵标识。

## 来源责任

PER02/PER03/PER22 原字段与 field-routing 不改写；本票责任字段数 0。Q17 的目的保护和 Q42 的合成样例隔离在本票验证，真实导出/真实文件扫描 NOT_RUN。IMP015/A030 的本票保护部分由下列专项覆盖；后续解析、人员实例、消费者投影、业务授权依据采纳仍由原后票承担，完整来源验收不标 PASS。CORE/FULL job 契约保持原样，不自动降级。

## 验证与审阅

证据目录 `.runtime/vnext/p0-11/`。01-fresh 是 schema 白名单遗漏导致的真实失败，清理成功；02-fresh 为第一候选 5/5 通过。没有声称 tests-only 初始 RED。后续最终候选命令、结果与同候选 Spec/Standards 审阅补记于本节，最终 commit/tree 写 ignored handoff。

本票 DOMAIN：真实 DB 权限、轮换、key 故障、retention、无敏感日志、请求冲突/并发、审计回滚和密文篡改；DDL 空库、22→23 保留原契约与 job 历史、生成类型及 authority。UI 与实际应用重启本票 NOT_RUN，按阶段关闭要求保留。

| 证据 | 命令与实际结果 |
|---|---|
| 03-upgrade | `prototype:db:with -- vnext:protected:upgrade`：22→23，原 53 份契约和原 job 历史相等，5/5 |
| 04-fresh-types | `prototype:db:with -- vnext:db:fresh:types`：空库安装、重复迁移/seed、生成类型通过；沿用通用 fresh runner 的 P0-01 临时 receipt 标识，不是再次实施 P0-01 |
| 05、06、08、09 | protected 专项 tsc、module boundaries、全仓 typecheck；lineage/wrapper 测试 4/4 |
| 07-final-fresh | AAD 加入存储请求身份后的 fresh 5/5；此时尚未修复审阅发现的键序重放问题 |
| 10-reviewed-fresh | 修复后的空库专项 5/5：覆盖 AC01–05、重排 JSON 键重放、alias、并发、权限撤销、替换密文、审计失败阻断明文释放与写入回滚 |
| 11、12 | 修复后专项 tsc、全仓 build 通过 |
| 13-current-migrate | 当前原库 22→23；OID 206108 不变，checksum 前缀相符，0023 SHA-256 `47b9aca0a43b26250eeaabda31fefb390895bc241adb974a6f1dc97f7a7d7b66` |
| 14、15 | 当前库生成类型 verify、authority 通过：29 表，businessInstanceSchemas=0 |
| 16-jobs-regression | receipt-owned 临时库 P0-03 作业回归 8/8，无 SKIP |

以上 DB 成功运行均有 DATABASE_SESSION_READY、targetExitCode=0、cleanupPassed=true；owned 临时库清理完成。部分 service stop 命令返回 1，但实际服务 inactive、连接已不可达，wrapper 明确确认清理成功；不将单个 stop exit 描述为 0。当前库只执行前向迁移/只读校验，变更测试全在临时库。日志扫描未出现测试敏感 sentinel；数据库元数据、outcome、audit、audit_chain 与错误路径亦由 AC05 核验。没有新增依赖或联网同步。

独立审阅以固定 baseline 对候选 tree 的差异进行只读 Spec/Standards 检查，不以 source review 冒充 DB 执行。第一候选 Standards 无阻断；Spec 发现 JSON 字段顺序影响 HMAC 幂等，已改为固定字段 tuple 并在 10 中验证。最终候选两轴复审及最终 commit/tree 在 ignored handoff 记录；审阅没有联网或连接 DB。完成本票即停止，不推进 P0-04，不关闭 P0-02 browser 待验或 P0 阶段。
