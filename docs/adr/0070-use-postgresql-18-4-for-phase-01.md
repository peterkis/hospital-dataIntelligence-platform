---
status: accepted
extended_by: 0071
---

# Phase 01治理事务数据库采用PostgreSQL 18.4

Phase 01的模块化单体治理应用使用PostgreSQL 18.4作为精确、可重复的事务数据库基线，并允许安装随PostgreSQL提供的可信扩展`pgcrypto`与`btree_gist`：前者用于受控摘要等数据库能力，后者配合范围类型和GiST排他约束承载身份与有效期组合的不重叠规则；发布、完整快照字节及元数据、审计和Outbox仍在同一本地事务中提交。该版本选择只约束POC可执行架构基线，不构成生产数据库或招标参数；物理DDL必须根据当前逻辑模型重新设计，不能复制历史参考DDL。任何小版本升级、数据库产品替换或扩展移除都必须形成显式变更记录，并重新执行数据库迁移、时间排他、发布原子性和审计完整性架构门禁。版本与扩展能力已经依据[PostgreSQL官方18.4发布说明](https://www.postgresql.org/docs/release/18.4/)、[`btree_gist`文档](https://www.postgresql.org/docs/18/btree-gist.html)和[`pgcrypto`文档](https://www.postgresql.org/docs/18/pgcrypto.html)核验；Phase 01权威快照使用`bytea`同事务存储的具体边界由[ADR-0093](0093-store-canonical-snapshot-bytes-in-postgresql-transactionally.md)进一步限定。
