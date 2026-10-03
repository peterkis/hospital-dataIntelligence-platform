# P2-07 当前科室契约与工作台验证

本轮基线为 `bb3e3509887bca8159a7401d45505fdb2a8a329a`。本轮证据写入 ignored `.runtime/vnext/p2-07/`；历史报告、0001–0143 迁移及其已安装校验和保持不变。正式院方验收为 `NOT_RUN`，ORG05/ORG06 FULL 为 `BLOCKED_DEPENDENCY`。

## 专项断言与可重复命令

| 断言 | 验证方法 | 本轮证据 |
|---|---|---|
| AC01 当前 schema 可前向变化 | 当前服务器 OpenAPI 与新生成客户端比较，不依赖旧 V1 静态摘要或七制品 | `vnext:contract:verify`；`current-contract-latest.log` |
| AC02 API/client 漂移仍阻断 | 变异当前 API 或客户端分别触发 drift；匹配的新版本通过 | `vnext:p2-07:unit`；`final-vnext-p2-07-unit.log` |
| AC03 发布事实与提交内容不可覆盖 | 原 Department/Hierarchy Owner 回归，提交后草稿拒绝改写；原冻结树与摘要保留 | `final-vnext-p2-01-validate.log`、`final-vnext-p2-02-validate.log`、`final-stage-upgrade.log` |
| AC04 fresh／0143 升级／生成类型一致 | 完整 145 迁移、全部当前表归属与类型检查；以基线真实 Owner 写入旧事实及待审批候选后升级 | `prototype:db:with -- vnext:p2-07:validate --upgrade`；`upgrade.json`、`final-stage-upgrade.log` |
| AC05 页面操作真实持久化 | 实际浏览器、实际 HTTP、真实 PostgreSQL，另以两个服务进程验证重启后恢复 | 浏览器索引见下文；`prototype:db:with -- vnext:p2-07:restart`、`restart.json` |

当前契约门禁是确定性的制品比较，不代替领域审查。所有数据库命令必须由 `npm run prototype:db:with -- <npm-script>` 包装；一次通过必须同时具有 `ready=true`、目标退出 0 和 `cleanupPassed=true`。

## 实际浏览器覆盖

- 科室：部分草稿保存、刷新、完整来源记录与附件提交、独立核验、准确候选核对及勾选、独立批准、维护者 Apply、刷新后历史读取。证据 `browser-department-committed.png`。
- 层级：真实 CORE ORG05/ORG06 工作簿上传、私有草稿恢复、独立候选审批、整树发布为准确版本 2、单独关闭候选审批和应用、关闭后仍读取原版本及原摘要。证据 `browser-hierarchy-published.png`、`browser-hierarchy-closed.png`、`browser-hierarchy-history.png`。测试管理员仅对该准确 view 显式授予审核者 READ/REVIEW；创建视图不自动扩大审核权限。
- 来源映射：实际表单与核验附件、私有保存/刷新、原 Owner staging、独立逐行核验、候选核对/批准、Apply COMMITTED、刷新后恢复原请求。纯审核者 Apply 禁用。证据 `browser-mapping-committed.png`。
- 标识、演化、生命周期、影响处置：分别验证部分草稿保存和刷新恢复；生命周期读取同一原科室身份的真实历史。其他完整领域闭环由相应公共 Owner／HTTP 回归覆盖，不把部分表单验证记作全流程浏览器通过。
- 网络失败：仅在开发浏览器网络边界阻断 submit，刷新后恢复同一 `requestId`；客户端保存的提交元数据只有 `id/expectedVersion/requestId`，没有来源行或文件内容。完整 Owner 同请求重放另有数据库及重启证据。
- 后续读取失败：实际 submit 返回 200 后阻断草稿读取，刷新仍锁定原提交；通过“恢复提交状态”读回同一 SUBMITTED 草稿。另在文件 PARSED 后阻断草稿读取，刷新从原接收请求恢复准确新草稿，文件字段保持只读。证据 `browser-post-acceptance-recovery.png`。
- 保存后读取失败：实际 save 返回 200 后阻断读取；旧页面丢失恢复标识的 RED 已复现。修复后新建与已有映射草稿均保留原请求和编辑锁，刷新时恢复读取失败也保持锁定，恢复后同一草稿从 v1 到 v2，未重复创建。证据 `browser-save-recovery-red.png`、`browser-save-recovery-green.png`。
- 权限及依赖：身份切换清除原上下文；无权限身份看不到私有草稿且保存禁用；FULL 实际返回 `BLOCKED_DEPENDENCY`，不转为 CORE 或模拟成功。人工入口不会提交服务主体回执。
- 1366、1024、390 宽度检查，1024 下 Tab 焦点从映射列表到映射历史；手机嵌套结果改为纵向字段后页面无水平溢出。证据 `browser-workspace-1024.png`、`browser-workspace-mobile.png`。临时视口和网络阻断已撤销。

CORE 模板已由页面实际下载为 `hierarchy-core-v1.xlsx`，5455 字节；下载副本在 ignored 证据目录，SHA-256 为 `15bd84076417f989d3f10df5ed64accfd7bd8cc145e8dc090168cd4989ee7bd5`。它表达现有 CORE Owner 的完整有限工作簿输入，不代表原始 ORG05/ORG06 FULL 16/15 字段获正式采纳。

## Q03、A018 与阶段边界

Q03 按当前 Owner 算法分别核对 B 与 R、半开业务期间、准确引用、完整期间准入以及重叠历史 B 的确定性读取。层级 WINDOW 返回一份覆盖整个请求期间的冻结快照；后续局部发布不能通过拼接旧树补齐，也不能覆盖原快照名称或摘要。关闭状态单独呈现，历史冻结事实不改写。

A018 使用当前 Department／Hierarchy／生成客户端与当前调用方。本票不连接旧库，不跑旧 SDK、旧静态 hash/path 或七制品协议门禁，不创建没有实际消费者的重复投影。P2-08、P2-03、P2-04、P2-05、P2-06 的原 Owner 不变量保留并执行适用回归；退休来源仍可走原 Owner 的非扩张撤回，新增／改动主张仍阻断。

适用回归及持久升级在本轮关闭前完成；准确候选 commit/tree、Spec／Standards 审查、GitHub 当前 head、CI、Codex review 修复与合并状态在 ignored handoff 中分别记录。历史 P0-02 browser 待验、院方政策采纳、正式验收及生产准入不因本轮 CORE 通过而自动完成。

首次固定候选 `c62bc45` 由两个独立代理分别静态审查 Spec 和 Standards，各发现两项问题。新建层级视图授权遗漏及历史 R 状态泄漏已在实际 Owner 复现 RED，修复后读取／恢复／提交重放随准确 view READ 撤权拒绝，R0/R1 分别返回 VALIDATED/APPROVED。Catalog 审批和影响表查询移入 Catalog 的有限事务接口，普通和服务角色不获其直接 EXECUTE。通用草稿保存恢复问题由实际浏览器复现并验证 GREEN。专项 fresh／已填充升级回归见 `review-red.log`、`review-green-2.log`；最终修复候选重新固定审查，不沿用首次候选结论。

修复候选 `60726d5` 的两轴复审又发现授权元数据与密文恢复比较不一致。实际授权读取复现 `PAYLOAD_UNAVAILABLE` 后，将提交和恢复统一为同一有限元数据投影，同时保留原 payload 的空 viewId；新增正向读取／原请求恢复断言与撤权拒绝断言一起执行。证据 `metadata-binding-red.log`、`metadata-binding-green.log`。只有新候选复审通过才部署持久迁移。

`596845e` 的 Spec／Standards 固定候选复审均无剩余可操作问题。修复后 13 项专项 DB/HTTP、0143 已填充升级及两个真实服务进程重启再次通过；本轮适用回归总计 305 项单元、367 项数据库测试。证据 `metadata-binding-green.log`、`metadata-restart-green.log`、`verified-evidence.json`。

持久研发库 OID206108 已从 0143 前向升至 0145，生成类型核验、原行／密钥／账本保留、实际工作台页面、私有保存／读取／原请求恢复及无权限拒绝通过。首次 HTTP 验证因测试脚本假定别名权限而拒绝；按当前权限检查后，仅在有权限时允许同身份读取，未新增 actor 权限。复核命令为 `prototype:db:with -- vnext:p2-07:deploy --verify-existing`；证据 `persistent-verify.log`、`deployment-1791060023382.http.json`、`deployment-1791060023382.preservation.json`、`persistent-chain.json`。既有已安装迁移保持只读；之后的数据库修复必须追加迁移。

PR #27 首轮云端审查针对 `de8e22c` 提出三项修复：补全演化／院区关系引用授权、科室保存后读取准确草稿再解锁、完整契约 ID／版本配对。真实 Owner 复现撤权后仍可读取／恢复以及错误配对仍被保存；追加 0146 修复 SQL 并保留 0001–0145 字节。0145 的真实旧工作台代码生成草稿后升级，旧密文／原行保留，已知旧元数据投影仅用于鉴真，返回正文和提交重放前仍在同一事务重新检查完整当前引用。fresh、0143→0146、0145→0146 与 14 项专项 DB/HTTP 通过，适用回归总计更新为 305 项单元、368 项数据库测试。证据 `cloud-owner-reference-red.log`、`cloud-reference-upgrade-green.log`、`reference-upgrade.json`。

科室页面实际 save 200 后读取失败的 RED／GREEN 与刷新恢复已验证；恢复前新建、选择其他草稿／申请及修订入口锁定。证据 `browser-main-save-red.png`、`browser-main-save-green.png`、`browser-main-context-recovery.png`，本轮服务重启见 `cloud-restart-green.log`。临时服务、视口及网络阻断均清理。

首轮 Linux CI 的业务、浏览器与升级步骤通过，当前契约步骤因缺少本地生成器失败。生成器锁定在 `tooling/openapi-generator`：openapi-typescript 7.13.0 与其 TypeScript 5.9.3 peer，应用编译器保留 TypeScript 7.0.2；不依赖机器缓存。当前 API/client/form 门禁及迁移单元复验通过，远端最终 head 的 CI 和 Codex 复审另行记录，不把首轮失败记作通过。

`b48ff15` 的 Standards 复审无问题，Spec 复审指出已接受保存的重试遇到 403 时会清除恢复标识。实际浏览器复现后，两类页面均按原请求 UUID 保留已接受状态，准确读取前继续锁定。科室实际保存后阻断读取，再由临时浏览器 Fetch 边界注入重试 403；修复前字段可编辑，修复后字段、新建和切换保持禁用。刷新后恢复原草稿 `01a103bf-dffc-727c-aca9-04b82f6c9180` v4；通用层级页面相同场景恢复原 v1。403 是明确标记的测试注入，原保存及恢复仍使用真实 HTTP/PostgreSQL。证据 `browser-accepted-retry-{red,green,recovered}.png`、`browser-generic-accepted-retry-{green,recovered}.png`、`browser-accepted-retry.log`；当前 UI 类型检查及 vNext 构建通过，临时接口拦截和服务已清理。
