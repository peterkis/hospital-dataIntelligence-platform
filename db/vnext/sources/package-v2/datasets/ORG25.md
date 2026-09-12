# ORG25 — 床位口径快照 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P7-06`；后续关联 `P8-04`。

## 来源与领域定位
原类别：业务快照。原Owner：运营部。原视图：统计运营。原粒度：一行一个统计对象在某日的某种床位口径值；非稳定科室属性。
原来源：科室原模板OPEN_BEDS。原主键声明：["bed_snapshot_id"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：床位资源与运营快照；建议owner：bed-resource；逻辑模型：BedMetricSnapshot。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `9` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `False` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
建立每日/时点床位口径快照，区分核定、开放、可用、占用。

内部操作候选：`captureBedSnapshot; validateBedCounts; restateSnapshot; compareSnapshots`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG25不是普通bitemporal master row，snapshot date/asof与record时间明确
- 每种count定义版本和calculation rule冻结
- 比较口径前声明同粒度/同时间基准，不强制未知临时加床容量不等式
- 动态占用由外部事实源快照，不存到Department
- 更正新增snapshot revision不覆盖当日报表
- Decimal整数界限和负数检查

## 每个FULL profile的就绪门禁
关联所需票：P7-06、P8-04。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `bed_snapshot_id` 床位快照ID | id/R | 床位口径快照的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `BedMetricSnapshot.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P7-06 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `target_type` 统计对象类型 | code/R | 统计对象类型；取值见建议码表target_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `BedMetricSnapshot.target_type`<br>VERSIONED_CODE_BINDING | P7-06 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `target_id` 统计对象ID | id/R | 床位口径快照记录的统计对象ID；按本表一行粒度维护，由运营部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedMetricSnapshot.target_id`<br>TYPED_RELATION_REFERENCE | P7-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `as_of_date` 统计日期 | date/R | 床位口径快照记录的统计日期；按本表一行粒度维护，由运营部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedMetricSnapshot.as_of_date`<br>SNAPSHOT_FACT | P7-06 | 口径snapshot事实，来源时点与record时点分开；修正新revision。 |
| `bed_count_type` 床位口径 | text/R | 编制床、开放床、实际可用床、占用床分别填<br>是：任何实际记录必填 | `BedMetricSnapshot.bed_count_type`<br>SNAPSHOT_FACT | P7-06 | 口径snapshot事实，来源时点与record时点分开；修正新revision。 |
| `bed_count` 床位数 | integer/R | 床位口径快照记录的床位数；按本表一行粒度维护，由运营部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedMetricSnapshot.bed_count`<br>SNAPSHOT_FACT | P7-06 | 口径snapshot事实，来源时点与record时点分开；修正新revision。 |
| `calculation_rule` 计算规则或依据 | text/R | 床位口径快照记录的计算规则或依据；按本表一行粒度维护，由运营部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `BedMetricSnapshot.calculation_rule`<br>SNAPSHOT_FACT | P7-06 | 口径snapshot事实，来源时点与record时点分开；修正新revision。 |
| `source_system_id` 来源系统ID | id/R | 来源系统ID；引用GOV01.system_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P7-06 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `recorded_at` 记录时间 | datetime/R | 床位口径快照记录的记录时间；按本表一行粒度维护，由运营部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P7-06 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
本数据集在 condition_rules.json 无独立条件条目；仍须逐字段执行R/C/O与本域语义约束。

## 正/负与生命周期必测
1. 同日两种口径分别保存。
2. 错误负数拒绝。
3. 占用>开放在未批准口径下形成review而非擅自裁剪。
4. 晚报更正旧R保留。
5. 快照无权被当资源身份引用。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
