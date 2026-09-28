# P2-01 Department 导入契约

实施基线96d84cec，前驱迁移0082。科室唯一Owner在department-master内接入当前vNext，不迁旧数据库或旧消费框架。

## 已批准的边界

ORG04_CORE_V1保留全部18源字段，支持CREATE/REVISE、新设/历史存量登记及同ID更名。org_id是作业内源别名；目标ID由数据库生成；修订使用department-master typed引用和expectedVersion。org_code首次归属永久固定，改码交P2-04。负责人、parent、campus不进入core。来源版本与平台版本、来源recorded_at与真实平台R严格分开。

院区管家可提交其明确授权范围输入，全院科室Owner独立审批。底层身份阻止自审。历史存量缺成立日期/文件可以独立核验例外；绑定准确输入与证据、保留空值及理由，新设不适用。virtual必须人工判别；视图分组不生成科室。真实院方政策未采纳，合成政策不等于业务批准。

原件受保护保存，输入revision绑定契约/政策；一revision最多100命令，共享Apply协调器一根事务落科室事实、审计、结果；失败不留半批事实。同请求恢复同结果且重查权限。FULL未就绪不降级CORE。API提供候选、核验、审批、应用、列表、详情、历史差异与只读typed引用；维护UI留P2-07。

版本采用追加事实和版本优先的有效区间覆盖：修订期间替代先前事实的对应区间，旧行不修改；B/R查询只使用当时已记录版本。引用覆盖检查完整窗口，不以点查代替。院区上下文不参与科室稳定身份；实际科室院区关系归P2-08，Q07完整业务单元验证归P3-01。

## 验证

公共Owner、真实HTTP与数据库角色为批准seams。专项AC01-05，加原子失败、重放、撤权、自审、期待版本、来源政策、例外核验、时间边界及SQL绕过。fresh/0082升级保留/codegen/受影响回归/持久HTTP分别记证；UI和正式验收不冒称已运行。最终验证与审阅结果在交接索引记录。

## ORG04字段路由

原始18字段全部保留在加密输入中；以下是进入正式事实前的具体职责。

| 源字段 | 路由与限制 |
| --- | --- |
| org_id | revision内源别名，不作数据库稳定ID；每批不可重复 |
| org_code | 科室稳定代码；首次归属固定，修订不能改码 |
| org_name | DepartmentVersion名称，更名追加版本 |
| org_short_name | 版本简称，空串表达未提供 |
| org_type | 已采纳契约的代码集准入，版本事实保存原值 |
| established_on | 成立日期；历史缺值须独立核验，新设不得例外 |
| abolished_on | 保留源值；填写即阻断，本票不执行废止 |
| establishment_doc | 受保护源文件引用说明；缺值例外与成立日期同规则 |
| description | 版本描述，不解释为负责人、地点或层级 |
| is_virtual | 必须核验为DEPARTMENT；UNKNOWN/VIEW_GROUP阻断 |
| version_no | sourceVersion，严格正整数字符串，不替代平台版本序号 |
| valid_from | 源业务有效起点，映射B起点 |
| valid_to | 源业务有效终点，映射B的半开区间，空表示开放 |
| record_status | 只接受ACTIVE正式输入；其他生命周期语义阻断 |
| source_system_id | 治理目录来源精确引用，检查完整业务区间证据 |
| source_record_id | 受保护来源记录标识，与原件、行坐标保留 |
| approval_ref | 源审批说明须存在，不能替代当前平台独立审批 |
| recorded_at | sourceRecordedAt，不能替代数据库真实R |

文件使用STRICT_DEPARTMENT_V1，ORG04单工作表、18个精确字段，时间明确为+08:00；人工输入可显式选择LOCAL。解析错误进入共享验证记录，保留原件和物理行坐标。审批候选包含原命令、核验理由和摘要；平台版本及核验各用显式序号排序，UUID只作身份。

## 2026-09-28交接边界

代码与owned临时库验证独立于持久库。现有持久库0079摘要与main@96d84cec不同且缺0080–0082，正常wrapper因LINEAGE_MISMATCH拒绝启动；用户指定由P1-07任务修复，本票不改历史迁移或账本。修复交接后须重新核对前驱及0083编号，再执行持久部署、正式角色/权限与签名权威配置及HTTP冒烟；不得直接把测试fixture用于真实业务授权。

fresh与0082升级测试采用receipt拥有的临时库、临时角色并核对清理凭据。合成政策/证据只证明机制；真实院方采纳、完整Q07/A013集成、维护UI与持久HTTP均未据此标为PASS。详细命令、退出码、复审树与日志索引位于ignored的`.runtime/vnext/p2-01-handoff.md`。
