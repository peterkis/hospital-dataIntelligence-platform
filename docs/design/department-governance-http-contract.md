# Department Governance Browser HTTP Contract

PV-005-B-02A 以 `a81aa3165039f438951c17a22b4b7c320cf0fd13` 为冻结开工基线，将 PV-005-B-01 已验证的薄 REST Adapter 纳入正式浏览器治理契约。本次正式化表示路径、身份声明、OpenAPI 和客户端契约已冻结，不构成正式验收或生产就绪证明。

## Audience 与调用链

这些 API 面向数据治理管理员、专业审核人员、Owner/数据负责人和 Admin Web。OpenAPI tag 为 `Department Governance`，描述为“面向治理工作台人员的科室主数据治理接口，不是第三方系统主数据消费接口。”

调用链固定为 Browser Session → Department Governance HTTP API → Department Application Contract → Workflow → Atomic Approval/Publication → Projection → Audit。所有路由要求人员会话 `browserSession`，不接受服务主体执行治理操作。

HIS、EMR、LIS、PACS、BI 和第三方厂商不是这些 HTTP 路由的消费者。应用契约中发布列表、详情等查询的名称不等于授权创建系统直查 HTTP API；这些查询在本 surface 中用于治理工作台展示。系统消费者仍通过 Release Distribution、版本化 Subscription、Event 和 Canonical Snapshot 接收发布内容，保持投影支持声明、发布顺序、幂等、水位、回执与重放语义。没有新增 `/v1/master-data/departments`、`/v1/service/departments` 或任何 `serviceBearer` Department direct-query route。

系统消费者不得依赖 Browser Governance API；正式系统消费通过 Release Distribution consumer contract。

## 双 surface 与路由

`registerDepartmentGovernanceRoutes(instance, dependencies, options)` 只有一份 handler 和一份 TypeBox body/response DTO Schema。`PROTOTYPE` 使用 `/prototype/v1`、无正式 security 声明、`hide=true`、无 operationId；`FORMAL_BROWSER` 使用 `/v1/department-governance`、`security=[{ browserSession: [] }]`、`hide=false`。不合法的 prefix/security/hide 组合在注册时失败。两个 surface 可同时注册，前缀互斥。

以下路径均以 `/v1/department-governance` 开头。创建和提交成功返回 201，其余返回 200。

| 方法 | 正式相对路径 | operationId | Application Contract |
|---|---|---|---|
| POST | `/department-drafts` | `createDepartmentDraft` | `execute(CreateDepartmentDraft)` |
| POST | `/departments/{departmentId}/versions/{departmentVersionId}/submissions` | `submitDepartmentGovernance` | `execute(SubmitDepartmentGovernance)` |
| POST | `/requests/{governanceRequestId}/reviews` | `reviewDepartmentGovernance` | `execute(ReviewDepartment)` |
| POST | `/requests/{governanceRequestId}/approvals` | `approveDepartmentGovernance` | `execute(ApproveDepartment)` |
| POST | `/requests/{governanceRequestId}/publication-confirmations` | `confirmDepartmentPublication` | `execute(PublishDepartment)` |
| POST | `/departments/{departmentId}/source-mappings/{mappingId}/confirmations` | `confirmDepartmentSourceMapping` | `execute(ConfirmSourceMapping)` |
| GET | `/departments` | `listPublishedDepartments` | `listPublishedDepartments` |
| GET | `/departments/{departmentId}` | `getPublishedDepartment` | `getPublishedDepartment` |
| GET | `/departments/{departmentId}/history` | `getDepartmentHistory` | `getDepartmentHistory` |
| GET | `/hierarchies/{viewType}` | `getDepartmentHierarchy` | `getDepartmentHierarchy` |
| GET | `/departments/{departmentId}/source-mappings` | `getDepartmentSourceMappings` | `getDepartmentSourceMappings` |
| GET | `/departments/{departmentId}/quality` | `getDepartmentQuality` | `getDepartmentQuality` |
| GET | `/departments/{departmentId}/governance-status` | `getDepartmentGovernanceStatus` | `getGovernanceStatus` |
| GET | `/pending-reviews` | `listDepartmentPendingReviews` | `findPendingReviews` |
| GET | `/departments/{departmentId}/version-difference` | `getDepartmentVersionDifference` | `getVersionDifference` |

Prototype 全部 15 条旧路径保留。其复核、审批、发布确认仍使用 `/department-governance/{governanceRequestId}/...`，待办仍为 `/department-governance/pending-reviews`，层级仍为 `/department-hierarchies/{viewType}`；共用注册器仅映射这些历史路径名称，不复制 handler。

## Authentication、CSRF 与 RequestContext

正式 `main.ts` 将现有 Keycloak authentication 的 `resolvePrincipal(request)` 传给共用装配 factory。该 resolver 对浏览器请求读取 `__Host-hdi-session`，对 mutation 验证会话绑定的 CSRF。共享 RequestContext 要求 `principalKind=PERSON`，服务令牌解析出的 `SERVICE` 在创建 Application 前被拒绝。`x-prototype-principal-code` 不参与正式身份解析。

现有正式 CSRF 由两层组成：Route Header Schema 要求 `x-csrf-token` 至少 32 字符；Keycloak resolver 对实际 session 和 token 做验证。Department 与 Charge/Price 共用提取后的 `BrowserMutationHeadersSchema`，没有新增 CSRF 实现或降低旧接口语义。缺少或过短 header 返回 400 `REQUEST_SCHEMA_INVALID`，格式合法但不匹配会话的 token 返回 403 `BROWSER_CSRF_FORBIDDEN`。Prototype 继续由原 Prototype authentication 验证原型 CSRF。

每次请求通过可信 resolver 和服务端时钟创建 RequestContext，再创建一个新 Application。`actorPrincipalId` 来自 resolved principal；`requestId` 和 `correlationId` 保留已有 header 优先级；`occurredAt` 来自服务端 `now()`，按本地时间契约校验。body 不接受 actorId、reviewerId 或 approverId。共用依赖 factory 只复用无请求上下文的 query service、transaction runner 和 Workflow application，不跨请求缓存携带 RequestContext 的 Department Application。

## 审批、发布确认和 DTO

Handler 只映射冻结的六个 Command 和九个 Query。`ApproveDepartment(APPROVED)` 继续由现有 Workflow 在同一事务内完成终审、发布权限检查、Release、版本发布、Projection 和 Audit；Handler 不再调用一次 Publish。`publication-confirmations` 只执行冻结的 `PublishDepartment` 后置条件核验，重复确认返回既有发布结果，不新增 Release、Projection 或发布 Audit，不修复不完整发布。

DTO Schema 继续来自 `department-governance-schemas.ts`：所有 DTO 对象 `additionalProperties=false`，UUID 为小写 RFC variant 形式，Digest 为 64 位小写 hex，enum 与冻结 Application Contract 一致。时间只接受按 `Asia/Shanghai` 解释的整秒 `YYYY-MM-DDTHH:mm:ss`，不接受时区后缀、偏移或小数秒，不声明 RFC 3339 `date-time`。API 不返回数据库字段、Workflow 内部 Entity、SQLSTATE、密码或令牌。

## Error Contract

所有正式 Department operation 都声明 400、401、403、404、409、500、503，统一响应 `{ code: string, requestId: string }`。未知内部异常仅返回 500 `INTERNAL_ERROR`，不返回内部消息或堆栈。

| 稳定错误码 | HTTP |
|---|---:|
| `DEPARTMENT_PERMISSION_DENIED` | 403 |
| `DEPARTMENT_NOT_FOUND` | 404 |
| `DEPARTMENT_VERSION_NOT_FOUND` | 404 |
| `DEPARTMENT_STATUS_INVALID` | 409 |
| `DEPARTMENT_APPROVAL_REQUIRED` | 409 |
| `DEPARTMENT_CONTENT_CHANGED` | 409 |
| `DEPARTMENT_EVOLUTION_RELATION_REQUIRED` | 409 |

## OpenAPI 与 Generated Client

`buildApplication()` 缺少 `departmentGovernance` 时不注册正式科室路由。生成脚本显式提供 `createDepartmentGovernanceContractDependencies()`，只注册 Schema，不访问数据库或 Keycloak，也不执行 handler；误用这些依赖执行请求会抛 `CONTRACT_RUNTIME_NOT_AVAILABLE`，经平台错误映射隐藏为 `INTERNAL_ERROR`。

生成链保持 TypeBox → `npm run contract:generate` → frozen OpenAPI → `npm run contract:generate-client` → Generated Client。`schema.generated.ts` 完全由工具生成。`src/index.ts` 保持唯一入口，并导出 `GovernanceApiOperations`。按照 ADR-0077，调用使用既有 `client.GET(path, ...)` / `client.POST(path, ...)`；15 个稳定 operationId 位于生成的 `operations` 类型中，并由生成的 `paths` 引用，不另建手写同名 REST wrapper。

`department-governance.compile-test.ts` 只做 TS contract 检查，覆盖发布列表、创建、提交、复核、终审和发布详情的参数、body、响应类型；不执行，不访问服务器，不进入构建输出。

结构检查命令：`node apps/governance-api/scripts/check-department-openapi-diff.ts`。它从冻结开工 Git blob 读取旧契约，验证摘要、15 个新增 path、零删除、零旧 path 修改、旧 component schema 和 security 不变。

| 契约 | SHA-256 |
|---|---|
| Old | `eaa3c1c12fcf2069e0f66252f0be0411c1f0e00876bbc6e72abd8a3a5d12b017` |
| New | `0a6f4916188d592993dc2bdfa6c8e42c8832ab112a4447f7cd211d7fb228879c` |

## 消费兼容性与后续边界

`release_distribution.RegisterPublicationCommand` 已支持 `DEPARTMENT_MASTER` 与 `DEPARTMENT_HIERARCHY`；`PHASE_01_PROJECTION_CONTRACTS` 已登记 `hdi.department-master` 与 `hdi.department-hierarchy`。本任务没有修改这些内部消费边界或 Department projection schema。

正式 snapshot HTTP response schema 当前仍只正式声明 Charge/Price，没有包含 Department Master/Hierarchy。这个已知缺口留给 **PV-005-B-02B**；本提交不扩展 snapshot OpenAPI，也不把内部支持等同于已完成外部 snapshot HTTP 契约。

本任务不修改 Admin Web、领域、Workflow、审批发布事务、Projection、Audit、Migration 或数据库时间类型，不启动 Keycloak/Podman/Docker，不执行 Formal ABG、AR-07 或 Sequence 10～13，不自动进入 B-02B。
