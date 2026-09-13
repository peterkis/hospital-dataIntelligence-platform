# P0-03 作业与静态适配器骨架

2026-09-13，执行 `HDIP-Codex-Multicampus-Development-Pack-v3/START-P0-03.prompt.md`，单票、本地提交、不 push。工程骨架及适用测试完成；旧库物理退役仍待精确对象确认，不能宣称只有一个物理数据库。P0-02 保持 **BROWSER_BLOCKED**，P0 保持 **IN_PROGRESS**。未重跑 P0-00/01/02 的建设工作。

## 设计与调用面

沿用 ADR 0122 的 governance-catalog 元数据 Owner、原生 SQL lineage、当前授权与审计链。0021 只新增 `import_job` 和 `import_input_revision`：前者保存稳定作业身份、提交者 underlying identity、scope/profile 和完整服务器契约快照，后者按 job 内 bigint 正序追加。每 job 最多 1000 revisions；current revision 的复合延迟 FK 保证引用属于自身 job。没有新业务 schema，原 `table-ownership.json` 的 schema Owner 不变。

公开入口为 `openCatalog()` 返回的 `importJobCommand`、`importJobRead`、`importJobAdapter`。采用 TypeBox closed schema，未增加 HTTP 路由、OpenAPI 或客户端协议；现有生成客户端随 build 验证。CREATE 必填 `scope/requestId/reason/contractId/contractVersionId/profile/input`，REVISE 必填 `scope/requestId/reason/jobId/expectedCurrentRevision/input`。`input` 仅允许 `{kind:'METADATA_ONLY', declaredSha256:<64 lowercase hex>}`，不允许 raw 行、文件 bytes、URL、路径或客户端 VERIFIED 状态。reason 是有限长度的大写技术代码，不接受自由描述。

作业与修订 ID 由 DB 分配；外部摘要始终是 DECLARED，服务器另算 metadataDigest。作业为 WAITING_INPUT、adapter 为 NOT_READY，创建元数据不代表导入成功。读取仅限同一 underlying identity，且每次重查精确契约及其引用的当前权限。写入还要求 dataset 的当前 WRITE 权限；scope 许可不替代对象许可。

SQL command 在同一个根事务持有既有 901002 锁，调用本 Owner 的 `contract_read` / `contract_require_access`，再写 job/revision/outcome/request_identity/audit。授权先于请求重放；同 identity/request/payload 返回原结果，payload 改变返回 REQUEST_CONFLICT。不同请求同 expected revision 只有一个成功。新写入要求 exact HISTORY 中存在 PUBLISHED，同时当前服务器 B/R 下 EFFECTIVE 返回同一版本；草稿、废止或当前不适用的版本被拒绝。历史 job 保留原快照，已授权原请求在退休后仍可重放原结果；这不是允许产生新可处理作业。P0-08 仍须在真实 Apply 前复验权限、依赖和期间。

静态 selector 声明 53 个已知 dataset 的 CORE/FULL：owner 和支持范围尚无实现，allowedIntents 为空，capability 全部 NOT_READY；未知 dataset 拒绝。`importJobAdapter` 从当前授权读取的冻结 job contract 取得 dataset/profile/version，调用者不能另传一个 dataset 替换绑定。`requireImportExecution` 在任何业务写入前拒绝；未来 validate/plan/apply 仅有 typed boundary。test-only adapter 在测试内调用，不注册为生产 READY。

`assertJobLocalAlias` 只检查 `(jobId,revisionId,datasetId,clientKey)` 引用边界，不解析、持久化或分配永久身份。作业元数据接口不接收 alias 数组；P0-07 再引入完整解析与拓扑排序。没有上传、规则执行、业务 Apply、新页面、旧收费 Owner 迁移或跨库联查。

## 实际验证与证据

本地证据目录：`.runtime/vnext/p0-03/`，日志保留命令、退出码和失败历史。不是正式 ABG，也不是医院生产验证。

| 证据 | 实际命令/结果 |
|---|---|
| 01-preflight | `npm run prototype:db:with -- vnext:db:inspect`，基线 20 项 checksum 相符，OID 206108 |
| 02-red-exact | `vnext:jobs:validate`，tests-only RED：`importJobCommand is not a function`，exit 1 |
| 03、05、06 | 03 的 npm 参数未转发，误跑 CURRENT，未迁移故缺 SQL 函数；05/06 临时库发现 SQL actor 参数歧义；06 还发现 selector 缺接口。均保留为真实失败，不记 PASS |
| 07 | 初始 3 组 core 测试 GREEN；同身份请求重放/冲突和追加修订实际通过 |
| 08–12 | 扩展测试先后暴露合成目录重名、字段名称/类型不匹配和撤权后 fixture 选择问题；修正测试 fixture，未放宽领域限制 |
| 13-upgrade | `vnext:jobs:upgrade`：20→21，逐字比对原 53 契约读取不变，7/7 通过 |
| 14-fresh、21-final-fresh | `vnext:jobs:fresh`：空库→21，最终 7/7 通过；包括撤权重放拒绝、审计故障六类行计数全回滚、并发修订、raw 拒绝、exact 草稿/退休拒绝和跨 job/revision/dataset alias 拒绝 |
| 15-current-migrate | `vnext:db:migrate`：当前库 20→21，OID 仍为 206108；0021 SHA-256 `0907442d1c5d1a4a923e4b50fbcc02f2c10410dbfaeba6be6fac1555f8624a34` |
| 16-current-regressions | `vnext:p0-03:validate`：codegen/verify/authority exit 0；26 表，businessInstanceSchemas=0；当前库 job 6 PASS、1 SKIP；P0-02 契约及状态单元 9/9；P0-01 目录 6/6 |
| 17、18、19 | `check:module-boundaries`、`typecheck`、`build` 均 exit 0 |
| 20、22 | 新增测试单独 tsc 首次发现 fixture action 类型过宽，修正后 `vnext:jobs:typecheck` exit 0 |

当前库 SKIP 的一组是管理权限故障注入/撤权，已在 receipt-owned 临时库真实执行，避免改动持久库既有授权。当前库测试只创建合成元数据。临时库逐座创建、逐座按 receipt/OID/零会话清理；托管命令的最终记录均有 `cleanupPassed=true`，不形成第二持久研发系统。旧库没有作为执行/回归前置；53 BASELINE 契约保持 DRAFT，ORG/PER/费用业务 schema 为零。

**RED 顺序限制**：只在首个实现之前保存了缺作业接口的 RED，随后保存缺 selector 的 RED；跨 job 断言在该 selector 失败之后尚未到达，请求冲突也没有独立的初始 tests-only RED。因此不能宣称四项都完成了严格初始 RED。本票最终行为 GREEN 与这一测试顺序偏差分开记录，不以 later GREEN 追认初始 RED。

独立同候选 Spec/Standards 审阅发现生成类型未更新、null 外层输入异常和 selector 未由冻结 job 派生；已更新生成类型、添加 closed-input guard/负例和 `importJobAdapter`。复审未发现剩余阻断缺陷。审阅未执行 DB 或网络，测试结论来自上述实际命令。

## 旧库退役与停止

04-legacy-inventory 实测：WSL `Anolis-8.9-HDI-POC`，PostgreSQL `/var/lib/pgsql/18/data`，port 55434。旧 **database** `hdi_prototype` OID **16389**，owner `hdi_prototype`，0 会话；当前库 `hdi_mc_vnext_a7049c9e5c2a4364` OID **206108**。已向操作者呈现精确删除计划并请求确认。v3 `maintenance/retire-legacy-database.prompt.md` 第 3 步明确要求确认该对象后才删除；截至本交付未收到确认，状态 **OUT_OF_EXECUTION / PENDING_DISPOSAL**。

`vnext:legacy:retire` 默认仅核对，显式 `--delete` 只可在确认后使用。它复核固定 server/port/OID/owner/零会话，不使用 FORCE，不删除同名 role、服务、WSL 或当前 receipt。未执行删除，不伪造 LEGACY_DATABASE_DELETED；共享连接配置仍通过现有 receipt resolver 指向当前库，未打印、删除或迁移共享凭据。

完成本地提交后停止，不 push/fetch，不启动 P0-11 或其他后票，不关闭 P0-02 浏览器待验。最终 SHA/tree 写 ignored handoff，不改写既有 P0-02 记录或外部状态原件。
