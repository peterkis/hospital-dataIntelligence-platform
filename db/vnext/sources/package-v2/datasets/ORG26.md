# ORG26 — 组织变更事件 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P2-05`；后续关联 `P2-06, P2-08, P8-04`。

## 来源与领域定位
原类别：治理记录。原Owner：组织人事部。原视图：生命周期。原粒度：一行一个组织调整事件；明细可包含多个前后继对象。
原来源：本次设计建议。原主键声明：["org_event_id"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：科室主数据与多视图；建议owner：department-master；逻辑模型：OrganizationEvolutionEvent。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `8` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `False` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
实现科室组织拆分/合并的显式演变图和可回溯事件。

内部操作候选：`proposeEvolution; validateSuccessionGraph; approveEvolution; applyEvolutionEvent`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG26和ORG27保持事件+多条承继边，不能一条successor字段覆盖多对多
- 更名同ID，真正拆分/实质合并由新目标ID形成事件
- 图引用typed target，同事件分支全原子，环/自承继/重复/未生效目标拒绝
- 业务生效T与记录R分开，共同知识时点关联前后
- 承继边不自动复制任职、账号、业务事实
- 影响清单/迁移计划与审批摘要冻结才能正式发布演变

## 每个FULL profile的就绪门禁
关联所需票：P2-05、P2-06、P2-08、P8-04。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `org_event_id` 组织变更事件ID | id/R | 组织变更事件的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P2-05 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `change_type` 事件类型 | code/R | 事件类型；取值见建议码表change_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.change_type`<br>VERSIONED_CODE_BINDING | P2-05 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `effective_at` 业务生效时间 | datetime/R | 组织变更事件记录的业务生效时间；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.effective_at`<br>EVENT_OR_SUCCESSION_FACT | P2-05 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `decision_ref` 批准文件号 | text/R | 组织变更事件记录的批准文件号；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.decision_ref`<br>EVENT_OR_SUCCESSION_FACT | P2-05 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `reason` 变更原因 | text/R | 组织变更事件记录的变更原因；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.reason`<br>EVENT_OR_SUCCESSION_FACT | P2-05 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `historical_reporting_rule` 历史报表保留或重述规则 | text/R | 组织变更事件记录的历史报表保留或重述规则；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `OrganizationEvolutionEvent.historical_reporting_rule`<br>EVENT_OR_SUCCESSION_FACT | P2-05 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `migration_plan_ref` 关联迁移方案 | text/C | 关联迁移方案；组织调整影响在途患者、账号、库存、财务或消费者映射时必填。<br>条件必填：组织调整影响在途患者、账号、库存、财务或消费者映射时必填。 | `OrganizationEvolutionEvent.migration_plan_ref`<br>EVENT_OR_SUCCESSION_FACT | P2-05 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `recorded_at` 记录时间 | datetime/R | 组织变更事件记录的记录时间；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P2-05 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-026` / `migration_plan_ref`：组织调整影响在途患者、账号、库存、财务或消费者映射时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. A拆B/C共事件新IDs。
2. A/B合C历史两个来源仍可查。
3. 中间失败无半演变。
4. 早于T仍原身份/视图。
5. 不能把合并解释为现有患者流水自动迁移。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
