# ORG18 — 组织监管分类映射 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P7-01`；后续关联 `P8-01`。

## 来源与领域定位
原类别：关系数据。原Owner：质评部。原视图：监管病案。原粒度：一行一个对象在一种监管方案/版本/机构范围内的编码映射。
原来源：科室原模板CTLOCInsuCode/HSDeptCode。原主键声明：["regulatory_map_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：监管、核算与统计映射；建议owner：organization-reference-mapping；逻辑模型：RegulatoryMapping。
原验收约束：**医保映射由医保部确认、病案卫统由质评部确认；不同用途不共用一个编码列**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
为监管方案、版本与机构范围建立明确组织映射，不以一个监管科室码覆盖全部口径。

内部操作候选：`adoptRegulatoryScheme; mapOrganizationCode; reviseRegulatoryMapping`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG18代码体系/方案版本/地区机构/目的均是key的一部分
- 医疗机构诊疗科目与医保/病案统计分类分开
- 标准疑点引用review queue，未确认不能静默纠正
- 映射EXACT/BROADER/NARROWER/RELATED明确，不用最后更新时间择优
- 历史业务发生口径与现行重述分开
- 不同监管源无授权不能相互替代

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P7-01、P8-01。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `regulatory_map_id` 监管映射ID | id/R | 组织监管分类映射的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `RegulatoryMapping.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P7-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `target_type` 院内对象类型 | code/R | 院内对象类型；取值见建议码表target_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `RegulatoryMapping.target_type`<br>VERSIONED_CODE_BINDING | P7-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `target_id` 院内对象ID | id/R | 组织监管分类映射记录的院内对象ID；按本表一行粒度维护，由质评部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `RegulatoryMapping.target_id`<br>TYPED_RELATION_REFERENCE | P7-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `scheme_id` 监管代码集ID | id/R | 监管代码集ID；引用REF01.code_system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `RegulatoryMapping.scheme_id`<br>TYPED_RELATION_REFERENCE | P7-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `scheme_version` 代码集版本 | text/R | 组织监管分类映射记录的代码集版本；按本表一行粒度维护，由质评部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `RegulatoryMapping.scheme_version`<br>OWNER_VERSIONED_FACT | P7-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `external_code` 外部科室代码 | text/R | 组织监管分类映射记录的外部科室代码；按本表一行粒度维护，由质评部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `RegulatoryMapping.external_code`<br>OWNER_VERSIONED_FACT | P7-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `external_name` 外部科室名称 | text/R | 组织监管分类映射记录的外部科室名称；按本表一行粒度维护，由质评部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `RegulatoryMapping.external_name`<br>OWNER_VERSIONED_FACT | P7-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `legal_entity_id` 适用医疗机构ID | id/R | 适用医疗机构ID；引用ORG01.legal_entity_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `RegulatoryMapping.legal_entity_id`<br>TYPED_RELATION_REFERENCE | P7-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `mapping_relation` 语义关系 | code/R | 语义关系；取值见建议码表mapping_relation，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `RegulatoryMapping.mapping_relation`<br>VERSIONED_CODE_BINDING | P7-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `purpose` 使用目的 | text/R | 医保、病案卫统、HQMS等分行<br>是：任何实际记录必填 | `RegulatoryMapping.purpose`<br>OWNER_VERSIONED_FACT | P7-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P7-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P7-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P7-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P7-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P7-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P7-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P7-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P7-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
本数据集在 condition_rules.json 无独立条件条目；仍须逐字段执行R/C/O与本域语义约束。

## 正/负与生命周期必测
1. 同组织两方案不同码合法。
2. 同方案同scope歧义拒绝。
3. 新标准不自动升级旧mapping。
4. 无地区依据不能照搬外院码。
5. 导入错codeSystem被拒。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
