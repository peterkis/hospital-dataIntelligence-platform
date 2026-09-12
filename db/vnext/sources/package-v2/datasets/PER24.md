# PER24 — 人员状态变更事件 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P4-06`；后续关联 `P4-12, P6-06, P5-14`。

## 来源与领域定位
原类别：治理记录。原Owner：组织人事部。原视图：生命周期。原粒度：一行一个入职、调动、离院、返聘、合并身份等事件。
原来源：本次设计建议。原主键声明：["person_event_id"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：人员身份、任用与任职；建议owner：person-master；逻辑模型：PersonnelGovernanceEvent。
原验收约束：**离院必须触发并核验任职终止、处方权撤销、账号撤权、证书处理；历史签名不可删除**。

原数据模型字段 `10` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `False` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把PER24变更事件路由到正确关系Owner和影响处理，而不是设置Person一个状态。

内部操作候选：`registerPersonnelEvent; planPersonnelChange; applyAuthorizedChange; reconcileEvent`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- 入职/调动/离院/返聘/身份纠错分别映射Engagement/Assignment/identity命令
- affected_assignments明确typed refs，解析逗号列表须保留原元组/范围不猜
- 离开某一E不关闭另一个合法E
- event在审批前不能自动产生新Person
- 撤权工单与consumer已回执状态分开，access_verified_at由实际回执生成
- 主数据事实、依赖复核、授权停用和远端确认逐步记录

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P4-03、P4-06、P4-12、P5-14、P6-06。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `person_event_id` 人员变更事件ID | id/R | 人员状态变更事件的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `PersonnelGovernanceEvent.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P4-06 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `PersonnelGovernanceEvent.person_id`<br>TYPED_RELATION_REFERENCE | P4-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `event_type` 事件类型 | text/R | 入职/任职变更/离院/返聘/身份纠错/合并；不可混同账号锁定<br>是：任何实际记录必填 | `PersonnelGovernanceEvent.event_type`<br>EVENT_OR_SUCCESSION_FACT | P4-06 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `employment_id` 关联聘用关系 | id/C | 关联聘用关系；引用PER04.employment_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>条件必填：事件针对某一聘用关系的入职、离职、返聘或调动时必填。 | `PersonnelGovernanceEvent.employment_id`<br>TYPED_RELATION_REFERENCE | P4-06 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `effective_at` 业务生效时间 | datetime/R | 人员状态变更事件记录的业务生效时间；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PersonnelGovernanceEvent.effective_at`<br>EVENT_OR_SUCCESSION_FACT | P4-06 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `decision_ref` 批准依据 | text/R | 人员状态变更事件记录的批准依据；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `PersonnelGovernanceEvent.decision_ref`<br>EVENT_OR_SUCCESSION_FACT | P4-06 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `affected_assignments` 受影响任职范围说明 | text/C | 受影响任职范围说明；事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。<br>条件必填：事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。 | `PersonnelEvent.affectedAssignmentRefs`<br>IMPACT_REFERENCE_SET | P4-06 | 解析为typed refs并检查完整范围，不猜UUID/不复制权限 |
| `access_revocation_ticket` 撤权执行工单号 | text/C | 撤权执行工单号；离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。<br>条件必填：离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。 | `PersonnelGovernanceEvent.access_revocation_ticket`<br>EVENT_OR_SUCCESSION_FACT | P4-06 | 变更/承继是明确事实，不等于立即执行全部受影响业务。 |
| `access_verified_at` 撤权验证完成时间 | datetime/C | 撤权验证完成时间；离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。<br>条件必填：离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。 | `DeprovisionCase.actualVerifiedAt`<br>RECEIPT_DERIVED | P6-06 | 仅实际完整消费者回执得出；源时间仅证据不能预填完成 |
| `recorded_at` 事件记录时间 | datetime/R | 人员状态变更事件记录的事件记录时间；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P4-06 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-073` / `employment_id`：事件针对某一聘用关系的入职、离职、返聘或调动时必填。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-074` / `affected_assignments`：事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-075` / `access_revocation_ticket`：离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-076` / `access_verified_at`：离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 一个E终止另一个E仍有效。
2. 离院事件未approval不执行。
3. 重复事件exact outcome重放。
4. 账号撤权未ack状态pending非完成。
5. 调动不直接UPDATE科室字段。
6. 合并事件必须走P4-12。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
