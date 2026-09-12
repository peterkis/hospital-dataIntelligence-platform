# ORG07 — 院区业务单元 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P3-01`；后续关联 `P3-10, P3-11, P5-02`。

## 来源与领域定位
原类别：主数据。原Owner：医务部。原视图：临床运营。原粒度：一行一个院区实际办理业务的服务单元版本。
原来源：科室模板院区/电话/描述；东华03科室病区。原主键声明：["unit_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：业务单元、病区护理与服务能力；建议owner：care-organization；逻辑模型：CampusBusinessUnit。
原验收约束：**单元与逻辑组织、院区和运营主体均有效；同名跨院区单元分别编码；不等同病区**。

原数据模型字段 `19` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
为一个逻辑科室在不同院区的实际运作建立独立业务单元。

内部操作候选：`createUnit; reviseUnit; bindUnitToDepartmentCampus; closeUnit`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG07的org/campus/legal三个anchor精确typed，按有效窗口与运营关系一致
- 业务负责人属于独立责任关系，不塞Person到科室版本
- 缺负责人先保留candidate，不能临时造人
- 各院区单元可独立电话/服务描述/收治规则
- 一个单元同一时间唯一可解释所属逻辑科室和院区
- 名称中院区字样不成为关系依据

## 每个FULL profile的就绪门禁
关联所需票：P1-01、P1-02、P2-01、P3-01、P3-10、P3-11、P4-01、P5-02。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `unit_id` 业务单元ID | id/R | 院区业务单元的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `CampusBusinessUnit.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P3-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `unit_code` 业务单元代码 | text/R | 院区业务单元记录的业务单元代码；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CampusBusinessUnit.unit_code`<br>OWNER_VERSIONED_FACT | P3-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `unit_name` 业务单元名称 | text/R | 院区业务单元记录的业务单元名称；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CampusBusinessUnit.unit_name`<br>OWNER_VERSIONED_FACT | P3-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `org_id` 所属逻辑科室ID | id/R | 所属逻辑科室ID；引用ORG04.org_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `CampusBusinessUnit.org_id`<br>TYPED_RELATION_REFERENCE | P3-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `campus_id` 服务院区ID | id/R | 服务院区ID；引用ORG02.campus_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `CampusBusinessUnit.campus_id`<br>TYPED_RELATION_REFERENCE | P3-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `legal_entity_id` 业务运营主体ID | id/R | 业务运营主体ID；引用ORG01.legal_entity_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `CampusBusinessUnit.legal_entity_id`<br>TYPED_RELATION_REFERENCE | P3-01 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `unit_type` 业务单元类型 | code/R | 业务单元类型；取值见建议码表unit_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `CampusBusinessUnit.unit_type`<br>VERSIONED_CODE_BINDING | P3-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `public_phone` 服务电话 | text/O | 院区业务单元记录的服务电话；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `CampusBusinessUnit.public_phone`<br>OWNER_VERSIONED_FACT | P3-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `service_description` 服务范围说明 | text/O | 院区业务单元记录的服务范围说明；按本表一行粒度维护，由医务部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `CampusBusinessUnit.service_description`<br>OWNER_VERSIONED_FACT | P3-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `receiving_rule_ref` 接收患者规则引用 | text/C | 年龄性别和就诊限制进入版本化规则，不用自由文本执行<br>条件必填：存在年龄、性别、病种、门急住或其他收治限制时必填；无特殊限制需经业务确认。 | `CampusBusinessUnit.receiving_rule_ref`<br>OWNER_VERSIONED_FACT | P3-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `business_owner_id` 业务负责人ID | id/C | 业务负责人ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：院区业务单元启用前必填；指向有效人员，不填写自由文本姓名作为关联。 | `OrganizationResponsibility.personRef`<br>RESPONSIBILITY_RELATION | P5-02 | 负责人独立版本关系；P3核心profile不可偷偷吞掉该字段 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P3-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P3-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P3-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P3-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P3-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P3-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P3-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P3-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-012` / `receiving_rule_ref`：存在年龄、性别、病种、门急住或其他收治限制时必填；无特殊限制需经业务确认。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-013` / `business_owner_id`：院区业务单元启用前必填；指向有效人员，不填写自由文本姓名作为关联。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 同科室A/B两院区单元成功。
2. unit引用不同campus证照拒绝。
3. 负责人未知不丢字段。
4. 移动单元不改逻辑科室ID。
5. 未来campus开业不允许提前临床可用。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
