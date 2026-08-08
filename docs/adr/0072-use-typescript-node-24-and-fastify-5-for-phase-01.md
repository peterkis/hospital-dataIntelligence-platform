---
status: accepted
extends: 0069
---

# Phase 01后端采用TypeScript、Node.js 24和Fastify 5

Phase 01治理后端采用严格模式TypeScript、Node.js 24 LTS和Fastify 5，首个可执行证据基线精确固定Node.js 24.18.0，Fastify及其他包的确切版本在工程初始化时写入并提交依赖锁文件；治理应用按既定模块化单体运行，仿真消费者可以使用相同语言和运行时，但必须保持独立进程、服务身份和消费状态，只能共享正式公共契约而不能导入治理应用内部模块。该决策只确定语言、运行时和HTTP框架，不预先决定数据库查询库、OpenAPI契约生成方式或工作流实现；Node.js或Fastify主版本变更属于需要重新确认的核心架构变更，同一主版本内的安全及补丁更新可以按受控依赖升级处理，但必须更新精确版本证据并重新执行受影响门禁。版本支持依据[Node.js官方发布状态](https://nodejs.org/en/about/previous-releases)、[Fastify LTS策略](https://fastify.dev/docs/latest/Reference/LTS/)和[Fastify TypeScript文档](https://fastify.dev/docs/latest/Reference/TypeScript/)核验。
