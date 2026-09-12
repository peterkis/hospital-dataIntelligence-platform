# ORG20 — 科室核算分配关系 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P7-03`；后续关联 `P8-04`。

## 来源与领域定位
原类别：关系数据。原Owner：财务部。原视图：财务核算。原粒度：一行一个对象按一种分配口径映射到一个核算单元的关系。
原来源：本次设计建议。原主键声明：["allocation_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：监管、核算与统计映射；建议owner：organization-reference-mapping；逻辑模型：CostAllocation。
原验收约束：**同对象+口径+组+有效期固定权重之和为1；不同口径禁止相加**。

原数据模型字段 `17` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
治理科室/业务对象对核算单元的分配口径与时间权重。

内部操作候选：`createAllocationGroup; validateAllocationWindow; publishAllocation; closeAllocation`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG20按source object+ledger+allocation basis+business interval分组
- 固定分摊每个时间分段Decimal和=1，不能全表求平均
- 动态规则仅冻结受限规则引用，不以任意文本执行
- 范围/成本单元适用期匹配
- 新增或调整整组原子提交防暂时不等1
- 已结算历史重述需要独立决策/报表版本

## 每个FULL profile的就绪门禁
关联所需票：P7-02、P7-03、P8-04。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `allocation_id` 核算分配关系ID | id/R | 科室核算分配关系的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `CostAllocation.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P7-03 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `target_type` 业务对象类型 | code/R | 业务对象类型；取值见建议码表target_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `CostAllocation.target_type`<br>VERSIONED_CODE_BINDING | P7-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `target_id` 业务对象ID | id/R | 科室核算分配关系记录的业务对象ID；按本表一行粒度维护，由财务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CostAllocation.target_id`<br>TYPED_RELATION_REFERENCE | P7-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `cost_center_id` 核算单元ID | id/R | 核算单元ID；引用ORG19.cost_center_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `CostAllocation.cost_center_id`<br>TYPED_RELATION_REFERENCE | P7-03 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `allocation_basis` 分配口径 | code/R | 分配口径；取值见建议码表allocation_basis，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `CostAllocation.allocation_basis`<br>VERSIONED_CODE_BINDING | P7-03 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `allocation_group` 同一分配方案组号 | text/R | 科室核算分配关系记录的同一分配方案组号；按本表一行粒度维护，由财务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CostAllocation.allocation_group`<br>OWNER_VERSIONED_FACT | P7-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `weight` 权重比例 | decimal/C | 固定分摊时取0至1；动态分摊填rule_ref不臆造权重<br>条件必填：分配方式为固定比例时必填，0≤weight≤1；同口径同期间同分配组之和为1。 | `AllocationWeight.value`<br>DECIMAL_ALLOCATION | P7-03 | DECIMAL，按同组每个业务分段sum=1，不以float或整表平均 |
| `rule_ref` 分配规则编号 | text/C | 分配规则编号；分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。<br>条件必填：分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。 | `CostAllocation.rule_ref`<br>OWNER_VERSIONED_FACT | P7-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `ledger_code` 账套标识 | text/R | 科室核算分配关系记录的账套标识；按本表一行粒度维护，由财务部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CostAllocation.ledger_code`<br>OWNER_VERSIONED_FACT | P7-03 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P7-03 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P7-03 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P7-03 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P7-03 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P7-03 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P7-03 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P7-03 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P7-03 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-021` / `weight`：分配方式为固定比例时必填，0≤weight≤1；同口径同期间同分配组之和为1。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-022` / `rule_ref`：分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 0.3+0.7精确通过。
2. 微秒中段sum不1拒绝。
3. 成本与收入不同口径不混算。
4. 并发两次调整无sum竞态。
5. dynamic+fixed规则未声明拒绝。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
