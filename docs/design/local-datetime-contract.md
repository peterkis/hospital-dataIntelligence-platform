# Hospital DataIntelligence Platform 时间契约

本契约落实 [ADR-0074](../adr/0074-use-asia-shanghai-local-datetimes-without-time-zone.md)，适用于项目自有 API、领域模型和数据库 Schema。

1. 统一业务时区：Asia/Shanghai。

2. 项目自有数据库 Schema 禁止使用：
   - timestamp with time zone
   - timestamptz
   - time with time zone
   - timetz
   - tstzrange
   - tstzmultirange

3. 时间字段使用：
   - 日期：date
   - 时刻：time without time zone
   - 日期时间：timestamp without time zone
   - 日期时间范围：tsrange

4. LocalDateTime 的接口格式：
   YYYY-MM-DDTHH:mm:ss[.ffffff]

5. LocalDateTime 禁止包含：
   - Z
   - UTC
   - +08:00
   - 其他 offset
   - IANA timezone 名称

6. PostgreSQL 读取结果必须保持字符串。
   业务字段不得由 pg 自动解析为 JavaScript Date。

7. JavaScript Date 只允许作为“当前物理时刻”的临时来源。
   Date 必须通过显式 timeZone=Asia/Shanghai 格式化后，
   才能进入领域模型、API 或数据库。

8. 禁止将 Date、toISOString() 或 UTC 字符串直接传入业务时间字段。

9. 数据库生成当前业务时间统一使用：
   platform.local_now()

10. 同一个本地秒内的确定性排序依靠显式 sequence，
    不依靠毫秒或时区换算。

11. 外部系统使用 UTC 或带 offset 时间时，
    只允许在 Adapter 边界转换一次；
    领域层与数据库仍使用 Asia/Shanghai 本地时间文本。

12. 本约束仅适用于本项目拥有的数据库 Schema。
    PostgreSQL 系统 Schema 或未来第三方产品独立数据库不纳入本规则。
