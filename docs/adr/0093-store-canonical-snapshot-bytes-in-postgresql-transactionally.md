---
status: accepted
extends: 0092
clarifies: 0087
extended_by: 0094
---

# Phase 01在PostgreSQL事务内保存规范快照字节

Phase 01将每个唯一`CANONICAL`权威快照的最终不可变字节直接保存到PostgreSQL 18.4的`bytea`，由`release-distribution`拥有。该`bytea`值就是`snapshot_artifact_digest`所覆盖并在读取后还原的精确逻辑字节序列；PostgreSQL内部物理存储或TOAST细节不形成另一种制品格式，也不进入外部契约。

快照字节、快照元数据、`governance_release`发布事实、发布审计和Outbox必须与既有发布成员、兼容预检及投递登记一起在同一本地数据库事务中提交；任一写入失败全部回滚，不允许先提交数据库记录再向文件系统或对象存储提升制品，也不建立跨资源补偿。消费者只能凭稳定快照身份通过平台受控下载API取得字节，事件和查询契约不得暴露表名、列名、数据库连接或其他物理存储位置，业务用户、治理角色及仿真消费者不得直接读取治理数据库。

Phase 01不为权威发布快照引入本地文件系统、共享文件、S3兼容对象存储、暂存区、提升流程或未使用的存储抽象。未来若因真实容量、成本或运维需求迁移到对象存储，必须另立ADR并追加迁移及验证门禁；稳定快照身份、下载契约、历史制品字节和双摘要不得因此改变。当前合成POC的单制品容量护栏及其禁止外推边界由[ADR-0094](0094-limit-phase-01-canonical-snapshot-artifacts-to-16-mib.md)进一步限定。

本ADR只约束`CANONICAL`规范快照的Phase 01物理存储。[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)确认的非权威派生交付制品不是`release_snapshot`；其完整POC物理存储、成功提交事务和平台受控取得边界已由[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)独立确认，保留、取代、禁止选择性删除及环境整体处置边界由[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)确认，容量先测后定及超限失败关闭方法由[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)确认；具体实验规模、阈值和数值上限仍须后续决定。不得因允许派生制品而把文件或对象存储旁路引入规范快照存储，也不得把ADR-0104至ADR-0106提前带入Phase 01。
