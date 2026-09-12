# PER02 — 人员证件标识 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-02`；后续关联 `P0-11, P4-09`。

## 来源与领域定位
原类别：关系数据。原Owner：组织人事部。原视图：受限身份。原粒度：一行一个人员的一种身份证件或院外注册标识。
原来源：人员原模板CERT_TYPE/ID_CARD_NO；东华SSUSRFreeText1。原主键声明：["person_identifier_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：PersonIdentifier。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
批量登记受治理人员标识并落实明文隔离、精确匹配和全历史冲突规则。

内部操作候选：`registerPersonIdentifier; retractIdentifier; appendIdentifierAssertion`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER02证件namespace/type/issuer与secure token分开，不把source key登记成证件
- 输入既有token只能由受信issuer解析，不能拿masked_value作为全值
- 新明文仅受保护入口允许并转为safe ref，不写普通表/日志
- 同namespace/value跨Person冲突硬阻断，撤回不释放复用
- 文档有效期与关系期分别校验
- 核验需要专业证据，format/checksum只是结构正确

## 每个FULL profile的就绪门禁
关联所需票：P0-11、P4-01、P4-02、P4-09。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `person_identifier_id` 人员证件记录ID | id/R | 人员证件标识的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PersonIdentifier.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-02 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PersonIdentifier.person_id`<br>TYPED_RELATION_REFERENCE | P4-02 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `identifier_type` 证件类型代码 | text/R | 绑定证件类型代码集；非身份证也可建档<br>是：任何实际记录必填 | `PersonIdentifier.identifier_type`<br>OWNER_VERSIONED_FACT | P4-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `identifier_system` 证件发行命名空间 | text/R | 人员证件标识记录的证件发行命名空间；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PersonIdentifier.identifier_system`<br>OWNER_VERSIONED_FACT | P4-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `identifier_token` 安全库标识令牌 | text/R | 令牌定位加密保管值；共享层不放证件明文<br>是：任何实际记录必填 | `PersonIdentifier.valueToken`<br>PROTECTED_REFERENCE | P4-02 | 受信token issuer/命名空间可验证；任意上传token不自动可信 |
| `masked_value` 脱敏展示值 | text/O | 人员证件标识记录的脱敏展示值；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `IdentifierMaskedPresentation`<br>DISPLAY_ONLY | P4-02 | 只能脱敏显示与一致性核对，不能用于匹配/唯一性判断 |
| `issuer_country` 签发国家地区 | text/O | 人员证件标识记录的签发国家地区；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PersonIdentifier.issuer_country`<br>OWNER_VERSIONED_FACT | P4-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `document_valid_from` 证件有效起始日 | date/O | 人员证件标识记录的证件有效起始日；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PersonIdentifier.document_valid_from`<br>OWNER_VERSIONED_FACT | P4-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `document_valid_to` 证件有效截止日 | date/O | 人员证件标识记录的证件有效截止日；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PersonIdentifier.document_valid_to`<br>OWNER_VERSIONED_FACT | P4-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `verification_status` 证件核验状态 | code/R | 证件核验状态；取值见建议码表verification_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `PersonIdentifier.verification_status`<br>VERSIONED_CODE_BINDING | P4-02 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `evidence_ref` 核验依据引用 | text/C | 共享表只保留受控引用<br>条件必填：证件标识被确认为有效身份匹配依据时必填；不得用未经确认的号码建立同人关系。 | `PersonIdentifier.evidence_ref`<br>PROTECTED_FACT | P4-02 | 按来源privacy加强目的权限和受限存储；不落通用日志/投影。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P4-02 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P4-02 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P4-02 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P4-02 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P4-02 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P4-02 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P4-02 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-02 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-034` / `evidence_ref`：证件标识被确认为有效身份匹配依据时必填；不得用未经确认的号码建立同人关系。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 相同末四位不能视同证件。
2. 前导零保留。
3. 同request幂等。
4. 撤回后跨人复用拒绝。
5. 密钥不可用不退化明文。
6. 证书过期历史证据保留。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
