---
status: accepted
extends: 0096
clarifies: 0101
extended_by: 0104
---

# 受控导出使用确定性无压缩ZIP派生制品

完整POC的`MANAGED_EXPORT_HANDOFF`每个成功作业只生成一个完整、不可分段、不可变且非权威的`application/zip`派生交付制品。ZIP固定只含根目录下的`manifest.json`和`records.csv`两个条目，条目使用`STORE`方法而不压缩；本POC不生成XLSX、裸CSV、压缩成员、分片包或同一作业的多格式变体。

`records.csv`使用UTF-8无BOM和LF；字段引用及双引号转义采用RFC 4180语义，但记录终止符明确固定为LF。消费者交付配置版本冻结列名、列序、字段表示、空值策略和形成全序的记录排序规则，稳定来源成员身份作为最终并列消解键；不得依赖数据库自然顺序、生成时间或区域设置。Decimal使用`.`且不使用千位分隔、指数或隐式精度，日期时间按冻结字段契约输出`Asia/Shanghai`无时区本地表示，不得携带`Z`或偏移。

`manifest.json`使用冻结的派生交付格式版本和确定性JSON序列化，至少记录非权威角色、来源发布和规范快照及其摘要、目标消费者与订阅、精确消费者交付配置及交付契约/模板/映射/格式/算法版本、CSV列及排序规则身份、记录数、`records.csv`媒体类型、编码、字节数和SHA-256。它不得包含自身所在完整ZIP的摘要，也不得包含作业、尝试、制品稳定身份、生成时间、下载/交接状态、存储位置等会使相同冻结输入产生不同字节的运行信息；这些信息保存在制品外部元数据和审计中。

ZIP条目顺序固定为`manifest.json`后`records.csv`，文件名、UTF-8标志、方法、头字段、固定时间戳、文件属性、额外字段、注释及其他非内容元数据均由不可变格式版本规范化；禁止加密、数据描述符和实现默认值漂移。平台在制品外部保存覆盖完整ZIP精确字节的SHA-256及字节数，并经API、界面和交接证据公开核验。相同冻结输入及格式版本在新作业或同作业重试中必须生成逐字节相同的ZIP；格式变化只能形成新的消费者交付配置版本和新作业，不要求重新发布权威主数据，也不得重生成历史制品。

[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)随后确认完整POC以`release-distribution`专属且与`release_snapshot`分离的PostgreSQL `bytea`保存该ZIP，并在字节和摘要于事务外完整形成后以短本地事务原子提交制品及成功状态；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)进一步确认完成ZIP保留到POC证据基线整体处置，取代、交付完成和权限变化均不允许重写或选择性删除；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)确认以这里冻结的最终ZIP精确字节开展代表性容量实验、后续冻结数值并对超限失败关闭；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)要求前置和集成后阶段使用同一冻结格式实现及测量参数，只有实际`release-distribution`与公共API核验授予最终容量资格；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结七类生成该ZIP的容量画像，且行数均按`records.csv`不含表头的数据行计算；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结形成这些ZIP的逐字段长度、字符与合法CSV转义分布，并分离Unicode码点长度与最终ZIP字节计量；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2容量环境。重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合及数值上限仍未确定，也不把Phase 01规范快照的16 MiB护栏自动套用于该ZIP。[ADR-0102](0102-retry-transient-managed-export-failures-within-the-same-frozen-job.md)确认的每次完整重建必须使用这里冻结的格式版本；G05、G06和U18增加必需参数化子用例，但[ADR-0101](0101-expand-managed-export-acceptance-baseline-to-72-rest-and-20-ui-scenarios.md)冻结的72个REST与20个界面场景以及Phase 01 ABG-01至ABG-40均不改变。
