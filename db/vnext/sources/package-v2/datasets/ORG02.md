# ORG02 — 院区服务节点 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P1-02`；后续关联 `P1-03, P1-04, P1-05, P1-07`。

## 来源与领域定位
原类别：主数据。原Owner：院办。原视图：空间院区。原粒度：一行一个院区或服务节点版本；本部/高新医院/成都市中心医院。
原来源：院内原表第55行；科室原模板HOSP_AREA_CODE。原主键声明：["campus_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：组织主体与院区权威；建议owner：organization-master；逻辑模型：Campus。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `17` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
以院区服务节点稳定身份表达本部、高新医院、成都市中心医院，保留真实登记待核验。

内部操作候选：`createCampus; reviseCampus; scheduleOpening; suspendCampus; getCampusAsOf`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- ORG02节点角色/名称/地址/开办日期与记录时间分开
- 与法人多对多关系留给ORG03
- 地址行政区划引用已采纳代码版本，不在线地理猜测
- 预开业日期与实际可运营状态分离
- 公众电话不混人员手机号
- 所有status映射需领域语义不得直接record_status upsert

## 每个FULL profile的就绪门禁
关联所需票：P1-02、P1-03、P1-04、P1-05、P1-07。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `campus_id` 院区ID | id/R | 院区服务节点的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `Campus.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P1-02 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `campus_code` 院区业务代码 | text/R | 院区服务节点记录的院区业务代码；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Campus.campus_code`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `campus_name` 院区名称 | text/R | 院区服务节点记录的院区名称；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `Campus.campus_name`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `node_role` 建设节点角色 | text/R | 本部、高新医院或成都市中心医院；管理称谓不决定法人关系<br>是：任何实际记录必填 | `Campus.node_role`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `campus_address` 院区地址 | text/C | 院区地址；实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。<br>条件必填：实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。 | `Campus.campus_address`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `admin_division_code` 行政区划代码 | text/C | 应绑定所用代码集版本<br>条件必填：实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。 | `Campus.admin_division_code`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `operation_status` 运营状态 | text/R | 筹建、试运行、运行、停用等由院方确认<br>是：任何实际记录必填 | `Campus.operation_status`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `opening_date` 启用日期 | date/O | 院区服务节点记录的启用日期；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Campus.opening_date`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `public_phone` 院区公开电话 | text/O | 院区服务节点记录的院区公开电话；按本表一行粒度维护，由院办确认，历史值不得直接覆盖。<br>可空：未知/不适用保持空；不以0或未知码冒充 | `Campus.public_phone`<br>OWNER_VERSIONED_FACT | P1-02 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P1-02 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P1-02 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P1-02 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P1-02 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P1-02 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P1-02 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P1-02 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P1-02 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
- `SRC-COND-005` / `campus_address`：实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。
- `SRC-COND-006` / `admin_division_code`：实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。。原声明 `DESIGN_REQUIREMENT_NOT_ALL_EXECUTABLE`；任务必须编译或设置明确人工证据门禁。

## 正/负与生命周期必测
1. 院区更名稳定ID不变。
2. 搬楼不新建法人。
3. 未来开业可计划不可当前运行。
4. 停用后不可复用ID。
5. null地址代码不是全国通配。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
