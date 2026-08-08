---
status: accepted
extends: 0091
clarifies: 0087
extended_by: 0093
---

# 发布快照采用投影载荷与完整制品双摘要

Phase 01的`release-distribution`为每个权威快照分别生成`projection_payload_digest`和`snapshot_artifact_digest`。前者只覆盖在冻结投影Schema下按已登记确定性序列化规则形成的投影载荷规范字节，用于证明该契约表达下的载荷逐字节等价；后者覆盖最终不可变落盘的完整快照字节，即冻结通用包络与投影载荷，用于下载、传输和存储完整性核验。完整制品摘要保存在快照元数据、事件及查询契约中而不嵌入其自身所覆盖的制品字节，避免自引用。

存储位置、投递状态、投递尝试、消费者回执、审计链状态及其他可变运维元数据不属于快照制品字节，也不进入任一摘要。两类摘要分别冻结算法标识并共同冻结序列化规则版本；Phase 01初始算法为SHA-256。历史快照必须按其发布时记录的算法和序列化规则核验，不得使用“当前最新版”重新计算、覆盖或补写摘要。

领域模块已有的领域版本摘要或成员集合摘要继续作为领域内容等价证据，不由上述两类制品摘要取代。跨投影Schema版本时，即使领域版本和成员集合完全相同，载荷结构变化仍可使`projection_payload_digest`不同；因此平台不得依据载荷摘要或完整制品摘要相等或不等推断跨Schema领域语义等价。`release-distribution`拥有双摘要的计算、保存和公开责任，但不取得领域内容摘要、字段语义或投影Schema主权，也不另建通用摘要模块或服务。Phase 01快照字节的PostgreSQL事务内存储与受控下载边界由[ADR-0093](0093-store-canonical-snapshot-bytes-in-postgresql-transactionally.md)进一步限定。

[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)允许的厂商专用派生交付制品另有独立制品摘要；该摘要只证明派生字节完整性，不属于本ADR定义的规范快照双摘要，不得复用两者名称、数值或作用域，也不得用于推断领域内容或规范快照等价。派生摘要同样不得自嵌入其覆盖字节。
