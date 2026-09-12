# PER01 — 人员主体 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-01`；后续关联 `P4-09, P4-12, P4-10`。

## 来源与领域定位
原类别：主数据。原Owner：组织人事部。原视图：身份主索引。原粒度：一行一个自然人主体版本；跨院区、返聘、兼岗均不重复建人。
原来源：原表第66行；人员原模板STAFF_INDEX_NO/STAFF_NAME；FHIR Practitioner。原主键声明：["person_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：Person。
原验收约束：**实名主体唯一；同名不合并、跨院区不复制；工号/手机号/身份证都不能直接当全局主键**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
将PER01人员身份导入唯一Person Owner，扩展姓名/人口学事实但不回退人员宽表。

内部操作候选：`registerPerson; correctPersonFacts; importPerson; verifyPersonIdentity`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- person_id文件值只作source alias，person_no进入受治理业务标识
- legal_name/display_name/birthDate等按字段契约映射，性别国籍引用采纳码表
- person_status只表身份治理语义，不能映射为在职/停用账号
- 来源证据与身份核验状态保留，证件号不得作为主键
- 姓名生日手机相同仅候选事项
- 所有P4数据默认合成，真实数据必须过受限存储和Owner制度门禁

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P4-02、P4-09、P4-10、P4-12。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `person_id` 人员稳定ID | id/R | 人员主体的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Person.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_no` 院级人员识别号 | text/R | 人员主体记录的院级人员识别号；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PersonIdentifier.personNumber`<br>IDENTIFIER | P4-02 | Person主体id不等于院级业务人员编号 |
| `legal_name` 法定或登记姓名 | text/R | 人员主体记录的法定或登记姓名；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Person.legal_name`<br>PROTECTED_FACT | P4-01 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `display_name` 业务展示姓名 | text/O | 人员主体记录的业务展示姓名；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Person.display_name`<br>PROTECTED_FACT | P4-01 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `gender_code` 性别代码 | text/C | 必要业务使用时填；绑定所用标准版本<br>条件必填：相关实名核验、执业或必要业务要求使用性别时填；非必要消费视图不下发。 | `PersonDemographicVersion.gender`<br>DEMOGRAPHIC_VERSION | P4-01 | 原字段需Owner明确gender/生理性别用途，不凭证件推导 |
| `birth_date` 出生日期 | date/O | 不得对无身份证人员强行推算；存储目的需明确<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Person.birth_date`<br>PROTECTED_FACT | P4-01 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `nationality_code` 国籍或地区代码 | text/O | 使用合法适用版本；不从姓名推断<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Person.nationality_code`<br>PROTECTED_FACT | P4-01 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `identity_verification_status` 身份核验状态 | code/R | 身份核验状态；取值见建议码表verification_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Person.identity_verification_status`<br>VERSIONED_CODE_BINDING | P4-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `identity_evidence_ref` 核验凭据引用 | text/C | 不在共享主表放身份证扫描件<br>条件必填：身份核验状态为已核验时必填；共享表只保留安全引用。 | `Person.identity_evidence_ref`<br>PROTECTED_FACT | P4-01 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `person_status` 人员主体状态 | text/R | 有效、身份待核实、合并重定向等；不等同在岗或账号状态<br>是：任何实际记录必填 | `PersonIdentityState`<br>IDENTITY_STATE | P4-01 | 仅自然人身份治理；就业/停岗/账号状态各自独立 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-032` / `gender_code`：相关实名核验、执业或必要业务要求使用性别时填；非必要消费视图不下发。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-033` / `identity_evidence_ref`：身份核验状态为已核验时必填；共享表只保留安全引用。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同名两人不自动合并。
2. 跨院区同Person不重复建人。
3. 离职/返聘不变Person ID。
4. 出生日期不能凭身份证号推导。
5. 未知性别不填默认男。
6. 所有源字段有路由或阻断理由。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
