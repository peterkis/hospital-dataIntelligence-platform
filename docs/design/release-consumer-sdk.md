# Release Consumer SDK — PV-005-C-01

START_HEAD: `666f0260c7ef67374e725ea07ed2d55948690b59`.
Branch: `prototype/phase-02-department-master`; opening index/worktree clean.
B-03A/B/C completed. Opening local tracking divergence: behind 0 / ahead 0.
Validation is synthetic, non-production, with Asia/Shanghai date/time. No push.

## Design

The private ESM workspace `packages/release-consumer-sdk` exposes one public
entry. It depends only on Generated Client and the repository's already locked
TypeBox/json-canonicalize packages. There are no server, Fastify, PostgreSQL,
repository or domain imports. No API, OpenAPI operation, schema version,
canonical artifact, SQL migration, governance permission or server module changes.

The SDK calls only the existing events, snapshot, receipt and operational-status
operations through Generated Client. Exact release/event resolution reads the
authorized historical event list at cursor 0. Checkpoint comes from operational
metadata. This reuses the consumer contract without a server shortcut. The
interface and adapter obligations are detailed in the
[package README](../../packages/release-consumer-sdk/README.md).

Validation data is deterministically generated from frozen OpenAPI. Canonical
schema identity uses the independently pinned, existing B-03C seven-contract
evidence because Swagger's legacy schema transformation is not byte preserving.
It does not define consumer-private payload schemas or import the domain at
runtime. B-03C continues to verify original TypeBox digests and exact artifact
bytes. No published pin or freeze gate is changed.

The callback receives verified immutable content and the next recovery state.
It must atomically commit both local business effects and the pending marker.
SDK reloads the marker before APPLIED. It cannot choose a future HIS/EMR/LIS/PACS
transaction. Single-writer ownership across processes remains the adapter's
responsibility. Instance-level concurrent writes fail explicitly.

Sim Consumer retains atomic rename, synthetic payload, version-1 state and
failure injection; its HTTP/digest/envelope/receipt/recovery protocol now lives
only in SDK. A synthetic apply counter proves no reapplication after process
restart. Existing tests retain all 20 safety cases; test fixtures now contain
valid canonical payloads and schema digests. Expected projection rejection occurs
after content verification, as required by the SDK's ordered validation contract.

Three separate child-process failure windows run for each Department pair on
real Fastify/PostgreSQL: verified-before-apply, committed-before-receipt-send, and
receipt-accepted-before-local-closure. Each restart records exactly one business
application and one qualifying receipt. Original event/snapshot references,
digests, operational last-success, persisted checkpoint and old-event filtering
are checked. Parent validators close child processes, HTTP apps, pools, temporary
state files and verify persisted facts through a reopened connection.

Lifecycle errors remain stable and terminal to the current pass. SLA is read-only
metadata with no timer, retry daemon, notifications or hospital policy. No
subscription provisioning or replay CLI enters the SDK. Opaque handles enforce
the verification/application boundary both at compile time and runtime.

## Final validation

Command results, protected artifact comparison, deterministic build and resource
closure are appended after the final verification run.


### Completed checks — 2026-09-04, Asia/Shanghai

The inherited B-series runner completed 29 commands with exit 0. The final SDK
candidate then completed 7 commands with exit 0, including a full build,
repository typecheck and all non-container API tests. After aligning the private
workspace type export with Generated Client's source-type convention, package
contract checking and the complete repository typecheck were repeated: both exit
0. All command output passed the forbidden-output-pattern scan before persistence
was accepted. Detailed ignored logs are under `.runtime/pv005-c01`.

| Suite | Final result |
|---|---|
| SDK unit/contract/recovery | 47/47 |
| Sim Consumer inherited behavior cases | 20/20 |
| API (Department, Release Distribution, lifecycle, SLA and SDK process recovery) | 347/347, 22 files |
| Verification tooling | 714/714, 33 files |
| B-03C freeze/evolution | 20/20 |
| SDK public positive/negative compile and Generated Client compile suites | PASS |
| SDK deterministic repeated build | 16/16 emitted files byte-identical |
| Public runtime export / private subpath rejection | PASS / PASS |

As in B-03A/B/C, the container-based `phase-01-vertical-slice.integration.test.ts`
and its fault/capacity entry points are outside this prototype validation run.
There is no formal ABG, container acceptance, browser acceptance or production
readiness claim. API suites ran serially across files because their real
PostgreSQL fixtures share governed objects. The SDK's seven frozen legacy and
Department contracts also passed through Generated Client in its own tests.

| Command | Exit |
|---|---:|
| `npm run build --workspace @hospital-data-intelligence/release-consumer-sdk` | 0 |
| `npm run contract:check-consumer-sdk` | 0 |
| `npm run test --workspace @hospital-data-intelligence/release-consumer-sdk` | 0 |
| `npm run contract:check-projection-freeze` | 0 |
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts --fileParallelism=false` | 0 |
| `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| `npm run test:verification` | 0 |
| `npm run prototype:db:check` | 0 |
| `npm run prototype:db:migrate` | 0 |
| `npm run prototype:db:seed` | 0 |
| `npm run prototype:department:seed` | 0 |
| `npm run prototype:department:validate` | 0 |
| `npm run prototype:http:validate` | 0 |
| `npm run prototype:department:http:validate` | 0 |
| `npm run prototype:department:consumer:validate` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --lifecycle` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --sla` | 0 |
| `npm run check` | 0 |
| `npm run contract:generate` | 0 |
| `npm run contract:lint` | 0 |
| `npm run contract:generate-client` | 0 |
| `npm run build --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| `npm run typecheck --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| `node apps/governance-api/scripts/check-department-consumer-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-lifecycle-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-sla-openapi-diff.ts` | 0 |
| `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 |

### Artifact and scope stability

OpenAPI before = after SHA-256:
`fb57428dd58ca5c72c4bee5f3827f9930746df88dbc5608259dac9d2a21fb607`.
Path delta 0; operation delta 0; all 15 Department Browser paths unchanged.
Generated Client source bytes, domain registry, Department domain source,
18 SQL migrations, and frozen canonical fixture are unchanged. Seven canonical
artifacts were regenerated and compared byte for byte by the unchanged B-03C gate.

Master V1 schema SHA-256 remains
`a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`;
Hierarchy V1 remains
`72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.
No OpenAPI/client regeneration changed those protected sources. Private SDK types
and runtime exports match repository ESM conventions; no external npm dependency
version was added or upgraded.

### Diagnostics and closure

Development failures were corrected before final verification: initial synthetic
unit events used IDs different from their frozen artifact; the lifecycle test
needed an explicit typed CSRF header; a package check initially assumed the
TypeScript 7 installation exposed the older compiler API. It now uses bounded
source-import checks, while the actual compiler remains authoritative for types.
The final pass also verifies resolved callback failure values, durable marker
loss before receipt, unsupported recovered projection declarations, and a local
closed state ahead of the server checkpoint. No frozen fixture, canonical pin,
server error contract or existing acceptance expectation was weakened.

Resource check exited 0: application database sessions 0, verification pool
closed, application ports released, temporary consumer state removed, PostgreSQL
service inactive, listener 55434 absent. Task keepalive Linux PID 139 was stopped
and Windows launcher PID 23576 exited; its temporary PID record was removed.
Codex host tools were preserved. Synthetic persisted release/receipt/checkpoint
facts remain in the existing prototype database. No production data was used.

Delivery is one local commit on the starting branch with message
`feat(consumer): add release consumer sdk`. No push or subsequent task is included.


### Changed files

- `.scratch/release-consumer-sdk/issues/01-release-consumer-sdk.md`
- `.scratch/release-consumer-sdk/spec.md`
- `apps/governance-api/src/modules/release-distribution/release-consumer-sdk.integration.test.ts`
- `apps/sim-consumer/package.json`
- `apps/sim-consumer/src/consumer.test.ts`
- `apps/sim-consumer/src/consumer.ts`
- `docs/design/release-consumer-sdk.md`
- `package-lock.json`
- `package.json`
- `packages/release-consumer-sdk/README.md`
- `packages/release-consumer-sdk/package.json`
- `packages/release-consumer-sdk/scripts/check-package.mjs`
- `packages/release-consumer-sdk/scripts/generate-contracts.mjs`
- `packages/release-consumer-sdk/src/consumer.compile-test.ts`
- `packages/release-consumer-sdk/src/consumer.test.ts`
- `packages/release-consumer-sdk/src/contracts.generated.ts`
- `packages/release-consumer-sdk/src/errors.ts`
- `packages/release-consumer-sdk/src/index.ts`
- `packages/release-consumer-sdk/src/types.ts`
- `packages/release-consumer-sdk/tsconfig.build.json`
- `packages/release-consumer-sdk/tsconfig.json`
- `tooling/prototype/check-release-consumer-sdk-flow.ts`
- `tooling/prototype/release-consumer-sdk-worker.ts`
- `tooling/prototype/run-department-consumer-flow.ts`
- `tooling/prototype/validate-department-consumer-flow.ts`
- `tooling/verification/src/check-repo-layout.mjs`

Final task application Node process count: 0. Local `origin/main` divergence before
commit was behind 0 / ahead 55; branch tracking divergence was behind 0 / ahead 0.
The single delivery commit adds exactly one local commit. Remote tracking refs
were inspected locally; no fetch or push was performed.
