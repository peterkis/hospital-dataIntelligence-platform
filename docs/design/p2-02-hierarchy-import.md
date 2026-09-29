# P2-02 Hierarchy 视图导入

P2-02 在当前 vNext Department Owner 内治理 ORG05 视图定义和 ORG06 完整结构。每次候选只描述一个视图和一个完整业务有效期间；候选先在内存中完成严格森林校验，再进入独立复核和完整快照发布。

## 领域约束

- 一个视图内每个 Department 只能出现一次；每个节点最多一个父节点；循环、缺父、重复 node key 和重复 Department 在发布前阻断。
- 结构合法但森林规则失败的候选返回 `decision=FAIL` 与带 `nodeKey/field` 的问题定位，不写入候选或快照；closed schema 违规仍返回 `CLOSED_INPUT_REQUIRED`。
- 同一 Department 可以在不同视图使用不同父节点。
- GROUP 只拥有视图内节点身份。发布时生成 group/group-version 引用，不写入 Department 外键。
- 财务和统计视图可以登记定义，但当前候选导入返回 `VIEW_TYPE_NOT_OPERATIONAL`。
- 0099 在候选存入和发布时绑定首次登记版本的视图类型；把 FINANCE/STATISTICAL 伪装成 ADMINISTRATIVE 会返回 `VIEW_TYPE_MISMATCH`，旧版已审批候选同样不能绕过发布检查。
- `validFrom`、`validTo`、`recordedAt` 使用 `Asia/Shanghai` 本地时间；偏移时间和跨期间候选拒绝。
- 发布时每个 Department 版本必须覆盖候选的完整业务区间；版本边界跨越候选期间时要求拆分候选。
- 快照保存展示名称、引用版本、深度、排序和内容摘要；后续改名不会改变已发布快照。
- 发布命令的 requestId 必须与原候选一致，首次执行和历史重放都拒绝错误 requestId，不能把其他请求记作原请求的成功结果。
- typed 快照读取保留责任组织、来源记录、来源版本、审批证据和状态，并把来源 `sourceRecordedAt` 与平台 `recordedFrom` 分开；责任 Department、来源 SOURCE 或节点 Department 版本无法覆盖完整业务期间时，数据库发布边界返回 `BLOCKED_DEPENDENCY`。
- PR #21 修复追加 0093：冻结责任 Department 与 SOURCE 的确切版本；SOURCE 通过公共时间解析函数选择覆盖版本。无界候选必须由无界依赖覆盖。GROUP 代码和所属视图/版本绑定进入快照，历史版本与节点禁止 UPDATE/DELETE。
- 每条 ORG06 节点边必须携带独立的 `sourceEvidence`（来源 alias、源版本、SOURCE、行定位、业务期间、来源记录时间、ACTIVE 意图及审批证据），参与审批摘要并逐条保存；所有边期间必须等于完整快照期间，混合期间拒绝。数据库再次检查边来源的权限和完整期间覆盖，并冻结 SOURCE 版本。迁移前未记录的逐边证据和依赖版本返回 null，不根据 ORG05 头部编造。
- `parentNodeKey` 是同一完整候选内的精确关系引用，发布时指向已校验的 DEPARTMENT/GROUP 节点及其版本，不按名称解析。GROUP 关系不伪装成 ORG04 科室外键；FULL 来源字段与码表采纳仍需独立合同门禁。

2026-09-29 的持久研发库修复通过 0088 层级迁移、0089 Department 前向修复、0090 完整载荷绑定、0091 数据库发布不变量重验和 0092 空白字段收紧完成；不重写 0084、0085、0087 历史账本。receipt 绑定数据库 OID 206108 的账本由 87 追加到 92，既有业务行与密钥摘要保持不变，wrapper readiness、`vnext:db:verify`、P2-02 fresh 和 0087→current 升级均通过。

后续 PR 审查修复已通过受管 wrapper 将同一持久库从 92 追加至 96，原 92 条安装账本逐项保持一致，`vnext:db:verify` 通过且 cleanupPassed=true。P2-01 的 83→current 升级回归 25/25 通过并保留前驱数据摘要。逐视图授权按上述明确规则生效；这不代表正式来源合同采纳或生产上线。

## 写入边界

0096 将 `department_master.hierarchy_grant` 的逐视图 READ/WRITE/REVIEW 与医院级权限取交集。创建者仅获得本视图 READ/WRITE；复核人与其他访问者必须由受控授权配置显式指定视图。历史视图只恢复其创建者读写权限，不把历史医院级复核权限复制到所有视图。应用数据库角色不能自行修改授权表；授权变更通过既有授权事务锁和审计触发器记录。持久环境需要管理员逐项配置复核人，不应通过全视图批量授予来绕过这个边界。

Owner 查询、候选读取、导入重放、审批、发布、发布重放和关闭/撤销均检查当前视图权限；SQL 受控函数也重验相应 WRITE/REVIEW，避免绕过 TypeScript Owner。发布与关闭执行时再次检查原审批人的视图 REVIEW 权限。撤销一个视图的权限不影响另一视图。

0097 撤销应用角色对层级视图、版本、候选、节点及终态表的原始表权限。Owner 通过 `hierarchy_read` 的有限命令读取数据，函数在返回候选、快照、请求或已提交版本之前核验当前视图权限；不依赖应用代码自觉加过滤条件。测试使用真实应用角色证明直接 SELECT 拒绝、越权调用读取函数拒绝、正常读取与历史重放保持有效；验证 runner 不再额外授予层级表 SELECT。

0095 在数据库发布边界按 DEPARTMENT/GROUP 分别验证节点完整键集合，拒绝未知字段和混用字段；同时检查 GROUP code 与非空 GROUP ID 的单快照唯一性。回归直接经过受控 store/approve/publish 函数，证明不能绕过 TypeBox Owner 静默丢弃已审批字段或重复放置同一 GROUP。

0098 对候选头部、节点及逐边来源证据执行完整封闭形状检查，先校验 JSON 类型，再允许文本提取或关系表转换；包括字符串长度、UUID、布尔值、整数范围、本地时间及必要字段。存入和新发布两处均检查，防止升级前已存入的畸形候选继续发布；已提交历史重放保留原版本。受控 SQL 回归覆盖未知顶层字段、数字节点名称/键及数字来源版本，旧版候选夹具只写入 receipt-owned 临时库。

0099 的时间检查先验证小时 0–23、分秒 0–59 和有效日历日期，再转换 timestamp；拒绝 PostgreSQL 可归一化的 `24:00:00`、`23:59:60`，覆盖头部和逐边证据。合法 `23:59:59.999999` 保留六位微秒，不把非法输入改成另一天。

`hierarchy_create_view`、`hierarchy_store_candidate`、`hierarchy_approve` 和 `hierarchy_publish` 是 SECURITY DEFINER 入口。应用角色只有读取新表和执行受控函数的权限，不能直接插入正式层级事实。发布函数锁定视图、重新检查 Department 版本覆盖，并在一笔事务中写完整版本、节点、审计和候选状态。

HTTP 路由位于 `/api/vnext/hierarchy/`：视图创建、候选导入、候选审批、快照发布和快照读取。维护页面不在本票范围，交由 P2-07 接入通用工作台。

`createHierarchyClient` 使用生成的 OpenAPI operations 类型访问上述五个路由。层级请求采用 TypeBox 无损 body 校验，保留根节点 `parentNodeKey: null`，避免 AJV coercion 将其改成空字符串。真实 loopback HTTP 测试覆盖完整发布、同人审批拒绝、历史读取以及空字符串父节点拒绝；这属于本地合成 API 集成证据，不替代正式验收。

### 非扩张生命周期

0094 增加 `prepareHierarchyClosure`（`CLOSE`/`REVOKE`）、复用独立 `approveHierarchyCandidate`，再由 `closeHierarchyView` 原子追加不可变终态事件。候选绑定 viewId、expectedVersion、requestId、动作和原因；执行时重查当前写权限、审批人身份/复核权限及准确发布版本。它不重新要求 SOURCE、Department 或来源合同处于准入状态，因此上游停用不阻断收尾。动作对整个视图立即终态生效，不提供隐式重开或未来计划关闭。

关闭后不再返回当前有效快照，明确指定历史版本仍返回原快照；后续发布被 `HIERARCHY_CLOSED` 拒绝。重放关闭命令返回原终态事件，错误 requestId 拒绝；原视图版本、节点及来源证据不被改写。两个新命令均有生成客户端与 HTTP 路由，业务验证覆盖 SOURCE 在审批后退役、关闭/撤销、历史读取、错误重放及终态阻断。

## 来源字段与范围

ORG05 的 16 个字段和 ORG06 的 15 个字段仍以
`db/vnext/sources/package-v2/maps/field-routing.csv` 及两个 draft contract 为完整来源。ORG05 的视图身份、代码、名称、类型、单父策略、业务口径、责任组织、汇总规则、来源版本、业务/记录时间、状态和审批证据进入 `HierarchyView`/候选；ORG06 的边身份、视图引用、父子节点、关系、排序、主路径、来源版本、业务/记录时间、状态和审批证据进入候选节点及来源证据。`source single_parent=false` 被 closed schema 拒绝，不能静默放宽 `STRICT_TREE`。两个 FULL contract 仍处于 DRAFT，Q08、A014、A015 的来源政策采纳和正式验收不是本地合成测试可以替代的结论。

## 专项验收映射

下表记录当前代码树的可重复本地观察；它不把合成测试改写成正式院方验收。

| ID | 当前证明 | 证据 | 当前结论 |
|---|---|---|---|
| P2-02-AC-01 | 跨视图同一 Department 可出现；单视图重复放置被拒绝 | `tooling/vnext/p2-02-unit.test.ts`：带 `P2-02-AC-01` 的两个用例 | 本地 DOMAIN PASS |
| P2-02-AC-02 | 后行闭环在全图校验阶段拒绝，快照摘要保持不变 | `p2-02-unit.test.ts`、`p2-02-db.test.ts`：带 `P2-02-AC-02` 的用例 | 本地 DOMAIN/DB PASS |
| P2-02-AC-03 | GROUP 携带 Department 外键形状被 closed schema 拒绝，发布节点只生成 group 引用 | `p2-02-unit.test.ts`：带 `P2-02-AC-03` 的用例；DB GROUP 发布用例 | 本地 DOMAIN/DB PASS |
| P2-02-AC-04 | 展示名相同的节点仍由 nodeKey、Department 稳定 ID 区分 | `p2-02-unit.test.ts`：带 `P2-02-AC-04` 的用例 | 本地 DOMAIN PASS |
| P2-02-AC-05 | 改名形成新版本，旧快照对象/摘要/历史显示不变，并可重放 | `p2-02-db.test.ts`：带 `P2-02-AC-05` 的用例 | 本地 DB PASS |

## 验证与收口边界

- `npm run vnext:p2-02:unit`、`npm run vnext:p2-02:typecheck`、`npm run typecheck`、`npm run check:module-boundaries` 已执行并通过；专项 fresh 与 `87_TO_CURRENT` 升级均通过，且临时数据库和临时 owner 清理凭据通过。
- `npm run vnext:contract:generate` 已重新生成并核对 `contracts/openapi/vnext-catalog.openapi.json` 与 `packages/generated-api-client/src/vnext-schema.generated.ts`，其中包含五个层级路由及其 typed schema。
- 持久研发库修复后，wrapper readiness、`vnext:db:verify`、P2-02 fresh 和 `87_TO_CURRENT` 均通过；0090 将发布输入绑定到候选完整载荷，0091 在发布函数内重验依赖、节点关系、严格森林和历史版本覆盖。这证明研发库可用，不代表正式院方采纳、生产部署或浏览器验收。
- Spec/Standards 两轴复核以 `origin/main...HEAD` 为固定基线，结果和最终 tree 记录在 ignored 的 `.runtime/vnext/p2-02-closeout.md`。P0-02 browser、P0-10/生产就绪、Q08/A014/A015 正式来源政策和 P2-07 通用工作台仍是明确后续门禁。

## PR 第五轮边界修复（2026-09-30）

- 0100 在注册函数转换时间前拒绝带时区、非法日期、24 点及闰秒；0101 将纯森林语义检查用于候选入库和发布两个边界。失败候选不写入、不占用请求 ID，正确重试仍可使用原请求。
- 0102 将基础视图身份纳入不可变保护，历史读取中的 sourceClientKey 不再可被普通特权 UPDATE/DELETE 改写。0103 和 Owner 的输入检查在 bigint 转换前拒绝越界版本号；HTTP 返回 400，最大合法版本查询保留正常空结果。
- 本轮采用真实应用角色 SQL 与真实 loopback HTTP 回归，先复现四项缺陷，再验证修复。持久库只追加 0100–0103，原 99 条账本保留。完整 P1-06 升级回归为 80/80；FULL 来源准入及正式采纳仍单独跟踪，不能据此宣称完成。
