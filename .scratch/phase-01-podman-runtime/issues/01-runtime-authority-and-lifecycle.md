# 01 — Podman 运行时权威与生命周期迁移

Status: ready-for-human

## What to build

落实 ADR-0111：迁移 Anolis 基线装配、依赖启动、正式运行身份、预检、资源证据、受控清理、Testcontainers 适配、对抗夹具和现行文档，并生成不覆盖旧回执的新 Podman 迁移回执。

## Exit condition

Podman 成为唯一可执行容器运行时；所有当前受管容器与卷可由五项标签精确发现和清理，且只用host network和冻结回环端口；Docker/Compose 仅剩已明确标注的历史事实、OCI registry 名称或第三方兼容变量；所有所需验证通过且未启动正式 ABG。

## Comments

- 2026-08-30：已在不清理 `/var/lib/docker` 的前提下，以 Anolis AppStream Podman `4.9.4-rhel` 替换冲突的 Docker RPM，并启用 `/run/podman/podman.sock`。旧 Docker 数据保留用于恢复；两只运行镜像已按原固定 registry digest 拉取到 Podman。
- 2026-08-30：Podman基线、PostgreSQL/Keycloak生命周期探针、11条空库迁移及生成类型权威、完整Testcontainers纵向集成、全仓测试/类型检查/构建/静态边界、152项验证工具测试（含60项对抗夹具）、脚本语法、JSON与回执摘要均通过。收尾检查为仓库标签容器0、卷0、网络0，冻结端口无监听；本结果不等于readiness或正式ABG。
