# PER12 — 专业技术资格记录 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-09`；后续关联 `P5-11`。

## 来源与领域定位
原类别：关系数据。原Owner：组织人事部。原视图：资格职称。原粒度：一行一个人取得的一项专业技术资格；与聘任职务分开。
原来源：人员原模板PRO_TECH_QUAL_LEVEL/PRO_TECH_QUAL_NAME。原主键声明：["title_qualification_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：TitleQualification。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `16` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
分开已取得技术资格与被聘专业职务，避免与业务角色重复建模。

内部操作候选：`recordTitleQualification; appointProfessionalTitle; endTitleAppointment`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER12表达取得资格，PER13表达在E/Assignment范围内一次聘任
- PER13只在此owner落库，P5-02仅做角色证据引用
- 职务名称允许历史展示但code_system_version冻结
- appointed_on与业务期/recordedAt分开
- 解聘不删除资格，资格撤销不直接覆盖旧聘任
- 薪级/工资金额不扩入本票

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P5-05、P5-09、P5-11。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `title_qualification_id` 资格记录ID | id/R | 专业技术资格记录的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `TitleQualification.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-09 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `TitleQualification.person_id`<br>TYPED_RELATION_REFERENCE | P5-09 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `title_code` 专业技术资格代码 | text/R | 专业技术资格记录记录的专业技术资格代码；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TitleQualification.title_code`<br>OWNER_VERSIONED_FACT | P5-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `title_name` 专业技术资格名称 | text/R | 专业技术资格记录记录的专业技术资格名称；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TitleQualification.title_name`<br>OWNER_VERSIONED_FACT | P5-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `title_level` 资格等级 | text/R | 专业技术资格记录记录的资格等级；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TitleQualification.title_level`<br>OWNER_VERSIONED_FACT | P5-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `acquired_on` 取得日期 | date/C | 取得日期；技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。<br>条件必填：技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。 | `TitleQualification.acquired_on`<br>OWNER_VERSIONED_FACT | P5-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `qualification_id` 关联证明证书ID | id/O | 关联证明证书ID；引用PER08.qualification_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `TitleQualification.qualification_id`<br>TYPED_RELATION_REFERENCE | P5-09 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `code_system_version` 职称代码版本 | text/R | 专业技术资格记录记录的职称代码版本；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TitleQualification.code_system_version`<br>OWNER_VERSIONED_FACT | P5-09 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-09 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-09 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-09 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-09 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-09 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-09 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-09 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-09 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-054` / `acquired_on`：技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 取得高级资格不自动成为主任或IAM角色。
2. 同人历史多聘任可按期存在。
3. 中段超E期间拒绝。
4. title definition更新不改旧名称快照。
5. 结束聘任保留资格事实。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
