# P1-05 原字段采纳追踪

主责任字段新增 0；本票负责将原 ORG01 19、ORG02 17、ORG03 15 字段送至既有权威。每个原值均留在受保护 XLSX 和有工作表/物理行/列/来源类型的解析结果；下表为其解释后去向。清单和字段矛盾时阻断，不覆盖源值。

## ORG01（19）

| 字段 | 解释后去向与检查 |
|---|---|
| legal_entity_id | job/revision/ORG01 别名，source.alias；不指定新平台 ID |
| version_no | source.versionNo；正整数，不作为平台序号 |
| legal_name | 主体资料 legalName；原类型/长度及必填 |
| entity_nature | 主体资料 entityNature |
| authority | 主体资料 authority；独立证照机关由清单明确 |
| legal_address | 主体资料 legalAddress |
| unified_credit_code | UNIFIED_CREDIT_CODE 标识；清单明确 namespace，登记核验的适用声明 |
| institution_code | INSTITUTION_CODE 标识；清单明确 namespace，持证登记规则 |
| license_number | 受保护证照号码；独立许可身份与归属冲突规则 |
| license_valid_from | 证照起点；原 date 契约，医院本地零点 |
| license_valid_to | 排他结束；date 为当日零点，空值必须有明确期限语义 |
| registration_evidence | 可解析、授权、完整期间的受控登记材料；独立核验 |
| valid_from | 主体资料半开期间起点；明确 +08:00 或医院本地时间 |
| valid_to | 主体资料半开期间结束；空为无界 |
| record_status | 正式来源意图；非 PUBLISHED 阻断，不替代平台审批 |
| source_system_id | source.systemId；清单固定其准确 versionId |
| source_record_id | 受保护 source.recordLocator，不进入普通响应 |
| recorded_at | source.recordedAt；保留源值，不回填平台记录时间 |
| approval_ref | source.approvalRef；正式意图必须有来源审批，仍需平台审批 |

## ORG02（17）

| 字段 | 解释后去向与检查 |
|---|---|
| campus_id | job/revision/ORG02 别名、source.alias |
| campus_code | campusCode；永久代码归属，不做大小写/前导零修复 |
| campus_name | campusName；更名保留 typed 目标身份 |
| node_role | nodeRole；显式有限角色 |
| campus_address | campusAddress；物理院区运行时受既有准入检查 |
| admin_division_code | 必须与清单准确 Division.code 一致；代码集版本准入 |
| operation_status | sourceOperationStatus；创建仅 PLANNING，修订不能暗中启停 |
| opening_date | openingDate；实际启用日期，不能由计划推导 |
| public_phone | publicPhone；公开属性由独立资料核验确认 |
| version_no | source.versionNo；不覆盖平台整体 head |
| valid_from | 资料半开期间起点 |
| valid_to | 资料半开期间结束，空为无界 |
| record_status | 正式来源意图门禁 |
| source_system_id | 准确来源系统与清单 sourceVersionId |
| source_record_id | 受保护来源定位 |
| approval_ref | 来源审批证据；不能替代整包审批 |
| recorded_at | 来源时间；平台时间由数据库产生 |

## ORG03（15）

| 字段 | 解释后去向与检查 |
|---|---|
| legal_campus_rel_id | job/revision/ORG03 别名、source.alias |
| legal_entity_id | 必须与明确 JOB_ALIAS 或 PLATFORM_REF 文本一致；不猜测 UUID |
| campus_id | 同上，准确 ORG02 端点；修订不得换端点 |
| relation_type | relationTypeText 原文与清单显式 role；OTHER 阻断 |
| license_scope | licenseScopeText 原文；结构化服务与准确范围依据来自清单 |
| is_primary_operator | 既有已采纳 Y/N；院区完整期间 primary 唯一性 |
| evidence_ref | 受控关系证据，解析、授权及期间检查 |
| version_no | source.versionNo；数据库签发关系序号 |
| valid_from | 关系半开期间起点 |
| valid_to | 关系半开期间结束，空为无界 |
| record_status | 正式来源意图门禁，不采纳关闭/启停动作 |
| source_system_id | 准确来源系统与版本 |
| source_record_id | 受保护来源定位 |
| recorded_at | 来源时间原值及明确转换；不替代平台认知时间 |
| approval_ref | 来源审批证据；独立平台审批仍必须 |

## 条件规则及后票边界

SRC-COND-001–004 由标识适用声明、准确证照期间、登记资料及独立核验共同承担；文本存在不代表证照真实。SRC-COND-005/006 复用物理院区地址及已采纳区划准入；本票创建不启用。SRC-COND-007 复用逐服务的准确证照范围覆盖和独立签审。

P1-06 维护页面、P1-07 批量生命周期均不因文件适配可用而就绪。冻结源字段定义、源规则原文和 FULL 草案保持不变。真实证照/区划/服务标准仍待院方确认；本票合成材料不构成真实医疗许可结论。
