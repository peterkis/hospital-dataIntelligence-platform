# Phase 01 Podman 运行时迁移

Status: ready-for-human

Scope: 将现行 Phase 01 容器运行时、运行身份、预检、受控清理、Testcontainers 适配、Anolis 装配脚本、运行手册和机器可读基线从 Docker/Compose 迁移为单一 rootful Podman 权威；历史 ADR、历史回执和既有终态证据只追加替代说明，不改写既有事实。

## Objective

在不改变 PostgreSQL、Keycloak、领域行为、数据库迁移、冻结 OpenAPI 或 ABG 语义的前提下，使本仓库所有现行容器路径只依赖 Podman，并以同一五标签所有权模型失败关闭地完成预检、运行和逐项 teardown。

## Boundaries

- 不执行正式 ABG、Chrome 或独立复核。
- 不运行 `podman prune/reset`，不删除无完整 HDI 标签的资源。
- 不把 `docker.io` OCI registry、Testcontainers 的 `DOCKER_HOST` 兼容变量或历史根文件系统归档名称误写为 Docker Engine 依赖。
- 不覆盖 `.runtime/evidence/` 中既有终态证据，不回写历史回执。
- 不改变既有固定镜像 digest、数据库持久化语义或业务契约。

## Completion Criteria

1. Anolis 运行时固定 Podman 精确版本、rootful Unix socket、存储/网络/日志配置和两只固定 digest 镜像；Docker Engine/CLI/Compose 不再是可执行依赖。
2. `runtimeNamespace` 替代 Compose project identity；受管容器与卷带完整五标签，容器只用host network并在进程层绑定冻结回环端口，不创建仓库专属网络或端口发布规则。
3. 正式预检记录 Podman 与镜像身份并拒绝漂移、缺失及仓库遗留资源；teardown 只逐项删除重新核验所有权的当前运行资源。
4. Testcontainers 只经 `/run/podman/podman.sock` 兼容适配访问同一 Podman 权威。
5. 活跃脚本、设计、运行手册、故障矩阵和测试不再依赖 Docker/Compose；历史事实保留并有明确说明。
6. Podman 基线验证、验证工具专项测试、类型检查、仓库静态检查和真实 PostgreSQL 集成验证通过；不据此声称 readiness、正式 ABG 或生产就绪。

## Comments

- 2026-08-30：用户明确要求将 Docker 改为 Podman，并调整整个现行设计。AR-07 的 Docker 路径停止，`runSequence 9` 不在旧设计上启动。
- 2026-08-30：实现与本地验证完成。直接Podman运行模块、host network回环端口、五标签所有权、预检/teardown、Testcontainers适配、基线回执、ADR和活跃设计已一致；未启动新的readiness、正式ABG、Chrome或独立复核。
