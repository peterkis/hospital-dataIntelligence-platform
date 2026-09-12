# PER05 — 岗位目录 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P5-01`；后续关联 `P5-02, P6-05`。

## 来源与领域定位
原类别：参考数据。原Owner：组织人事部。原视图：岗位编制。原粒度：一行一种岗位定义；岗位不是账号菜单角色。
原来源：人员原模板EMPLOYED_POST_LEVEL/EMPLOYED_POST_NAME；卫宁gzgw。原主键声明：["position_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：岗位角色、专业资质与医疗组；建议owner：person-role-credential；逻辑模型：PositionDefinition。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `17` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
建立岗位目录，区分岗位定义、专业技术资格和账号角色。

内部操作候选：`createPosition; revisePosition; retirePosition; importPosition`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER05岗位分类/等级/专业类别以采纳码表定义，资格要求是受控引用，不存任意可执行脚本
- 岗位定义不代表某人已经聘任
- 临床行政分类只是职责类别，不自动授予处方/操作权
- 退役定义阻止新聘用但保留旧任命证据
- P4导入中暂挂position引用此时才能完整解析
- 模板与UI明确字段来源

## 每个FULL profile的就绪门禁
关联所需票：P5-01、P5-02、P6-05。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `position_id` 岗位ID | id/R | 岗位目录的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PositionDefinition.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P5-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `position_code` 岗位代码 | text/R | 岗位目录记录的岗位代码；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PositionDefinition.position_code`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `position_name` 岗位名称 | text/R | 岗位目录记录的岗位名称；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PositionDefinition.position_name`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `position_category` 岗位类别 | text/R | 专业技术、管理、工勤等院方批准分类<br>是：任何实际记录必填 | `PositionDefinition.position_category`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `position_level` 岗位等级 | text/C | 岗位等级；岗位采用分级管理/聘任等级时必填；非分级岗位可空。<br>条件必填：岗位采用分级管理/聘任等级时必填；非分级岗位可空。 | `PositionDefinition.position_level`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `profession_type` 岗位专业类别 | code/O | 岗位专业类别；取值见建议码表profession_type，采用前需院方确认；不可用显示名称替代代码。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `PositionDefinition.profession_type`<br>VERSIONED_CODE_BINDING | P5-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `clinical_admin_class` 临床行政类别 | text/C | 由人事与业务部门确认的岗位临床/行政分类，不推导系统权限<br>条件必填：岗位参与临床/行政分类报表或厂商岗位映射时必填；分类不自动授予系统权限。 | `PositionDefinition.clinical_admin_class`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `qualification_requirement` 任职资格要求 | text/C | 任职资格要求；岗位设置了任职资质、职称或培训准入要求时必填。<br>条件必填：岗位设置了任职资质、职称或培训准入要求时必填。 | `PositionDefinition.qualification_requirement`<br>OWNER_VERSIONED_FACT | P5-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `is_clinical` 临床岗位标志 | code/R | 临床岗位标志；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `PositionDefinition.is_clinical`<br>VERSIONED_CODE_BINDING | P5-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P5-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P5-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P5-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P5-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P5-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P5-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P5-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P5-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-036` / `position_level`：岗位采用分级管理/聘任等级时必填；非分级岗位可空。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-037` / `clinical_admin_class`：岗位参与临床/行政分类报表或厂商岗位映射时必填；分类不自动授予系统权限。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-038` / `qualification_requirement`：岗位设置了任职资质、职称或培训准入要求时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 岗位菜单角色混用拒绝。
2. 退休岗位已有历史任命仍可读。
3. 未核验资格要求不可自动计算PASS。
4. 同岗位不同期新版不覆盖。
5. 源字典代码前导零不丢。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
