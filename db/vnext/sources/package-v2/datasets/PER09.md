# PER09 — 执业注册 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-06`；后续关联 `P5-07, P5-14`。

## 来源与领域定位
原类别：关系数据。原Owner：医务部。原视图：执业合规。原粒度：一行一个卫生专业人员在某注册机构的执业注册事实。
原来源：厂商执业证书编码；原人员模板缺失补充。原主键声明：["registration_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：PracticeRegistration。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把执业注册事实与资格证、院区、机构许可分开关联。

内部操作候选：`recordRegistration; verifyRegistrationScope; suspendRegistration; endRegistration`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER09注册主体精确ORG01而非院区名
- 资格证依赖按适用专业政策，缺证/不适用不可用统一假默认
- practice_scope_code引用版本，原文范围保留但不作任意表达式授权
- 多地点备案文号是证据不等于所有院区
- 状态与周期整段核验
- 机关变更形成新/更正关系，不覆盖历史注册

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P5-04、P5-05、P5-06、P5-07、P5-14。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `registration_id` 执业注册ID | id/R | 执业注册的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PracticeRegistration.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-06 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `practitioner_id` 专业身份ID | id/R | 专业身份ID；引用PER07.practitioner_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PracticeRegistration.practitioner_id`<br>TYPED_RELATION_REFERENCE | P5-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `qualification_id` 依据资质证书ID | id/R | 依据资质证书ID；引用PER08.qualification_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PracticeRegistration.qualification_id`<br>TYPED_RELATION_REFERENCE | P5-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `registered_entity_id` 注册医疗机构ID | id/R | 注册医疗机构ID；引用ORG01.legal_entity_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PracticeRegistration.registered_entity_id`<br>TYPED_RELATION_REFERENCE | P5-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `registration_no_secure_ref` 执业证编号安全引用 | text/R | 执业注册记录的执业证编号安全引用；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PracticeRegistration.registration_no_secure_ref`<br>PROTECTED_FACT | P5-06 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `registration_category` 注册类别 | text/R | 执业注册记录的注册类别；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PracticeRegistration.registration_category`<br>OWNER_VERSIONED_FACT | P5-06 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `practice_scope_code` 执业范围代码 | text/C | 执业范围代码；该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。<br>条件必填：该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。 | `PracticeRegistration.practice_scope_code`<br>OWNER_VERSIONED_FACT | P5-06 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `practice_scope_text` 核验后的执业范围 | text/R | 执业注册记录的核验后的执业范围；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PracticeRegistration.practice_scope_text`<br>OWNER_VERSIONED_FACT | P5-06 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `multi_site_record_ref` 多机构执业备案引用 | text/C | 是否需要备案按实际登记和有效规定核验，不由院区数推断<br>条件必填：经医务部门核定实际依法需要多机构执业备案时必填；不能按院区数量推断。 | `PracticeRegistration.multi_site_record_ref`<br>OWNER_VERSIONED_FACT | P5-06 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verification_status` 注册核验状态 | code/R | 注册核验状态；取值见建议码表verification_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `PracticeRegistration.verification_status`<br>VERSIONED_CODE_BINDING | P5-06 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-06 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-06 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-06 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-06 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-06 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-06 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-06 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-06 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-049` / `practice_scope_code`：该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-050` / `multi_site_record_ref`：经医务部门核定实际依法需要多机构执业备案时必填；不能按院区数量推断。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 两院区同一个许可主体不强制两注册。
2. 不同法人不自动共用注册。
3. 后录变更旧R仍原scope。
4. 过期或撤销注册拒绝资格评估。
5. 服务账号不可持专业注册。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
