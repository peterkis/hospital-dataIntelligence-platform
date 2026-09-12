# P0-01 治理目录

后续 PR #2 审查修复：新增 `0003_catalog_published_authority_and_identity_replay`，已发布来源权威与未批准候选分离；同一 identity 的不同 alias 共用原请求结果，仍检查当前 alias 权限。新增只追加请求身份索引表，保留原 outcome/audit 行，当前共10张表。下文初始交付两份迁移/9表及其指纹为历史证据；新的迁移/复验记录另存 `.runtime/vnext/pr-2/`。未实现生命周期的明确处置见 `catalog-lifecycle-disposition.md`。

来源：`D:/Agent-Prompts/HDIP-MC-P0-01-catalog-execution/P0-01-governance-catalog.local-only.prompt.md`，原 v2 开发包 P0-01。开工 HEAD `7d5d7838e983bb21b445bd4f0d8cfe0be817969e`、tree `321c2ca28a7eba399cb83a1d464ca5151aeae32e`、parent `b84ebca6a1eb277172531014e1fe11e03db7e7b4` 已现场核对，初始工作区干净。P0-00 handoff 原字节保存在 `.runtime/vnext/history/P0-00-handoff.json`；creation receipt 保持原样。

## 入口、权限与迁移

命令均在仓库根执行。数据库操作用 `npm run prototype:db:with -- <script>`；不通过旧 migration/seed 安装 vNext。

| npm script | 用途 |
|---|---|
| test:vnext:lineage | receipt/环境覆盖/迁移 prefix 保护 |
| vnext:db:verify | live identity、已知 namespace、完整 checksum 前缀；恢复不再要求空库 |
| vnext:db:migrate | receipt-bound 原生 SQL 安装/升级，单 writer，每个文件与 ledger 同事务 |
| vnext:catalog:seed | 来源快照、53 目录候选与合成控制身份；重复相同来源 no-op，漂移拒绝 |
| vnext:db:types:generate / verify | 独立 Kysely 生成/核验，新库类型不复用旧 91 表类型 |
| vnext:db:fresh:validate / upgrade:validate | 临时新库 fresh / 合法 bootstrap 前缀升级及 seed 幂等 |
| vnext:catalog:validate | 五项原 AC 对应真实 owner/DB 场景 |
| vnext:catalog:adversarial | 临时库 checksum、并发迁移、DDL/audit 故障、撤权与 HTTP 负例 |
| vnext:contract:generate | 从真实 Fastify route 生成 OpenAPI，再用已有本机 generator 生成 client |
| vnext:ui:build | 独立 React/Vite 页面构建，不改旧前端 runtime |
| vnext:catalog:serve / serve:fresh | 持久/临时 receipt-bound 本机页面；`.runtime/vnext/server.json` 保存停止文件 |

页面为 `http://127.0.0.1:4317/admin/vnext/catalog`，只监听 loopback。停止时创建 server receipt 指定的 stopFile，等待服务和 wrapper 自行收尾。不能结束无关进程。浏览器是合成身份选择器，不是正式登录；maker-alias 与 maker 的 underlying identity 相同，不能自审。

连接 secret 从既有 ignored `.env.prototype.local` 继承，数据库名仅取 receipt。拒绝 PGSERVICE、PGDATABASE、PGHOST 等覆盖以及 URI query；连接前约束与连接后 name/OID/owner/port 检验并用。迁移管理员只通过已有 WSL peer 路径，应用角色无 SUPERUSER/CREATEDB 扩权。临时库具独立 creation intent/receipt；清理精确核对身份且拒绝活动会话。P0-00 cleanup 拒绝保持，持久 vNext 和旧证据库均不删除。

`0001_control_plane_bootstrap` 建控制身份、权限、结果、审计及 checksum ledger；`0002_governance_catalog` 建来源快照、对象、版本与治理事件。每份 migration 由 runner 唯一控制事务，文件本身不包 BEGIN/COMMIT。合法前缀升级保留 bootstrap fixture 和旧 ledger，不伪称存在历史业务版本。SHA-256 是本次新链字节证据，不能回推旧库当年执行字节。

## 目录来源与覆盖

`db/vnext/sources/package-v2` 保存 116 份原文件，逐文件摘要在 `catalog-metadata.json.manifest`；CSV UTF-8 BOM 只在元数据编译阶段去除，源字节原样保留。`prepare-catalog.py` 不是通用上传解析器；它只编译明确本地包。已存在不同快照拒绝覆盖。

11 主题来自 docs/02，53 目录技术码为 ORG01–27/PER01–26。419 个 ORG 与 447 个 PER 字段逐项保存原文、JSON pointer 和原 routing；元数据登记=866，业务字段实现=0。GOV01 原规格另列，所有 ORG/PER adapter 仍 NOT_READY。已知未来引用登记 DECLARED_NOT_READY；未知 ID/字段、缺多态判别或外部处置阻断编译。ORG07 负责人只登记 PER01.person_id/P5 等依赖，不创建 Person。

GOV01 runtime thin profile：DB签发 ID/version/R；system_code/name、environment=SYNTHETIC、sourceKind、deploymentScope声明、vendor_name/system_version条件、business_owner/technical_contact_role岗位描述、sourceEvidence以及 B 期间。record_status 由治理事件维护；来源描述不变。interface_contract_ref 只声明，真实接口、正式院区 UUID、院方 approval_ref、真实系统接入都 NOT_READY。source_system_id 根例外是唯一 SYNTHETIC_BOOTSTRAP；后续源引用已发布来源的技术ID。system source_id 不等于 Person/IAM 绑定。

源材料 approval_status 原样“待院方确认”；目录治理 DRAFT/REVIEW/PUBLISHED/RETIRED 独立；实施准备为 METADATA_ONLY，不能据 PUBLISHED 宣称真实文件可 apply。合成测试在 SYNTHETIC scope 发布，不改变来源基线53条。源资格读取只证明 registry 引用准入，真实 apply 未实现。

Q04 仅覆盖元数据责任/来源/签审；Q31/32/33/34/35/37/38/39 按源 quality-gates disposition 保留范围外，不冒领药品/检验/患者等业务实现。完整原门禁字典已随来源快照保存。来源规则与 FULL 草案仅供可追溯说明，不等于 P0-02 可执行 contract 注册。

## 当前契约与治理语义

唯一 Owner：`apps/governance-api/src/modules/governance-catalog/index.ts`。公开 read/command/history/resolveSource 能力通过受限数据库函数执行；维护 UI 与 HTTP 使用相同入口。HTTP 路由是 `/api/vnext/catalog`、`/:id`、`/commands`、`/:id/history` 和 `/api/vnext/sources/:id/qualification`，从 TypeBox 实际 route 生成独立 OpenAPI 和 typed client。新增消费方只有 vNext 页面，旧费用/Person/consumer API、client、DB 默认目标不变。

新建/修订追加完整版本；提交绑定 exact 版本和内容/B 期间摘要；复核者当前权限与 maker underlying identity 单独核验。版本/事件/outcome/audit 同事务。当前权限先于请求重放，撤权不能用旧 R 或旧 request 读回结果。请求相同回原 outcome，不同 payload 冲突。旧状态和载荷不可更新/删除；R 取真实 DB 本地微秒时间，B 半开且 null 无界。

责任 OWNER/STEWARD/COLLABORATOR 是元数据职责，来源 Owner 建议不自动成为授权主体。ALL 覆盖 NORTH/SOUTH，字段 ALL 覆盖 IDENTITY/CONTACT；同 dataset/重叠事实范围/重叠 B 的已发布 Owner 冲突，协同方允许。更替通过新版本的完整期间，并保留旧 R。审批、字段或期间变动都产生新 candidate。

权限粒度为当前 actor × BASELINE/SYNTHETIC × READ/WRITE/REVIEW。BASELINE 只开放读取；可操作发布测试在 SYNTHETIC 范围进行。审计不存 raw source payload、密码或个人标识，仅技术 refs/action/reason code/digest/R。有限 source evidence、权限和责任是目录底座，不是全域 BPM、P6 IAM 或业务实例。

## 实际验证与交接

全部原始日志、RED、失败/重跑及最终逐 gate 索引位于 `D:/Agent-State/HDIP-MC-VNEXT/P0-01`，最终结果由该目录及 ignored `.runtime/vnext/handoff.json` 记录。文档不预填 PASS，也不把源码推断、unit、DB、浏览器混称成相同数据库测试。类型工具路径来自已安装本地缓存，不运行联网 npm exec。首选浏览器插件不可连接时，使用当前可用浏览器控制工具，未改安全设置。

最终 stage 后由 Spec/Standards 对同 tree 复审；修复后重跑受影响门禁。最终 commit/tree 与资源记录只写 ignored handoff/external state，避免第二次自引用提交。原 P0-00 DONE 历史保持；只有 P0-01 变更状态。P0-02 仅下一候选，执行未授权。

## 本次实测结果与保留事项

持久库仍为 creation receipt 的 `hdi_mc_vnext_a7049c9e5c2a4364` / OID `206108` / owner `hdi_prototype`。新链两份 SQL 已安装；9 张控制平面/目录表，无 ORG/PER 业务实例表。fresh 与合法前缀升级的结构指纹均为 `e247902528f9dc1b8157ef1a591c90cd5c3419c390f53cb8300b9e634cbdb0ef`。独立 codegen generate/verify 已真实执行。来源快照摘要 `31b3deb563b7667a9daf64447446745641cd35ebbee3ba87e9d8223003be3d7c`；原116份来源文件逐一匹配。

重启准备 postmaster 为 `2026-09-12 20:01:47.130539+08`，恢复时为 `2026-09-12 20:02:11.572386+08`（此处是实例诊断时间，不是领域 B/R）。新进程恢复了 baseline53/866、source、责任更替的旧 R/当前状态及原 request outcome。持久库保留来源基线 DRAFT 和独立合成恢复样例。浏览器先在 fresh scope 执行完整维护闭环，再在持久库只读复验修复后的版本差异及 source summary。

初审四项阻断已修复并保留历史：REJECT 选择性撤回 REVIEW 后不能重放；空库/lineage 检查覆盖 public 函数/枚举及非系统 pgx schema；页面显示持久化前一版本→当前版本的完整治理字段/B 差异；目录和字段的原始格式/ref/身份/类型/隐私说明可见。另补充来源 exact evidence version 和完整期间检查、peer 环境清理、临时删除的磁盘 creation intent/receipt 复核。最终结论以同 tree review receipt 为准。

失败/重跑日志保留：CSV BOM 读取、seed/SQL 变量名冲突、codegen 相对输出路径、前端异步列表覆盖与时间显示归一化、旧 authority checker 未登记新模块等。旧 checker 现在合并两个显式 ownership 声明来审查源码模块边界，但其 live DB/type 检查仍只认旧 lineage；`vnext:authority:check` 单独核验新库与9表派生类型。没有删除旧 checker 或弱化未声明 Owner 的拒绝。

部分托管会话的 `systemctl stop` 退出1；日志同时记录了实际 inactive、连接拒绝、distribution terminate 成功与 cleanupPassed=true。没有将退出1改写为0。清理仅本票临时DB/托管会话；持久新旧库保留。source-negative 和 baseline 测试的合成文件作为证据保留，未声称清理整个 Temp。

新链 checksum 绑定原始 SQL bytes；0002 安装时含 CRLF 和末尾空行，因此 `.gitattributes` 对 `db/vnext/migrations/*.sql` 禁止 Git 换行转换，并仅允许保留该类文件的末尾空行。没有在安装后改写 SQL 来迎合格式检查；最终 Git blob SHA-256 必须与 live ledger 相同。旧39份迁移的属性与内容未修改。

GOV01 的18个源字段三组处置见 `GOV01-thin-profile.json`；字段名称/来源条件与平台薄切不是同一批准结论。源和规则业务采纳、正式认证、真实系统连接、导入 adapter/apply、P0-02 可执行契约以及生产/ABG均未实现或未授权。
