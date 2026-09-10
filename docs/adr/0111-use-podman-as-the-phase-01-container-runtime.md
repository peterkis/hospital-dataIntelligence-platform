---
status: accepted
extends: 0110
clarifies: 0081
---

# Phase 01 采用 Podman 作为唯一容器运行时

自本决策起，Phase 01 在 `Anolis-8.9-HDI-POC` 中只使用 rootful Podman 作为容器运行时权威。运行时基线固定 Podman 4.9.4-rhel、runc、overlay、发行版 CNI 元数据后端和 rootful Unix socket；PostgreSQL 18.4 与 Keycloak 26.7.0 继续使用完整 registry digest，不因运行时迁移改变镜像内容身份。`docker.io` 只表示 PostgreSQL 镜像所在的 OCI registry，不表示 Docker Engine 参与运行。

Phase 01 不使用容器桥接网络或端口 NAT。真实建网验证确认，WSL 自身维护的 nftables `nat` 表与本发行版的 CNI `iptables-nft` 路径不兼容；Netavark 1.10.3 的 nftables 路径也不能解析 WSL 生成的端口区间 masquerade 规则，而 legacy DNAT 不会取得本地 NAT hook 的预期语义。因此所有受管容器必须使用 Podman host network，并在进程层显式绑定 `127.0.0.1`：运行时 PostgreSQL 为 `55432`，集成验证 PostgreSQL 为 `55433`，Keycloak HTTP/management 为 `18080`/`19000`。禁止 `--publish`、仓库专属 Podman 网络、flush WSL 规则、全局替换 iptables 前端或防火墙 shim。

运行依赖不再经 Compose provider 编排。仓库内一个 Podman runtime module 负责创建带标签的卷和容器，并以 `runtimeNamespace` 统一派生资源名称。正式运行身份由 `runId`、`runSequence`、`gitCommitSha` 和同时包含序号及 run-id 安全短标识的 `runtimeNamespace` 构成；容器、卷和 Testcontainers 容器必须同时携带 `hdi.repository`、`hdi.phase`、`hdi.run-id`、`hdi.run-sequence`、`hdi.managed-by` 五项标签。预检仍扫描容器、卷和网络，且只接受空的本仓库 Podman 资源集合；teardown 在每次删除前重新核验全部标签，只允许逐个删除当前运行的精确对象，禁止 `podman * prune`、`podman system reset` 或任何无精确对象的清理命令。

Testcontainers for Node 保持验证依赖库，不取得容器运行时主权。它只通过 Podman 在 `/run/podman/podman.sock` 提供的 Docker-compatible API 适配器访问同一 rootful Podman 实例，并以 host network 启动显式回环绑定的集成 PostgreSQL；`DOCKER_HOST=unix:///run/podman/podman.sock` 是第三方客户端要求的兼容变量，不授权安装 Docker CLI、创建 `/run/docker.sock` 别名、开放 TCP API 或建立第二容器运行时。socket 权限等价于该 rootful Podman 用户的任意代码执行能力，因此只绑定本机 Unix socket，不映射到网络，并仅在受控验证发行版中启用。

Anolis AppStream 当前冻结 Podman `4.9.4-rhel`。运行基线必须记录 Podman/Conmon/OCI runtime 的精确 NEVRA、`overlay` 存储驱动、发行版 CNI 元数据后端、`k8s-file` 日志驱动、rootful 状态和 socket 路径；CNI 仅是被观察的发行版配置，不授权受管容器进入桥接网络。运行模块对每只长期容器设置 10 MiB 日志上限；缺失镜像、摘要不匹配、socket 未激活、Docker 可执行文件重新出现、版本或运行时配置漂移都必须失败关闭。正式运行不得拉取镜像；镜像取得只能作为正式运行之前的显式基线装配动作。

本决策只替换现行容器运行时、资源身份和生命周期设计，不改写历史事实。ADR-0110 与 `receipt-20260808.json` 中的 `AnolisOS-8.9-x86_64-docker.tar` 是创建 WSL 根文件系统所用官方归档的真实名称，既有 Docker 初始化回执和既有失败证据继续保持不可变；现行运行时状态由新的 Podman 迁移回执和 `runtime-baseline.lock.json` 表达。容量运行仍禁止其他 WSL 发行版以及 Docker Desktop、Podman Machine 等额外 WSL 后端并发，ADR-0110 的资源包络、证据资格和非生产边界不变。

参考：[Podman system service](https://docs.podman.io/en/latest/markdown/podman-system-service.1.html)、[Testcontainers for Node 支持的运行时](https://node.testcontainers.org/supported-container-runtimes/)、[Podman run 日志限制](https://docs.podman.io/en/latest/markdown/podman-run.1.html)。
