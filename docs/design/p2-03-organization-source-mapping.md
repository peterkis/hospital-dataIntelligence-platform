# P2-03 组织源映射

基线7f1eff27b60f222fc1b0e5d4188537e14ff68fb7。ORG22由department-master维护独立关系，机构/院区/科室仍由原Owner维护。仅合成研发，真实政策与正式验收未获批准。

## 已批准规则

一个revision最多100条命令，全单元原子，不沿用ORG04逐行应用。19字段完整保留；CORE只有LEGAL/CAMPUS/ORG、EXACT可应用。未实现目标、非等价关系及FULL输入保留原件和候选，阻断正式写入。

沿用协调器512KiB完整候选保护值和普通HTTP 300000字节限制；文件入口最多1MiB原件，使用单ORG22工作表XLSX与STRICT_ORGANIZATION_MAPPING_V1。超过任一保护值明确拒绝，不自动分块。时间只接受Asia/Shanghai无offset本地字符串；原件不变，来源R不成为平台R。

| ORG22字段 | 真实职责 |
| --- | --- |
| org_map_id | revision内源alias，非平台ID |
| from_system_id | 固定来源命名空间，精确GOV01来源引用 |
| source_entity_type | 固定源实体类型，不按名称推导 |
| source_code | 固定文本编码，保留前导零 |
| source_name | 不可变版本来源名称，不作为匹配键 |
| source_context | 固定精确上下文，DEFAULT不通配 |
| target_type | 已采纳代码与固定Owner判别 |
| target_id | 已实现Owner的稳定ID，冻结准确覆盖片段 |
| mapping_relation | CORE仅EXACT应用，其他保留并阻断 |
| resolution_rule | 保存说明；存在同期多目标时须独立核验，执行维度仍是精确上下文和期间 |
| verified_by | 原始核验岗位声明，受保护保存；平台核验人另记 |
| version_no | sourceVersion，平台版本由DB排序 |
| valid_from | 半开业务期间起点 |
| valid_to | 排他终点，空变为null无界 |
| record_status | 源意图，ACTIVE准入；显式命令执行撤回/更正 |
| source_system_id | 本条维护输入的权威来源，独立于from_system_id检查 |
| source_record_id | 受保护定位，不进入普通facts/audit/error |
| approval_ref | 受保护源审批声明，不能替代当前平台批准 |
| recorded_at | sourceRecordedAt，平台R由数据库生成 |

来源身份为from_system_id+source_entity_type+source_code+source_context；DEFAULT是精确值，不是通配。source_system_id为本条维护输入的权威来源，与被映射编码来源独立。上下文不推导权限；授权绑定精确来源/实体/上下文/院区元组，目标还需要明确目标引用授权和Owner读取许可。

REGISTER不能upsert。CORRECT以稳定映射ID、expectedHead、理由追加完整替代版本，来源身份不改。RETRACT撤回整条断言，禁止复活；源键真实复用只能另行批准新的上下文及证据。源名称、来源核验岗位和源审批号不构成平台权限。

给定R先选最新完整版本，再判断B是否在其半开区间；新版结束或撤回后不得回退旧开放版本。旧R保留原指向。版本前驱和平台R不可覆盖；source recorded_at只作证据。

信息管理部映射Owner独立审批；maker-checker按真实底层身份分离。审批冻结完整输入、精确契约、来源/上下文、目标版本片段、映射head及证据。普通更正执行完整准入；纯期间收缩和撤回只要求当前授权、head、理由及独立批准，不依赖已失效上游。

关闭、候选敏感读取和已提交结果恢复仍检查当前源引用权限、目标元组授权及目标Owner读取权限；这些权限检查不重新评估已接受目标的当前业务覆盖。Apply在同一事务重新检查执行人与原批准人，撤权不能借关闭或重放绕过。

## 接线与接口

复用公共目录、受保护原件、作业、验证、审批和Apply协调器；复用现有department写授权密钥，不新增密钥truth。跨Owner通过公开事务内port读取，源/目标变更和本票命令共用901002锁。

公开Owner提供stage/receiveFile/validate/verify/plan/readApplyCandidate/approveApplyUnit/applyUnit/resumeOutcome/list/read/resolve/history/diff。命令动作REGISTER/CORRECT/RETRACT映射为协调器封闭职责，不直接暴露SQL。HTTP位于/api/vnext/organization-mappings，当前生成客户端同步。

解析返回RESOLVED/NOT_FOUND及准确映射版本；来源身份唯一性约束拒绝歧义，不优先级择一。历史断言与当前依赖复核分开。解析不赋予临床或运营许可。复杂条件、源系统connector、UI、拆并事件、下游发布不在本票。

当前唯一来源身份约束保证可接受事实不会形成多个匹配；解析无命中返回NOT_FOUND，命中返回RESOLVED，不执行优先级选择。版本输出标HISTORICAL_ASSERTION/currentReview=NOT_EVALUATED，明确没有以读取历史顶替当前准入复核。

## 证据与收尾

公共Owner、真实HTTP、实际服务角色为已批准测试seams。fresh、111源码前缀和109现场持久前缀升级、codegen、当前类型/模块边界和受影响回归逐项记证。持久研发库仅沿receipt做前向升级并核对前驱保留；UI/重启/正式验收不冒领PASS。最终commit/tree和命令索引写ignored handoff，本地完成后停止。
