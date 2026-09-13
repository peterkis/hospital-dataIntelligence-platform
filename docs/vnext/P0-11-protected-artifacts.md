# P0-11 受限文件保护

范围：v3 P0-11，仅本地合成保护底座。基线 `00612a81f7b2221d0f4bd4f12670de15b5df1968` / tree `6162d77c457158aac26724e955241d7f71b6efcd`，进入时 main 工作树干净。当前 receipt OID 206108，22 项已安装 checksum 核实。P0-02 **BROWSER_BLOCKED** 保留，P0 仍 **IN_PROGRESS**；P0-04 未开始。

## 设计及调用

`openCatalog(connectionString, keyProvider)` 暴露 `storeProtectedArtifact`、`readMasked`、`authorizeSensitiveRead`、`purgeOwnedExpiredArtifact`，均为当前唯一 governance-catalog Owner 的 typed API。无 HTTP 上传/下载、新页面、解析、规则引擎、业务 Apply 或 ORG/PER 实例。P0-04 将消费这些接口，本票测试是实际调用方。

0023 新增三个表，对应不可绕过的不变量：protected_artifact 保存不可变作业/修订、院区、目的、请求与到期事实；protected_payload 独立保存可删除的 AES-256-GCM 密文；protected_grant 扩展现有 actor/授权锁，限定 dataset × campus × purpose × operation。没有新 identity、审计链、持久数据库或授权管理页面。应用角色表读取受 RLS 默认拒绝，不能直接写表，有限 SECURITY DEFINER 函数复核当前授权。管理员仍可运维数据库，不宣称能抵御管理员或受信服务进程失陷。

本地 `LocalSyntheticKeyProvider` 仅在内存生成随机密钥，**非生产、进程存活期内使用**；rotate 保留本实例旧 payload key，独立 lookup key 只用于 HMAC 请求去重。调用方必须保有同一 provider；未提供、丢失实例或旧 key 不可用均失败关闭，不自动替换为新 key 解密。密钥不入数据库、仓库、日志或默认配置。此实现没有磁盘密钥托管与进程重启后可读承诺；真实文件进入前仍需生产 key-provider 和扫描能力，不能据本票宣称生产就绪。

使用 Node 内置 OpenSSL AES-GCM/HMAC，无自制算法或新增依赖。每次加密有随机 96-bit nonce 与 128-bit tag；AAD 绑定 job、revision、kind、campus、purpose、存储 requestId，防止跨制品替换。输入上限 1 MiB，仅允许 RAW_FILE/RAW_CELL/ERROR_REPORT 的不透明 bytes，不解析字段。普通 job 接口仍只接受 METADATA_ONLY。掩码固定 `[REDACTED]`，不会泄露短值或尾号。所有制品永远 QUARANTINED，没有 CLEAN 命令或假扫描结果；敏感读取仅供明确目的下受限检查，不产生扫描/业务准入资格。

现有 READ_JOB 不赋予 raw 读取。新存储要求当前 exact 契约、当前修订、本人 underlying identity、对象 WRITE 和独立 STORE grant；明文读取要求当前对象/契约访问、本人身份、精确院区/目的 READ grant。认证来自受信调用方，与现有 Owner 同边界。没有可重用授权 token；读取与授权锁同根事务，审计提交后才返回 bytes。grant 变更复用 901002 锁并留审计。生产/BASELINE 存储尚未开放。

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
