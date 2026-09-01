# 11 — Podman 运行时权威加固

Status: resolved

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

- [x] 预检能证明只有预期 rootful Podman Unix socket/运行时权威存在，并对 Docker socket/daemon/远程 API 或第二 authority 失败关闭。
- [x] Restart policy 被明确冻结、验证并保证终态/teardown 后资源不会自动复活。
- [x] 任一 partial-startup 失败都留下稳定错误证据，并只清理重新核验为当前运行所有的精确资源；无标签或标签不全资源保持不动。
- [x] 定向测试覆盖每个创建阶段、所有权漂移、socket alias、restart 和残留资源路径，禁止 prune/reset。
- [x] AR-11 完成后提供人工复核材料；人工复核前 Podman 工作包继续为 `ready-for-human`，且未运行正式 ABG。

## Comments

- 2026-08-30（AR-08 建立）：Podman 迁移已在 `5fc00d043dfbad213d647edae7be6df11016ba8a` 进入分支，但本 Ticket 的加固与人工复核尚未执行；等待 AR-10。
- 2026-08-30（AR-11 开工基线）：开工 HEAD 为 `7ef55be50b4e71789667ca7aa262c2f59c71320d`；`git status --short` 无输出；当前分支为 `phase-01-acceptance-readiness`；本地与 `origin/phase-01-acceptance-readiness` 的差异为 `0 0`；AR-10 已为 `resolved`。本任务只实施 AR-11，不授权启动 PostgreSQL、Keycloak、Chrome、真实 Podman 容器、shared readiness 或正式 ABG。
- 2026-08-30（AR-11 修改前问题定义）：以下均为静态审阅识别的**当前设计缺口**，不是已经发生的正式运行事故：
  1. 当前运行事实分散在 `runtime-baseline.lock.json`、Podman Shell 脚本、TypeScript preflight 常量、`formal-runtime-contract` 端口常量、teardown 和 frozen-inputs 代码中。
  2. 这些平行定义可能形成第二 authority，必须收敛为一个机器可读目标权威。
  3. `runtime-baseline.lock.json` 当前同时包含规范性事实和迁移/容量观察事实，需要明确 authority 与 observation 的边界。
  4. 当前 Podman 长期容器使用或可能使用非临时 restart policy；正式验收容器必须明确冻结为 `restart=no`。
  5. Docker 排除需要覆盖 `/run/docker.sock`、`/var/run/docker.sock`、socket alias 或符号链接、`docker.service`、`docker.socket`、`dockerd`、`docker-proxy`、TCP Docker/Podman API、非预期 `DOCKER_HOST` 与第二 remote container endpoint，而不能只检查常见 CLI 文件路径。
  6. `DOCKER_HOST=unix:///run/podman/podman.sock` 仅是 Testcontainers compatibility endpoint，不能解释为 Docker Engine authority。
  7. Podman runtime module 顺序创建卷和容器，任一中间步骤失败都可能遗留部分资源。
  8. 即使 `podman ... up` 成功，后续 readiness、migration、seed 或 schema check 失败仍可能留下已启动容器，因此 bootstrap 层也必须受控失败收尾。
  9. 所有清理都必须在删除前重新核验当前运行的完整五标签；标签缺失或不一致时必须保留资源并失败关闭，不能猜测所有权。
  10. AR-10 已冻结 35 个验证权威文件；AR-11 新增或修改运行权威文件时必须同步更新 source manifest registry、producer provenance 和精确 reviewer 回归。
- 2026-08-30（AR-11 完成）：实现及审查修复提交为 `ebd19ad205539695600b66ec82efdbf81957706c`、`9ad9fa2ad4f750f77259e88ec32db12811cea03c`、`e8d56f46e561048132734a20279fa61113dab789`、`2feaee74944761ca42dd2f9b92e9d4c3f13b2795`、`4f8032b10cdadcb3d95d5cb44bbf82c52458fb18`、`5601bb9c18ac93f872846821fb3340f9b56d80ad`、`fd8f0d7c4658c717e06d14ba950b2befce976915`。唯一 authority 为 `runtime-baseline.lock.json` 的 schema v3 `.authority`，byte SHA-256 为 `20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`，semantic digest 为 `96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c`。最终 clean-HEAD source manifest 为 43 文件、`sourceFilesDigest=48a6fd9a67f13a02df0bb46b56ddcbb87b1b78765e488e364155062d83365415`；verification 全量 22 files / 495 tests、Podman 173、lifecycle 217、provenance 93、adversarial 142 均通过，140/140 mutations detected、0 survived；Standards 与 Spec 两轴只读复审均 `APPROVED`。人工复核输入见 `.scratch/phase-01-podman-runtime/human-review.md`。本轮仅使用 fake/DI/mock/合成资产，未启动真实服务或容器，未执行 shared readiness/正式 ABG，未运行 prune/reset，Podman 工作包保持 `ready-for-human`；AR-12 仍须真实 Anolis/rootful Podman 重基线。
- 2026-08-30（HR-01 人工复核）：仓库责任人已完整复核 Podman 工作包并对 AR-11 最终候选 `ab48a26463332d6639ab9c642377235e9c8d0062` 作出 `APPROVED` 决策。Podman human review prerequisite 已完成，AR-11 保持 `resolved`；该决定只确认实现、合成失败关闭验证和人工设计复核，不表示真实环境验收、正式 ABG 或生产就绪。AR-12 仍为 `ready-for-agent` 且未开始，AR-07 继续 `blocked`。
- 2026-08-30（AR-12 当前候选重验证）：初始重基线候选为 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`；不可覆盖运行目录为 `.runtime/rebaseline/ar-12/20260830-db57406-precloseout-r4`，`ar-12-rebaseline-summary.json` SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`。当前候选重新执行 `npm run verify:podman-runtime-authority`（exit `0`；rootful、socket `/run/podman/podman.sock`、`restart=no`、authority byte SHA-256 `20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`、semantic digest `96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c`）、`npm run test:verification:podman-runtime`（5 files / 173 passed，exit `0`）、`npm run test:verification:adversarial`（1 file / 142 passed；140/140 mutation detected、0 survived，exit `0`）及 `tooling/verification` 下的 `node ../../node_modules/vitest/vitest.mjs run src/runtime/formal-teardown-cli.test.ts`（1 file / 6 passed，exit `0`）。Testcontainers 合成 guard 在 `apps/governance-api` 下以 `node ../../node_modules/vitest/vitest.mjs run src/composition/phase-01-vertical-slice.integration.test.ts "--testNamePattern=Testcontainers Podman lifecycle guard"` 执行，1 file / 8 passed，3 个 real-runtime case 因本任务禁令按预期 skipped，exit `0`。五只受控 Shell 分别执行 `bash -n phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh`、`bash -n phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh`、`bash -n phase-plan/environment/anolis-8.9-wsl2/configure-podman-proxy.sh`、`bash -n phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh`、`bash -n phase-plan/environment/anolis-8.9-wsl2/verify-phase-01-runtime.sh`，均 exit `0`。
- 2026-08-30（AR-12 AR-11 standalone）：合法 authority 由上述 `npm run verify:podman-runtime-authority` 覆盖；其余五项在 `tooling/verification` 下分别执行 `node ../../node_modules/vitest/vitest.mjs run src/runtime/formal-preflight.test.ts "--testNamePattern=fails closed when Docker socket alias is detected"`、`node ../../node_modules/vitest/vitest.mjs run src/runtime/podman-runtime-authority.test.ts "--testNamePattern=rejects persistent restart"`、`node ../../node_modules/vitest/vitest.mjs run src/runtime/podman-runtime-shell.test.ts "--testNamePattern=fails KEYCLOAK_CONTAINER_CREATE closed, records PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED, and removes only exact current-run residues"`、`node ../../node_modules/vitest/vitest.mjs run src/runtime/podman-runtime-shell.test.ts "--testNamePattern=cleans the runtime after BOOTSTRAP_MIGRATION and retains BOOTSTRAP_MIGRATION_FAILED"`、`node ../../node_modules/vitest/vitest.mjs run src/testing/build-valid-evidence-fixture.test.ts "--testNamePattern=generates byte-identical, gate-specific evidence that all validation layers accept"`；各为 1 file / 1 passed、exit `0`，其余 skip 均为聚焦选择产生的预期 skip，六项 AR-11 standalone 全部符合预期。该 summary 明确 `formalAcceptanceEligible=false`、`formalAbgExecuted=false`、`realServicesStarted=false`；deny-shim side-effect invocation 为 0，未调用真实 Podman/Docker/systemctl/网络端点，未启动 PostgreSQL、Keycloak、Chrome 或容器，未执行 shared readiness 或正式 ABG。AR-11 保持 `resolved`，但 real-environment acceptance 与 formal acceptance 继续 `pending`，不声称 production readiness。
- 2026-09-01（AR-12R-05 Initial 当前候选复核）：opening HEAD `8f0999b0d1aa68c52a66660d795043fd547828f1` 的 Podman authority verification、5 files / 173 fake-runtime tests、8 passed / 3 expected real-runtime skipped、teardown 6/6及六项 AR-11 standalone 全部通过。Authority schema 3 / `phase-01.podman-runtime-authority.v1`、byte SHA `20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`、semantic digest `96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c` 均稳定；Initial Summary SHA-256 为 `833f6c9369b505257db3bc72f331d7db0371f7e7e56f7f475dbd17bf158a956b`。未启动真实 Podman/Docker或服务，real-environment acceptance、formal acceptance、production readiness 继续未取得。
- 2026-09-01（AR-07R-01影响）：唯一runtime authority与rootful/socket/remote/第二endpoint禁令未放宽。新增共用Machine inspection结果模型，稳定区分`NOT_APPLICABLE_NATIVE_ROOTFUL`、`NONE_REGISTERED`、`REGISTERED_MACHINE_PRESENT`、`RUNNING_MACHINE_PRESENT`、`REMOTE_CONNECTION_PRESENT`和`INSPECTION_FAILED`；teardown已移除旧的第二套`machine list`解析，preflight与cleanup共用同一实现。额外running WSL container backend继续失败，普通发行版仅registered未running不失败；本条不改变AR-11 `resolved`或既有人工复核边界，也不构成真实环境验收、正式ABG或生产就绪。
