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

`001b991` 两轴复审进一步发现 ACK 丢失时仍需保留未知结果。最终客户端直接使用保留的原 pending 请求区分首次明确拒绝与结果未知的重试；收到 200 和未收到响应两种情况都保留原身份，准确读取后解锁。相同规则用于提交和有限维护操作／层级文件接收，防止重试拒绝消除先前未知结果。实际浏览器在服务端 save 已返回 200 的 Response 阶段关闭连接，再在重试 Request 阶段注入 403，完成 RED／GREEN；科室恢复准确 ID `01a103c7-6f2d-717f-aff0-01b3733ddbe7` v1，层级恢复 `01a103c7-d1ef-797f-9257-2a85b10f2161` v1，均未再保存。首次明确 403 的对照仍可编辑且没有恢复标记。证据 `browser-ackloss-retry-{red,green,recovered}.png`、`browser-generic-ackloss-retry-{green,recovered}.png`、`browser-ackloss-retry.log`、`ackloss-retry-typecheck.log`、`ackloss-retry-build.log`；连接关闭和 403 均为浏览器边界的测试注入。

持久研发库 OID206108 的 0145→0146 前向升级、当前类型与实际 HTTP 私有草稿原请求恢复通过；原行、密钥和迁移账本保留，别名仍按当前权限拒绝，不扩大 actor 授权。证据 `persistent-146-deploy.log`、`deployment-1791064516628.{preservation,http}.json`；包装器 ready／targetExitCode 0／cleanupPassed true。0001–0146 现均已安装，之后数据库修复必须另加迁移。正式验收与 FULL 状态不变。

`46d2c29` 的 CI 两项均通过，第二轮 Codex review 仍提出影响处置结果引用及演化配套契约的授权遗漏。实际 Owner RED 后追加 0147：四类结果引用通过有限内部接口检查原 Owner 的当前读取权限，映射按实际院区、院区关系按自身治理范围读取；不重算历史业务处置或最新结果证明。ORG27／ORG04 配套契约及层级依赖逐个检查准确 ID／版本配对；只填 ID 或版本的部分草稿也授权已知部分。两条云端线程的最终关闭和后续准确 head 的检查另记 ignored handoff。

字段清点同时覆盖省略固定 Owner 的部分引用、受保护证据、既有层级分组的实际视图，以及科室版本引用。业务 Owner 保留原有新分组身份规则；已有分组和已知版本仍检查实际 Owner 权限与绑定。旧 0145／0146 元数据投影仅用于鉴真，返回正文、恢复和提交重放始终使用完整当前投影重新授权。未改旧密文、请求或修订。证明包括单独撤销已提交映射／标识的 READ、证据 READ、准确视图 READ，以及 SOUTH 草稿引用 NORTH 院区关系的正向与撤权检查。

专项增至 19 项真实 DB/HTTP 测试，适用回归累计 305 项单元、373 项数据库测试。143→147 领域升级与真实 145／146 旧草稿升级保留原行、密钥、账本及原请求恢复，针对原引用的撤权仍拒绝。证据 `cloud-round2-red.log`、`complete-reference-inventory-red.log`、`group-reference-red.log`、`complete-reference-final-green.log`、`reference-upgrade-145.json`、`reference-upgrade-146.json`。新拒绝测试的两个初次错误分别是管理夹具列名，以及错误地把科室元数据历史当作受保护材料读取；改用准确权限列和真实 `authorizeSensitiveRead` Owner 接口，不改变既有领域读取语义。跨院区测试只给 owned 验证角色授予已有 P2-08 夹具的两个有限接口，并显式授权新测试科室；业务和持久角色不自动扩权。类型检查、199 项迁移单元、当前契约、22 项 P2-08 回归及两个实际服务进程重启通过；证据 `round2-typecheck.log`、`round2-migration-unit.log`、`round2-contract.log`、`round2-p208-regression.log`、`round2-restart.log`。0147 在固定候选本地审查通过前不安装至持久库。

内部接口的实际权限断言发现，旧验证夹具的 Department 批量函数授权会把新内部接口一起授予验证角色。三个新接口已加入夹具既有的内部接口排除清单，保持数据库 PUBLIC／普通服务角色不可直接执行。带此断言的 19 项 fresh 及旧数据升级复验通过；证据 `round2-final-acl-green.log`（RED）、`round2-final-verified.log`（GREEN）、`round2-final-group-green.log`。

合法调用方对象字段顺序另复现私有恢复 `PAYLOAD_UNAVAILABLE`：密文内容规范排序，而授权引用数组原先依赖输入对象字段顺序。新增保存／恢复边界按准确引用多重集合比较，仅忽略授权集合顺序，保留全部项、重复计数及其他元数据；业务命令和节点顺序仍由原内容 MAC 绑定。新写入先复制规范内容，旧 145／146 密文无需重写。证据 `reference-key-order-red.log`、`reference-key-order-green.log`；升级夹具还从真实旧源码创建此前因顺序错误无法读取的草稿，验证前向恢复和原行保留。此专项使 P2-07 总计 20 项，适用数据库回归累计 374 项。

`23b3af1` 的独立 Spec 审查无可操作问题；Standards 审查发现工作台导入 Organization 内部事务适配器，违反 ADR-0083 的模块边界。工作台改为在 Department 内建立事务运行器，使用既有共享池、同一 advisory lock 和 Catalog 事务作用域，保留原原子提交与关闭行为，不扩大模块外部接口。验证证据为 `module-boundary-types.log`、`module-boundary-gate.log`、`module-boundary-green.log`；首次静态命令误用不存在的脚本，随后使用仓库实际 `check:module-boundaries` 命令通过。

`1f1da49` 的独立 Spec／Standards 复审均无剩余可操作发现。修复后的 20 项专项 DB／HTTP 和实际两进程重启通过，重启保留私有草稿、准确历史与原接受 Apply 重放；证据 `module-boundary-green.log`、`module-boundary-restart.log`。持久研发库 OID206108 的 0146→0147 前向升级完成，原行、密钥及迁移账本保留；当前生成类型、实际工作台 HTTP、原私有请求恢复及当前权限拒绝通过，未扩大 actor 权限。证据 `persistent-147-deploy.log`、`deployment-1791070256603.{migration,preservation,http}.json`；包装器 ready／targetExitCode 0／cleanupPassed true。0001–0147 均已安装，后续 SQL 修复必须追加迁移。PR #27 的最终 head、云端复审和 CI 状态按实际发布记录，正式验收与 FULL 边界保持不变。

`ee9d4a8` 的两项 CI 均通过；第三轮 Codex review 又提出完整影响结果授权、缺少 Owner 的合法部分草稿以及已有分组的未知版本三项问题。实际 Owner RED 后追加 0148，保留 0001–0147 字节。Department 的私有 `impact_result_access` 接口检查所引用版本的当前目标／来源权限，以及准确稳定 ID／历史版本／已接受候选／请求的不可变绑定。映射和标识使用原 Catalog 接受结果接口，层级使用自身 APPLIED 候选与准确发布或关闭绑定，院区关系兼容生命周期及演化整包结果。私有历史读取不重算最新业务处置；原完整 `impact_result` 的最新版本和 case 语义仍用于原业务流程，避免后续无关发布阻断已接受历史草稿。旧稳定 ID 元数据仅形成初步检查，鉴真后的完整当前投影在原事务内检查完毕后才返回正文或重放。

缺少结果 Owner 或映射 target_type 的 UUID 字段保留为部分草稿；判别字段存在时继续授权已知引用，提交仍执行完整原 Owner schema。已有分组与给定版本必须准确绑定，未知版本拒绝；新组由原 Owner 按空引用分配身份。新增 21 项专项测试中的部分草稿保存／读取／恢复及提交拒绝、完整四类结果、精确目标撤权、错误版本／候选／请求、映射及层级后续发布后原结果恢复均通过。累计适用回归为 305 项单元、375 项实际 DB／HTTP。证据 `cloud-round3-target-red.log`、`cloud-round3-complete-green.log`、`cloud-round3-types.log`、`cloud-round3-root-types.log`、`cloud-round3-migration-unit.log`（199 项）、`cloud-round3-contract.log`。初次整体结果 oracle 缺少原 case 上下文，改用准确 `mapping_target_authorize` 与 Catalog 接受结果接口；部分提交夹具补齐 CORE／契约后保留原完整输入拒绝，不改变业务错误语义。

0143 已填充领域升级与真实 0145／0146／0147 旧加密草稿升级进一步包含完整映射结果：原行、密文、密钥及账本不改写，原请求可恢复，单独撤销准确目标权限后读取和恢复拒绝。证据 `cloud-round3-close-diagnostic.log`、`reference-upgrade-{145,146,147}.json`，包装器 ready／targetExitCode 0／cleanupPassed true。前两次扩展运行在临时库收尾被 `UNRELATED_SESSIONS_PRESENT` 保护拦下，未终止未知会话；仅按匹配的自有数据库／角色 receipt 清理，复验观测为零会话后通过原删除保护。证据 `cloud-round3-owned-disposal.log`、`cloud-round3-owned-disposal-2.log`、`reference-close-{145,146,147}.json`。本地固定候选审查通过前，0148 不安装至持久库。

`47db592` 的独立 Spec／Standards 复审各指出同一项已知 Owner 的部分结果坐标遗漏：没有稳定 ID 时，单独的版本或候选未纳入授权。真实 Identifier Owner 及私有读取边界复现 RED 后，当前投影独立收集已填写坐标，版本在 Department 自有表内解析实际身份；候选委派原 Owner 的事务内读取能力，复用现有冻结输入／目标／来源授权。Catalog 只提供经过 MAC 鉴真的候选路由元数据，院区关系据此委派 Lifecycle 或 Evolution，未读取 Catalog 账本表或在失败事务内尝试另一 Owner。层级使用自身事务内候选鉴真及读取。保存、读取、恢复、已接受重放均在原事务内完成全部授权；缺少 Owner 的原始部分字段仍可保留，未提交候选不会被要求提供 COMMITTED 结果。

证据 `partial-result-coordinate-red.log`、`partial-result-coordinate-green.log`、`partial-result-coordinate-final-green.log`：21 项专项及 0143／0145／0146／0147 升级通过，四类 Owner 的单独版本／候选、未提交映射候选、精确撤权后的读取／恢复拒绝，以及演化候选的院区关系路由均覆盖；完整历史结果恢复继续通过。P2-07／根类型、Catalog 单元和当前契约通过，证据 `partial-result-coordinate-{types,root-types,catalog-unit,contract}.log`。受影响 Owner、Catalog 和服务重启的回归与最终候选审查状态在 ignored handoff 中记录；未据运行中状态安装迁移或合并。
