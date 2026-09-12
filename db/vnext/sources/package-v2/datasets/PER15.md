# PER15 — 轮转支援计划 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-07`；后续关联 `P4-11, P5-10`。

## 来源与领域定位
原类别：业务配置。原Owner：组织人事部。原视图：轮转支援。原粒度：一行一次批准的轮转或支援安排；实际权限仍按有效任职和授权计算。
原来源：本次设计建议。原主键声明：["rotation_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：TemporaryArrangementPlan。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `16` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
在批量入口复用有限有来源SECONDMENT，并保留PER15计划与实际任职的区别。

内部操作候选：`planSecondment; approveTemporaryPlan; createSourceLinkedAssignment; closeTemporaryAssignment`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- 来源PRIMARY不结束，目标有限且同Person/E/Purpose
- 目标/source/任用/两科室或单元全窗口验证
- 审批计划和actual Assignment/link分开，计划ID不作为目标Assignment ID
- 源link固定精确版本，来源后续调动不自动跟随
- 自然到期只读推导，无自动创建返回岗位
- 缺明确临时方式的rotation_purpose不得猜SECONDMENT

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P4-04、P4-07、P4-11、P5-10。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `rotation_id` 轮转计划ID | id/R | 轮转支援计划的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `TemporaryArrangementPlan.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-07 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `TemporaryArrangementPlan.person_id`<br>TYPED_RELATION_REFERENCE | P4-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `from_assignment_id` 原任职关系ID | id/C | 原任职关系ID；引用PER06.assignment_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：已有本院任职人员轮转/支援调出时必填；外部首次来院可空。 | `TemporaryArrangementPlan.from_assignment_id`<br>TYPED_RELATION_REFERENCE | P4-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `to_assignment_id` 目标任职关系ID | id/R | 目标任职关系ID；引用PER06.assignment_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `TemporaryArrangementPlan.to_assignment_id`<br>TYPED_RELATION_REFERENCE | P4-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `rotation_purpose` 轮转或支援目的 | text/R | 轮转支援计划记录的轮转或支援目的；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TemporaryArrangementPlan.rotation_purpose`<br>OWNER_VERSIONED_FACT | P4-07 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `training_program` 培训项目名称 | text/O | 轮转支援计划记录的培训项目名称；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `TemporaryArrangementPlan.trainingProgram`<br>TRAINING_PLAN | P4-11 | 轮转计划与实际期间、监督关系分开 |
| `supervisor_person_id` 带教或接收负责人ID | id/C | 带教或接收负责人ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：学生、进修、规培等需带教审核或支援需指定接收责任人时必填。 | `SupervisionRelation.supervisor`<br>SUPERVISION_RELATION | P5-10 | 不能仅ID存在就视为有资格带教 |
| `plan_approval_ref` 批准凭据 | text/R | 轮转支援计划记录的批准凭据；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TemporaryArrangementPlan.plan_approval_ref`<br>OWNER_VERSIONED_FACT | P4-07 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-07 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-07 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-07 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-07 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-07 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-07 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-07 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-07 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-059` / `from_assignment_id`：已有本院任职人员轮转/支援调出时必填；外部首次来院可空。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-060` / `supervisor_person_id`：学生、进修、规培等需带教审核或支援需指定接收责任人时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 借调来源完全不写业务版本。
2. 无期限/链式借调拒绝。
3. 重叠借调按明确测试policy拒绝。
4. 来源变化CHANGED但不改目标。
5. 提前END只关目标。
6. 中段暂停不能点查漏掉。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
