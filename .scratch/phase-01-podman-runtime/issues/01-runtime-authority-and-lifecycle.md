# 01 — Podman 运行时权威与生命周期迁移

Status: resolved

## What to build

落实 ADR-0111：迁移 Anolis 基线装配、依赖启动、正式运行身份、预检、资源证据、受控清理、Testcontainers 适配、对抗夹具和现行文档，并生成不覆盖旧回执的新 Podman 迁移回执。AR-11在此历史迁移基础上把`runtime-baseline.lock.json`的`.authority`固定为唯一机器可读运行权威，并补齐authority identity、Docker/第二endpoint排他、`restart=no`及partial-startup/bootstrap失败收尾。

## Exit condition

Podman 成为唯一可执行容器运行时；所有当前受管容器与卷可由五项必需标签精确发现，并在每次变更前重新inspect后逐项清理，且只用host network、冻结回环端口和`restart=no`；附加无关元数据标签不影响所有权，但任一必需标签缺失或不一致时保留资源并失败关闭。Docker/Compose 仅剩已明确标注的历史事实、OCI registry 名称或精确`DOCKER_HOST=unix:///run/podman/podman.sock`兼容变量；Docker socket alias/TCP API和第二endpoint全部失败关闭，禁止prune/reset。AR-11所需fake/mock/DI验证与HR-01人工复核必须完成且不得启动真实服务或正式ABG；工作包在该范围保持`resolved`。AR-12按更晚的明确授权只完成当前HEAD静态/单元/合成/fake技术重基线；真实Anolis/rootful Podman baseline与readiness继续`pending`，仅可在用户另行授权的AR-07/正式执行阶段建立。

## Comments

- 2026-08-30：已在不清理 `/var/lib/docker` 的前提下，以 Anolis AppStream Podman `4.9.4-rhel` 替换冲突的 Docker RPM，并启用 `/run/podman/podman.sock`。旧 Docker 数据保留用于恢复；两只运行镜像已按原固定 registry digest 拉取到 Podman。
- 2026-08-30：Podman基线、PostgreSQL/Keycloak生命周期探针、11条空库迁移及生成类型权威、完整Testcontainers纵向集成、全仓测试/类型检查/构建/静态边界、152项验证工具测试（含60项对抗夹具）、脚本语法、JSON与回执摘要均通过。收尾检查为仓库标签容器0、卷0、网络0，冻结端口无监听；本结果不等于readiness或正式ABG。
- 2026-08-30（AR-11协议影响）：`runtime-baseline.lock.json`升级为schema v3并以稳定authority ID区分`.authority`与`.observations`；Shell通过`jq`、TypeScript通过严格schema loader共享同一authority，byte SHA-256和authority semantic digest进入frozen inputs且cleanup后复核。PostgreSQL、Keycloak、Testcontainers均要求`restart=no`并inspect；partial startup按Keycloak容器、PostgreSQL容器、Keycloak卷、PostgreSQL卷反向收尾，bootstrap在readiness、migration、seed或schema failure后调用同一`down`路径。Source manifest当前登记43个文件，receipt只以`RUNTIME_RECEIPT`角色保留，不能替代`RUNTIME_AUTHORITY`。本条不改写上面的真实迁移事实；AR-11的合成验证不等于新的真实环境readiness、Podman工作包accepted或正式ABG。
- 2026-08-30（AR-11 closeout）：单一 authority、Docker/第二 endpoint 排他、`restart=no`、partial-startup/bootstrap 收尾、五标签删除前复核、冻结 snapshot 恢复及 producer manifest/Git blob 绑定均完成；最终 verification 22 files / 495 tests 和 140/140 mutation 检出通过，双轴只读复审 `APPROVED`。人工复核输入见 `../human-review.md`。本 Ticket 和工作包保持 `ready-for-human`，未自动标记 accepted；AR-12 必须在真实 Anolis/rootful Podman 环境重验。
- 2026-08-30（HR-01 人工复核）：人工复核决策为 `APPROVED`；被复核 AR-11 最终提交为 `ab48a26463332d6639ab9c642377235e9c8d0062`；authority `schemaVersion` 为 `3`，`authorityId` 为 `phase-01.podman-runtime-authority.v1`；runtime authority byte SHA-256 为 `20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`，semantic digest 为 `96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c`；mutation 为 140/140、survived 0，verification full suite 为 495/495。该`resolved`只表示AR-11实现和人工设计复核完成；未启动真实服务，未执行正式ABG，不表示真实Podman环境验收或生产就绪；AR-12和AR-07仍为后续独立门禁。
- 2026-08-30（AR-12 合成重基线）：候选 `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` 的初始重基线 summary SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`；Podman runtime 5 files / 173 passed、Testcontainers synthetic guard 8 passed（3 个 real-runtime case 按授权边界 skipped）、standalone teardown 6/6、六项 AR-11 standalone 均通过。summary 明确 `formalAcceptanceEligible=false`、`realServicesStarted=false`、`formalAbgExecuted=false`。本 Ticket 和工作包保持 `resolved`，但该轮完全是静态/fake/mock/合成验证；真实 Podman 环境验收、正式 ABG 与 production readiness 均未取得，real-environment acceptance 和 formal acceptance 继续 `pending`。
