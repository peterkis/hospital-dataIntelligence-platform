# P3-10 来源字段覆盖

P3-10 汇合既有公共 Owner；领域事实、来源修订、核验与审批仍由原票持有写主权。以下77字段均存在于当前生成工作台行契约，CSV/JSON/XLSX 使用同一原 Owner 接收与预检管道。字段存在不表示 FULL 或后期人员能力已实现。

| 数据集 | 原字段 | 原 Owner | 处理边界 |
|---|---|---|---|
| ORG07 | `unit_id` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `unit_code` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `unit_name` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `org_id` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `campus_id` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `legal_entity_id` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `unit_type` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `public_phone` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `service_description` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `receiving_rule_ref` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `business_owner_id` | `care-organization/unit` | CORE 只接受空值；非空 BLOCKED_DEPENDENCY，人员写主权留给 P4。 |
| ORG07 | `version_no` | `care-organization/unit` | 原来源版本；不作为数据库 head。 |
| ORG07 | `valid_from` | `care-organization/unit` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG07 | `valid_to` | `care-organization/unit` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG07 | `record_status` | `care-organization/unit` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG07 | `source_system_id` | `care-organization/unit` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG07 | `source_record_id` | `care-organization/unit` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG07 | `approval_ref` | `care-organization/unit` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG07 | `recorded_at` | `care-organization/unit` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG10 | `unit_ward_rel_id` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `unit_id` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `ward_id` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `relation_type` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `is_primary` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `sharing_rule` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `version_no` | `care-organization/unit-ward-relation` | 原来源版本；不作为数据库 head。 |
| ORG10 | `valid_from` | `care-organization/unit-ward-relation` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG10 | `valid_to` | `care-organization/unit-ward-relation` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG10 | `record_status` | `care-organization/unit-ward-relation` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG10 | `source_system_id` | `care-organization/unit-ward-relation` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG10 | `source_record_id` | `care-organization/unit-ward-relation` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG10 | `approval_ref` | `care-organization/unit-ward-relation` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG10 | `recorded_at` | `care-organization/unit-ward-relation` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG11 | `ward_nursing_rel_id` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `ward_id` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `nursing_unit_id` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `coverage_scope` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `is_primary` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `handover_rule_ref` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `version_no` | `care-organization/ward-nursing-coverage` | 原来源版本；不作为数据库 head。 |
| ORG11 | `valid_from` | `care-organization/ward-nursing-coverage` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG11 | `valid_to` | `care-organization/ward-nursing-coverage` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG11 | `record_status` | `care-organization/ward-nursing-coverage` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG11 | `source_system_id` | `care-organization/ward-nursing-coverage` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG11 | `source_record_id` | `care-organization/ward-nursing-coverage` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG11 | `approval_ref` | `care-organization/ward-nursing-coverage` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG11 | `recorded_at` | `care-organization/ward-nursing-coverage` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG13 | `object_location_rel_id` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `target_type` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `target_id` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `location_id` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `usage_type` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `is_primary` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `sharing_description` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `version_no` | `location-master/location-use` | 原来源版本；不作为数据库 head。 |
| ORG13 | `valid_from` | `location-master/location-use` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG13 | `valid_to` | `location-master/location-use` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG13 | `record_status` | `location-master/location-use` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG13 | `source_system_id` | `location-master/location-use` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG13 | `source_record_id` | `location-master/location-use` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG13 | `approval_ref` | `location-master/location-use` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG13 | `recorded_at` | `location-master/location-use` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG16 | `capability_id` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `unit_id` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `capability_type` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `care_setting` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `enabled` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `rule_ref` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `approval_dept` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `version_no` | `care-organization/unit-capability` | 原来源版本；不作为数据库 head。 |
| ORG16 | `valid_from` | `care-organization/unit-capability` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG16 | `valid_to` | `care-organization/unit-capability` | 原 Owner 解释业务期间；保留微秒及 null/空值原有语义。 |
| ORG16 | `record_status` | `care-organization/unit-capability` | 原 Owner 封闭行契约与原独立核验；规范化及写入规则沿用原票。 |
| ORG16 | `source_system_id` | `care-organization/unit-capability` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG16 | `source_record_id` | `care-organization/unit-capability` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG16 | `approval_ref` | `care-organization/unit-capability` | 原 Owner 保护的来源依据；平台审批另行记录。 |
| ORG16 | `recorded_at` | `care-organization/unit-capability` | 原 Owner 保护的来源依据；平台审批另行记录。 |

支撑 Owner：ORG08 病区、ORG09 护理单元、ORG12 地点树、ORG17 科目映射及许可；参数值、科目采纳、分区和用途字典由各自既有 Owner 维护。组织、院区、科室和运营许可沿用 P1/P2 公共接口。Q19 本票只汇合组织端 Unit—Department—Campus；PER06 留给 P4-04。

聚合问题附原 inputId、数据集、字段、物理来源行、工作表、准确期间与依赖；纠错追加原 Owner 修订。页面草稿与文件回执不构成第二个领域事实账本。
