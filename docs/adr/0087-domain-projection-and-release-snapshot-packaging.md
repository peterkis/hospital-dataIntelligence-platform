---
status: accepted
extends: 0086
clarifies: 0084
extended_by: 0088
---

# 领域模块构造内容投影，发布分发模块构造快照制品

Phase 01在领域模块与`release-distribution`的seam上使用冻结、类型化且已完整物化的发布内容投影。领域模块从自己拥有的权威状态构造该值，完成领域语义校验并冻结稳定身份、明确版本及必要引用；投影不得携带数据库行、SQL、repository、事务句柄、延迟加载器或要求稍后查询“当前数据”的回调，也不等同于数据库模型或公开REST传输对象。

`release-distribution`通过其唯一接口接收该投影，负责生成通用发布包络，执行受控的确定性规范序列化，计算由[ADR-0092](0092-use-separate-projection-payload-and-snapshot-artifact-digests.md)分层限定的投影载荷摘要与快照制品摘要，保存不可变快照并登记快照元数据与Outbox事实。它可以校验通用可序列化性、由[ADR-0094](0094-limit-phase-01-canonical-snapshot-artifacts-to-16-mib.md)限定的Phase 01容量护栏和其他已登记规则，却不得查询领域表、理解或推断领域字段、修补领域语义，也不得在事务提交后回调领域模块重新取数；同一冻结输入在相同序列化规则下必须得到相同载荷字节、快照字节及其对应摘要。

领域模块不得直接写入`release_snapshot`、快照存储或Outbox，也不得自行生成最终发布快照字节、投影载荷摘要或快照制品摘要；它已有的领域版本摘要可以作为投影中的冻结证据引用，但不能代替`release-distribution`生成的双摘要。该分工避免`release-distribution`膨胀为理解所有治理域的通用领域模块，也避免每个领域重复实现包络、规范序列化、摘要、存储和分发。投影Schema主权及不可变版本由[ADR-0088](0088-domain-owned-versioned-projection-schemas.md)进一步限定；每个发布的投影与快照基数、Schema升级和未来扩展接缝由[ADR-0090](0090-use-one-canonical-projection-snapshot-per-release-in-phase-01.md)进一步限定；投影载荷与完整快照制品双摘要及其作用域由[ADR-0092](0092-use-separate-projection-payload-and-snapshot-artifact-digests.md)进一步限定；Phase 01权威快照字节的PostgreSQL事务内存储与受控下载边界由[ADR-0093](0093-store-canonical-snapshot-bytes-in-postgresql-transactionally.md)进一步限定。

[ADR-0096](0096-allow-versioned-non-authoritative-derived-artifacts-for-managed-export.md)确认的厂商专用派生交付制品不改变上述规范投影与快照分工。`release-distribution`可以封装派生制品的通用身份、摘要、清单和交付证据，但不得因此理解、推断或改写领域字段。

[ADR-0097](0097-govern-consumer-delivery-profiles-with-integration-owner-and-domain-confirmation.md)进一步把字段选择、表示及模板装配纳入独立版本化的消费者交付配置：来源领域Owner确认语义，集成交付Owner终审配置，导出作业冻结精确版本；`release-distribution`只执行已批准配置，不得成为配置编辑或语义主权模块。

[ADR-0098](0098-restrict-consumer-delivery-transformations-to-declarative-validated-capabilities.md)进一步限定配置只能默认表达受控表示转换，并在精确来源Schema与固定样例向量验证后执行；任何改变成员集合、基数或业务含义的高风险能力默认禁止，不能借派生制品绕过领域投影主权。
