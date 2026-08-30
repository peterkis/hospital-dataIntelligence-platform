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
- 2026-08-30：上述Docker/Compose实现记录作为历史事实保留；ADR-0111已替代现行运行时语义。当前身份字段为`runtimeNamespace`，rootful Podman直接管理带五标签的容器与卷，受管容器统一使用host network并显式绑定回环端口；预检与teardown只通过Podman逐项发现、复核和清理，禁止prune/reset。迁移验证不等于readiness或正式ABG。
- 2026-08-30（AR-08 状态复核）：Implementation 基线为 `9bc5851c9d361f10fe90905affe797153ae4673a`，其 Docker/Compose 运行时语义已被 `5fc00d043dfbad213d647edae7be6df11016ba8a` 的 Podman 迁移直接替代；AR-09 的终态协议和 AR-11 的 authority、restart、Docker socket、partial-startup 加固仍会继续改变验证基线。AR-12 必须在这些整改完成后重新验证；历史 35/35 与 85/85 不能表示当前正式 accepted。
- 2026-08-30（AR-09 历史影响）：formal runtime callback 现明确分为 cleanup 前执行与 producer snapshot 落盘、cleanup 后终态生成、以及只负责 Manifest 的 seal。最终 outcome 暴露 `finalResources`，cleanup 后重新核验 frozen inputs 与 verification authority；ABG-40 不再能在 cleanup 前产生。AR-11 的 Podman authority、restart policy、Docker socket 与 partial-startup 范围没有在 AR-09 中改变。
- 2026-08-30（AR-11协议影响）：本Ticket在2026-08-27实现的Docker/Compose身份与teardown继续只作历史记录；现行runtime identity仍为`runtimeNamespace`，唯一机器可读运行权威改为`runtime-baseline.lock.json`的`.authority`。Preflight新增authority byte/semantic identity、rootful socket、Docker CLI/daemon/socket alias/TCP/第二endpoint和精确Podman兼容`DOCKER_HOST`检查；teardown新增`restart=no`、partial-startup/bootstrap recovery、持久化单元及cleanup后authority稳定性检查。每次变更前重新inspect，五个必需标签缺失或不一致即保留并失败关闭，附加无关元数据标签不影响所有权；仍禁止prune/reset。该影响不改变AR-05的历史`resolved`边界，AR-12仍须在当前HEAD真实环境重新验证。
