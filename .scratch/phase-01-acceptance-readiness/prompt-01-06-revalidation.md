# AR-12 — Prompt 1～6 与 AR-09～AR-11 当前 HEAD 技术重基线

Status: final-rebaseline-failed — AR-12 已按非覆盖恢复流程回到 claimed

本报告记录正式 ABG 前的技术重基线，不是正式 ABG evidence package，不具备正式验收资格。当前授权明确禁止 PostgreSQL、Keycloak、Chrome、真实 Podman、shared readiness、正式 ABG 和独立正式 evidence acceptance；只允许静态、单元、类型、构建、合成 fixture、fake/mock runtime 和列表检查。

## 冻结开工基线

- Branch: `phase-01-acceptance-readiness`
- Opening HEAD: `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`
- Opening worktree: `CLEAN`
- Origin divergence: `0 0`
- Podman human review: `APPROVED`，仅覆盖实现与合成失败关闭验证
- Real-environment acceptance: `NOT PERFORMED`
- Formal ABG acceptance: `NOT PERFORMED`
- Production readiness: `NOT CLAIMED`
- Formal acceptance eligible: `false`

开工命令的原始输出记录在 AR-12 Ticket 的本次 Comments 中。本报告在运行任何基础检查、测试或安装前创建，以下内容是执行计划，不是通过声明。

## 执行拓扑与不可覆盖规则

AR-12 的 claim、map 和本计划按要求保持未提交，因而主工作区在计划落盘后不再是 Git-clean；与此同时，source-manifest 和 baseline identity 要求执行目录从第一条命令起为 `CLEAN`。初始重基线因此使用当前本地仓库对象、同一精确 opening HEAD 和同名目标分支创建一个不联网的临时 execution clone，随后把其 `origin` 身份恢复为当前仓库的 GitHub origin；输出写回主仓库内新的 `.runtime/rebaseline/ar-12/<date>-<sha>-precloseout` 目录。该安排不切换当前工作区分支，不使用 `checkout/reset/stash/clean/merge/rebase`，不引入另一提交，也不把未提交 Markdown 纳入候选源码身份。Closeout 提交后的最终重跑直接在 clean 的目标分支工作区执行。

- 每个运行目录必须以不存在的路径独占创建；存在即失败。
- 每条命令使用独立、不存在的子目录，并分别写入 `command.json`、`stdout.log`、`stderr.log`、`result.json`。
- 命令使用现有 `SpawnRuntimeCommandRunner`；写入和脱敏使用现有 evidence recorder 的 exclusive/redacted writers，不建立第二套验证权威。
- `.runtime` 产物不提交；失败目录保留；重跑必须使用新目录。
- 日志先由现有 recorder 脱敏，再对配置 secret 的原值及 URL encoded、Base64、Base64url、JSON escaped、PowerShell/shell quoted 派生值执行只读扫描；扫描器不得记录 secret 或派生值。
- 初始和结束身份都从当前权威模块计算；source-manifest 重建固定同一 `startedAt`，避免把生成时间变化误判为源码漂移。

## Prompt 1～6 与 AR-09～AR-11 执行矩阵

| 工作项 | 需要重验的能力 | 当前权威命令或测试 | 分类 |
| --- | --- | --- | --- |
| AR-01 | 40 门禁矩阵、唯一断言、selector、派生报告 | `npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/abg-coverage-matrix.test.ts`; `npm run verify:abg-coverage` | SAFE_UNIT / SAFE_STATIC |
| AR-02 | producer evidence 协议、写入安全、脱敏、validator | `npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/evidence`；verification 全量 | SAFE_UNIT |
| AR-03 | gate-specific proof、selector、引用、摘要 | `npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/abg-gate-proof.test.ts`；verification 全量 | SAFE_UNIT |
| AR-04 | independent reviewer、Manifest、只读、lifecycle review | `npm run test:verification:provenance`; reviewer CLI 只指向新建合成 fixture 与独占 review 输出 | SAFE_SYNTHETIC_RUNTIME |
| AR-05 | preflight、controller、teardown、signal、失败证据 | `npm run test:verification:lifecycle`; `formal-teardown-cli.test.ts` 6 项合成 snapshot | SAFE_SYNTHETIC_RUNTIME |
| AR-06 | 全部对抗 mutation、零 survivor | `npm run test:verification:adversarial`，不使用 `-t` 过滤 aggregate suite | SAFE_SYNTHETIC_RUNTIME |
| AR-09 | cleanup 后 terminal conclusion、ABG-40、summary v5 | lifecycle 全量；reviewer 3 项 terminal 合成场景 | SAFE_SYNTHETIC_RUNTIME |
| AR-10 | source provenance、EXACT/COMPATIBLE/INCOMPATIBLE | `npm run test:verification:provenance`; `npm run verify:verification-source-manifest`; reviewer 5 项 provenance 合成场景 | SAFE_STATIC / SAFE_SYNTHETIC_RUNTIME |
| AR-11 | 单一 Podman authority、Docker 排除、restart、partial cleanup | `npm run test:verification:podman-runtime`; `npm run verify:podman-runtime-authority`; 精确过滤 Testcontainers guard；五只 Shell `bash -n` | SAFE_STATIC / SAFE_SYNTHETIC_RUNTIME |

当前根命令的正确 Podman 别名是 `npm run test:verification:podman-runtime`；根目录不存在 `npm run test:podman-runtime`，不得引用旧别名。

## 命令分类

### SAFE_STATIC

```text
npm run check:runtime
npm run check:repo:layout
npm run check:module-boundaries
npm run typecheck
npm run typecheck --workspace @hospital-data-intelligence/governance-api
npm run typecheck --workspace @hospital-data-intelligence/verification-tooling
npm run build
npm run contract:lint
npm run verify:abg-coverage
npm run verify:verification-source-manifest
npm run verify:podman-runtime-authority
npm run test:e2e:list
git diff --check
bash -n phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh
bash -n phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh
bash -n phase-plan/environment/anolis-8.9-wsl2/configure-podman-proxy.sh
bash -n phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh
bash -n phase-plan/environment/anolis-8.9-wsl2/verify-phase-01-runtime.sh
```

`npm ci` 单独分类为 lockfile-bound dependency installation：允许为安装当前 lockfile 依赖联网；不得获取镜像、修改 runtime authority、使用 `npm exec --yes` 或修改 `package-lock.json`。

### SAFE_UNIT

```text
npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/abg-coverage-matrix.test.ts
npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/evidence
npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/abg-gate-proof.test.ts
npm run test --workspace @hospital-data-intelligence/verification-tooling
```

### SAFE_SYNTHETIC_RUNTIME

```text
npm run test:verification:lifecycle
npm run test:verification:adversarial
npm run test:verification:provenance
npm run test:verification:podman-runtime
node ../../node_modules/vitest/vitest.mjs run src/runtime/formal-teardown-cli.test.ts
node ../../node_modules/vitest/vitest.mjs run src/composition/phase-01-vertical-slice.integration.test.ts --testNamePattern=Testcontainers\ Podman\ lifecycle\ guard
```

最后一条从 `apps/governance-api` 执行，必须直接使用仓库已安装的 Vitest entry 和单一 `--testNamePattern` 参数；不得经 npm 转发 `-t`，不得删除或放宽过滤器。预期为 guard 8 passed、真实 runtime 3 skipped。

### REAL_SERVICE_FORBIDDEN

```text
npm run check
npm run check:database-authority
npm test
npm run test --workspace @hospital-data-intelligence/governance-api
npm run test:e2e
npm run verify:phase-01:live
npm run verify:phase-01:preflight
npm run verify:phase-01:teardown
node tooling/verification/src/run-shared-abg-verification.ts
```

另外禁止执行 governance `db:types:*`、任意未带 `bash -n` 的五只受控 Shell、应用 `dev/start`、真实 Testcontainers case、Podman、Docker、systemctl、真实 socket/TCP/HTTP endpoint 或运行镜像获取。

### FORMAL_ABG_FORBIDDEN

```text
npm run verify:phase-01:formal
```

Reviewer CLI 只允许针对本轮合成 fixture；不得指向真实/正式 evidence package。`report:abg-coverage` 与 contract generation 会修改 tracked 文件，不属于冻结重基线 allowlist。

## 最低回归门槛

| 套件 | 最低要求 |
| --- | ---: |
| Verification tooling | 22 files / 495 passed |
| Lifecycle | 10 files / 217 passed |
| Podman runtime | 5 files / 173 passed |
| Provenance | 4 files / 93 passed |
| Adversarial | mutationCount ≥ 140；detectedCount = mutationCount；survivedCount = 0 |
| Testcontainers synthetic guard | 8 passed；3 个真实 runtime 测试按授权边界 skipped |
| Standalone teardown snapshot | 6/6 passed |

数量下降默认失败，必须定位被删除、过滤或跳过的具体测试；不得以无证据的“合并测试”解释。除明确的 3 个 real-runtime guard skipped 和逐场景精确过滤产生的 selection skips 外，任何 skipped 都失败关闭。

## 14 项 standalone 计划

| # | 场景 | 合成权威与预期 |
| ---: | --- | --- |
| 1 | AR-09 合法终态 | current fixture；reviewer `PASSED`，`failedCheckCount=0` |
| 2 | cleanup FAILED | `FORMAL_CLEANUP_STATUS_NOT_PASSED`，reviewer `FAILED` |
| 3 | terminal conclusion 缺失 | `FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING`，reviewer `FAILED` |
| 4 | AR-10 EXACT | `PASSED / VERIFIED / EXACT / NONE / CLEAN` |
| 5 | evidence 内部篡改 | integrity `FAILED`；provenance 不得误报 unavailable |
| 6 | producer commit unavailable | `UNVERIFIABLE`；`PRODUCER_COMMIT_UNAVAILABLE` |
| 7 | compatible definition drift | `FAILED / VERIFIED / COMPATIBLE / DRIFTED / CLEAN` |
| 8 | unsupported tuple | `FAILED / INCOMPATIBLE` |
| 9 | 合法 runtime authority | exit 0；rootful；`restart=no` |
| 10 | Docker socket alias | 非零 subject exit；`FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT` |
| 11 | restart `unless-stopped` | 非零 subject exit；`RUNTIME_AUTHORITY_RESTART_POLICY_INVALID` |
| 12 | Keycloak create failure | 保留原错误；当前 run 四项资源精确清理；无关资源保留 |
| 13 | bootstrap migration failure | 稳定 exit 83（或当前冻结码）；容器/volumes 精确清理；原错误与 cleanup evidence 均保留 |
| 14 | source provenance exact | `VERIFIED / EXACT / NONE / CLEAN / PASSED` |

AR-09/10 的持久化场景通过现有 `buildValidEvidenceFixture`、mutation/DI seam 和现有 reviewer CLI 组合；AR-11 场景通过当前 verifier、fake-PATH Shell harness 和当前定向测试。临时编排只调用这些现有权威，不复制 validator/reviewer 逻辑，不执行 evidence 内代码。

## 初始重基线结果

有效初始运行目录为 `.runtime/rebaseline/ar-12/20260830-db57406-precloseout-r4`；候选为 opening HEAD `db57406592b5afe18ac2e95f3ddd0e1bf40173ea`。`ar-12-rebaseline-summary.json` 状态为 `PASSED`，SHA-256 为 `57c0c37368ccb4335754af70c018062b57395c2379c0c6270f4acd06b90b61e1`。42 条允许命令全部 exit 0，0 failed、0 command skipped、0 unexpected test skipped；结束身份与基线完全一致，execution clone 保持 `CLEAN`。

### 冻结身份

| 字段 | 初始值 |
| --- | --- |
| Branch / Git SHA | `phase-01-acceptance-readiness` / `db57406592b5afe18ac2e95f3ddd0e1bf40173ea` |
| Node / npm | `24.18.0` / `11.9.0` |
| `package.json` SHA-256 | `2e88bcbda6def04680fc6427c15d2898f2edcbafb1dc59e72c8f40d04fbc1161` |
| `package-lock.json` SHA-256 | `12ae7ec25b010a6cad399ffcd42fc48785410db0668fc494217eeb9a3913415b` |
| Coverage digest | `465b7e619c6f9dd8178d8620d349976f358d3f7f8c440afbc42662329c1c2795` |
| Producer protocol digest | `aecbba1f952ff12dab58565197f05d3bdfb464a8582de6f5af00b55a17563346` |
| Source manifest | 43 files；`sourceFilesDigest=48a6fd9a67f13a02df0bb46b56ddcbb87b1b78765e488e364155062d83365415`；`manifestSha256=5d10a55c3db88533a62a87f85ff391d1f3e88ccf1b41d1052e883a0f77119388` |
| Runtime authority | schema `3`；id `phase-01.podman-runtime-authority.v1`；byte SHA `20af1706102a68c10ae4a9cf1c141d83c51078381187abe0436e176b7508c42f`；semantic digest `96442161a82bea15bbf01bf16a9d488335bdb55ca59a5ec0210ec7f412564b8c` |
| AR-12 composer | `sha256=685d6400f45f61591e8a49ab3c86a3f2890c8e847b07db0fc5cab4d89185ba10`；init/run/finalize 全阶段重核验稳定 |
| Original completion tree | 23 files；fingerprint `84f42a8eedbec08cb278f03fa477d4c58a2731349c8c0788334fffcc7dedd3a8`；未修改 |

Contract tuple：

```json
{
  "runPlanSchemaVersion": "phase-01.abg-run-plan.v4",
  "runPlanAuthorityId": "phase-01.repository-authoritative-plan.v3",
  "producerEvidenceSchemaVersion": "phase-01.producer-evidence.v2",
  "producerEvidenceIndexSchemaVersion": "phase-01.producer-evidence-index.v2",
  "gateResultSchemaVersion": "phase-01.abg-gate-result.v3",
  "runSummarySchemaVersion": "phase-01.abg-run.v5",
  "terminalConclusionSchemaVersion": "phase-01.formal-terminal-conclusion.v2",
  "runtimeOutcomeSchemaVersion": "phase-01.formal-runtime-outcome.v3",
  "evidenceManifestSchemaVersion": "phase-01.evidence-manifest.v1"
}
```

### Prompt 1～6 与 AR-09～AR-11 结论

| 工作项 | 当前候选重验证事实 | 结论 |
| --- | --- | --- |
| AR-01 | coverage focused 1 file / 8 tests；coverage verifier exit 0；全量共同覆盖 | PASSED |
| AR-02 | evidence focused 3 files / 16 tests；全量与 Secret/写入回归共同覆盖 | PASSED |
| AR-03 | gate-proof focused 1 file / 7 tests；全量共同覆盖 | PASSED |
| AR-04 | provenance 4 files / 93 tests；reviewer standalone 合成路径通过 | PASSED |
| AR-05 | lifecycle 10 files / 218 tests；standalone teardown 6/6 | PASSED |
| AR-06 | adversarial 142 tests；140/140 mutations detected；0 survived | PASSED |
| AR-09 | lifecycle 与三项 terminal standalone 当前重跑 | PASSED |
| AR-10 | provenance、source manifest self-check 与五项 standalone 当前重跑 | PASSED |
| AR-11 | Podman fake runtime 5 files / 173 tests；authority、guard、Shell failure paths 当前重跑 | PASSED（仅合成） |

### 全部命令与计数

表中的 `F/T` 是 Vitest passed files/tests；`skip` 只在后文分类。每条命令的完整 argv、cwd、已脱敏 stdout/stderr 与结果位于对应 `commands/<ordinal>-<id>/`。

| # | Command id | 分类 | Exit | Files/tests |
| ---: | --- | --- | ---: | --- |
| 1 | `npm-ci` | LOCKFILE_INSTALL | 0 | `npm ci --ignore-scripts --no-audit --no-fund` |
| 2 | `check-runtime` | SAFE_STATIC | 0 | - |
| 3 | `check-repo-layout` | SAFE_STATIC | 0 | - |
| 4 | `check-module-boundaries` | SAFE_STATIC | 0 | - |
| 5 | `typecheck-root` | SAFE_STATIC | 0 | - |
| 6 | `typecheck-governance-api` | SAFE_STATIC | 0 | - |
| 7 | `typecheck-verification-tooling` | SAFE_STATIC | 0 | - |
| 8 | `build` | SAFE_STATIC | 0 | - |
| 9 | `contract-lint` | SAFE_STATIC | 0 | - |
| 10 | `verify-abg-coverage` | SAFE_STATIC | 0 | - |
| 11 | `verify-source-manifest` | SAFE_STATIC | 0 | - |
| 12 | `verify-podman-authority` | SAFE_STATIC | 0 | - |
| 13 | `e2e-list` | SAFE_STATIC | 0 | - |
| 14 | `bash-syntax-bootstrap-phase-01-runtime` | SAFE_STATIC | 0 | - |
| 15 | `bash-syntax-bootstrap-phase-01` | SAFE_STATIC | 0 | - |
| 16 | `bash-syntax-configure-podman-proxy` | SAFE_STATIC | 0 | - |
| 17 | `bash-syntax-podman-phase-01-runtime` | SAFE_STATIC | 0 | - |
| 18 | `bash-syntax-verify-phase-01-runtime` | SAFE_STATIC | 0 | - |
| 19 | `ar01-coverage-focused` | SAFE_UNIT | 0 | 1F / 8T |
| 20 | `ar02-evidence-focused` | SAFE_UNIT | 0 | 3F / 16T |
| 21 | `ar03-gate-proof-focused` | SAFE_UNIT | 0 | 1F / 7T |
| 22 | `verification-full` | SAFE_UNIT | 0 | 22F / 495T |
| 23 | `verification-lifecycle` | SAFE_SYNTHETIC_RUNTIME | 0 | 10F / 218T |
| 24 | `verification-adversarial` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 142T；140 mutations |
| 25 | `verification-provenance` | SAFE_SYNTHETIC_RUNTIME | 0 | 4F / 93T |
| 26 | `verification-podman-runtime` | SAFE_SYNTHETIC_RUNTIME | 0 | 5F / 173T |
| 27 | `testcontainers-synthetic-guard` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 8T；3 expected real-runtime selection skips |
| 28 | `standalone-teardown-snapshot` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 6T |
| 29 | `ar09-valid-terminal-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 30 | `ar09-cleanup-failed-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 31 | `ar09-terminal-missing-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 32 | `ar10-exact-contract-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 33 | `ar10-commit-unavailable-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 34 | `ar10-compatible-drift-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 35 | `ar10-incompatible-tuple-fixture` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 36 | `ar10-evidence-tamper-observed` | SAFE_SYNTHETIC_RUNTIME | 0 | direct synthetic observation |
| 37 | `ar11-docker-socket-alias` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 38 | `ar11-persistent-restart` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 39 | `ar11-keycloak-create-failure` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 40 | `ar11-bootstrap-migration-failure` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 41 | `ar11-exact-source-provenance` | SAFE_SYNTHETIC_RUNTIME | 0 | 1F / 1T |
| 42 | `git-diff-check` | SAFE_STATIC | 0 | - |

### 14 项 standalone

| # | 场景 | 当前观察 / 断言 | 结果 |
| ---: | --- | --- | --- |
| 1 | 合法终态 | reviewer `PASSED`；`failedCheckCount=0` | PASSED |
| 2 | cleanup FAILED | reviewer `FAILED`；`FORMAL_CLEANUP_STATUS_NOT_PASSED` | PASSED |
| 3 | terminal conclusion 缺失 | reviewer `FAILED`；`FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING` | PASSED |
| 4 | EXACT | `PASSED / VERIFIED / EXACT / NONE / CLEAN` | PASSED |
| 5 | evidence 内部篡改 | 直接 synthetic observation：`evidenceIntegrityStatus=FAILED`、`producerProvenanceStatus=VERIFIED`、`reviewStatus=FAILED` | PASSED |
| 6 | producer commit unavailable | `UNVERIFIABLE`；`PRODUCER_COMMIT_UNAVAILABLE` | PASSED |
| 7 | compatible drift | `FAILED / VERIFIED / COMPATIBLE / DRIFTED / CLEAN` | PASSED |
| 8 | unsupported tuple | `INCOMPATIBLE / FAILED` | PASSED |
| 9 | 合法 authority | verifier exit 0；`rootless=false`；`restartPolicy=no`；byte/semantic digest 精确匹配 | PASSED |
| 10 | Docker socket alias | `FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT` | PASSED |
| 11 | persistent restart | `RUNTIME_AUTHORITY_RESTART_POLICY_INVALID` | PASSED |
| 12 | Keycloak create failure | 原错误保留；当前 run 四项资源精确清理；无关资源保留 | PASSED |
| 13 | bootstrap migration failure | 非零稳定 subject exit 与 `BOOTSTRAP_MIGRATION_FAILED`；容器/volumes 精确清理；原错误和 cleanup evidence 保留 | PASSED |
| 14 | source provenance exact | `VERIFIED / EXACT / NONE / CLEAN / PASSED` | PASSED |

### Skipped、Secret 与副作用

- Testcontainers guard 的 3 个 skipped 是被精确 test-name filter 排除的真实 runtime case，分类为 `EXPECTED_REAL_RUNTIME_FORBIDDEN`。
- 12 条聚焦 Vitest 命令的 selection skips 分别为 75×7、53、25、47×2、1；每条均精确执行 1 个目标测试，分类为 `EXPECTED_FOCUSED_SELECTION`。这些不是 aggregate suite 内的 skipped；全量、lifecycle、adversarial、provenance、Podman runtime 和 teardown 均为 0 skipped。
- `unexpectedSkippedCount=0`。
- Secret scan：`PASSED`；扫描 199 个运行产物；配置 secret 计数 0；raw/URL/Base64/Base64url/JSON/shell 派生值 finding 0；敏感赋值/完整容器 Env finding 0。命令日志在写入前另做派生值主动脱敏。
- Side-effect scan：`PASSED`；deny-shim invocation 0；sentinel 0；`EVIDENCE_EMBEDDED_SCRIPT_NOT_EXECUTED` mutation 已检测。完整源审计确认除获准的 lockfile 依赖获取外，当前 literal allowlist 不访问真实服务；Redocly telemetry/update notice 被显式关闭。
- 真实 PostgreSQL、Keycloak、Chrome、Podman、Docker 和 systemctl 均未启动或调用；shared readiness、正式 ABG、独立正式 evidence acceptance 均未执行。

### 保留的尝试记录

| 目录 | 阶段 | 结果与处置 |
| --- | --- | --- |
| `20260830-db57406-precloseout` | init only | 身份初始化通过；安全复审补强 composer SHA、派生 Secret 预脱敏与精确 standalone 后废弃；0 project commands executed，目录未覆盖 |
| `20260830-db57406-precloseout-r2` | command 1 | `npm ci` exit 1，`EBADENGINE`：误选 Node bundled npm 11.16.0，而冻结 authority 要求 npm 11.9.0；41 条未执行，失败目录保留 |
| `20260830-db57406-precloseout-r3` | init | `AR12_LOCKED_NPM_CLI_NOT_FOUND`；定位为 npm package-root 发现路径多退一级；失败目录保留 |
| `20260830-db57406-precloseout-r4` | complete | 锁定并绑定已安装 npm 11.9.0；42/42、14/14、身份与扫描全部 `PASSED`；本次初始 closeout authority |

### 初始 closeout 决策

初始技术重基线通过，未触发发布事务、数据库 Schema、稳定身份、版本语义、一发布一快照、双时态、消费者契约、人员/IAM 或 API/数据库边界停止线。AR-01～AR-06、AR-09～AR-11 可追加“当前候选重新验证通过”，Implementation 保持 `resolved`，Formal acceptance 保持 `pending`。AR-12 可随本报告 closeout 提交由 `claimed` 转为 `resolved`；AR-07 的技术依赖标记为 `satisfied`，但 AR-07 必须继续 `blocked`，唯一剩余阻断是用户另行明确授权正式执行并在正式环境建立新 candidate/run identity。

本 closeout 提交将建立新的 Git SHA，因此该提交本身不沿用上述初始结果。提交后必须在新的、不可覆盖的 `...-final` 目录从身份冻结起完整重跑 42 条命令与 14 项 standalone；最终 summary 只保留在 `.runtime`。最终重跑失败时按任务约定创建非覆盖纠正提交恢复 AR-12 `claimed`，不得把本节的初始通过表述为最终完成。

## Closeout HEAD 最终重跑失败（保留）

Closeout HEAD `4dca3cacfc98b77e2e805260703a912b0a069d17` 使用新的不可覆盖目录 `.runtime/rebaseline/ar-12/20260830-4dca3ca-final`。init、命令 01 `npm ci --ignore-scripts --no-audit --no-fund` 与命令 02 `npm run check:runtime` 通过；命令 03 `npm run check:repo:layout` 以 exit `1` 失败，编排错误码为 `AR12_COMMAND_EXIT_UNEXPECTED`，其余 39 条命令未执行。

直接原因是布局检查同时发现根 `package-lock.json` 与为 opening-HEAD 初始执行保留在仓库内的 `.runtime/rebaseline/ar-12/worktrees/db57406-precloseout/package-lock.json`。失败证据保留于该目录的 `run-commands-result.json`、`failure-run-commands.json` 和 `commands/03-check-repo-layout/{command.json,stdout.log,stderr.log,result.json}`；目录不删除、不覆盖、不修补。该失败未触发架构停止线，但依任务规则仍使 AR-12 恢复 `claimed`、Current frontier 恢复 AR-12、AR-07 继续 `blocked`，不得宣称 AR-12 完成。
