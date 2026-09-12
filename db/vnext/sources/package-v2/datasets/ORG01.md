# ORG01 — 医疗机构主体 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P1-01`；后续关联 `P1-04, P1-05, P1-07`。

## 来源与领域定位
原类别：主数据。原Owner：院办。原视图：法人合规。原粒度：一行一个依法或业务登记的机构主体版本；不是一个院区。
原来源：院内原表第96行扩展；WS/T846.3；FHIR Organization。原主键声明：["legal_entity_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：组织主体与院区权威；建议owner：organization-master；逻辑模型：OrganizationSubject。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把医院运营/登记主体建成独立版本化对象，不从三个院区名称推导法人。

内部操作候选：`createOrganization; reviseOrganization; addLicense; verifyRegistration`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG01的主体名称/性质与证照分开版本化，院区不是子法人默认值
- 组织stableId由DB签发，证照号和名称不作为身份
- 证照有效期/登记机构/原证据由院办核验
- 支持筹建资料在候选区但缺许可不得获得运营结论
- 公开地址和许可附件分别限权
- 新领域Owner包含创建/证照修订/当前和历史读取

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P1-04、P1-05、P1-07。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `legal_entity_id` 医疗机构主体ID | id/R | 医疗机构主体的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `OrganizationSubject.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P1-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `legal_name` 法定或登记名称 | text/R | 医疗机构主体记录的法定或登记名称；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSubject.legal_name`<br>OWNER_VERSIONED_FACT | P1-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `entity_nature` 主体性质 | text/R | 按登记证照确认；不得由院区名称推断<br>是：任何实际记录必填 | `OrganizationSubject.entity_nature`<br>OWNER_VERSIONED_FACT | P1-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `unified_credit_code` 统一社会信用代码 | text/C | 法人主体依法有该证时填；不自动假设三个节点三法人<br>条件必填：主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。 | `OrganizationIdentifier.unifiedCreditCode`<br>IDENTIFIER | P1-01 | 依法登记证据核验；按命名空间判断冲突，不以名称替代 |
| `institution_code` 医疗机构登记代码 | text/C | 登记证照或官方目录核实<br>条件必填：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。 | `OrganizationIdentifier.institutionCode`<br>IDENTIFIER | P1-01 | 与统一社会信用代码/许可证分开 |
| `license_number` 医疗机构执业许可证号 | text/C | 医疗机构执业许可证号；作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。<br>条件必填：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。 | `InstitutionLicense.secureNumberReference`<br>LICENSE | P1-01 | 证照独立关系与期间，禁止以许可证号当stableId |
| `authority` 登记主管机关 | text/O | 医疗机构主体记录的登记主管机关；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `OrganizationSubject.authority`<br>OWNER_VERSIONED_FACT | P1-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `legal_address` 登记地址 | text/O | 医疗机构主体记录的登记地址；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `OrganizationSubject.legal_address`<br>OWNER_VERSIONED_FACT | P1-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `license_valid_from` 许可证生效日期 | date/C | 许可证生效日期；作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。<br>条件必填：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。 | `InstitutionLicense.validFrom`<br>LICENSE_TIME | P1-01 | 许可期间不是主体身份期间 |
| `license_valid_to` 许可证失效日期 | date/O | 医疗机构主体记录的许可证失效日期；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `InstitutionLicense.validTo`<br>LICENSE_TIME | P1-01 | 许可过期不删除主体历史 |
| `registration_evidence` 登记材料引用 | text/R | 医疗机构主体记录的登记材料引用；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationSubject.registration_evidence`<br>OWNER_VERSIONED_FACT | P1-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P1-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P1-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P1-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P1-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P1-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P1-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P1-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P1-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-001` / `unified_credit_code`：主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-002` / `institution_code`：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-003` / `license_number`：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-004` / `license_valid_from`：作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同名两个合法主体不自动合并。
2. 同证照冲突隔离。
3. 未来许可证不能覆盖过去运营。
4. 三院区一个主体合成案例成立。
5. 无来源证据不得发布持证状态。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
