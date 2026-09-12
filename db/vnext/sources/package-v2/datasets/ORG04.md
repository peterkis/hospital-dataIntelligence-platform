# ORG04 — 逻辑科室组织 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P2-01`；后续关联 `P2-05, P2-08`。

## 来源与领域定位
原类别：主数据。原Owner：组织人事部。原视图：行政临床。原粒度：一行一个稳定的组织实体版本；跨院区逻辑科室不按地点重复造人造科。
原来源：院内原表第54行；科室原模板DEPT_INDEX_NO/DEPT_CODE/DEPT_NAME。原主键声明：["org_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：科室主数据与多视图；建议owner：department-master；逻辑模型：Department。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
把ORG04转换为Department Owner命令并完成维护视图，而非宽表复制。

内部操作候选：`createDepartment; reviseDepartment; validateORG04; importDepartment`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- org_id用源别名/精确引用，org_code与名称作为受治理标识/语义
- is_virtual不得自动转成GROUP或临床科室，声明不清转人工判别
- 一逻辑科室跨多院区保持同ID，地点联系迁至独立关系
- 新建、更名、暂停/恢复/废止区分语义命令
- 可以替换旧Department V1接口，当前UI/SDK同步
- 对所有ORG04字段做明确路由不能silent drop

## 每个FULL profile的就绪门禁
关联所需票：P2-01、P2-05、P2-08。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `org_id` 组织稳定ID | id/R | 逻辑科室组织的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Department.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P2-01 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `org_code` 院级科室代码 | text/R | 逻辑科室组织记录的院级科室代码；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Department.org_code`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `org_name` 组织正式名称 | text/R | 逻辑科室组织记录的组织正式名称；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Department.org_name`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `org_short_name` 组织简称 | text/O | 逻辑科室组织记录的组织简称；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Department.org_short_name`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `org_type` 组织类别 | code/R | 组织类别；取值见建议码表org_type，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `Department.org_type`<br>VERSIONED_CODE_BINDING | P2-01 | 建议枚举需采纳版本；错误码/未批准码阻断；显示标签不当key。 |
| `established_on` 成立日期 | date/C | 成立日期；新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。<br>条件必填：新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。 | `Department.established_on`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `abolished_on` 撤销日期 | date/O | 逻辑科室组织记录的撤销日期；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Department.abolished_on`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `establishment_doc` 成立或调整文件 | text/C | 成立或调整文件；新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。<br>条件必填：新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。 | `Department.establishment_doc`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `description` 组织职责说明 | text/O | 逻辑科室组织记录的组织职责说明；按本表一行粒度维护，由组织人事部确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Department.description`<br>OWNER_VERSIONED_FACT | P2-01 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `is_virtual` 虚拟管理组织标志 | code/R | 虚拟管理组织标志；取值见建议码表yes_no，采用前需院方确认；不可用显示名称替代代码。<br>是：任何实际记录必填 | `DepartmentIdentityDisposition.virtualMeaning`<br>SEMANTIC_REVIEW | P2-01 | 需判别真实受治理虚拟科室或视图分组；不能自动将group转Department |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P2-01 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P2-01 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P2-01 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P2-01 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P2-01 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P2-01 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P2-01 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P2-01 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-008` / `established_on`：新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-009` / `establishment_doc`：新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 多院区同科室不重复创建。
2. 同名不同科室必须由证据分开。
3. 通用parent/campus负责人字段不能混入core。
4. 未知virtual含义阻断发布。
5. 更名历史名称冻结。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
