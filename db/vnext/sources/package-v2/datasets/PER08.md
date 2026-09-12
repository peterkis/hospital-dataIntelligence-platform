# PER08 — 资质证书 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-05`；后续关联 `P5-14`。

## 来源与领域定位
原类别：关系数据。原Owner：医务部。原视图：资格核验。原粒度：一行一个人员的一本资格或培训证书及核验版本。
原来源：厂商资格证号；人员原模板PRO_TECH_QUAL_LEVEL/NAME部分。原主键声明：["qualification_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：Credential。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `21` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
实现证书与核验证据的独立生命周期，包括过期、撤销和更正。

内部操作候选：`registerCredential; verifyCredential; revokeCredential; correctCredentialEvidence`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER08证书编号只受保护引用，附件受恶意文件检查
- 签发日期/有效期/核验日期/记录日期四义分开
- 不同证书类别有不同专业审核归口，信息科不能凭格式判真
- 资格可能无到期但必须explicit null语义，不填9999
- 核验人必须真实权限且不自动等于上传人
- 撤销影响未来资格评估但不改过去业务

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P5-05、P5-14。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `qualification_id` 资质证书ID | id/R | 资质证书的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Credential.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-05 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Credential.person_id`<br>TYPED_RELATION_REFERENCE | P5-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `certificate_kind` 证书类别 | code/R | 证书类别；取值见建议码表certificate_kind，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Credential.certificate_kind`<br>VERSIONED_CODE_BINDING | P5-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `certificate_name` 证书名称 | text/R | 资质证书记录的证书名称；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Credential.certificate_name`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `certificate_no_secure_ref` 证书编号安全引用 | text/R | 资质证书记录的证书编号安全引用；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Credential.certificate_no_secure_ref`<br>PROTECTED_FACT | P5-05 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `qualification_code` 资质专业或等级代码 | text/C | 资质专业或等级代码；证书采用标准专业/类别/等级编码或被准入规则引用时必填。<br>条件必填：证书采用标准专业/类别/等级编码或被准入规则引用时必填。 | `Credential.qualification_code`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `issuer` 签发机构 | text/C | 签发机构；资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。<br>条件必填：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。 | `Credential.issuer`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `issued_on` 签发日期 | date/O | 资质证书记录的签发日期；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Credential.issued_on`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `certificate_expires_on` 证书截止日 | date/O | 资质证书记录的证书截止日；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Credential.certificate_expires_on`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verification_status` 核验状态 | code/R | 核验状态；取值见建议码表verification_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Credential.verification_status`<br>VERSIONED_CODE_BINDING | P5-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `verified_on` 核验日期 | date/C | 核验日期；资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。<br>条件必填：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。 | `Credential.verified_on`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verified_by` 核验责任岗位 | text/C | 核验责任岗位；资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。<br>条件必填：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。 | `Credential.verified_by`<br>OWNER_VERSIONED_FACT | P5-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `evidence_ref` 资质证明引用 | text/C | 资质证明引用；资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。<br>条件必填：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。 | `Credential.evidence_ref`<br>PROTECTED_FACT | P5-05 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-05 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-05 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-05 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-05 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-05 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-05 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-05 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-05 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-044` / `qualification_code`：证书采用标准专业/类别/等级编码或被准入规则引用时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-045` / `issuer`：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-046` / `evidence_ref`：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-047` / `verified_on`：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-048` / `verified_by`：资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 证号checksum正确仍可未核验。
2. 失效证书不支持新资格。
3. 同份证书重复导入幂等。
4. 错owner核验拒绝。
5. 更正新增version。
6. 下载证书需独立敏感权限。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
