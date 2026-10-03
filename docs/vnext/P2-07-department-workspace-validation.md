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
- 权限及依赖：身份切换清除原上下文；无权限身份看不到私有草稿且保存禁用；FULL 实际返回 `BLOCKED_DEPENDENCY`，不转为 CORE 或模拟成功。人工入口不会提交服务主体回执。
- 1366、1024、390 宽度检查，1024 下 Tab 焦点从映射列表到映射历史；手机嵌套结果改为纵向字段后页面无水平溢出。证据 `browser-workspace-1024.png`、`browser-workspace-mobile.png`。临时视口和网络阻断已撤销。

CORE 模板已由页面实际下载为 `hierarchy-core-v1.xlsx`，5455 字节；下载副本在 ignored 证据目录，SHA-256 为 `15bd84076417f989d3f10df5ed64accfd7bd8cc145e8dc090168cd4989ee7bd5`。它表达现有 CORE Owner 的完整有限工作簿输入，不代表原始 ORG05/ORG06 FULL 16/15 字段获正式采纳。

## Q03、A018 与阶段边界

Q03 按当前 Owner 算法分别核对 B 与 R、半开业务期间、准确引用、完整期间准入以及重叠历史 B 的确定性读取。层级 WINDOW 返回一份覆盖整个请求期间的冻结快照；后续局部发布不能通过拼接旧树补齐，也不能覆盖原快照名称或摘要。关闭状态单独呈现，历史冻结事实不改写。

A018 使用当前 Department／Hierarchy／生成客户端与当前调用方。本票不连接旧库，不跑旧 SDK、旧静态 hash/path 或七制品协议门禁，不创建没有实际消费者的重复投影。P2-08、P2-03、P2-04、P2-05、P2-06 的原 Owner 不变量保留并执行适用回归；退休来源仍可走原 Owner 的非扩张撤回，新增／改动主张仍阻断。

适用回归及持久升级在本轮关闭前完成；准确候选 commit/tree、Spec／Standards 审查、GitHub 当前 head、CI、Codex review 修复与合并状态在 ignored handoff 中分别记录。历史 P0-02 browser 待验、院方政策采纳、正式验收及生产准入不因本轮 CORE 通过而自动完成。
