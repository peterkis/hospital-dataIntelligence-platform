# PER11 — 医疗行为专项授权 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-08`；后续关联 `P5-12, P5-14`。

## 来源与领域定位
原类别：关系数据。原Owner：医务部。原视图：临床权限。原粒度：一行一个专业人员在限定机构/院区/单元的专项医疗行为授权。
原来源：卫宁KSS_ZGDMK；东华管制药品权限/处方权；原表抗菌分级。原主键声明：["privilege_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：ProfessionalPrivilege。
原验收约束：**职称、医生类型或账号安全组不得直接推导处方权；有效身份、注册、业务能力、授权范围取交集**。

原数据模型字段 `21` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
实现专项医疗授权，独立于职称、岗位和应用菜单角色。

内部操作候选：`grantPrivilege; suspendPrivilege; revokePrivilege; evaluatePrivilegeAt`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER11处方/手术/报告等授权类型由医务护理药学Owner规则发布
- legal/campus/unit/action范围是一个元组，不数组扩张
- supervisionRequired须有有效监督关系才能使用
- 新增授权检查注册/能力/任职，撤销属于安全收缩不因旧资质过期无法执行
- 授权证据、审批和撤销原因不可覆盖
- 只合成策略，不代替医院正式临床授权制度

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P1-02、P3-01、P5-04、P5-06、P5-08、P5-12、P5-14。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `privilege_id` 专项授权ID | id/R | 医疗行为专项授权的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `ProfessionalPrivilege.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-08 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `practitioner_id` 专业身份ID | id/R | 专业身份ID；引用PER07.practitioner_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ProfessionalPrivilege.practitioner_id`<br>TYPED_RELATION_REFERENCE | P5-08 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `registration_id` 依据执业注册ID | id/R | 依据执业注册ID；引用PER09.registration_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ProfessionalPrivilege.registration_id`<br>TYPED_RELATION_REFERENCE | P5-08 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `privilege_type` 授权类别 | code/R | 授权类别；取值见建议码表privilege_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `ProfessionalPrivilege.privilege_type`<br>VERSIONED_CODE_BINDING | P5-08 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `privilege_code` 具体授权项目或级别 | text/R | 抗菌分级、手术项目或级别等由业务部门核定<br>是：任何实际记录必填 | `ProfessionalPrivilege.privilege_code`<br>OWNER_VERSIONED_FACT | P5-08 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `legal_entity_id` 适用医疗机构 | id/R | 适用医疗机构；引用ORG01.legal_entity_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ProfessionalPrivilege.legal_entity_id`<br>TYPED_RELATION_REFERENCE | P5-08 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `campus_id` 适用院区 | id/R | 适用院区；引用ORG02.campus_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `ProfessionalPrivilege.campus_id`<br>TYPED_RELATION_REFERENCE | P5-08 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `unit_id` 适用业务单元 | id/C | 适用业务单元；引用ORG07.unit_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：专项医疗授权限定到特定单元时必填；院区级授权不得自动扩大至其他院区。 | `ProfessionalPrivilege.unit_id`<br>TYPED_RELATION_REFERENCE | P5-08 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `grant_status` 授权状态 | code/R | 授权状态；取值见建议码表grant_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `ProfessionalPrivilege.grant_status`<br>VERSIONED_CODE_BINDING | P5-08 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `supervision_required` 需上级审核 | code/R | 需上级审核；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `ProfessionalPrivilege.supervision_required`<br>VERSIONED_CODE_BINDING | P5-08 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `authorization_ref` 授权批准号 | text/R | 医疗行为专项授权记录的授权批准号；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ProfessionalPrivilege.authorization_ref`<br>OWNER_VERSIONED_FACT | P5-08 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `revoked_at` 撤销时间 | datetime/O | 医疗行为专项授权记录的撤销时间；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `ProfessionalPrivilege.revoked_at`<br>OWNER_VERSIONED_FACT | P5-08 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `revocation_reason` 撤销原因 | text/C | 撤销原因；授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。<br>条件必填：授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。 | `ProfessionalPrivilege.revocation_reason`<br>OWNER_VERSIONED_FACT | P5-08 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-08 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-08 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-08 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-08 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-08 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-08 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-08 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-08 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-052` / `unit_id`：专项医疗授权限定到特定单元时必填；院区级授权不得自动扩大至其他院区。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-053` / `revocation_reason`：授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 高级职称不能自动拿处方权。
2. 控制药类别未采纳不推断。
3. 授权A单元不能用于B。
4. 撤销后当前评估拒绝旧R保留。
5. 期间内监督缺口阻断。
6. maker自批拒绝。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
