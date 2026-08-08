---
status: superseded by ADR-0074
---

# 全系统固定使用Asia/Shanghai时区

全系统所有业务有效时间、计划生效、导入时间解释、价格与规则解析日界、时态查询、调度任务和管理界面展示统一使用IANA时区`Asia/Shanghai`，不提供按用户、院区或消费者切换业务时区的能力。绝对记录时刻可以内部保存为UTC Instant或数据库时区感知时间类型，但对外解释和展示必须转换为`Asia/Shanghai`并保留明确偏移。API中的时间戳必须符合RFC 3339并携带偏移；无偏移日期时间只有在字段结构明确声明为院内本地业务时间时才允许，并固定按`Asia/Shanghai`解释，不能依赖操作系统、数据库会话、浏览器或用户设备本地时区。日期型字段保持日历日期语义。实现不得使用含义不唯一的`CST`缩写，也不得用单纯`UTC+8`替代IANA时区标识。

本决策已由[ADR-0074](0074-use-asia-shanghai-local-datetimes-without-time-zone.md)取代。
