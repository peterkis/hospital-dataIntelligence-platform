---
status: accepted
extends: 0072
clarified_by: 0088
---

# 由TypeBox单向生成并冻结OpenAPI契约

Phase 01以Fastify公开路由中的TypeBox Schema作为API契约唯一可编辑、可执行的定义源，并由`@fastify/swagger`在全部路由注册后单向生成和冻结OpenAPI 3.1 JSON；冻结产物记录版本与摘要，是管理界面、仿真消费者和测试生成客户端及类型时唯一允许使用的外部契约，消费者不得导入治理后端内部TypeScript类型，也不得平行手写OpenAPI、DTO或接口类型。请求参数、查询、请求头、请求体以及成功和错误响应都必须进入Schema，CI必须重生成、规范校验、比较冻结产物并阻断未声明漂移或破坏性变更；无时区`LocalDateTime`、Decimal和`int8`均使用明确约束的字符串Schema，其中本地日期时间不得错误声明为RFC 3339 `date-time`。该选择牺牲独立手写契约的自由，以换取运行时校验、后端类型、发布契约和消费者代码之间的一条可审计权威链。
