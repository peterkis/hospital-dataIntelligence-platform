# P0-09 导入工作台

当前入口为 `START-P0-09.current-baseline.prompt.md`，公共规格仍为原 v3。
开始 HEAD `36ed54732abaf6cee0cdd14c9702dbe04789fb18`，tree
`1051d2e01494112ae06d68e6a0e509320836217b`。仅本票、串行、local-only。

## G0 与连接责任

迁移管理通过 receipt-bound peer runner；普通应用保留既有角色与权限。
受信 Owner 服务使用独立非管理员登录、明确函数 allowlist、无表权限、无角色成员资格。
配置及凭据分别在忽略目录 `.runtime/vnext/p0-09/owner-service.json` 和
`owner-service.secret.json`，凭据文件限制为当前 Windows 用户及 SYSTEM。
既有数据库、schema 与表 ownership 保持不变。服务进程只构造一个 key-provider；
重启后的历史解密不在承诺范围，KEY_UNAVAILABLE 必须诚实显示。

G0 已运行既有 `vnext:quality:upgrade` 的 0037→0051 路径，历史 job、原文件、
校验和解释保留，28 项通过；receipt-owned 临时库与 Owner 已清理。
持久安装日志为 `.runtime/vnext/p0-09/g0-migrate.log`。
此记录不代表工作台、浏览器或持久服务集成已经通过。

## 接线与拟议 DDL

复用现有文件、校验、质量、预览与 Apply Owner。HTTP 不接受客户端提供的
PASS、Owner 就绪、规范行或任意 SQL。上传使用有界 base64 JSON，仅上传路由
提高 bodyLimit，解码后仍执行 1 MiB 原文件上限。

新增 0052 提供受授权的 job 技术摘要读取，用于 reload；0053 前向增加真实文件权限
观察与 exact 模板摘要，已安装的 0052 checksum 不变；不新增业务表、
状态机、审批表或隔离区。摘要含已有 artifact/run/candidate 技术引用，不含
密文、原值、敏感 diff 或签名。按 fresh、0051→0052、codegen 验证。

ORG/PER 校验保持 BLOCKED，不能获得可执行批准。有限 E2E Owner 仅在带 receipt
的临时测试 composition 注册；从本次真实文件的已验签规范行派生有限意图。
有限映射必须冻结 source artifact、revision、exact contract、规则及质量水位，
拒绝非法输入和未解决的字段问题；不覆盖原 ORG/PER ValidationRun 的 BLOCKED。
冻结候选显式展示上述有限范围，独立身份读取并批准，再由既有 Coordinator 原子提交。

## 验收状态

P0-09 AC-01：真实 Chrome 文件上传、解析、校验、有限目标多行提交、恢复/对账；
非法 CSV 被拒绝并阻断候选。AC-02：浏览器 maker 自审拒绝，HTTP maker-alias 同身份拒绝。
AC-03：浏览器 outsider 隐藏写控件；真实 HTTP 上传/报告返回 403。
AC-04：浏览器 reload 恢复同 job/revision/candidate/request 并读取原结果。
AC-05：真实受限工作簿下载、无权限 HTTP 拒绝、普通技术摘要不含原值。
AC-06：HTTP 精确 templateVersion 不匹配返回 409，浏览器模板展示 exact 版本信息。
证据分别在 `.runtime/vnext/p0-09/browser-*.txt`、`browser-committed.png`、
`http-result.json`；浏览器与 API 的观察方法分开，不以 API 代替浏览器。

`fresh-result.json`、`upgrade-result.json` 与对应 validation 日志记录 fresh、
0051→0052 及后续 0052→0053、codegen、真实 HTTP、字节变化使候选失效、非法/陈旧输入零目标写入、
READ-only 结果恢复与上传上限。适用静态检查为 API build、admin typecheck/build、
workbench typecheck、module-boundaries、repo-layout、lineage/wrapper tests。

P0-02 浏览器：PARTIAL，已观察未知字段拒绝、旧 ruleVersion 不可覆盖、版本/字段/
历史页面。条件规则、候选代码集、GOV09 参数页及其原始完整 UI 场景仍 BLOCKED/待验；
最迟 P0-10 关闭前解决，不标 P0-02 通过。

持久 schema 已到 0053，受信角色已配置；真实持久浏览器观察到 CONTROL_PLANE、
缺少文件权限时隐藏上传控件，实际 HTTP 同时返回 ACCESS_DENIED/403。
2026-09-17 用户明确授权后，仅补齐 maker 在既有合成 ORG01、NORTH /
IDENTITY_VERIFY 下的 STORE、READ；未改变数据库角色成员资格。
持久真实 HTTP 与 Chrome 文件/质量冒烟均 PASS：接收 QUARANTINED、解析 PARSED、
校验 BLOCKED，问题页读出 BUSINESS_KEY_NOT_CONFIGURED 与 DOMAIN_OWNER_UNAVAILABLE，
冻结返回 BLOCKED_DEPENDENCY。证据为 `authorized-persistent-smoke.log`、
`authorized-persistent-quality.txt`、`authorized-persistent-browser.txt/png`；均在上述忽略目录。
服务 wrapper 正常退出并完成清理，密钥恢复仍仅限同一进程。既有已发布 CORE 契约没有
后来新增的 businessKey，沿用其历史定义，不改写或冒充可 apply 的现代契约。
真实 ORG/PER Owner：NOT_READY。代码候选独立 Spec/Standards 审阅 PASS、零剩余发现；
完成提交及最终文档增量审阅的精确 tree/commit 记录在 ignored handoff。
远端：NOT_OBSERVED。有限 E2E 使用 `FINITE_FILE_E2E_V1` 契约标签和
`FINITE_FILE_ALL_ROWS_V1` 映射；校验原有 8–10 层 NOT_RUN 不作真实业务通过声明。

## 候选审阅与修复

第一轮独立 Spec/Standards 审阅候选 tree
`9c239eaea4ade6a6d91f204797f3da9f903885b5`：Spec 指出解析策略未精确绑定、
UI 文件权限不准确、预览固定一行；Standards 建议关键响应字段不要全部可选。
已修复：上传/纠正 exact 版本与 STRICT_V2 校验；0053 服务端权限观察驱动控件；
真实规范行驱动全部行 CREATE 预览，有限 E2E 与实际计划同源并沿用已验证去重结果；
模板/接收/冻结/复核/批准响应各有必填字段，生成客户端同步。
`fresh-r2.log`、`upgrade-r2-green.log` 覆盖策略降级拒绝、STORE 撤销、全部行预览、
去重与既有反例；`control-plane-validation.log` 单独证明普通 ORG/PER 两行预览仍
BLOCKED、零领域写入，不能把有限成功拼接成真实业务 Owner 成功。
后续独立复核状态写入 ignored handoff；未完成全部适用门禁前不创建完成提交。

第二轮复核要求继续收紧有限源消费权限、提供完整分页并修正部署日志标签。
有限 Owner 的 WRITE 现要求源 job 的提交身份；敏感观察与 REVIEW 另检查请求 actor
本人的精确 campus/purpose protected READ。有限服务内部消费原 maker 的证据前，
以实际请求 actor 记录 `FINITE_FILE_SOURCE_READ`，仅测试 composition 为 reviewer
授予本次临时数据集的 READ。普通技术结果恢复不要求解密或 protected READ。
冻结/敏感读取权限另有不返回明文的查询；每个 SQL 拒绝在独立事务回滚，不能污染
下一项能力观察。`fresh-r3-final.log` 覆盖 reviewer 不能替 maker 冻结、撤销敏感
READ 后预览/复核拒绝、原提交身份仍能恢复技术结果及源消费审计。
契约与责任定义现按现有 API 的 total 提供前后页选择，不再固定前十项。

第三轮独立审阅通过代码候选 tree `233c2f43fc63fd1e649c3658f32fbb1e8d59f599`，
Spec/Standards 均零发现。后续仅补充本节验收记录与本票状态；不修改代码。

2026-09-17 Medium-01—04 修复：工作台使用显式状态词典区分 `PARSED`、治理阻断、
审核就绪、批准与 `COMMITTED`，未知状态保留原代码，不再以通用成功文案代替；
模板响应同时返回其精确 dataset/profile/contractVersionId/templateVersion 与
`STRICT_V2` parser policy，HTTP 回归验证 exact contract 绑定；浏览器从 capabilities
读取 1 MiB 原始文件上限，base64 传输、Protected Store 与边界拒绝均由真实 HTTP
验证。前端未调用 localStorage、sessionStorage 或 IndexedDB；真实 Chrome 有限 E2E
观察到 `QUARANTINED → PARSED → BLOCKED/QUALITY_ITEMS → FINITE_PREVIEW → FROZEN
→ READ_READY → APPROVED → COMMITTED`，浏览器存储键为空。对应单元测试、fresh/upgrade
receipt 与浏览器 AX/截图证据均保存在 `.runtime/vnext/p0-09/` 忽略目录。
