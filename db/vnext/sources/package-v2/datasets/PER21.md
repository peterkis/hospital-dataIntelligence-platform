# PER21 — 人员账号历史映射 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-05`；后续关联 `P4-09, P6-07, P5-04`。

## 来源与领域定位
原类别：关系数据。原Owner：信息管理部。原视图：系统互操作。原粒度：一行一个源系统人员/工号/医务人员/账号标识的语义明确映射。
原来源：原模板STAFF_INDEX_NO/STAFF_CODE；厂商人事ID/医生代码/用户代码。原主键声明：["person_map_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：TypedSourceRecordMapping。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
导入有语义判别的人员/任用/专业/账号来源记录映射。

内部操作候选：`registerSourceRecord; correctSourceTarget; retractSourceAssertion; lookupExactSource`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER21 target_entity_type从PERSON/EMPLOYMENT/PRACTITIONER/ACCOUNT注册表解析，未建owner只暂存
- namespace/sourceEntity/context/key/time共同决定记录来源，不以source code等于工号判Person
- 纠错必须expectedHead/reason/new version，重新注册不能重指向
- 同个源记录不同真实incarnation不能混同
- 原source key敏感隔离
- 账号映射不赋予认证权限

## 每个FULL profile的就绪门禁
关联所需票：P4-05、P4-09、P5-04、P6-07。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `person_map_id` 人员映射ID | id/R | 人员账号历史映射的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-05 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `from_system_id` 源系统ID | id/R | 源系统ID；引用GOV01.system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.from_system_id`<br>TYPED_RELATION_REFERENCE | P4-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `source_entity_type` 源对象类型 | text/R | PERSON、EMPLOYEE、PRACTITIONER、ACCOUNT分开标注<br>是：任何实际记录必填 | `TypedSourceRecordMapping.source_entity_type`<br>OWNER_VERSIONED_FACT | P4-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `source_code` 源标识 | text/R | 人员账号历史映射记录的源标识；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.source_code`<br>OWNER_VERSIONED_FACT | P4-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `source_context` 源医院或账套上下文 | text/R | 人员账号历史映射记录的源医院或账套上下文；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.source_context`<br>OWNER_VERSIONED_FACT | P4-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `target_entity_type` 目标对象类型 | text/R | PER01、PER04、PER07、PER17四种之一<br>是：任何实际记录必填 | `TypedSourceRecordMapping.target_entity_type`<br>OWNER_VERSIONED_FACT | P4-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `target_id` 目标对象ID | id/R | 人员账号历史映射记录的目标对象ID；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.target_id`<br>TYPED_RELATION_REFERENCE | P4-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `mapping_relation` 映射语义 | code/R | 映射语义；取值见建议码表mapping_relation，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.mapping_relation`<br>VERSIONED_CODE_BINDING | P4-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `verified_by` 核验岗位 | text/R | 人员账号历史映射记录的核验岗位；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `TypedSourceRecordMapping.verified_by`<br>OWNER_VERSIONED_FACT | P4-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `resolution_evidence` 同一人判定依据引用 | text/C | 同一人判定依据引用；完成同一人映射、冲突工号裁决或人工身份归并时必填。<br>条件必填：完成同一人映射、冲突工号裁决或人工身份归并时必填。 | `TypedSourceRecordMapping.resolution_evidence`<br>PROTECTED_FACT | P4-05 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-05 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-05 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-05 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-05 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-05 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-05 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-05 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-05 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-067` / `resolution_evidence`：完成同一人映射、冲突工号裁决或人工身份归并时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 缺target type拒绝。
2. 同source context时间歧义拒绝。
3. 跨人纠错旧R仍原指向。
4. 服务账号映射不能造自然人。
5. 重试映射不再追加。
6. 不同namespace同值合法。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
