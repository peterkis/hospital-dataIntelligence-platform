# 11 — Podman 运行时权威加固

Status: ready-for-agent

Blocked by: AR-10 — Evidence provenance 与契约漂移整改

## What to build

在 ADR-0111 基线上加固单一 rootful Podman authority、容器 restart 策略、Docker socket/daemon 排除和 partial-startup 收尾；任何创建中途失败都必须只按完整五标签处理当前运行资源并失败关闭。

## Why

当前预检已检查常见 Docker CLI 路径和 Podman socket，但仍需覆盖 `/run/docker.sock` 别名、额外 daemon/远程端点及第二 authority。运行脚本按顺序创建卷和容器，restart 与中途失败语义也必须证明不会在终态后复活资源或遗留部分启动状态。

## Scope

- Rootful Podman/socket/OCI runtime 的单一权威检查与 machine-readable evidence。
- Docker CLI、daemon、socket alias、开放 TCP API 和其他容器 authority 的失败关闭检查。
- PostgreSQL/Keycloak 的 restart policy、终态后不复活约束和逐项验证。
- 每个 volume/container 创建或启动失败点的 partial-startup cleanup 与所有权复核测试。
- Podman 工作包完成后的人工复核输入。

## Non-goals

- 不清理不具备完整当前运行五标签的容器、卷、网络或旧 Docker 数据。
- 不使用 prune/reset，不放宽 host network、回环端口或镜像 digest 约束。
- 不执行正式 ABG，不据此将 Podman 工作包或 Phase 01 表述为 accepted。

## Acceptance criteria

- [ ] 预检能证明只有预期 rootful Podman Unix socket/运行时权威存在，并对 Docker socket/daemon/远程 API 或第二 authority 失败关闭。
- [ ] Restart policy 被明确冻结、验证并保证终态/teardown 后资源不会自动复活。
- [ ] 任一 partial-startup 失败都留下稳定错误证据，并只清理重新核验为当前运行所有的精确资源；无标签或标签不全资源保持不动。
- [ ] 定向测试覆盖每个创建阶段、所有权漂移、socket alias、restart 和残留资源路径，禁止 prune/reset。
- [ ] AR-11 完成后提供人工复核材料；人工复核前 Podman 工作包继续为 `ready-for-human`，且未运行正式 ABG。

## Comments

- 2026-08-30（AR-08 建立）：Podman 迁移已在 `5fc00d043dfbad213d647edae7be6df11016ba8a` 进入分支，但本 Ticket 的加固与人工复核尚未执行；等待 AR-10。
