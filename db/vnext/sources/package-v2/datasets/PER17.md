# PER17 — 系统账号 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P6-01`；后续关联 `P6-06, P6-07`。

## 来源与领域定位
原类别：安全配置。原Owner：信息管理部。原视图：身份访问。原粒度：一行一个身份提供方/应用中的账号；服务账号不能伪装自然人。
原来源：东华06用户医护人员；卫宁操作员czryk。原主键声明：["account_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：数字身份与访问控制；建议owner：identity-access；逻辑模型：Account。
原验收约束：**账号与自然人分开；禁共享医师实名账号；非实名号别进入服务资源配置而非人员表**。

原数据模型字段 `20` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
建立自然人与系统账号的显式核验绑定，服务账号只记录责任人而不伪装个人。

内部操作候选：`registerAccount; verifyPersonBinding; suspendAccount; unlinkByDecision`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER17的system/subject联合身份，login_name可改而subject stable
- HUMAN账号person binding需来源核验，SERVICE账号personId空且responsible person不代表账号身份
- 同人多账号合法，不自动造Person
- 默认unit不作为全范围权限
- 不导入密码/口令/私钥，只记录既有认证策略引用
- 与现有security_principal统一接入但不强制等于Person ID

## 每个FULL profile的就绪门禁
关联所需票：P3-01、P4-01、P6-01、P6-06、P6-07。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `account_id` 账号稳定ID | id/R | 系统账号的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Account.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P6-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `system_id` 应用系统ID | id/R | 应用系统ID；引用GOV01.system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `Account.system_id`<br>TYPED_RELATION_REFERENCE | P6-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `account_subject` 认证主体标识sub | text/R | 系统账号记录的认证主体标识sub；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Account.account_subject`<br>OWNER_VERSIONED_FACT | P6-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `login_name` 登录名 | text/R | 系统账号记录的登录名；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Account.login_name`<br>OWNER_VERSIONED_FACT | P6-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `account_kind` 账号类型 | code/R | 账号类型；取值见建议码表account_kind，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Account.account_kind`<br>VERSIONED_CODE_BINDING | P6-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `person_id` 实名关联人员ID | id/C | HUMAN账号必填；服务账号此项可空<br>条件必填：账号类型为HUMAN时必填；服务账号不得绑定虚构员工。 | `Account.person_id`<br>TYPED_RELATION_REFERENCE | P6-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `responsible_person_id` 账号责任人ID | id/R | 账号责任人ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `AccountResponsibility.personRef`<br>ACCOUNT_RESPONSIBILITY | P6-01 | 服务账号负责人不是自然人登录身份绑定 |
| `account_status` 账号状态 | code/R | 账号状态；取值见建议码表account_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Account.account_status`<br>VERSIONED_CODE_BINDING | P6-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `default_unit_id` 默认登录单元 | id/C | 默认登录单元；引用ORG07.unit_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：应用需要默认登录单元时必填；默认值不等于完整授权范围。 | `Account.default_unit_id`<br>TYPED_RELATION_REFERENCE | P6-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `authentication_policy_ref` 认证策略引用 | text/R | 不保存密码、私钥、MFA密钥或恢复码<br>是：任何实际记录必填 | `Account.authentication_policy_ref`<br>OWNER_VERSIONED_FACT | P6-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `must_change_initial_secret` 初次登录改密标志 | code/R | 初次登录改密标志；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `AuthenticationPolicy.requireFirstUseChange`<br>AUTH_POLICY_METADATA | P6-01 | 不传递初始口令或私钥；不声称本字段已实现第三方认证 |
| `disabled_at` 停用时间 | datetime/O | 系统账号记录的停用时间；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Account.disabled_at`<br>OWNER_VERSIONED_FACT | P6-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P6-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P6-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P6-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P6-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P6-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P6-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P6-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P6-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-061` / `person_id`：账号类型为HUMAN时必填；服务账号不得绑定虚构员工。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-062` / `default_unit_id`：应用需要默认登录单元时必填；默认值不等于完整授权范围。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 服务账号含person binding拒绝。
2. 人名/邮箱匹配不能自动绑定。
3. system不同同login合法。
4. 撤销绑定不删除历史审计。
5. 账号暂时停用不删除Person。
6. unknown scope不得wildcard。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
