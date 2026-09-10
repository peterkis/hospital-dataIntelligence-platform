# Department Application Boundary

本文记录 PV-005-A.4-R1 在进入 PV-005-B HTTP API 前验证的科室治理 Application Contract。它不修改已接受 ADR、科室领域模型、Workflow、发布事务、权限白名单、Projection、Audit 或 Published Read Model 的主权。

## Facade responsibility

`DepartmentGovernanceApplicationContract` 是未来传输层与现有领域模块之间的请求作用域 Facade。`createDepartmentGovernanceApplication(...)` 绑定可信 `RequestContext`、`TransactionRunner`、现有 `WorkflowApplication` 和 `DepartmentQueryService`。Command 不接收 `actorId`；操作者、发生时间、请求标识和关联标识只来自 `RequestContext`。

Facade 只负责编排和稳定错误映射。它不直接写 Workflow、Release、Projection 或 Audit 表，不复制这些模块的规则，也不返回数据库实体、SQL、表名或 repository 字段。

## Commands

`CreateDepartmentDraft` 保持冻结输入：

```ts
{
  commandName: 'CreateDepartmentDraft',
  governanceObjectId,
  departmentCode,
  content: {
    standardName,
    shortName,
    departmentType,
    subjectMappingApplicability,
    lifecycleStatus,
    businessValidFrom,
    businessValidTo,
    campusIds,
  },
}
```

Facade 在单个 `TransactionRunner` 事务内校验 `DEPARTMENT_MASTER_DRAFT_WRITE`，调用现有 `DepartmentMasterModule` 创建稳定身份和首个 `DRAFT` 版本，并记录院区关系。既有领域模块继续唯一负责 `DEPARTMENT_CREATED`、`DEPARTMENT_VERSION_CREATED` 和院区审计。冻结 Command 未增加操作者字段；领域模块所需的既有 `clinicalFlag`、`managementFlag` 和 `description` 由 Facade 确定性适配为科室类型对应标志和 `null` 描述，不扩大传输契约。

`SubmitDepartmentGovernance`、`ReviewDepartment` 和 `ApproveDepartment` 委托现有 `WorkflowApplication`。提交冻结科室编码、语义内容摘要、变更原因、映射适用性和确定排序的院区 ID；复核与终审比较提交摘要、操作者所见摘要和当前版本摘要。

`ApproveDepartment(APPROVED)` 是唯一的最终批准与发布变更入口。`WorkflowApplication.act(stageType=OWNER_FINAL_APPROVAL, actionResult=APPROVED)` 在同一个数据库事务中写入终审动作与审计、校验 `DEPARTMENT_MASTER_PUBLISH`、注册 Release、把版本从 `DRAFT` 改为 `PUBLISHED`、创建 Published Projection 并写入发布审计。任一步失败都会回滚全部变更，不存在可提交的 `Workflow=APPROVED` 但版本未发布状态。

`PublishDepartment` 仅保留为冻结传输契约的发布后置条件确认。它校验 `DEPARTMENT_MASTER_PUBLISH`、已批准 Workflow、已发布版本、非空 Release、当前 Projection，以及三处内容摘要一致性；满足时幂等返回既有 `PUBLISHED` 状态。它不创建 Release、Projection 或 Audit，也不修复不完整发布事务。最终批准未完成时返回 `DEPARTMENT_APPROVAL_REQUIRED`，已批准但发布制品缺失时返回 `DEPARTMENT_STATUS_INVALID`。

`ConfirmSourceMapping` 使用既有 `DEPARTMENT_MASTER_REVIEW`，在单个事务中把同一 `governanceObjectId + departmentId` 下的映射从 `PENDING` 转为 `CONFIRMED`。它不新增独立权限，不改写来源系统、来源编码、来源名称、目标科室或匹配方式；终态映射不能再次确认。

## Queries and errors

六个发布查询直接委托 `DepartmentQueryService`，并映射为冻结 DTO：发布列表、发布详情、业务时间历史、冻结层级路径、来源映射和质量。查询按 `governanceObjectId` 约束，不返回 `DepartmentVersion`、数据库 Projection 行或 Workflow 详情。治理状态、待复核列表和版本差异保持独立工作台视图。

Application error mapper 只把已知内部错误转换为冻结的 `DepartmentErrorCode`。未知异常继续抛给未来传输层的统一 500 处理，不作为业务成功，也不把 SQLSTATE、表名或堆栈放入 DTO。

所有 Application 输入和输出时间均为按 `Asia/Shanghai` 解释的 `YYYY-MM-DDTHH:mm:ss` 本地文本，不含 `Z` 或 offset，不使用 JavaScript `Date` 作为领域值。

## Explicit exclusions

PV-005-A.4-R1 未实现 HTTP Route、OpenAPI、Generated Client、Admin Web、外部 HIS/EMR/LIS/PACS Adapter、Keycloak 或 Formal ABG。
