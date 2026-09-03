# Department Governance API Contract Boundary

本文件冻结 PV-005-B 之前的科室治理查询场景、应用契约和 DTO 边界。它不是 HTTP 路由、OpenAPI、Generated Client 或 UI 规格，也不授权实现这些能力。

## 1. Domain Model

`Department` 是永久且不可复用的全院科室稳定身份；`DepartmentVersion` 是同一身份的不可变语义版本。名称、类型、诊疗科目映射适用性、生命周期和主数据业务有效时间属于版本，院区和层级不属于版本内字段。

科室层级按行政、运营、病案等视角独立治理。每个发布视图冻结完整节点、父子关系、展示名称和被引用版本。院区隶属是独立、只追加、双时态关系。来源映射是源系统代码到科室稳定身份的显式绑定，不改变科室身份或层级。

治理流程状态与科室业务生命周期状态分离。Workflow 拥有提交、复核和最终审批；Department Domain 拥有版本与生命周期；Release Distribution 拥有通用发布包络与快照制品。任何应用命令都不得取得或绕过这些模块的主权。

## 2. Read Model

`DepartmentPublishedReadModel` 是系统消费者查询已发布科室标准数据的应用层模型。它由精确发布 Projection、该版本的院区快照、层级快照和来源映射组装，不是数据库表映射。

Read Model 只返回已发布业务内容。发布列表和详情禁止携带 Workflow 请求、审批动作、内部 repository 标识或数据库结构。治理管理员和业务审核人员所需的状态、待办和差异使用独立的治理工作台视图，不能混入系统消费者的发布 DTO。

## 3. Consumer Roles

| 消费者角色 | 业务需要 | 契约入口 |
|---|---|---|
| 治理管理员 | 创建草稿、提交治理、查看状态 | `CreateDepartmentDraft`、`SubmitDepartmentGovernance`、`getGovernanceStatus` |
| 业务审核人员 | 查看待审核科室、查看版本差异、执行复核和最终审批 | `findPendingReviews`、`getVersionDifference`、`ReviewDepartment`、`ApproveDepartment` |
| 系统消费者 | 获取当前已发布科室标准数据 | 发布列表、详情、层级、来源映射和质量查询 |
| 数据分析人员 | 按业务时间查询历史版本 | `getDepartmentHistory` |

这些名称是消费者画像，不是 IAM 角色。授权只依据已验证平台安全主体在指定 `governanceObjectId` 上的有效权限，不按角色名称或外部身份提供方角色推断。

## 4. DTO

DTO 是应用边界的公开传输值，不等于 Domain Entity、Projection 或数据库 Entity。

| DTO | 用途 | 核心内容 |
|---|---|---|
| `DepartmentSummaryDTO` | 发布科室列表 | 稳定 ID、编码、名称、类型、生命周期、院区、发布时间 |
| `DepartmentDetailDTO` | 当前发布详情 | 基础信息、院区、层级、来源映射、质量、发布身份和内容摘要 |
| `DepartmentHistoryDTO` | 业务时间历史查询 | 查询时点、版本序号、业务有效区间和当时详情 |
| `DepartmentHierarchyDTO` | 指定视角层级 | 视角类型及从根到科室节点的完整冻结路径 |
| `DepartmentSourceMappingDTO` | 来源映射 | 来源系统、来源编码、来源名称和映射状态 |
| `DepartmentQualityDTO` | 质量查询 | 总质量分、完整性、唯一性和标准化分数 |

DTO 禁止出现 `created_at`、`recorded_to`、`internal_version_id`、SQL、表名和 repository 句柄。`departmentVersionId` 只在治理工作台视图和 Command 中作为明确版本引用使用，不进入系统消费者的发布 DTO。发布 DTO 不包含 `workflowInstanceId` 或 `governanceRequestId`。

所有 DTO 时间使用 `DepartmentDtoLocalDateTime`，唯一解释为 `Asia/Shanghai`，格式严格为 `YYYY-MM-DDTHH:mm:ss`。不接受小数秒、`Z`、UTC 或任何 offset，也不使用 JavaScript `Date`。

## 5. Query Scenarios

### 5.1 List Published Departments

输入 `governanceObjectId` 和可选 filter；filter 只允许 `departmentCode`、`standardName`、`departmentType`、`campusId`。输出 `DepartmentSummaryDTO[]`。不得传入 SQL filter，也不得返回 Workflow 详情。

### 5.2 Get Published Department

输入 `governanceObjectId`、`departmentId`，输出当前 `DepartmentDetailDTO`，包含基础信息、院区、层级、来源映射、质量评分和发布时间。

### 5.3 Get Department History

输入 `governanceObjectId`、`departmentId`、`asOf`，输出该业务时点有效的 `DepartmentHistoryDTO`。实现必须按主数据业务有效时间查询，并继续服从平台既有双时态规则，不得以 `created_at` 代替。

### 5.4 Get Department Hierarchy

输入 `governanceObjectId`、`viewType`，输出该发布视角内每个科室的 `DepartmentHierarchyDTO`。路径按根节点到科室节点排序，例如“医疗系统 / 内科 / 呼吸与危重症医学科”，必须来自发布快照，不能读取当前树重算历史路径。

### 5.5 Get Department Source Mappings

输入 `governanceObjectId`、`departmentId`，输出 `DepartmentSourceMappingDTO[]`，例如 HIS“呼吸科”和 EMR“呼吸内科”，并明确返回 `CONFIRMED` 等映射状态。

### 5.6 Get Department Quality

输入 `governanceObjectId`、`departmentId`，输出 `DepartmentQualityDTO`，分别表达 `qualityScore`、`completenessScore`、`uniquenessScore` 和 `standardizationScore`。应用层只读取既有质量事实，不在查询时计算新业务状态。

治理管理员和审核人员另通过 `getGovernanceStatus`、`findPendingReviews`、`getVersionDifference` 读取治理工作台视图。它们不属于系统消费者的发布查询结果。

## 6. Command Contract

未来 Department Governance API 只允许下列应用 Command：

| Command | 前置状态 | 权限 | 边界 |
|---|---|---|---|
| `CreateDepartmentDraft` | 无既有版本状态要求 | `DRAFT_WRITE` | 创建稳定身份及首个草稿，或由既有应用流程创建新版本草稿 |
| `SubmitDepartmentGovernance` | `DRAFT` | `SUBMIT` | 固定提交内容摘要并进入治理流程 |
| `ReviewDepartment` | `SUBMITTED` 或 `UNDER_REVIEW` | `REVIEW` | 对所见内容摘要执行专业复核 |
| `ApproveDepartment` | `AWAITING_FINAL` | `APPROVE` | 对同一冻结内容执行 Owner 最终审批 |
| `PublishDepartment` | `APPROVED` | `PUBLISH` | 仅发布已经批准且内容未漂移的版本 |
| `ConfirmSourceMapping` | `PENDING` | `REVIEW` | 将来源映射一次性确认，不能改写绑定内容 |

`PublishDepartment` 是应用编排中的允许命令名称，不是独立低级写入口。现有实现由最终批准动作在同一事务中触发发布；PV-005-B 必须保留这一原子语义。即使未来传输层单独表达该命令，也只能承接已批准 Workflow 状态，并同时验证 `PUBLISH` 权限和批准内容摘要，不能允许人员跳过提交、复核或最终审批直接发布。

明确禁止公开 `updateDepartment`、`deleteDepartment`、`moveDepartment`。内容变更必须创建或编辑草稿版本；层级移动属于独立层级视图治理；已发布内容不得原位覆盖或物理删除。

## 7. Permission Model

`DepartmentPermission` 固定为：

- `READ`
- `DRAFT_WRITE`
- `SUBMIT`
- `REVIEW`
- `APPROVE`
- `PUBLISH`

每次 Query 和 Command 都必须携带目标 `governanceObjectId`，授权决策必须匹配同一治理对象。没有匹配授权、显式拒绝或授权绑定到另一治理对象时均失败关闭。不存在全局 `department_admin`、角色名旁路或外部身份提供方角色旁路。

`ConfirmSourceMapping` 使用 `REVIEW`，因为它是对既有待确认绑定的治理判断，不是草稿内容写入。若未来需要独立职责分离，应通过新的权限决策和 ADR 明确变更，不能静默复用全局管理员角色。

## 8. Error Model

应用边界使用稳定的 `DepartmentErrorCode`，不得把数据库错误、表名或内部异常文本直接返回给调用方。

| Error code | 语义 |
|---|---|
| `DEPARTMENT_NOT_FOUND` | 指定治理对象范围内不存在该科室稳定身份 |
| `DEPARTMENT_VERSION_NOT_FOUND` | 指定科室版本不存在 |
| `DEPARTMENT_STATUS_INVALID` | Command 与当前治理或映射状态不兼容 |
| `DEPARTMENT_APPROVAL_REQUIRED` | 发布前没有已完成的最终批准 |
| `DEPARTMENT_PERMISSION_DENIED` | 当前平台安全主体在目标治理对象上没有所需权限 |
| `DEPARTMENT_CONTENT_CHANGED` | 当前内容摘要与提交、复核或批准时所见摘要不同 |
| `DEPARTMENT_EVOLUTION_RELATION_REQUIRED` | `SUPERSEDED` 缺少显式前身后继关系 |

内部 `OBJECT_PERMISSION_FORBIDDEN`、`APPROVAL_CONTENT_DRIFT` 或数据库约束异常必须由未来应用适配层映射为上述稳定错误码；本任务不实现 HTTP 状态映射。

## 9. Frozen Boundary

PV-005-B 只能在本文件和 `department-contracts.ts` 冻结的应用边界上增加传输适配。不得把数据库 Entity、当前层级查询、Workflow 详情或任意 SQL filter 作为 REST 契约，也不得借 HTTP 路由增加未列入允许清单的直接写命令。
