# PostgreSQL migrations

此目录是 Phase 01 PostgreSQL 物理 Schema 的唯一权威。应用、Kysely 和类型生成工具不得在运行时修改 Schema。

- `0001_phase_01_vertical_slice.sql`：建立模块专属 Schema、声明式核心约束、不可变规范快照、Outbox、解析证据和只追加审计链。

迁移按文件名前缀严格升序执行。尚未进入正式证据包的迁移可在开发期修订；进入证据基线后，原文件及摘要不得覆盖，后续只能追加迁移。逻辑表所有权见 `db/table-ownership.json`。
