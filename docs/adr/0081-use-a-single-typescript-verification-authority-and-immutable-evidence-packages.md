---
status: accepted
extends: 0068
clarifies: 0065
---

# Phase 01使用单一TypeScript验证权威和不可覆盖证据包

Phase 01以TypeScript测试资产和证据编排作为唯一自动化验证权威：Vitest 4是单元、模块、Fastify注入、数据库集成和REST场景的通用运行器，首个证据基线精确固定为4.1.6；Playwright Test只作为浏览器端到端专用运行器，首个证据基线精确固定为1.61.0，API验收只能使用冻结OpenAPI生成的客户端。集成测试由Testcontainers启动真实PostgreSQL 18.4、Keycloak 26.7.0和Toxiproxy，通过生产不可启用的枚举化测试故障点验证事务及崩溃窗口，并通过代理故障和容器停止、重启验证网络及依赖故障；不得用SQLite、内存数据库、伪造IAM、Postman/Newman、Cucumber或外部混沌平台形成平行验证权威。冻结OpenAPI必须同时通过Redocly CLI规范校验和oasdiff破坏性变更检查；TypeScript证据编排器为每次正式验证创建新的不可覆盖运行身份，汇总结构化测试结果、工具及镜像精确版本、fixture种子、契约与迁移摘要、故障注入和服务证据，生成规范化清单及逐项SHA-256，重跑不得覆盖旧证据。所有门禁以厂商中立的仓库命令执行，CI平台只负责调用这些命令和保存原始产物，不取得测试语义、放行规则或证据结论主权。

[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)在不改变Phase 01范围的前提下复用本验证权威：完整POC前置容量可行性实验只能作为既有TypeScript验证工具链内的一次性隔离装置，集成后容量核验必须通过实际业务链路和冻结公共API；两者进入同一不可覆盖证据链，不建立第二测试权威、业务模块或运行时依赖。[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)进一步把七类容量画像生成器及矩阵编排限定为该既有验证工具链的确定性fixture资产，并明确Phase 01不得预建或运行这些资产；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)在同一fixture边界冻结逐字段分布、适用字段资格及Unicode码点/最终ZIP字节分层，并同样禁止形成平行生成器、业务配置或Phase 01资产。
