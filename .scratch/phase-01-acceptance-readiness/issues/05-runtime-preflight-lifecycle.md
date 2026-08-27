# 05 — 运行时预检与生命周期

Status: resolved

Blocked by: none

## What to build

定义正式运行前的冻结输入、运行目录、环境预检、运行身份和终态不可覆盖生命周期，并把缺失或漂移处理为失败关闭。

## Exit condition

预检不得启动正式运行，也不得覆盖历史证据或复用终态目录。

## Comments

- 2026-08-27：等待 04。
- 2026-08-27：新增机器可读正式运行预检，失败关闭核验 Git/冻结输入/不可复用输出目录、精确 Node/npm 与 lockfile 摘要、Anolis/WSL2 包络与宿主 `.wslconfig` 摘要、Docker/Compose 与固定镜像摘要、仓库遗留资源、固定端口及九项 secret presence；secret 证据不记录值或摘要。
- 2026-08-27：正式运行身份由 `runId`、`runSequence`、`gitCommitSha` 和同时含序号及 run-id 安全短标识的 `composeProjectName` 组成；Compose 服务/卷/网络和 Testcontainers PostgreSQL 均带五项当前运行标签，清理前再次核验完整标签及 project identity。
- 2026-08-27：新增运行中/运行后资源清单、进程和 Testcontainers 生命周期事件、峰值可得指标、失败摘要、pre-cleanup producer evidence snapshot、SIGINT/SIGTERM/未捕获异常收尾，以及先落盘后精确 teardown 的失败关闭控制器。清理失败、证据写入失败或 manifest 失败都会使总结果失败；失败目录永久保留且不覆盖旧目录。
- 2026-08-27：受控 teardown 只停止当前运行已核验进程、Testcontainers 和 Compose project，并逐项处理当前运行卷/网络及复核端口；专用命令写不可覆盖 follow-up cleanup 记录。未使用任何 Docker prune，也未触碰无关 Docker/WSL/用户资源。
- 2026-08-27：生命周期专项 35/35、verification-tooling 全量 85/85 通过；verification 与 governance-api typecheck、ABG coverage、仓库布局、模块边界、Compose config、bootstrap shell syntax 和 `git diff --check` 通过。真实 Anolis `--dry-run` 在实现期对脏工作区及既有 `anolis-89-wsl2` PostgreSQL/Keycloak/卷/网络和 55432/18080/19000 端口准确失败关闭；未自动清理这些无法证明属于当前 run 的旧资源。
- 2026-08-27：未执行完整正式 ABG，未进入 AR-06。
