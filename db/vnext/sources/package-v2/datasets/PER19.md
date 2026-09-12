# PER19 — 账号范围授权 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P6-03`；后续关联 `P6-06`。

## 来源与领域定位
原类别：关系数据。原Owner：业务系统归口部门。原视图：身份访问。原粒度：一行一个账号×角色×明确院区/业务单元的授权元组；严禁拼接后笛卡尔展开。
原来源：东华06医院/科室/安全组三列；08用户登录其他科室。原主键声明：["account_grant_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：数字身份与访问控制；建议owner：identity-access；逻辑模型：ScopedAccessGrant。
原验收约束：**权限角色所属系统与账号一致；源多值三列数量和顺序逐组校验；到期撤权并验证实际生效**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
维护账号×角色×院区×单元的原始范围元组并实现判定。

内部操作候选：`grantScopedAccess; reviseGrantScope; revokeScopedGrant; evaluateAccess`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER19一行一原子授权元组，不把roles/campuses/units分列拆散组合
- unit所属campus和assignment依赖全窗口验证
- scope_expression解析白名单AST，不执行脚本，null不是任意范围
- grantStatus/revokedAt分命令追加
- Maker-checker按真实actor身份而非UI选角色
- 本平台判定与外部系统ack分别记录

## 每个FULL profile的就绪门禁
关联所需票：P1-02、P3-01、P4-04、P6-01、P6-02、P6-03、P6-06。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `account_grant_id` 账号授权ID | id/R | 账号范围授权的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `ScopedAccessGrant.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P6-03 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `account_id` 账号ID | id/R | 账号ID；引用PER17.account_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ScopedAccessGrant.account_id`<br>TYPED_RELATION_REFERENCE | P6-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `iam_role_id` 权限角色ID | id/R | 权限角色ID；引用PER18.iam_role_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ScopedAccessGrant.iam_role_id`<br>TYPED_RELATION_REFERENCE | P6-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `campus_id` 院区范围 | id/R | 院区范围；引用ORG02.campus_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ScopedAccessGrant.campus_id`<br>TYPED_RELATION_REFERENCE | P6-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `unit_id` 业务单元范围 | id/C | 业务单元范围；引用ORG07.unit_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：权限按临床业务单元/科室隔离时必填；空范围不能被实现为全部科室。 | `ScopedAccessGrant.unit_id`<br>TYPED_RELATION_REFERENCE | P6-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `assignment_id` 任职依据ID | id/C | 任职依据ID；引用PER06.assignment_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：账号权限依据员工岗位任职批准时必填；其他依据必须显式审签。 | `ScopedAccessGrant.assignment_id`<br>TYPED_RELATION_REFERENCE | P6-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `scope_expression` 其他资源范围表达式 | text/C | 必须可执行且经审核；空不是全院<br>条件必填：存在患者、资源、操作类别等额外权限过滤条件时必填，使用版本化可执行表达式。 | `ScopedAccessGrant.scopeAst`<br>CONSTRAINED_SCOPE_AST | P6-03 | 仅白名单DSL，不执行原文SQL/JS；null不全院、数组不笛卡尔 |
| `grant_status` 授权状态 | code/R | 授权状态；取值见建议码表grant_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `ScopedAccessGrant.grant_status`<br>VERSIONED_CODE_BINDING | P6-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `approval_ticket` 权限申请审批单号 | text/R | 账号范围授权记录的权限申请审批单号；按本表一行粒度维护，由业务系统归口部门确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ScopedAccessGrant.approval_ticket`<br>OWNER_VERSIONED_FACT | P6-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `revoked_at` 撤销时间 | datetime/O | 账号范围授权记录的撤销时间；按本表一行粒度维护，由业务系统归口部门确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `ScopedAccessGrant.revoked_at`<br>OWNER_VERSIONED_FACT | P6-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `grant_reason` 授权事由 | text/R | 账号范围授权记录的授权事由；按本表一行粒度维护，由业务系统归口部门确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ScopedAccessGrant.grant_reason`<br>OWNER_VERSIONED_FACT | P6-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P6-03 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P6-03 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P6-03 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P6-03 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P6-03 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P6-03 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P6-03 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P6-03 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-064` / `unit_id`：权限按临床业务单元/科室隔离时必填；空范围不能被实现为全部科室。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-065` / `assignment_id`：账号权限依据员工岗位任职批准时必填；其他依据必须显式审签。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-066` / `scope_expression`：存在患者、资源、操作类别等额外权限过滤条件时必填，使用版本化可执行表达式。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 2原始元组只得到2授权不变4。
2. 跨system/错unit-campus拒绝。
3. 扩大scope重新审批。
4. revocation重复幂等。
5. 撤权后缓存不允许继续按旧grant放行。
6. 未观察远端不能称全部已撤权。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
