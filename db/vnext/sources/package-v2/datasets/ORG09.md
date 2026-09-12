# ORG09 — 护理单元 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P3-03`；后续关联 `P3-05, P3-11`。

## 来源与领域定位
原类别：主数据。原Owner：护理部。原视图：护理管理。原粒度：一行一个护理管理和排班单元版本；不等同物理护士站。
原来源：院内原表第59/65行。原主键声明：["nursing_unit_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：业务单元、病区护理与服务能力；建议owner：care-organization；逻辑模型：NursingUnit。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `15` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
建立护理管理单元身份及院区归属，保留护理与收治维度独立。

内部操作候选：`createNursingUnit; reviseNursingUnit; suspendNursingUnit; importNursingUnit`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG09护理管理组织不是物理护士站
- 管理科室/院区和care level独立引用
- 护理负责人由ORG15职责关系承担
- 历史排班事实不导入此主数据
- 跨病区覆盖通过ORG11
- 名称相似不自动绑定病区

## 每个FULL profile的就绪门禁
关联所需票：P1-02、P2-01、P3-03、P3-05、P3-11。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `nursing_unit_id` 护理单元ID | id/R | 护理单元的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `NursingUnit.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P3-03 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `nursing_code` 护理单元代码 | text/R | 护理单元记录的护理单元代码；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `NursingUnit.nursing_code`<br>OWNER_VERSIONED_FACT | P3-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `nursing_name` 护理单元名称 | text/R | 护理单元记录的护理单元名称；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `NursingUnit.nursing_name`<br>OWNER_VERSIONED_FACT | P3-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `campus_id` 院区ID | id/R | 院区ID；引用ORG02.campus_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `NursingUnit.campus_id`<br>TYPED_RELATION_REFERENCE | P3-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `managing_org_id` 护理管理组织ID | id/R | 护理管理组织ID；引用ORG04.org_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `NursingUnit.managing_org_id`<br>TYPED_RELATION_REFERENCE | P3-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `care_level` 护理服务级别说明 | text/O | 护理单元记录的护理服务级别说明；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `NursingUnit.care_level`<br>OWNER_VERSIONED_FACT | P3-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `office_phone` 办公电话 | text/O | 护理单元记录的办公电话；按本表一行粒度维护，由护理部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `NursingUnit.office_phone`<br>OWNER_VERSIONED_FACT | P3-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P3-03 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P3-03 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P3-03 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P3-03 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P3-03 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P3-03 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P3-03 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P3-03 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
本数据集在 condition_rules.json 无独立条件条目；仍须逐字段执行R/C/O与本域语义约束。

## 正/负与生命周期必测
1. 一个护理单元覆盖多个病区可配置。
2. 护士站房间ID输入拒绝。
3. 重复稳定ID版本拒绝。
4. 停用产生下游覆盖影响。
5. 院区不一致的关系不发布。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
