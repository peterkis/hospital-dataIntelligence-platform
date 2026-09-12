# ORG22 — 源系统组织映射 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P2-03`；后续关联 `P2-05, P8-04`。

## 来源与领域定位
原类别：关系数据。原Owner：信息管理部。原视图：系统互操作。原粒度：一行一个源系统编码在明确上下文和有效期内指向院级对象。
原来源：旧HIS科室编码；所有厂商导入列。原主键声明：["org_map_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：科室主数据与多视图；建议owner：department-master；逻辑模型：OrganizationSourceMapping。
原验收约束：**上线范围内可用编码100%可解析；一对多必须有可执行上下文规则**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
按来源系统、实体类型、上下文、有效期治理组织旧码，不做名称猜测。

内部操作候选：`registerOrganizationMapping; correctOrganizationMapping; retractOrganizationMapping`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG22 typed target包含机构/院区/科室/单元等已实现owner
- 缺adapter的目标类型只staging不应用
- 同源码不同上下文可明确并存，歧义不能优先级择一
- 错误指向通过新版本+expectedHead+reason纠正，旧R仍是旧指向
- 源key真实复用须增加incarnation/已批准source上下文，不能偷当普通纠错
- 审批与解析source namespace精确匹配

## 每个FULL profile的就绪门禁
关联所需票：P2-03、P2-05、P8-04。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `org_map_id` 组织映射ID | id/R | 源系统组织映射的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `OrganizationSourceMapping.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P2-03 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `from_system_id` 源系统ID | id/R | 源系统ID；引用GOV01.system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `OrganizationSourceMapping.from_system_id`<br>TYPED_RELATION_REFERENCE | P2-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `source_entity_type` 源表对象类型 | text/R | 源系统组织映射记录的源表对象类型；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSourceMapping.source_entity_type`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `source_code` 源科室或单元编码 | text/R | 源系统组织映射记录的源科室或单元编码；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSourceMapping.source_code`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `source_name` 源名称 | text/O | 源系统组织映射记录的源名称；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `OrganizationSourceMapping.source_name`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `source_context` 源院区账套等上下文 | text/R | 无上下文明确填DEFAULT，不把空当通配符<br>是：任何实际记录必填 | `OrganizationSourceMapping.source_context`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `target_type` 目标对象类型 | code/R | 目标对象类型；取值见建议码表target_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `OrganizationSourceMapping.target_type`<br>VERSIONED_CODE_BINDING | P2-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `target_id` 目标对象ID | id/R | 源系统组织映射记录的目标对象ID；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSourceMapping.target_id`<br>TYPED_RELATION_REFERENCE | P2-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `mapping_relation` 映射关系 | code/R | 映射关系；取值见建议码表mapping_relation，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `OrganizationSourceMapping.mapping_relation`<br>VERSIONED_CODE_BINDING | P2-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `resolution_rule` 一对多裁决规则 | text/C | 拆分后必须按日期院区业务等确定；不可随机选一个<br>条件必填：源代码在相同有效期下对应多个目标或存在拆分时必填，并可由上下文唯一裁决。 | `OrganizationSourceMapping.resolution_rule`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verified_by` 映射核验岗位 | text/R | 源系统组织映射记录的映射核验岗位；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSourceMapping.verified_by`<br>OWNER_VERSIONED_FACT | P2-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P2-03 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P2-03 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P2-03 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P2-03 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P2-03 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P2-03 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P2-03 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P2-03 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-023` / `resolution_rule`：源代码在相同有效期下对应多个目标或存在拆分时必填，并可由上下文唯一裁决。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同码不同源允许。
2. 同namespace/context/time两目标拒绝。
3. 更正保持旧版本。
4. 无权限跨院区绑定拒绝。
5. re-register不能悄悄重指向。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
