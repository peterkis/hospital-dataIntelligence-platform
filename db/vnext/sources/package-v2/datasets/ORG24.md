# ORG24 — 床位资源 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P7-05`；后续关联 `P3-11, P7-06`。

## 来源与领域定位
原类别：主数据。原Owner：护理部。原视图：住院资源。原粒度：一行一个可识别床位资源版本；床位占用是交易状态。
原来源：卫宁ZY_BCDMK；科室原模板OPEN_BEDS延伸。原主键声明：["bed_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：床位资源与运营快照；建议owner：bed-resource；逻辑模型：BedResource。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `17` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把床位当稳定资源，不混床位号码、病区或患者占用交易。

内部操作候选：`createBed; moveBed; suspendBed; retireBed`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG24床号命名空间按病区/院区政策且历史可变，stableId不复用
- bed、ward、location、nursing引用分别验证
- charge_item_id仅精确收费主数据引用，未建依赖不能随填
- 床位移动新关系，不修改旧患者占用记录
- 核定容量标记来源证据而非当前占用
- 本票不导入患者住院交易

## 每个FULL profile的就绪门禁
关联所需票：P3-02、P3-06、P3-11、P7-05、P7-06。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `bed_id` 床位ID | id/R | 床位资源的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `BedResource.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P7-05 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `bed_code` 床位代码 | text/R | 床位资源记录的床位代码；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedResource.bed_code`<br>OWNER_VERSIONED_FACT | P7-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `bed_label` 显示床号 | text/R | 床位资源记录的显示床号；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedResource.bed_label`<br>OWNER_VERSIONED_FACT | P7-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `ward_id` 病区ID | id/R | 病区ID；引用ORG08.ward_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `BedResource.ward_id`<br>TYPED_RELATION_REFERENCE | P7-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `location_id` 所在房间ID | id/C | 所在房间ID；引用ORG12.location_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：实体床位投入使用时必填；非实体候床/虚拟资源须另行明确类型。 | `BedResource.location_id`<br>TYPED_RELATION_REFERENCE | P7-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `bed_type` 床位类型 | text/R | 床位资源记录的床位类型；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedResource.bed_type`<br>OWNER_VERSIONED_FACT | P7-05 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `bed_status` 床位开放状态 | code/R | 床位开放状态；取值见建议码表bed_status，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `BedResource.bed_status`<br>VERSIONED_CODE_BINDING | P7-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `charge_item_id` 床位收费项目ID | id/C | 床位收费项目ID；引用BIZ02.charge_item_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：该床位需按床位类别收费时必填，指向已批准收费项目，不直接填价格。 | `BedResource.charge_item_id`<br>TYPED_RELATION_REFERENCE | P7-05 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `is_licensed_capacity` 计入核定编制床标志 | code/R | 计入核定编制床标志；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `BedResource.is_licensed_capacity`<br>VERSIONED_CODE_BINDING | P7-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P7-05 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P7-05 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P7-05 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P7-05 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P7-05 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P7-05 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P7-05 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P7-05 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-024` / `location_id`：实体床位投入使用时必填；非实体候床/虚拟资源须另行明确类型。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-025` / `charge_item_id`：该床位需按床位类别收费时必填，指向已批准收费项目，不直接填价格。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同床号不同病区合法。
2. 一床同期间两个物理地点拒绝。
3. 床位退出不删除旧快照。
4. 患者ID额外字段拒绝。
5. 移床不等于转科医嘱。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
