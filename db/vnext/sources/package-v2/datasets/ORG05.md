# ORG05 — 组织视图定义 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P2-02`；后续关联 `P2-07`。

## 来源与领域定位
原类别：参考数据。原Owner：数据治理牵头部门。原视图：多视图。原粒度：一行一个组织视图定义版本。
原来源：本次设计建议。原主键声明：["view_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：科室主数据与多视图；建议owner：department-master；逻辑模型：HierarchyView。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `16` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
治理独立视图的完整树/森林快照，并支持批量边导入。

内部操作候选：`createHierarchyView; importHierarchyCandidate; validateForest; publishHierarchySnapshot`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG05与ORG06分离，ADMIN/OPERATION/MEDICAL_RECORD等各有owner
- 每视图单父/无环/同科室一次，跨视图允许不同结构
- GROUP局部节点不能用于任职/源部门绑定
- 导入先全图校验再原子写完整快照，不能按边逐条发布
- 冻结节点标签和引用版本，层级深度派生
- source single_parent=false不能自动放宽现行tree，要换显式graph contract或拒绝

## 每个FULL profile的就绪门禁
关联所需票：P2-01、P2-02、P2-07。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `view_id` 视图ID | id/R | 组织视图定义的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `HierarchyView.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P2-02 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `view_code` 视图代码 | text/R | 组织视图定义记录的视图代码；按本表一行粒度维护，由数据治理牵头部门确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `HierarchyView.view_code`<br>OWNER_VERSIONED_FACT | P2-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `view_name` 视图名称 | text/R | 组织视图定义记录的视图名称；按本表一行粒度维护，由数据治理牵头部门确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `HierarchyView.view_name`<br>OWNER_VERSIONED_FACT | P2-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `view_type` 视图类型 | code/R | 视图类型；取值见建议码表view_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `HierarchyView.view_type`<br>VERSIONED_CODE_BINDING | P2-02 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `single_parent` 单父级约束 | code/R | 单父级约束；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `HierarchyView.parentCardinality`<br>VIEW_POLICY | P2-02 | 目标单视图严格树/森林；源多父意图需拆方案/关系或review，不静默接受多父 |
| `purpose` 适用业务口径 | text/R | 组织视图定义记录的适用业务口径；按本表一行粒度维护，由数据治理牵头部门确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `HierarchyView.purpose`<br>OWNER_VERSIONED_FACT | P2-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `owner_org_id` 视图最终负责组织 | id/C | 视图最终负责组织；引用ORG04.org_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：视图拟正式发布时必填，明确唯一最终负责组织。 | `GovernanceResponsibility.ownerDepartmentRef`<br>GOVERNANCE_RESPONSIBILITY | P2-02 | Owner科室不等于视图根；依赖可在候选图后单独绑定 |
| `aggregation_rule` 汇总规则 | text/R | 多父级视图必须明确去重或分摊，不能重复累计<br>是：任何实际记录必填 | `HierarchyView.aggregation_rule`<br>OWNER_VERSIONED_FACT | P2-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P2-02 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P2-02 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P2-02 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P2-02 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P2-02 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P2-02 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P2-02 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P2-02 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-010` / `owner_org_id`：视图拟正式发布时必填，明确唯一最终负责组织。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 跨视图双归属允许而单视图双父拒绝。
2. 后行造成环全批不写。
3. GROUP当科室FK拒绝。
4. 同名节点区分IDs。
5. 旧snapshot更名后字节和历史显示不变。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
