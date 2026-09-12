# ORG17 — 诊疗科目与许可 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P3-09`；后续关联 `P5-07, P7-01`。

## 来源与领域定位
原类别：关系数据。原Owner：医务部。原视图：法人专业。原粒度：一行一个主体/科室/单元获准开展的诊疗科目关系。
原来源：科室原模板MEDICALSUBJECTS_CODE。原主键声明：["subject_license_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：业务单元、病区护理与服务能力；建议owner：care-organization；逻辑模型：SubjectLicensePermission。
原验收约束：**诊疗科目多值分行；代码存在于所选版本；有许可依据；不得由科名自动推定**。

原数据模型字段 `17` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
将机构许可诊疗科目与业务能力、监管分类分别治理。

内部操作候选：`recordSubjectPermission; verifyLicenseScope; retirePermission; evaluateSubjectScope`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG17绑定主体/科室/单元类型和已采纳诊疗科目版本
- 代码来源保存原文件页/摘要/采纳日期，待标准复核不得自动批准
- 等价/更宽/更窄/相关映射分别留证据，不能名称匹配授予许可
- 实体许可与人员注册服务地点后续求交
- 新增官方代码不使旧exact mapping自动升级
- 使用离线合成采纳版测试不声称真实监管效力

## 每个FULL profile的就绪门禁
关联所需票：P3-09、P5-07、P7-01。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `subject_license_id` 诊疗科目许可ID | id/R | 诊疗科目与许可的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `SubjectLicensePermission.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P3-09 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `target_type` 许可对象类型 | code/R | 许可对象类型；取值见建议码表target_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `SubjectLicensePermission.target_type`<br>VERSIONED_CODE_BINDING | P3-09 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `target_id` 许可对象ID | id/R | 诊疗科目与许可记录的许可对象ID；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SubjectLicensePermission.target_id`<br>TYPED_RELATION_REFERENCE | P3-09 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `code_system_id` 诊疗科目代码集ID | id/R | 诊疗科目代码集ID；引用REF01.code_system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `SubjectLicensePermission.code_system_id`<br>TYPED_RELATION_REFERENCE | P3-09 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `code_system_version` 代码集版本 | text/R | 诊疗科目与许可记录的代码集版本；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SubjectLicensePermission.code_system_version`<br>OWNER_VERSIONED_FACT | P3-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `subject_code` 诊疗科目代码 | text/R | 诊疗科目与许可记录的诊疗科目代码；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SubjectLicensePermission.subject_code`<br>OWNER_VERSIONED_FACT | P3-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `license_ref` 许可证或备案凭证 | text/R | 诊疗科目与许可记录的许可证或备案凭证；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SubjectLicensePermission.license_ref`<br>OWNER_VERSIONED_FACT | P3-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `permitted_scope` 许可范围限制 | text/C | 许可范围限制；许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。<br>条件必填：许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。 | `SubjectLicensePermission.permitted_scope`<br>OWNER_VERSIONED_FACT | P3-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verifier` 核验责任岗位 | text/R | 诊疗科目与许可记录的核验责任岗位；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SubjectLicensePermission.verifier`<br>OWNER_VERSIONED_FACT | P3-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P3-09 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P3-09 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P3-09 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P3-09 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P3-09 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P3-09 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P3-09 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P3-09 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-020` / `permitted_scope`：许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 能力REGISTER不能替代许可证。
2. 未核实标准进入review不可publish。
3. 过期许可不覆盖未来期间。
4. 目标代码退役触发review不是自动改码。
5. 院区数不等于机构注册数。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
