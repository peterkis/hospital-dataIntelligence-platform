# P1-01 机构主体与证照

基线 main `c7cfe7c58319af258e5b005835e74bcba5d198b7`。本票包含真实 Owner、HTTP API、前向 SQL 和持久研发库接线；结果以 ignored handoff 中的最终候选及命令为准。

## 调用与权限

`/api/vnext/organizations/inputs` 保存 closed typed command 的加密完整输入，关联已存在的材料 job/revision。`plan → review → approve → apply` 使用既有 Apply 协调器。`resume` 在当前 READ 权限下恢复原结果，不依赖旧材料或密钥；撤销输入走 `withdraw`，不会假造反向回滚。

命令包括 CREATE、REVISE、ADD_LICENSE、REVISE_LICENSE、VERIFY_REGISTRATION、REVOKE_LICENSE。前三类资料和未知期限证照可以成为候选；冻结正式命令还要求明确源正式意图和审批来源，持证核验要求准确登记代码、证照、有效期和实际材料。CREATE 不接受平台 ID。修改使用目标与 expected version；失败候选以新输入修正，原输入、审批及已提交历史不覆盖。

READ 与 READ_RESTRICTED 分离。query 读取主体当前/准确版本/B/R 历史，HISTORY 支持 afterVersion 分页；history-details 读取证照和核验历史，diff 比较主体版本，restricted-input 才返回号码、alias、来源定位和原始日期值。登记附件仍归 Protected Artifact Owner，核验经有限来源材料 port 授权与认证解密，候选摘要绑定其内容 HMAC。普通日志不记录输入或低熵普通 SHA。

证照日期结束为当日零点，精确时刻保持微秒。VERIFIED_UNBOUNDED 与 UNKNOWN 独立；后者不能产生持证事实。修订的高序号断言在其业务区间覆盖旧断言，旧记录时点仍可复现。证照/主体变更后旧签审不自动复用，重新核验再产生新资格事实。资格返回 LICENSED_REGISTRATION 或 NOT_ESTABLISHED；operatingPermission 固定 NOT_EVALUABLE。

## 19 字段责任

| ORG01 来源字段 | 本票落点 |
| --- | --- |
| legal_entity_id | 加密 source.alias；DB 签发平台 subject.id |
| legal_name | version.legal_name |
| entity_nature | version.entity_nature |
| unified_credit_code | identifier UNIFIED_CREDIT_CODE；原值在受保护输入 |
| institution_code | identifier INSTITUTION_CODE；当前主体版本固定标识集合 |
| license_number | 受保护 license.number；分域 HMAC 冲突索引 |
| authority | version.authority；证照另有核验 authority |
| legal_address | version.legal_address；需对象 READ |
| license_valid_from | license_version.valid_from；原精度保留 |
| license_valid_to | license_version.valid_to + end_kind；日期/时刻显式转换 |
| registration_evidence | version.registration_evidence；真实受控材料 UUID |
| version_no | 加密 source.versionNo；不覆盖 DB number |
| valid_from | version.valid_from，半开区间 |
| valid_to | version.valid_to，null 无界 |
| record_status | 加密 source.recordStatus；DRAFT 不发布正式命令 |
| source_system_id | 加密 source.systemId + 精确 versionId，公共 SOURCE 权威 |
| source_record_id | 加密 source.recordLocator |
| approval_ref | 加密 source.approvalRef；独立于平台候选审批 |
| recorded_at | 加密 source.recordedAt；平台时间由 DB 生成 |

SRC-COND-001 由明确 HELD/NOT_APPLICABLE 核验声明及材料绑定实现；HELD 强制统一社会信用代码。SRC-COND-002/003/004 在持证核验时强制当前登记代码、准确证照版本及有效起点；不从机构名字推断。所有号码命名空间显式提供，按精确值检查归属，不进行未经批准的清洗合并。

CORE 契约为代码内 ORG01-MANUAL-CORE-V1，19 字段映射完整；材料 transport job 的 CORE 契约不等于此领域契约。ORG01-FULL、源标准的院方正式采纳、ORG01 文件适配仍未就绪。非空未实现关系字段被 closed command 拒绝，不能被静默删除或按 CORE 执行。

## 验证及停止线

入口：`vnext:p1-01:unit`、`vnext:p1-01:typecheck`；数据库通过 `prototype:db:with -- vnext:p1-01:validate`，`--upgrade` 验证 0053 前缀，`--generate` 仅在 owned 临时库生成类型。部署通过 `prototype:db:with -- vnext:p1-01:deploy`，持久库身份、旧控制面保留、真实 HTTP 结果写 ignored evidence。后续 `vnext:workbench:persistent` 在同一 loopback 运行入口挂载 Owner。

AC01 同名独立及改名历史；AC02 冲突候选隔离；AC03 未来证照/完整窗口；AC04 三具名合成节点读取同一实际主体（不建立院区表）；AC05 无真实材料不能发布。另测 current permissions、原录入 identity、自审、输入重复执行、并发、ACK 恢复、审计异常回滚、密文损坏与直写拒绝。

Q06/A011 仅完成主体不混同部分，完整院区与运营关系由 P1-02/P1-04 联合验收。文件批导入 P1-05，页面 P1-06，完整生命周期 P1-07。UI 与实际数据库重启 NOT_RUN；正式 ABG NOT_RUN。本票不是 P1 阶段完成或生产许可。

默认一个本地完成提交，不 push，不开始下一票。原 P0-10 密封包与失败记录保持不变；后续 P0 历史 runner 的“零业务 schema”断言不作为 P1 新领域的验收定义。
