---
status: accepted
extends: 0069
---

# 管理界面采用同源React SPA

Phase 01管理界面采用严格TypeScript、React 19、Vite 8、React Router 7 Data Mode和TanStack Query 5，前端源码作为独立工程包维护，但生产构建为静态资源并由Fastify同源提供，归入同一个治理应用部署单元；开发期可以使用独立Vite开发服务器，但不引入Next.js、SSR、RSC、Server Actions或第二套BFF。`openapi-typescript`只从冻结OpenAPI 3.1生成类型，`openapi-fetch`据此提供浏览器和Node可复用的类型安全客户端；浏览器只负责展示、导航、输入辅助校验和读取缓存，不持有权限、流程、业务校验、版本、价格解析或审计主权，治理写操作必须等待服务端确认并重新取得权威状态，不能以乐观更新伪造成功。首个证据基线固定依赖锁文件中的精确版本，Phase 01只验证当前稳定版Edge和Chrome；该选择牺牲服务端渲染与遗留浏览器覆盖，以保持Fastify为唯一服务边界并避免第二套后端路径。
