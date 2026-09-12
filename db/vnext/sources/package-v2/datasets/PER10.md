# PER10 — 执业服务地点关系 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-07`；后续关联 `P5-12, P5-14`。

## 来源与领域定位
原类别：关系数据。原Owner：医务部。原视图：跨院区执业。原粒度：一行一个执业注册被核验允许服务的院区或单元。
原来源：本次设计建议。原主键声明：["practice_scope_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：PracticeServiceLocation。
原验收约束：**地点范围不得超出机构许可、个人注册和院内授权；全院标志不得替代逐项核验**。

原数据模型字段 `15` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
核验个人注册可在哪些院区或业务单元服务，保留范围元组。

内部操作候选：`authorizePracticeLocation; revisePracticeScope; closePracticeLocation`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER10每条关系绑定注册和明确campus/unit，unit归属与campus一致
- allowed_scope/restriction采用受控code及evidence，不自由SQL
- 个人注册、机构运营许可和目标能力求交
- null unit表示明确campus-wide scope仅在合同显式允许时成立，空值默认未知不是全院
- 换院区必须重新确认证据
- 结束关系不撤销其他合法院区服务地

## 每个FULL profile的就绪门禁
关联所需票：P1-02、P3-01、P5-06、P5-07、P5-12、P5-14。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `practice_scope_id` 执业地点关系ID | id/R | 执业服务地点关系的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PracticeServiceLocation.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-07 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `registration_id` 执业注册ID | id/R | 执业注册ID；引用PER09.registration_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PracticeServiceLocation.registration_id`<br>TYPED_RELATION_REFERENCE | P5-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `campus_id` 服务院区ID | id/R | 服务院区ID；引用ORG02.campus_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PracticeServiceLocation.campus_id`<br>TYPED_RELATION_REFERENCE | P5-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `unit_id` 服务业务单元ID | id/C | 服务业务单元ID；引用ORG07.unit_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：执业服务关系限定到具体业务单元时必填；仅到院区须显式说明批准范围。 | `PracticeServiceLocation.unit_id`<br>TYPED_RELATION_REFERENCE | P5-07 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `allowed_scope` 允许开展的业务范围 | text/R | 执业服务地点关系记录的允许开展的业务范围；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PracticeServiceLocation.allowed_scope`<br>OWNER_VERSIONED_FACT | P5-07 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `restriction` 限制条件 | text/O | 执业服务地点关系记录的限制条件；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PracticeServiceLocation.restriction`<br>OWNER_VERSIONED_FACT | P5-07 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verification_ref` 核验或批准凭据 | text/R | 执业服务地点关系记录的核验或批准凭据；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PracticeServiceLocation.verification_ref`<br>OWNER_VERSIONED_FACT | P5-07 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-07 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-07 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-07 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-07 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-07 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-07 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-07 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-07 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-051` / `unit_id`：执业服务关系限定到具体业务单元时必填；仅到院区须显式说明批准范围。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. A院区许可不扩到B。
2. 同院区两单元可分记录。
3. 错unit-campus组合拒绝。
4. 中段license空档拒绝。
5. 核验过期返回UNKNOWN/不允许而非继续PASS。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
