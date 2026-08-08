---
status: accepted
extends: 0093
---

# Phase 01规范快照制品上限为16 MiB

Phase 01将单个`CANONICAL`规范快照制品的容量上限固定为16 MiB，即16,777,216字节。计量对象是确定性规范序列化完成后、写入`release_snapshot.artifact_bytes`且由`snapshot_artifact_digest`覆盖的最终逻辑字节序列；`artifact_byte_length`小于或等于该值允许继续发布，大于该值必须以`SNAPSHOT_ARTIFACT_TOO_LARGE`失败关闭。PostgreSQL TOAST或其他内部物理压缩以及HTTP内容编码均不得改变计量结果或被用于规避该上限。

超限不得自动拆分、截断、改变规范序列化、压缩后重新计量、生成替代快照、回退文件或对象存储，也不得只提交发布事实、元数据、审计或Outbox而遗漏快照字节。整个发布事务不形成已发布结果；失败尝试仍按既有失败审计机制留痕，但不得伪装为成功发布。边界验证必须至少证明16,777,216字节可以通过、16,777,217字节被阻断，且超限后不存在半发布或消费水位推进。

该数值只服务于当前合成数据POC，用于限制测试期间的内存、事务、备份和故障注入范围，不是未来全院初始化、历史数据装载、生产日常发布、容量规划、性能SLA或招标参数。未来进入全院初始化或生产设计前，必须基于代表性全院对象规模、字段分布、版本保留、发布频率、序列化膨胀、并发、数据库WAL与备份恢复、下载和消费者恢复行为开展容量与性能验证，再以新ADR确认上限、分片或存储策略；不得未经验证直接继承16 MiB。下载流式传输、HTTP Range和HTTP内容编码策略不包含在本决策中。

[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)确认的派生交付制品拥有独立字节与摘要，不是本ADR的`CANONICAL`计量对象。其容量上限不得默认继承16 MiB，也不得反向改变或规避规范快照护栏；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)进一步要求以最终派生ZIP精确字节开展代表性容量实验，再由后续ADR冻结具体数值并对超限失败关闭。
