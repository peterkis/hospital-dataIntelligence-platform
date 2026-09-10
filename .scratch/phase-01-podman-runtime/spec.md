# Phase 01 Podman 运行时迁移

Status: resolved

Scope: 将现行 Phase 01 容器运行时、运行身份、预检、受控清理、Testcontainers 适配、Anolis 装配脚本、运行手册和机器可读基线从 Docker/Compose 迁移为单一 rootful Podman 权威；AR-11进一步把唯一机器可读权威固定为`phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json`的`.authority`对象。历史 ADR、历史回执、`.observations`和既有终态证据只记录决策、观察或历史事实，不提供第二份运行期望，也不改写既有事实。

## Objective

在不改变 PostgreSQL、Keycloak、领域行为、数据库迁移、冻结 OpenAPI 或 ABG 语义的前提下，使本仓库所有现行容器路径只依赖 Podman，并以同一五标签所有权模型失败关闭地完成预检、运行和逐项 teardown。

## Boundaries

- 不执行正式 ABG、Chrome 或独立复核。
- 不运行 `podman prune/reset`，不删除无完整 HDI 标签的资源。
- 不把 `docker.io` OCI registry、Testcontainers 的 `DOCKER_HOST` 兼容变量或历史根文件系统归档名称误写为 Docker Engine 依赖。
- 不覆盖 `.runtime/evidence/` 中既有终态证据，不回写历史回执。
- 不改变既有固定镜像 digest、数据库持久化语义或业务契约。
- 不允许Docker CLI/daemon/socket alias/systemd unit/process/TCP API、Podman TCP API、第二Podman connection或其他container endpoint；Testcontainers只允许精确`DOCKER_HOST=unix:///run/podman/podman.sock`访问同一Podman authority。
- 所有正式验证容器固定`restart=no`且创建后inspect；不得生成systemd unit、Quadlet或auto-update等持久化路径。
- Partial startup和bootstrap failure只按当前run逐项反向收尾；每次变更前重新inspect，五个必需标签任一缺失或不一致即保留资源并失败关闭。

## Completion Criteria

1. Anolis 运行时固定 Podman 精确版本、rootful Unix socket、存储/网络/日志配置和两只固定 digest 镜像；Docker Engine/CLI/Compose 不再是可执行依赖。
2. `runtimeNamespace` 替代 Compose project identity；受管容器与卷带完整五标签，容器只用host network并在进程层绑定冻结回环端口，不创建仓库专属网络或端口发布规则。
3. 正式预检记录 Podman 与镜像身份并拒绝漂移、缺失及仓库遗留资源；teardown 只逐项删除重新核验所有权的当前运行资源。
4. Testcontainers 只经 `/run/podman/podman.sock` 兼容适配访问同一 Podman 权威。
5. 活跃脚本、设计、运行手册、故障矩阵和测试不再依赖 Docker/Compose；历史事实保留并有明确说明。
6. 初始Podman迁移期的基线与真实PostgreSQL集成验证作为历史结果保留；AR-11只执行验证工具专项、fake CLI/DI测试、类型检查和仓库静态检查，不重跑真实依赖。两类结果都不得据此声称当前readiness、正式ABG或生产就绪。
7. `runtime-baseline.lock.json`固定`schemaVersion: 3`、`authorityId: phase-01.podman-runtime-authority.v1`；Shell通过`jq`、TypeScript通过严格schema loader读取同一`.authority`，byte SHA-256与authority semantic digest进入frozen inputs并在cleanup后复核。
8. `.observations`、Podman迁移receipt和历史Docker数据只保留provenance/恢复事实，不参与正式期望值解析；source manifest以不同角色登记authority、loader/schema、运行脚本及receipt，不混淆其语义。
9. PostgreSQL、Keycloak及Testcontainers PostgreSQL均显式`restart=no`并inspect；preflight拒绝任何自动重启或生成持久化单元，teardown记录restart-policy findings。
10. `up`各失败点及中断均按Keycloak容器、PostgreSQL容器、Keycloak卷、PostgreSQL卷反向清理；runtime up后的readiness、migration、seed、schema verification失败由bootstrap调用相同`down`路径，并同时保留原始错误和cleanup结果。
11. 删除前重新inspect资源；只有名称属于当前namespace且`hdi.repository`、`hdi.phase`、`hdi.run-id`、`hdi.run-sequence`、`hdi.managed-by`五个必需标签全部存在并匹配当前run时才允许变更。附加的无关元数据标签不影响所有权；必需标签缺失/不一致、inspect失败或名称不规范时必须保留并失败关闭。
12. AR-11只允许fake CLI、DI/mock adapter和合成文件系统验证。HR-01记录人工复核`APPROVED`后，本工作包仅按“AR-11实现和人工设计复核完成”的范围转为`resolved`；AR-12按当前更晚且明确的授权只执行静态/单元/合成/fake技术重基线。真实Anolis/rootful Podman baseline与readiness留给用户另行授权的AR-07/正式执行阶段。该`resolved`及AR-12通过都不表示真实Podman环境验收、正式ABG或生产就绪。
13. `.scratch/phase-01-podman-runtime/human-review.md`保留AR-11实现提交、authority路径/schema/ID及byte/semantic digest、Podman metadata、`restart=no`、Docker socket/daemon/TCP排他、精确兼容`DOCKER_HOST`、partial-startup/bootstrap cleanup、五标签规则、禁止prune/reset、43文件source manifest、定向测试/mutation总数及当时的前置边界，作为不可改写的人工复核历史。当前执行边界以更晚的AR-12明确授权为准：AR-12不得运行真实容器或真实环境验收，真实运行仍须由AR-07的单独授权建立。

## Comments

- 2026-08-30：用户明确要求将 Docker 改为 Podman，并调整整个现行设计。AR-07 的 Docker 路径停止，`runSequence 9` 不在旧设计上启动。
- 2026-08-30：实现与本地验证完成。直接Podman运行模块、host network回环端口、五标签所有权、预检/teardown、Testcontainers适配、基线回执、ADR和活跃设计已一致；未启动新的readiness、正式ABG、Chrome或独立复核。
- 2026-08-30（AR-08 状态复核）：Podman 迁移已进入代码分支，但尚未形成正式 ABG evidence；本工作包继续保持 `ready-for-human`。AR-11 将完成 authority、restart、Docker socket 和 partial-startup hardening，并在完成后接受人工复核；只有 AR-12 完成最新基线重新验证后，才可解除其对 AR-07 的阻断。
- 2026-08-30（AR-11协议影响）：唯一机器可读运行权威收敛为`runtime-baseline.lock.json`的`.authority`（schema v3、稳定authority ID），Shell/TypeScript共同读取该文件；`.observations`和迁移receipt继续只作历史观察/provenance。正式生命周期新增authority字节/语义摘要冻结及cleanup后复核、Docker socket alias/TCP/第二endpoint排他、精确Podman兼容`DOCKER_HOST`、`restart=no`、partial-startup/bootstrap反向收尾和删除前五个必需标签复核。该变化不改写前述真实迁移验证事实，也不构成新的真实环境readiness或正式ABG；AR-12仍负责当前HEAD的真实Anolis/Podman重基线。
- 2026-08-30（AR-11 closeout）：AR-11 已在最终实现 HEAD `fd8f0d7c4658c717e06d14ba950b2befce976915` 完成规定的 fake/DI/mock/合成验证，verification 全量 22 files / 495 tests、140/140 mutations detected 且 0 survived，Standards/Spec 双轴只读复审均 `APPROVED`。人工复核输入见 `human-review.md`。本工作包继续保持 `ready-for-human`：没有新的真实 Anolis/Podman readiness、人工 accepted、shared readiness 或正式 ABG；AR-12 仍须在另行授权后真实重基线。
- 2026-08-30（HR-01 人工复核）：仓库责任人已对 AR-11 最终候选 `ab48a26463332d6639ab9c642377235e9c8d0062` 作出 `APPROVED` 决策，本工作包转为 `resolved`。该状态只表示 AR-11 实现和人工设计复核完成；未执行真实 Podman 环境验收或正式 ABG，不声称生产就绪。AR-12 的统一重基线和 AR-07 的正式执行仍是后续独立门禁。
- 2026-08-30（AR-12 合成重基线）：候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 的初始 AR-12 重基线已通过；summary SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`，并明确 `formalAcceptanceEligible=false`、`realServicesStarted=false`、`formalAbgExecuted=false`。本工作包保持 `resolved`，但该轮只使用静态、fake/mock/DI 与合成 fixture，没有启动真实 Podman 或其他服务，不构成真实环境验收、正式 ABG 或 production readiness；real-environment acceptance 与 formal acceptance 继续 `pending`。
