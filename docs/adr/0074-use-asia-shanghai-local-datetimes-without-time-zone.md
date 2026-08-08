---
status: accepted
supersedes: 0066
---

# 全系统采用Asia/Shanghai无时区本地日期时间

当前建设范围只有一个医院治理主体，相关系统均位于同一地域且统一采用`Asia/Shanghai`，在每层携带和转换时区不会增加业务表达能力，反而会扩大前端、API、数据库和测试的类型与转换复杂度。因此，全系统所有业务有效时间、平台记录时间、计划生效、导入、解析、调度、审计、Outbox、回执、API和界面日期时间值均不携带时区或UTC偏移，其唯一语义固定为IANA `Asia/Shanghai`本地日期时间；PostgreSQL日期时间列使用`timestamp without time zone`，时间范围使用`tsrange`，治理Schema禁止`timestamp with time zone`、`timestamptz`和`tstzrange`，日期型字段继续使用`date`。API使用不带`Z`或偏移的ISO 8601本地日期时间字符串和专用契约类型，不标注为RFC 3339 `date-time`；应用、数据库会话、测试运行器和浏览器均固定并核验`Asia/Shanghai`，数据库驱动按字符串无损传递且不得转换为JavaScript `Date`。PostgreSQL会静默忽略写入`timestamp without time zone`值中的时区指示，因此任何含`Z`或偏移的输入必须在服务边界失败关闭，不能剥离偏移后保存；该选择也意味着值本身不能证明绝对时刻或跨时区先后关系，时间戳不得单独承担唯一标识或并发顺序。若治理主体、运行地域或消费者出现跨时区需求，必须作为核心架构变更重新确认。该行为边界依据[PostgreSQL 18日期时间类型文档](https://www.postgresql.org/docs/18/datatype-datetime.html)、[范围类型文档](https://www.postgresql.org/docs/18/rangetypes.html)和[会话TimeZone配置文档](https://www.postgresql.org/docs/18/runtime-config-client.html)核验。
