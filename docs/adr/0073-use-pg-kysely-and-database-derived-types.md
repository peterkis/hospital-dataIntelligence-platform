---
status: accepted
extends: 0071
---

# Phase 01使用pg、Kysely查询层和数据库派生类型

Phase 01使用`pg`作为PostgreSQL底层驱动，Kysely只承担类型安全查询构建和显式事务边界，禁止使用其Schema Builder、Migrator或任何运行时DDL；`kysely-codegen`必须从执行完权威原生SQL迁移的数据库生成TypeScript类型，生成文件纳入版本控制并在自动化门禁中验证未过期，因此生成类型是Schema的派生证据而不是第二结构权威。复杂PostgreSQL查询使用参数化Kysely `sql`标签或受审查的静态SQL文件，业务代码禁止拼接SQL和使用任意动态`sql.raw`；`numeric`、`int8`和数据库日期时间值在驱动适配边界保持无损字符串，再由显式金额、整数和时间适配器转换，不能把金额隐式转换为JavaScript `number`，也不能把院内本地日期时间转换为JavaScript `Date`。日期时间的数据库类型和契约遵循[ADR-0074](0074-use-asia-shanghai-local-datetimes-without-time-zone.md)。
