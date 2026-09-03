# Phase 02 科室治理 Prototype REST Adapter

## 范围与定位

本实现以提交 `4733dfc5cb79712a329869e804c929160eb299ef` 为冻结开工基线。REST Adapter 是 `DepartmentGovernanceApplicationContract` 的薄 HTTP 传输适配层，仅在 Prototype API 中以 `/prototype/v1` prefix 注册；插件内部保留相对路径，全部路由设置 `schema.hide = true`。

请求处理固定为：HTTP Handler 创建可信 `RequestContext`，再通过请求作用域 factory 创建一个 `DepartmentGovernanceApplicationContract`，调用冻结的 Application Contract，最后返回冻结 DTO。Adapter 不直接访问 Kysely、repository、`DepartmentMasterModule`、`WorkflowModule`、Audit、Release 或 Projection，也不在 Handler 中重新实现权限、摘要或时间查询规则。

> 本 REST Adapter 仅注册在 Prototype API，用于验证科室主数据治理 Application Contract 的 HTTP 传输适配。它不是正式身份认证、正式 OpenAPI、外部系统契约或生产就绪证明。

## Prototype 路由清单

下表列出本阶段全部 15 条实际路由。除创建和提交成功返回 `201` 外，其余成功响应均为 `200`。

| # | 方法与实际路径 | 类型 | 成功返回 |
|---:|---|---|---|
| 1 | `POST /prototype/v1/department-drafts` | Command | `201 DepartmentGovernanceStatusView` |
| 2 | `POST /prototype/v1/departments/:departmentId/versions/:departmentVersionId/submissions` | Command | `201 DepartmentGovernanceStatusView` |
| 3 | `POST /prototype/v1/department-governance/:governanceRequestId/reviews` | Command | `200 DepartmentGovernanceStatusView` |
| 4 | `POST /prototype/v1/department-governance/:governanceRequestId/approvals` | Command | `200 DepartmentGovernanceStatusView` |
| 5 | `POST /prototype/v1/department-governance/:governanceRequestId/publication-confirmations` | Command | `200 DepartmentGovernanceStatusView` |
| 6 | `POST /prototype/v1/departments/:departmentId/source-mappings/:mappingId/confirmations` | Command | `200 DepartmentGovernanceStatusView` |
| 7 | `GET /prototype/v1/departments` | 发布查询 | `200 DepartmentSummaryDTO[]` |
| 8 | `GET /prototype/v1/departments/:departmentId` | 发布查询 | `200 DepartmentDetailDTO` |
| 9 | `GET /prototype/v1/departments/:departmentId/history` | 发布查询 | `200 DepartmentHistoryDTO` |
| 10 | `GET /prototype/v1/department-hierarchies/:viewType` | 发布查询 | `200 DepartmentHierarchyDTO[]` |
| 11 | `GET /prototype/v1/departments/:departmentId/source-mappings` | 发布查询 | `200 DepartmentSourceMappingDTO[]` |
| 12 | `GET /prototype/v1/departments/:departmentId/quality` | 发布查询 | `200 DepartmentQualityDTO` |
| 13 | `GET /prototype/v1/departments/:departmentId/governance-status` | 治理工作台查询 | `200 DepartmentGovernanceStatusView` |
| 14 | `GET /prototype/v1/department-governance/pending-reviews` | 治理工作台查询 | `200 DepartmentReviewQueueItem[]` |
| 15 | `GET /prototype/v1/departments/:departmentId/version-difference` | 治理工作台查询 | `200 DepartmentVersionDifference` |

列表查询支持 `departmentCode`、`standardName`、`departmentType`、`campusId` 可选过滤条件。历史查询把 `asOf` 原样交给 Application 同时应用业务时间与记录时间语义。层级查询只返回发布时冻结的指定视角路径，不根据当前树重算历史。版本差异查询在 `fromVersionNo` 缺失时向 Application 传入 `null`。

## HTTP 到 Application Contract 的映射

### Command 映射

| HTTP 操作 | Application 调用 | 关键边界 |
|---|---|---|
| 创建科室草稿 | `execute({ commandName: 'CreateDepartmentDraft', ... })` | `departmentCode + content` 原样映射；操作者和发生时间不来自 body |
| 提交治理申请 | `execute({ commandName: 'SubmitDepartmentGovernance', ... })` | 合并 path 中的科室/版本 ID 与 body 中的治理对象、摘要和变更原因 |
| 专业复核 | `execute({ commandName: 'ReviewDepartment', ... })` | 合并 path 中的治理请求 ID；使用所见内容摘要和复核决定 |
| Owner 最终审批 | `execute({ commandName: 'ApproveDepartment', ... })` | Handler 只调用 `ApproveDepartment`，绝不随后调用 `PublishDepartment` |
| 发布后置条件确认 | `execute({ commandName: 'PublishDepartment', ... })` | 仅核验既有发布制品与摘要，不形成第二发布入口 |
| 确认来源映射 | `execute({ commandName: 'ConfirmSourceMapping', ... })` | 只允许既有映射 `PENDING -> CONFIRMED`，不公开创建来源映射命令 |

`ApproveDepartment` 的 `decision=APPROVED` 是最终批准与发布的唯一变更入口。现有 Application/Workflow 链路在同一个事务中完成 Owner 最终批准、`PUBLISH` 权限检查、Release 注册、`DepartmentVersion` 发布、Projection 和 Audit；任一步失败都整体回滚。Adapter 不拆分该事务，成功状态为 `PUBLISHED`。`decision=REJECTED` 则返回 `REJECTED`。

`publication-confirmations` 映射到冻结命令名 `PublishDepartment`，但语义严格是发布后置条件确认：验证 Workflow 已为 `APPROVED`、Version 已为 `PUBLISHED`、Release 与 Projection 均存在，并核对 Workflow、Version、Projection 三处摘要一致。它不创建 Release、Projection 或发布 Audit，也不修复不完整发布；重复调用必须幂等且不产生新制品。

`ConfirmSourceMapping` 继续使用既有 `DEPARTMENT_MASTER_REVIEW`（Contract 权限 `REVIEW`），不新增权限、不开放创建映射的 REST 命令，也不允许改写既有绑定内容。

### Query 到 DTO 映射

| HTTP 查询 | Application 方法 | 冻结输出 |
|---|---|---|
| 当前发布列表 | `listPublishedDepartments` | `DepartmentSummaryDTO[]` |
| 当前发布详情 | `getPublishedDepartment` | `DepartmentDetailDTO` |
| 历史时点 | `getDepartmentHistory` | `DepartmentHistoryDTO` |
| 指定层级视图 | `getDepartmentHierarchy` | `DepartmentHierarchyDTO[]` |
| 来源系统映射 | `getDepartmentSourceMappings` | `DepartmentSourceMappingDTO[]` |
| 质量评分 | `getDepartmentQuality` | `DepartmentQualityDTO` |
| 治理状态 | `getGovernanceStatus` | `DepartmentGovernanceStatusView` |
| 待复核队列 | `findPendingReviews` | `DepartmentReviewQueueItem[]` |
| 版本差异 | `getVersionDifference` | `DepartmentVersionDifference` |

前六项是发布消费者查询，仅返回冻结 DTO，不暴露 Workflow、内部版本、repository 句柄或 SQL 字段。后三项是独立治理工作台视图；治理状态允许读取 `DRAFT` 和流程中对象，待复核队列仍通过 Application 做对象级权限检查而不直接读取 Workflow 表。

## 请求作用域与可信上下文

共享 `createHttpRequestContext` 先调用 `resolvePrincipal(request)` 获取可信 principal，Department 路由要求 `principalKind='PERSON'`。每个 HTTP 请求只创建一次新的 Application 实例，不跨请求缓存携带 `RequestContext` 的实例；Adapter 依赖面只有 principal resolver、`now()` 和 `createApplication(context)`，不接收 database、transaction runner 或 repository。

`RequestContext` 的来源规则如下：

- `actorPrincipalId` 来自 Prototype authentication 解析后的 principal；客户端不能提交 principal UUID。
- `requestId` 按 `x-request-id -> request.id -> randomUUID()` 取值。
- `correlationId` 按 `x-correlation-id -> requestId` 取值。
- `occurredAt` 只由服务端 `dependencies.now()` 生成并经 `parseLocalDateTime` 校验。
- body/query 中的 `actorId`、`actorPrincipalId`、`reviewerId`、`approverId`、`occurredAt`、`requestId` 和 `correlationId` 均不是可信输入；未声明字段由 TypeBox schema 拒绝。
- 运行时依赖未配置时返回 `503 / DEPARTMENT_RUNTIME_NOT_CONFIGURED`。

## Prototype principal 与 CSRF

所有路由复用 `createPrototypeAuthentication`。`x-prototype-principal-code` 只接受 `prototype-owner`、`prototype-reviewer` 和 `prototype-final-owner`，解析结果为 `PERSON` principal；缺失或未知 principal 返回 `401`。所有非安全方法继续要求 `x-csrf-token`，错误或缺失返回 `403`。

Prototype role code 只负责解析合成身份。业务权限决策仍由 security principal、`governanceObjectId` 和 object permission grant 共同完成，Adapter 不按 role code 自行授权，也没有 prototype admin bypass。Prototype authentication 只允许非生产模式下绑定 `127.0.0.1`；CSRF guard 只是防止误调用的原型护栏，不是正式安全机制。

## Department HTTP 错误映射

错误响应保持 `{ "code": "稳定错误码", "requestId": "..." }`，不返回 stack、内部异常消息、SQLSTATE、表名、连接串、密码或其他 Secret。

| 条件/稳定错误码 | HTTP 状态 | 响应 code |
|---|---:|---|
| TypeBox 请求校验失败 | 400 | `REQUEST_SCHEMA_INVALID` |
| principal 缺失或未知 | 401 | `PROTOTYPE_PRINCIPAL_UNAUTHENTICATED` |
| Prototype CSRF 错误 | 403 | `PROTOTYPE_CSRF_FORBIDDEN` |
| `DEPARTMENT_PERMISSION_DENIED` | 403 | `DEPARTMENT_PERMISSION_DENIED` |
| `DEPARTMENT_NOT_FOUND` | 404 | `DEPARTMENT_NOT_FOUND` |
| `DEPARTMENT_VERSION_NOT_FOUND` | 404 | `DEPARTMENT_VERSION_NOT_FOUND` |
| `DEPARTMENT_STATUS_INVALID` | 409 | `DEPARTMENT_STATUS_INVALID` |
| `DEPARTMENT_APPROVAL_REQUIRED` | 409 | `DEPARTMENT_APPROVAL_REQUIRED` |
| `DEPARTMENT_CONTENT_CHANGED` | 409 | `DEPARTMENT_CONTENT_CHANGED` |
| `DEPARTMENT_EVOLUTION_RELATION_REQUIRED` | 409 | `DEPARTMENT_EVOLUTION_RELATION_REQUIRED` |
| Department runtime 缺失 | 503 | `DEPARTMENT_RUNTIME_NOT_CONFIGURED` |
| 未知内部错误 | 500 | `INTERNAL_ERROR` |

这些 Department 精确映射优先于通用字符串规则。因此内容漂移和状态冲突不会落成 `500` 或误报为 `400`，权限拒绝也不会暴露为内部错误；既有 Charge、Price 与 Authentication 映射语义保持不变。

## Asia/Shanghai 时间契约

所有业务日期时间唯一解释为 `Asia/Shanghai`，HTTP 和 DTO 格式严格为整秒 `YYYY-MM-DDTHH:mm:ss`，数据库对应 `timestamp without time zone`。Schema 拒绝小数秒、`Z`、`+08:00` 或任何 offset；业务边界不接收 JavaScript `Date`，也不使用 `Date.parse(LocalDateTime)`、`new Date(LocalDateTime)` 或 `toISOString()`。

Adapter 不自行生成业务时间，只把经共享 RequestContext 校验的 `dependencies.now()` 传给 Application。历史 `asOf` 同样保持无 offset 的整秒本地时间文本，时间语义由 Application 处理。

## 真实 PostgreSQL HTTP 验证记录

本节只承接本任务真实运行后的安全摘要；在验证器完成前不预写成功结论，也不记录数据库地址、凭据或完整 `DATABASE_URL`。

| 验证范围 | 结果 |
|---|---|
| 科室 HTTP 生命周期、原子发布、两次 publication confirmation 幂等、来源映射确认、发布查询、持久化、Release/Projection/Audit exactly-once、数据库池关闭与端口释放 | `PASSED`：`departmentHttpSmokePassed`、`departmentPublished`、`workflowApproved`、`releaseExactlyOnce`、`projectionExactlyOnce`、`auditSequenceObserved`、`publicationConfirmationIdempotent`、`sourceMappingConfirmed`、`persistenceObserved`、`databasePoolClosed`、`portReleased` 均为 `true` |

真实验证命令为 `npm run prototype:department:http:validate`。验证器在启动 API 前记录动态科室集合，完成原生 `fetch` HTTP 场景后通过 IPC 优雅关闭 API，并仅在关闭后使用新的只读数据库连接核对唯一新增科室、已发布版本、已批准 Workflow、单一 Release member、单一当前 Projection、摘要一致、六项有序 Audit 和已确认来源映射；随后确认数据库池已关闭且 `127.0.0.1:3000` 已释放。该次验证使用 16 个 migration，禁止时区类型数量为 0。

## 正式契约冻结与排除项

本任务未修改 `contracts/openapi/phase-01.openapi.json`、`contracts/openapi/phase-01.openapi.sha256` 或 `packages/generated-api-client/**`。Department 路由只由 `prototype-main.ts` 注册、全部 `schema.hide = true`，不进入正式 `main.ts` 或 `buildApplication` 默认路由；因此正式 OpenAPI 与 Generated Client 保持冻结。正式 OpenAPI 契约和 Generated Client 的科室能力由后续独立任务 **PV-005-B-02** 负责，本任务不得提前实现，也不得据此进入 PV-005-B-02。

明确排除且未由本 Adapter 证明的范围包括：

- Admin Web/UI 或任何浏览器验收；
- 正式 Keycloak 身份认证、正式 session/CSRF 和生产安全验证；
- HIS、EMR、LIS、PACS 或其他真实外部系统集成；
- 正式 OpenAPI、Generated API Client 和外部系统契约；
- Formal ABG、AR-07、Sequence 10～13 Evidence 或正式验收；
- 容器、生产部署、生产数据、可用性、性能、容量、灾备或生产就绪结论。

所有数据和 principal 均为本地合成原型用途。本结果即使完成真实 PostgreSQL HTTP 闭环，也只构成非生产原型观察，不构成正式验收、试点或生产就绪证明。
