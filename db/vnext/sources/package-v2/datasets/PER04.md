# PER04 — 聘用合同关系 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-03`；后续关联 `P4-06, P4-10`。

## 来源与领域定位
原类别：主数据。原Owner：组织人事部。原视图：人事聘用。原粒度：一行一个人与一个聘用主体的聘用关系版本；返聘可形成新关系。
原来源：人员原模板STAFF_CODE/IN_HIRE_DATE/PERSON_CONTRACT_TYPE。原主键声明：["employment_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：Engagement。
原验收约束：**工号在主体+有效期内唯一；离职、返聘沿用person_id；历史工号不可覆盖**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
批量治理Person与依法确认聘用主体的独立Engagement，不新增重复人员。

内部操作候选：`createEngagement; reviseEngagement; suspendEngagement; resumeEngagement; endEngagement`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER04 employer必须精确ORG01，source STAFF/CONTRACT等经批准映射到版本化type
- employee_no按issuer归为业务标识或源key，不默认全院永不复用人员号
- 同一法律/管理基础连续延长期限沿用E，真实结束后返聘新E
- business state派生不写Person
- 结束和事实纠错分开，末尾扩大不能伪装为end
- 多Engagement重叠按版本规则分段而非单旧ALLOW

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P4-01、P4-03、P4-06、P4-10。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `employment_id` 聘用关系ID | id/R | 聘用合同关系的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Engagement.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-03 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Engagement.person_id`<br>TYPED_RELATION_REFERENCE | P4-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `legal_entity_id` 聘用或接收主体ID | id/R | 聘用或接收主体ID；引用ORG01.legal_entity_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Engagement.legal_entity_id`<br>TYPED_RELATION_REFERENCE | P4-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `employee_no` 该聘用主体内工号 | text/R | 聘用合同关系记录的该聘用主体内工号；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `EmploymentIdentifierOrSourceKey`<br>IDENTIFIER_OR_SOURCE_REVIEW | P4-03 | 按发行主体和真实是否重用确定归属，不默认person永久编号 |
| `employment_type` 人员合同或用工类型 | code/R | 人员合同或用工类型；取值见建议码表employment_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Engagement.employment_type`<br>VERSIONED_CODE_BINDING | P4-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `employment_status` 聘用状态 | code/R | 聘用状态；取值见建议码表employment_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `EngagementBusinessState`<br>ENGAGEMENT_LIFECYCLE | P4-03 | 显式create/suspend/resume/end，禁止直接Person.employmentStatus |
| `join_date` 来院工作日期 | date/C | 来院工作日期；来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。<br>条件必填：来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。 | `Engagement.join_date`<br>OWNER_VERSIONED_FACT | P4-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `contract_start` 本次关系开始日期 | date/R | 聘用合同关系记录的本次关系开始日期；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Engagement.contract_start`<br>OWNER_VERSIONED_FACT | P4-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `contract_end` 合同或接收截止日期 | date/O | 聘用合同关系记录的合同或接收截止日期；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Engagement.contract_end`<br>OWNER_VERSIONED_FACT | P4-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `departure_date` 实际离院日期 | date/O | 聘用合同关系记录的实际离院日期；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Engagement.departure_date`<br>OWNER_VERSIONED_FACT | P4-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `hr_source_ref` 人事批准依据 | text/R | 聘用合同关系记录的人事批准依据；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Engagement.hr_source_ref`<br>OWNER_VERSIONED_FACT | P4-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-03 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-03 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-03 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-03 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-03 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-03 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-03 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-03 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-035` / `join_date`：来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 一个人多任用可按ALLOW。
2. FORBID/REVIEW缺规则拒绝。
3. B/R旧认知可重现。
4. 跨主体返聘不新建Person。
5. 历史end错误显式纠正，真实再聘新ID。
6. 批量多行并发无write skew。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
