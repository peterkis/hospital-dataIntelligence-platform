# PER20 — 电子签名证书绑定 实施规格

**性质：源定义保留＋目标逻辑设计建议；不是当前已存在的表/API。** 主票 `P6-04`；后续关联 `P6-06`。

## 来源与领域定位
原类别：安全配置。原Owner：信息管理部。原视图：电子签名。原粒度：一行一个实名账号绑定证书的有效关系；不收集私钥。
原来源：东华SSUSRIgnoreCALogon仅作为风险项，不继承绕过设置。原主键声明：["sign_binding_id", "version_no"]；创建时源主键值作为alias，不指定新平台UUID。
目标主题：数字身份与访问控制；建议owner：identity-access；逻辑模型：SignatureCertificateBinding。
原验收约束：**必填齐全；主键唯一；关联可解析；有效期无冲突；业务负责人签审**。

原数据模型字段 `18` 个全部见下表，不省略“通用治理字段”。原字段属性完整副本在 `inputs/dataset-v2/models.ORG-PER.json`。原lifecycle标记 `True` 只描述源模板，不强制事件/快照套通用状态机。

## 实现要求
绑定实名账号与证书身份，验证有效期和撤销状态，不收集私钥。

内部操作候选：`bindCertificate; verifyCertificateState; revokeBinding; renewByNewBinding`。调用名称可重构；字段/状态/Owner语义不可静默消失。

- PER20 person/account实名核验、序列/issuer/指纹相符
- notBefore/notAfter是证书事实，record时间独立
- revocation observation有来源和freshness，离线未知不能当GOOD
- 不得导入p12私钥、密码或将证书文件当自动签署能力
- 到期更新新binding，旧签署验证引用旧证书
- 本票仿真CA/状态回执，真实证书接入另授权

## 每个FULL profile的就绪门禁
关联所需票：P4-01、P6-01、P6-04、P6-06。这是最终FULL验收依赖，不要求跨phase创建循环任务；核心能力可以独立profile逐步就绪。
若引用尚未实现，应BLOCKED_DEPENDENCY，保留源输入，不发假ID、不置空丢字段。任何CORE profile与本FULL profile必须有单独明确contractId/field list，不将同一份FULL文件降级处理。

## 字段级实施映射
| 源字段 | 类型/必填 | 源定义/条件 | 目标逻辑位置 | 负责票 | 转换/保护 |
|---|---|---|---|---|---|
| `sign_binding_id` 签名绑定ID | id/R | 电子签名证书绑定的永久稳定记录/对象标识；不可由名称、工号或院区拼接决定，不复用停用标识。<br>是：任何实际记录必填 | `SignatureCertificateBinding.sourceClientKey`<br>SOURCE_CREATE_ALIAS | P6-04 | CREATE中为源alias；平台stableId由DB生成。UPDATE需单独已授权platformRef+expectedVersion，不能伪造新ID。 |
| `account_id` 实名账号ID | id/R | 实名账号ID；引用PER17.account_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `SignatureCertificateBinding.account_id`<br>TYPED_RELATION_REFERENCE | P6-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `person_id` 人员ID | id/R | 人员ID；引用PER01.person_id的稳定标识；跨表关联须使用相同业务时点下的有效记录。<br>是：任何实际记录必填 | `SignatureCertificateBinding.person_id`<br>TYPED_RELATION_REFERENCE | P6-04 | 按精确dataset/type/namespace解析，验证owner/scope/full interval；未ready目标不能忽略或按名猜测。 |
| `certificate_serial` 证书序列号 | text/R | 电子签名证书绑定记录的证书序列号；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.serial`<br>CERTIFICATE_REFERENCE | P6-04 | 证书身份可核验；禁止私钥或密码内容 |
| `certificate_issuer` 签发机构 | text/R | 电子签名证书绑定记录的签发机构；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.certificate_issuer`<br>OWNER_VERSIONED_FACT | P6-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `certificate_fingerprint` 公钥证书指纹 | text/R | 电子签名证书绑定记录的公钥证书指纹；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.certificate_fingerprint`<br>OWNER_VERSIONED_FACT | P6-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `cert_not_before` 证书起始时间 | datetime/R | 电子签名证书绑定记录的证书起始时间；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.cert_not_before`<br>OWNER_VERSIONED_FACT | P6-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `cert_not_after` 证书截止时间 | datetime/R | 电子签名证书绑定记录的证书截止时间；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.cert_not_after`<br>OWNER_VERSIONED_FACT | P6-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `revocation_status` 吊销状态 | text/R | 电子签名证书绑定记录的吊销状态；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `CertificateRevocationObservation.status`<br>VERIFICATION_OBSERVATION | P6-04 | 带核验来源时间和freshness；未知/过时不能当GOOD |
| `verification_time` 状态核验时间 | datetime/R | 电子签名证书绑定记录的状态核验时间；按本表一行粒度维护，由信息管理部确认，历史值不得直接覆盖。<br>是：任何实际记录必填 | `SignatureCertificateBinding.verification_time`<br>OWNER_VERSIONED_FACT | P6-04 | 明确字段纳入owner的版本化内容/关系；不反向形成通用宽表或绕过审批。 |
| `version_no` 版本号 | integer/R | 稳定ID内部递增；不是新对象ID<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceVersion`<br>SOURCE_VERSION_EVIDENCE | P6-04 | 源修订号仅保存来源，不覆盖DB目标versionNo |
| `valid_from` 业务生效时间 | datetime/R | 左闭右开区间起点；ISO 8601并含时区<br>是：任何实际记录必填 | `businessValidFrom`<br>BUSINESS_TIME | P6-04 | 原始offset保留；仅按已发布contract显式+08:00→local；DB主时间无offset |
| `valid_to` 业务失效时间 | datetime/O | 空表示未设结束；不得早于生效时间<br>可空：未知/不适用保持空；不以0或未知码冒充 | `businessValidTo`<br>BUSINESS_TIME | P6-04 | null=无界，必须大于from，整区间检验，不用任意大日期 |
| `record_status` 记录状态 | code/R | 草稿与正式有效记录分离<br>是：任何实际记录必填 | `ImportIntent.sourceRecordStatus`<br>LIFECYCLE_INTENT | P6-04 | 源草稿/正式等映射显式owner命令；不得直接改变审批/业务状态 |
| `source_system_id` 权威来源系统ID | id/R | 来源为人工整理时登记来源系统MDM_MANUAL<br>是：任何实际记录必填 | `SourceSystemReference`<br>SOURCE_NAMESPACE | P6-04 | 精确GOV01源系统注册；MANUAL也要登记，非账号system身份默认映射 |
| `source_record_id` 来源记录定位 | text/R | 原表主键或文件加工作表加行号；不得填个人证件原文<br>是：任何实际记录必填 | `ImportSourceEvidence.recordLocator`<br>SOURCE_RECORD_EVIDENCE | P6-04 | 仅定位，不作为Person标识；日志/审计不写原敏感值 |
| `approval_ref` 审批证据号 | text/C | 发布时必填；引用受控签审记录不粘贴敏感附件<br>条件必填：发布时必填；引用受控签审记录不粘贴敏感附件 | `SourceEvidence.approvalReference`<br>APPROVAL_EVIDENCE | P6-04 | 源审批证据不等于本平台已授权；需owner核验及本次审批digest |
| `recorded_at` 系统记录时间 | datetime/R | 实际录入或纠错时间；不得冒充业务生效时间<br>是：任何实际记录必填 | `ImportSourceEvidence.sourceRecordedAt`<br>SOURCE_RECORDED_TIME | P6-04 | 保存来源记录时间；目标recordedFrom由DB实际生成，不能回填伪知识 |


## 条件规则
本数据集在 condition_rules.json 无独立条件条目；仍须逐字段执行R/C/O与本域语义约束。

## 正/负与生命周期必测
1. wrong person certificate拒绝。
2. 过期/吊销/状态过旧返回不满足或UNKNOWN。
3. 证书更换不覆盖旧绑定。
4. 私钥上传明确拒绝。
5. service账号不能伪自然人签名。

另外：原始文件不变、明确转换后的digest、全批错误原子回滚、同请求结果重放、更新期待版本、当前权限、旧B/R历史、跨院区scope、UI/批导入同校验分别记证。事件/快照使用本类型更正命令，不做普通对象DELETE复用。

## UI、API与发布
至少提供该owner列表、候选输入/修改、期间/来源/证据、问题定位、版本/历史、该类型合法生命周期动作；导入统一走P0工作台。P8决定最小消费投影字段，受限字段不自动下发HIS。前端不能直接SQL或伪造成功。

## 本票产物
领域契约/owner/DDL（如需）、发布版本化导入adapter、可维护UI/API、真实数据库/浏览器证据、该source-schema和contract从DRAFT到受控状态的采纳记录。

初始：IMPLEMENTATION=NOT_STARTED；VALIDATION=NOT_RUN；SOURCE_POLICY_APPROVAL=PENDING。模板的源标准引用不等于已经核验。
