# PER07 — 卫生专业人员身份 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-04`；后续关联 `P5-13, P5-14`。

## 来源与领域定位
原类别：主数据。原Owner：医务部。原视图：专业身份。原粒度：一行一个人员的一个卫生专业身份；非医务人员无需填。
原来源：东华医护人员类型；WS/T363.15。原主键声明：["practitioner_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：PractitionerIdentity。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `16` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
登记卫生专业身份，让同一Person具有可独立核验的专业身份记录。

内部操作候选：`createProfessionalIdentity; verifyProfessionalIdentity; suspendProfessionalIdentity`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER07 profession_type与Person分离，非医务人员无需造practitioner
- external_practitioner_no是独立来源/标识，不作为Person stable ID
- specialty_code/name纳入采纳分类或P5-13多归属，不自由覆盖
- professional_status为核验状态不是临床授权状态
- credential_owner指向治理归口，不因字符串创建权限
- 跨院区复用身份，注册/地点另建

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P5-04、P5-13、P5-14。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `practitioner_id` 专业身份ID | id/R | 卫生专业人员身份的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PractitionerIdentity.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-04 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PractitionerIdentity.person_id`<br>TYPED_RELATION_REFERENCE | P5-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `profession_type` 卫生专业类别 | code/R | 卫生专业类别；取值见建议码表profession_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `PractitionerIdentity.profession_type`<br>VERSIONED_CODE_BINDING | P5-04 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `specialty_code` 专业方向代码 | text/C | 专业方向代码；按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。<br>条件必填：按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。 | `PractitionerSpecialtyRelation.code`<br>SPECIALTY_RELATION | P5-13 | 分类方案与专业注册scope分开，不将一列限制为医生唯一亚专业 |
| `specialty_name` 专业方向名称 | text/C | 专业方向名称；本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。<br>条件必填：本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。 | `PractitionerSpecialtyRelation.sourceLabel`<br>SPECIALTY_LABEL_EVIDENCE | P5-13 | 名称不是身份，未知方案先review |
| `professional_status` 专业身份状态 | code/R | 专业身份状态；取值见建议码表verification_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `PractitionerIdentity.professional_status`<br>VERSIONED_CODE_BINDING | P5-04 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `credential_owner` 资质主管部门 | text/R | 医生医务部、护理护理部、药师药学部等<br>是：任何实际记录必填 | `PractitionerIdentity.credential_owner`<br>OWNER_VERSIONED_FACT | P5-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `external_practitioner_no` 外部医务人员标识 | text/O | 卫生专业人员身份记录的外部医务人员标识；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PractitionerIdentity.external_practitioner_no`<br>PROTECTED_FACT | P5-04 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-04 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-04 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-04 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-04 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-04 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-04 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-04 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-04 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-042` / `specialty_code`：按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-043` / `specialty_name`：本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同人医师/科研身份按规定独立。
2. 后勤人员不强制专业字段。
3. 同外部专业号冲突阻断。
4. 核验撤销历史仍保留。
5. 专业身份ACTIVE不等于处方权。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
