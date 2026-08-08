---
status: accepted
extends: 0074
---

# 以显式流内序号作为记录顺序权威

任何需要严格顺序的版本、发布、审计、变化、导入执行或消费处理记录流，都使用流标识和正数`bigint`流内序号建立唯一、单调、不复用的规范顺序；序号允许因回滚、失败或并发分配出现空洞，日期时间仅用于业务有效性、展示和筛选，不参与唯一性或最终排序。实体版本继续使用`version_no`，治理发布使用`release_no`，Outbox使用`aggregate_version`，审计使用`audit_stream_id + audit_sequence`并将序号纳入前后哈希链，导入结果使用`execution_sequence`，消费尝试使用`attempt_no`；每个组合建立唯一约束并以并发安全事务分配。不同记录流之间不建立全局总序，`request_id`和事务关联ID只表达同一次操作的关联关系，不暗示先后。
