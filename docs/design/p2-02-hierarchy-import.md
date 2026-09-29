# P2-02 Hierarchy 视图导入

P2-02 在当前 vNext Department Owner 内治理 ORG05 视图定义和 ORG06 完整结构。每次候选只描述一个视图和一个完整业务有效期间；候选先在内存中完成严格森林校验，再进入独立复核和完整快照发布。

## 领域约束

- 一个视图内每个 Department 只能出现一次；每个节点最多一个父节点；循环、缺父、重复 node key 和重复 Department 在发布前阻断。
- 结构合法但森林规则失败的候选返回 `decision=FAIL` 与带 `nodeKey/field` 的问题定位，不写入候选或快照；closed schema 违规仍返回 `CLOSED_INPUT_REQUIRED`。
- 同一 Department 可以在不同视图使用不同父节点。
- GROUP 只拥有视图内节点身份。发布时生成 group/group-version 引用，不写入 Department 外键。
- 财务和统计视图可以登记定义，但当前候选导入返回 `VIEW_TYPE_NOT_OPERATIONAL`。
- `validFrom`、`validTo`、`recordedAt` 使用 `Asia/Shanghai` 本地时间；偏移时间和跨期间候选拒绝。
- 发布时每个 Department 版本必须覆盖候选的完整业务区间；版本边界跨越候选期间时要求拆分候选。
- 快照保存展示名称、引用版本、深度、排序和内容摘要；后续改名不会改变已发布快照。
- typed 快照读取保留责任组织、来源记录、来源版本、审批证据和状态，并把来源 `sourceRecordedAt` 与平台 `recordedFrom` 分开；责任 Department、来源 SOURCE 或节点 Department 版本无法覆盖完整业务期间时，数据库发布边界返回 `BLOCKED_DEPENDENCY`。
- PR #21 修复追加未部署的 0093：冻结责任 Department 与 SOURCE 的确切版本；SOURCE 通过公共时间解析函数选择覆盖版本。无界候选必须由无界依赖覆盖。GROUP 代码和所属视图/版本绑定进入快照，历史版本与节点禁止 UPDATE/DELETE。
- 每条 ORG06 节点边必须携带独立的 `sourceEvidence`（来源 alias、源版本、SOURCE、行定位、业务期间、来源记录时间、ACTIVE 意图及审批证据），参与审批摘要并逐条保存；所有边期间必须等于完整快照期间，混合期间拒绝。数据库再次检查边来源的权限和完整期间覆盖，并冻结 SOURCE 版本。迁移前未记录的逐边证据和依赖版本返回 null，不根据 ORG05 头部编造。
- `parentNodeKey` 是同一完整候选内的精确关系引用，发布时指向已校验的 DEPARTMENT/GROUP 节点及其版本，不按名称解析。GROUP 关系不伪装成 ORG04 科室外键；FULL 来源字段与码表采纳仍需独立合同门禁。

2026-09-29 的持久研发库修复通过 0088 层级迁移、0089 Department 前向修复、0090 完整载荷绑定、0091 数据库发布不变量重验和 0092 空白字段收紧完成；不重写 0084、0085、0087 历史账本。receipt 绑定数据库 OID 206108 的账本由 87 追加到 92，既有业务行与密钥摘要保持不变，wrapper readiness、`vnext:db:verify`、P2-02 fresh 和 0087→current 升级均通过。

## 写入边界

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
