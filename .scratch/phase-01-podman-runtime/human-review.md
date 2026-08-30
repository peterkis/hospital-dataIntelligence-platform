# AR-11 Podman 运行时权威人工复核输入

Status: ready-for-human

本文件是 AR-11 本地整改完成后的人工复核输入，不是人工接受记录、真实 Anolis/Podman readiness、shared readiness、正式 ABG、Phase 01 accepted 或生产就绪结论。Podman 工作包继续保持 `ready-for-human`；AR-12 仍须在另行授权后基于当时冻结的当前 HEAD 执行真实环境重基线。

## 冻结范围与提交

- 开工固定点：`7ef55be50b4e71789667ca7aa262c2f59c71320d`，分支 `phase-01-acceptance-readiness`，开工工作树 clean，开工时与 origin divergence 为 `0 0`。
- AR-11 实现与审查修复提交：
  - `ebd19ad205539695600b66ec82efdbf81957706c` — single Podman authority 与 partial-startup cleanup。
  - `9ad9fa2ad4f750f77259e88ec32db12811cea03c` — fail-closed cleanup 审查修复。
  - `e8d56f46e561048132734a20279fa61113dab789` — cleanup 全程使用冻结 authority。
  - `2feaee74944761ca42dd2f9b92e9d4c3f13b2795` — standalone teardown 使用 preflight-frozen authority snapshot。
  - `4f8032b10cdadcb3d95d5cb44bbf82c52458fb18` — snapshot 绑定 producer manifest 与 Git blob。
  - `5601bb9c18ac93f872846821fb3340f9b56d80ad` — reviewer 复用同一次 provenance 验证的 authority blob，消除第二次 Git lookup TOCTOU。
  - `fd8f0d7c4658c717e06d14ba950b2befce976915` — producer commit 显式绑定冻结 run commit。
- Standards 与 Spec 两个既定只读审查轴均在最终实现 HEAD `fd8f0d7c4658c717e06d14ba950b2befce976915` 返回 `APPROVED`，无剩余 finding；审查未运行真实服务、shared readiness 或正式 ABG。

## 唯一机器可读 authority

- 路径：`phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json`。
- Schema：`schemaVersion: 3`。
- ID：`phase-01.podman-runtime-authority.v1`。
- 完整文件 byte SHA-256：`20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`。
- `.authority` canonical semantic digest：`96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c`。
- 只有 `.authority` 提供正式期望值；`.observations`、`rules`、Podman 迁移 receipt 与历史 Docker 数据只提供观察、规则说明或 provenance，不形成第二 authority。
- `runtime/runtime-authority-snapshot.json` 是按 run identity、byte/semantic digest、canonical producer source manifest、producer commit 和该 commit 中精确 Git blob 绑定的派生恢复 evidence；它不是可编辑的第二 authority。Standalone teardown 在任何 discovery/mutation 前完成上述绑定；reviewer 复用同一 provenance pass 已认证的 blob，commit 不可用保持 `UNVERIFIABLE`，实际不一致归 integrity failure。

## 冻结 Podman metadata

- Podman：`4.9.4-rhel`；rootful：`true`（authority 字段 `rootless: false`）；Unix socket：`/run/podman/podman.sock`。
- 存储：`overlay`；graphroot `/var/lib/containers/storage`；runroot `/run/containers/storage`。
- OCI runtime：`runc`；network backend：`cni`；log driver：`k8s-file`；cgroup manager：`systemd`；events backend：`file`。
- 五个精确 RPM NEVRA：
  - `podman-4:4.9.4-34.0.1.module+an8.10.0+11435+30029c08.x86_64`
  - `conmon-3:2.1.10-1.module+an8.10.0+11427+f88b498a.x86_64`
  - `containers-common-2:1-82.0.1.module+an8.10.0+11427+f88b498a.x86_64`
  - `runc-4:1.2.9-4.module+an8.10.0+11427+f88b498a.x86_64`
  - `containernetworking-plugins-1:1.4.0-8.0.1.module+an8.10.0+11427+f88b498a.x86_64`
- 正式容器和 Testcontainers 合成路径均固定 `restart=no` 并在创建后 inspect；禁止 generated systemd unit、Quadlet、auto-update 或其他自动复活路径。
- 网络只允许 host mode、进程层绑定 `127.0.0.1` 的冻结端口；bridge networking 与 port publishing 均禁止。

## Docker 与第二 authority 排除

- 失败关闭地排除 `docker`、`dockerd`、`docker-proxy` 可执行文件/进程，`/run/docker.sock`、`/var/run/docker.sock` 及 alias/symlink，`docker.service`、`docker.socket`，TCP `2375`/`2376`，Podman TCP API、非预期 remote endpoint 与第二 container authority。
- Testcontainers 唯一允许的兼容变量是 `DOCKER_HOST=unix:///run/podman/podman.sock`，它只访问同一 rootful Podman Unix socket，不表示 Docker Engine authority。

## 生命周期、cleanup 与所有权

正式 runtime state machine 共 12 个阶段：

1. `AUTHORITY_VALIDATED`
2. `BASELINE_VALIDATED`
3. `RESOURCE_NAMES_CONFIRMED_ABSENT`
4. `POSTGRES_VOLUME_CREATED`
5. `KEYCLOAK_VOLUME_CREATED`
6. `POSTGRES_CONTAINER_CREATED`
7. `POSTGRES_CONTAINER_STARTED`
8. `POSTGRES_RESTART_POLICY_VERIFIED`
9. `KEYCLOAK_CONTAINER_CREATED`
10. `KEYCLOAK_CONTAINER_STARTED`
11. `KEYCLOAK_RESTART_POLICY_VERIFIED`
12. `UP_COMPLETE`

- 任一 partial-startup 失败都按 Keycloak container → PostgreSQL container → Keycloak volume → PostgreSQL volume 反向收尾；runtime up 后的 readiness、bootstrap migration、seed 或 schema verification 失败也调用同一 `down` 路径，并同时保留原始错误和 cleanup 结果。
- 每次 stop/remove 前重新 inspect；只有名称属于当前 `runtimeNamespace` 且以下五个必需标签全部存在并匹配当前 run 才允许精确变更：`hdi.repository`、`hdi.phase`、`hdi.run-id`、`hdi.run-sequence`、`hdi.managed-by`。附加无关 metadata 标签不影响所有权；缺失、不一致、inspect 运行错误或非规范名称都保留资源并失败关闭。
- Teardown 只逐个删除精确对象；Testcontainers/probe 路径也先捕获 ID，再以名称、完整五标签和 `restart=no` 复核后精确删除。没有 `podman * prune`、`podman system reset`、宽泛 stop/remove 或按猜测清理。

## Evidence contract 与 provenance

- 当前 tuple：run plan `v4` / authority `v3` / producer evidence `v2` / producer index `v2` / gate result `v3` / run summary `v5` / terminal conclusion `v2` / runtime outcome `v3` / evidence manifest `v1`。
- 变更原因：run plan、summary、terminal conclusion 与 runtime outcome 新增 reader-visible runtime authority byte/semantic identity、cleanup 后稳定性及相关绑定；producer/gate envelope 未改变。
- 当前 tuple 与当前定义是 `EXACT`；AR-10 历史 tuple（run plan `v3`、authority `v2`、summary `v4`、terminal `v1`、outcome `v2`）是 `INCOMPATIBLE`，不能形成正式 review pass。
- Clean-HEAD `fd8f0d7c4658c717e06d14ba950b2befce976915` source-manifest 自检：`PASSED`、43 个文件、`sourceFilesDigest=48a6fd9a67f13a02df0bb46b56ddcbb87b1b78765e488e364155062d83365415`、`producerSourceManifestSha256=1479eb522b5512468a2f1cc2ccb37aafd1416c0756f4b798de1f63113c42cd5d`、工作树 `CLEAN`。Closeout Markdown 不属于该 43 文件权威集合，因此不会改变 `sourceFilesDigest`。
- Mutation：`mutationCount=140`、`detectedCount=140`、`survivedCount=0`。

## 验证记录

最终适用结果均只使用 fake CLI、DI/mock adapter、合成 evidence、合成文件系统或静态检查：

- Verification tooling typecheck：exit 0；governance-api typecheck：exit 0。
- 五只变更 Shell 的 `bash -n`：exit 0。
- `verify:podman-runtime-authority`：exit 0，`PASSED`，rootful、socket、`restart=no` 与两项 authority digest 精确匹配。
- Podman 定向套件：5 files / 173 tests passed。
- Lifecycle 定向套件：10 files / 217 tests passed。
- Adversarial：1 file / 142 tests passed；140/140 mutations detected，0 survived。
- Provenance：4 files / 93 tests passed。
- 最终 verification 全量：22 files / 495 tests passed。
- Testcontainers Podman lifecycle guard：1 file，8 passed / 3 个真实运行时用例 skipped。
- Snapshot standalone teardown：1 file / 6 tests passed；覆盖 live disk invalid/B 下 authority A cleanup、missing/tampered/mismatched snapshot、producer manifest/Git blob 绑定及 mutation 前失败关闭。
- 六条 standalone：authority 正例、Docker socket alias 负例、persistent restart 负例、Keycloak create failure cleanup、bootstrap migration failure cleanup、byte-identical exact provenance 均 exit 0；对应 focused 计数分别为 authority verifier `PASSED`、1/54、1/26、1/48、1/48、1/2。
- ABG coverage、repo layout、module boundaries、五只 Shell syntax、authority verifier、source-manifest verifier 与 `git diff --check` 均 exit 0。

开发期被后续成功结果取代的失败尝试仍保留边界：

- 三次较早全套尝试只在受负载影响的 5s/30s 测试预算或临时目录收尾竞态上超时；测试文件采用有界 15s/60s 预算后完整套件通过。
- 一条错误引用的 npm Testcontainers 过滤命令曾尝试 runtime discovery，并在 `Could not find a working container runtime strategy` 处立即失败；未创建/启动容器或服务。正确的 direct Vitest guard 命令随后 8/8 通过、3 个真实用例 skipped。
- 最终 closeout 前一次完整 suite 因宿主会话暂停约 19 分钟，三个无关测试分别超过 15s/30s/60s，得到 492/495；三个路径恢复后均通过，随后完整 suite 495/495 通过。
- 对 adversarial 单 mutation 使用 `-t` 会触发该套件要求汇总全部 140 mutations 的总量断言，因此该过滤命令不构成有效 isolated acceptance；完整 adversarial 142/142 随后通过。

## 人工复核边界

- 本轮没有启动 PostgreSQL、Keycloak、Chrome、真实 Podman 容器、Docker、systemd unit、socket service、TCP listener 或 shared readiness；没有执行正式 ABG。
- 没有运行 prune/reset，也没有删除用户/旧运行资源；没有触发 architecture stop line；没有修改业务模块、数据库迁移、冻结 OpenAPI 或生成客户端。
- AR-11 的 `resolved` 只表示本地整改、规定的安全验证和双轴只读审查完成。AR-12 保持 `ready-for-agent` 且未认领，必须在另行授权后以新的冻结 HEAD 在真实 Anolis/rootful Podman 环境重建 baseline/readiness；AR-07 继续 blocked by AR-12 和明确的正式执行授权。

## Review decision

本段记录仓库责任人在完整阅读上述复核输入后作出的后续决定；上文保留的是决定前的原始复核内容与边界。

- Decision: APPROVED
- Scope: implementation and synthetic fail-closed verification only
- Reviewed candidate: ab48a26463332d6639ab9c642377235e9c8d0062
- Real-environment acceptance: NOT PERFORMED
- Formal ABG acceptance: NOT PERFORMED
- Production readiness: NOT CLAIMED
- Next required gate: AR-12
