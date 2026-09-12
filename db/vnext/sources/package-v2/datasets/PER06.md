# PER06 — 人员任职关系 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-04`；后续关联 `P4-10, P4-11, P5-02`。

## 来源与领域定位
原类别：关系数据。原Owner：组织人事部。原视图：跨院区任职。原粒度：一行一个聘用关系在一个组织/业务单元的任职事实；兼岗/轮转分行。
原来源：人员原模板DEPT_CODE/HOSP_AREA_CODE/聘用时间；东华行政科室。原主键声明：["assignment_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：Assignment。
原验收约束：**同聘用关系同时间至多一个人事主归属；任职院区与单元院区一致；任职不自动授予处方或系统权限**。

原数据模型字段 `20` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把PER06的组织/单元/院区安置和用途方式导入完整任职关系，并提供有效窗口消费者。

内部操作候选：`createAssignment; classifyAssignment; revisePeriod; endAssignment; transferAssignment; getEffectiveAssignmentWindow`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- department或unit作为typed placement，unit的org/campus分别owner验证且期间一致
- source assignment_type/is_primary_hr只能按批准映射形成Purpose×Mode，不猜多义字段
- position_id路由P5角色关系，P5尚不可用时该字段不能静默丢弃
- 每版本同事务冻结任用/目标依赖证据
- 校验完整区间、主归属桶不含departmentId
- 支持结束非扩张、原子调动共同知识时间、旧证据与当前复核分离
- 延长/修订和当前权限重新校验，旧幂等结果不是新许可

## 每个FULL profile的就绪门禁
关联所需票：P1-02、P2-01、P3-01、P4-03、P4-04、P4-10、P4-11、P5-01、P5-02。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `assignment_id` 任职关系ID | id/R | 人员任职关系的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Assignment.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-04 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `employment_id` 聘用关系ID | id/R | 聘用关系ID；引用PER04.employment_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Assignment.employment_id`<br>TYPED_RELATION_REFERENCE | P4-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `org_id` 任职逻辑科室ID | id/R | 任职逻辑科室ID；引用ORG04.org_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Assignment.org_id`<br>TYPED_RELATION_REFERENCE | P4-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `unit_id` 业务单元ID | id/C | 业务单元ID；引用ORG07.unit_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：承担具体临床、护理、医技或药学业务的任职必填；纯院级行政任职可空。 | `Assignment.unit_id`<br>TYPED_RELATION_REFERENCE | P4-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `campus_id` 工作院区ID | id/C | 院级行政任职可不指定院区；临床任职必须明确<br>条件必填：存在明确工作地点的院区任职必填；院级行政关系可空但不得解读为全院区授权。 | `Assignment.campus_id`<br>TYPED_RELATION_REFERENCE | P4-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `position_id` 岗位ID | id/R | 岗位ID；引用PER05.position_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `AssignmentPositionRole.positionRef`<br>POSITION_ROLE_RELATION | P5-02 | FULL profile必需；P5未就绪时FULL不得应用；不塞回安置基础表 |
| `assignment_type` 任职关系类型 | code/R | 任职关系类型；取值见建议码表assignment_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `AssignmentSemantics.purposeAndMode`<br>PURPOSE_MODE_TRANSFORM | P4-04 | 必须与is_primary_hr联合用已批准转换决策，不能一列揉角色/模式 |
| `is_primary_hr` 人事主归属 | code/R | 人事主归属；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `AssignmentSemantics.primaryMode`<br>SCOPED_PRIMARY | P4-04 | 按person/E/purpose/scope唯一；冲突声明不按Department分别分桶 |
| `assignment_status` 在岗业务状态 | code/R | 工作、休假、结束等任职业务状态；与record_status发布状态分离<br>是：任何实际记录必填 | `AssignmentWorkStateFact`<br>ASSIGNMENT_BUSINESS_FACT | P4-04 | 源工作/休假/结束与治理发布状态分开；不可用status暗中重新开放END |
| `workload_fraction` 任职工作量比例 | decimal/O | 不是通用权限权重；仅约定口径后使用<br>可空：未知/不适用保持空；不以0或未知码冒充 | `AssignmentWorkloadDeclaration`<br>WORKLOAD_DECLARATION | P4-04 | Decimal只为已定义口径声明；不自动证明跨院区排班/FTE容量 |
| `appointment_date` 聘用岗位时间 | date/C | 聘用岗位时间；岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。<br>条件必填：岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。 | `AssignmentPositionRole.appointedOn`<br>POSITION_APPOINTMENT | P5-02 | 正式岗位聘任日期，与任职实际期间和record时间分开 |
| `appointment_ref` 任职批准文号 | text/R | 人员任职关系记录的任职批准文号；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `AssignmentAdmission.appointmentEvidence`<br>APPOINTMENT_EVIDENCE | P4-04 | 需要来源批准依据，本平台maker-checker不因填了文号而略过 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-04 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-04 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-04 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-04 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-04 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-04 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-04 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-04 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-039` / `unit_id`：承担具体临床、护理、医技或药学业务的任职必填；纯院级行政任职可空。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-040` / `campus_id`：存在明确工作地点的院区任职必填；院级行政关系可空但不得解读为全院区授权。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-041` / `appointment_date`：岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 7-12月任职越出8月到期E拒绝。
2. A/B院区多个用途合法，重复组织主归属拒绝。
3. 中段暂停review。
4. 转岗目标失败来源不结束。
5. 闭合后不回退开放旧版本。
6. 已提供未就绪岗位字段阻断不忽略。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
