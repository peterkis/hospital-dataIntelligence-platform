---
status: accepted
extends: 0069
clarifies: 0076
---

# Phase 01使用根目录单一Git仓库和npm工作区

Phase 01在当前项目根目录建立单一Git仓库，以Node.js 24.18.0自带的npm 11.9.0和一个根`package-lock.json`管理workspaces，不并行使用pnpm、Yarn、Turborepo、Nx或其他包管理及任务编排权威。源码按`apps/governance-api`、`apps/admin-web`和`apps/sim-consumer`分区，后者是一套实现但以两个独立身份、进程配置和状态运行；`packages/generated-api-client`只能从`contracts/openapi`中的冻结契约生成，管理界面、仿真消费者和外部测试不得导入治理后端内部类型或共享领域实现。`db/migrations`继续是物理Schema权威，`contracts/openapi`是外部契约发布权威，`tests/api`、`tests/e2e`、`tests/fault`和`tooling/verification`分别承载外部验证及证据编排；治理模块仍深置于模块化单体内部，不拆成可被消费者绕过公共契约直接依赖的共享领域包。
