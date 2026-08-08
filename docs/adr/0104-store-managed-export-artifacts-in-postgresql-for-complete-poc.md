---
status: accepted
extends: 0103
clarifies: 0096
extended_by: 0105
---

# 完整POC在PostgreSQL中原子保存受控导出派生制品

完整POC的`MANAGED_EXPORT_HANDOFF`把每个成功作业唯一派生ZIP的精确字节保存于`release-distribution`拥有、与`release_snapshot`分离的`managed_export_artifact`持久化关系，并使用非空PostgreSQL `bytea`承载字节。派生制品继续拥有独立稳定`artifact_id`、非权威角色、媒体类型、精确字节数和覆盖完整ZIP的外置SHA-256，不得复用规范快照身份、表记录、`projection_payload_digest`或`snapshot_artifact_digest`；两者使用相同数据库产品不表示它们是同一类制品。

ZIP必须先从作业冻结的来源与配置在最终提交事务外完整、确定性地生成并计算摘要；生成中的进程内临时字节不取得制品身份、不可下载，也不得作为失败后部分续跑的起点。只有完整字节和摘要均已形成后，`release-distribution`才开启短PostgreSQL本地事务，原子写入制品稳定身份、精确`bytea`、媒体类型、字节数、外置摘要、成功尝试终态、作业成功终态、审计及可交付资格。任一写入失败必须整体回滚，不能留下可下载字节、成功尝试、成功作业或半登记制品。

数据库约束与事务条件必须保证一个初始化导出作业最多一个派生制品。提交前崩溃或事务回滚仍按冻结重试规则完整重建；提交成功后的重复请求或恢复只能返回既有`artifact_id`及相同字节，不得再生成第二个制品、覆盖原记录或把成功尝试重复编号。授权管理界面和平台API只能凭稳定`artifact_id`经`release-distribution`取得同一精确字节，浏览器、仿真消费者及第三方不得直读数据库、获得表列或物理位置，也不得绕过对象级授权。

完整POC不使用文件系统、共享目录、S3、MinIO或其他对象存储，不做数据库与外部存储双写、暂存对象提升、跨资源补偿，也不建立独立制品存储模块、服务、workspace或为未来迁移预建存储port。未来可以在代表性容量验证和新ADR后更换内部存储，但必须保持历史`artifact_id`、精确ZIP字节、媒体类型、字节数、摘要、平台获取契约、回执、对账及证据语义不变。

本决策只约束架构门禁通过后的合成完整POC，不授权Phase 01提前实现受控导出，也不把Phase 01规范快照的16 MiB上限自动套用于派生制品。派生制品在完整POC内的保留、取代、禁止选择性删除及环境整体处置边界由[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)进一步确认；容量先测后定、最终ZIP精确字节计量和超限失败关闭方法由[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)确认；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)要求前置隔离装置只模拟同物理形态写入/读取，最终容量资格必须由集成后的实际`release-distribution`持久化及冻结公共API下载链路核验；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结七类容量画像且要求两阶段使用同一画像版本；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结两阶段共同使用的逐字段分布版本和适用字段清单；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结两阶段共同使用的受限本机WSL2环境。重复次数、阈值、结果聚合、数值上限以及未来全院初始化及生产存储策略仍须独立确认。不得把本POC的PostgreSQL `bytea`方案解释为生产基线、SLA或招标参数。该存储与原子提交语义作为G05、G06、G07、G12和U18的必需参数化子用例，不改变72个REST、20个界面场景或Phase 01 ABG-01至ABG-40。
