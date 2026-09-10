# Department Projection Schema Versioning and Evolution Policy

PV-005-B-03C. START_HEAD: `e366a073692587797472ff96623ef7d586364e78` (B-03B final commit), branch `prototype/phase-02-department-master`, initially clean. B-03A is `733072bc592b82c3ceb0bda4a7be16e2979c64e6`. Verification remains synthetic, non-production, with Asia/Shanghai display; this is not formal ABG, pilot or production acceptance.

## Published version is immutable

`projectionType + projectionSchemaVersion` identifies a published contract permanently. The domain-owned TypeBox schema (including definitions, identifiers, descriptions and constraints) must retain its canonical schema digest. For the same frozen release input, the canonical generator must retain the exact artifact bytes, not merely a JSON-equivalent value. No optional-field exception, patch-in-place operation, implicit migration or update-golden mode exists.

| Published contract | Immutable SHA-256 schema digest |
|---|---|
| `hdi.department-master@1` | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` |
| `hdi.department-hierarchy@1` | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` |

This implements [ADR-0088](../adr/0088-domain-owned-versioned-projection-schemas.md), [ADR-0090](../adr/0090-use-one-canonical-projection-snapshot-per-release-in-phase-01.md) and [ADR-0091](../adr/0091-govern-projection-schema-upgrades-as-high-risk-contract-changes.md), not a new hospital-wide Schema Registry design. ADR-0014's compatible structural changes do not authorize replacing a digest-addressed ProjectionSchema version.

## Digest is identity evidence

The existing `PHASE_01_PROJECTION_CONTRACTS` composition registry remains the sole registration source; each domain still owns its executable schemas. The gate extends `tooling/prototype/check-department-consumer-canonical.ts` and calls the real `buildCanonicalSnapshotArtifact`. It verifies unique contract identities, retention of every published pair, the entire schema digest, payload validation, release envelope validity, exact bytes and artifact SHA-256. The envelope's release identity, projection identity, digest algorithm, envelope version and serialization profile are covered by the byte comparison. Schema, payload and artifact digests retain the distinct roles in [ADR-0092](../adr/0092-use-separate-projection-payload-and-snapshot-artifact-digests.md).

The already-existing seven-contract fixture `tooling/prototype/fixtures/department-consumer-baseline.json` is frozen evidence, not a second editable registry. Its source at START_HEAD is Git blob `f10fdfce76f81a1d2a6759a94a6a023ab88c82f8`; its exact file SHA-256 is `04367946e70e95bed4c1898576b33827e3fa906610bc1826fbe1e5e65e3a17e9`. The gate pins that whole-file digest independently before using any fixture values. It does not derive expected identity from candidate schemas. Changing schema, fixture, embedded digests and artifact bytes together still fails. Even whitespace-only fixture changes fail. The pin must never be refreshed to make a failure pass. The local gate needs no Git-history checkout or network access.

The seven frozen artifacts cover charge catalog @1/@2, price list @0/@1/@2, Department Master @1 and Department Hierarchy @1. Their fixed synthetic inputs include release identity and payload. Freezing these deterministic vectors does not mean different legitimate releases must have the same bytes. Nor can a finite fixture prove arbitrary generator behavior or detect a semantic change that was never recorded in schema or tests: domain/spec review remains required. Deliberately deleting the gate or altering its authority pin is a policy violation, not an approved evolution path.

## Additive and breaking changes both require a new version

Any change to canonical schema or artifact identity requires an explicitly new projection version. An optional field can be structurally backward-compatible while still being forbidden in V1. Breaking changes also require a new version. A new number does not authorize removing an old registration or writing a newly numbered artifact into an old release. This task does not register, publish, expose through an API or generate a client for Department V2.

## Old versions remain available while supported

Future versions coexist with the supported old versions. The freeze gate checks all seven published identities even when a proposed new registration is supplied in a test. It does not treat replacement or removal as an upgrade. While any snapshot references an old version, the executable definition, digest and frozen evidence remain traceable under ADR-0088. Ending support cannot authorize rewriting its historical identity. Future approved versions need their own additive identity evidence and acceptance; the existing seven-contract fixture and pin stay untouched.

## Consumer compatibility is explicitly evaluated

`evaluateProjectionSchemaCompatibility` is an offline proposal evaluator, separate from immutability. It accepts the same projection type with a distinct proposed version, never infers compatibility from version numbering, and returns two directions:

- Backward: the proposed schema accepts values permitted by the old schema.
- Forward: the old schema accepts values permitted by the proposed schema.

It conservatively handles identical schemas and closed-object property/required changes using unchanged or recursively comparable property schemas. Both directions true gives FULLY_COMPATIBLE; one true gives BACKWARD_COMPATIBLE or FORWARD_COMPATIBLE; both false gives BREAKING. Unsupported constraints, references, changed primitive types or semantic annotations yield null/REQUIRES_REVIEW instead of an optimistic compatibility claim. This bounded evaluator is not a general JSON Schema theorem prover and does not approve semantic equivalence.

Synthetic test-only V2 adds only `syntheticNote`, proves backward-but-not-forward compatibility for a closed V1 object, and still fails if substituted into V1. Other fixtures exercise forward-only, breaking, unchanged and review-required outcomes. They never mutate the production registry. The HTTP support schema continues to reject Department @2.

The existing runtime compatibility precheck is unchanged: [ADR-0089](../adr/0089-use-exact-consumer-projection-support-and-isolated-delivery-blocking.md) requires each immutable consumer subscription version to explicitly support the exact type/version registered digest. Structural compatibility does not confer runtime support, permit field probing, auto-convert data, or bypass BLOCKED_INCOMPATIBLE.

## New rollout cannot rewrite old release or snapshot

A future approved schema upgrade requires the existing high-risk domain and platform contract confirmations, explicit new governance release and stream sequence, new contract identity and new snapshot artifact. Old releases, snapshots, support declarations, receipts and checkpoints are not repackaged or overwritten. No replay, migration, distribution, SLA, audit or metrics mechanism is introduced here.

## V1 explicitly excludes campus, alias, quality and source mapping

Neither frozen Department consumer projection gains campus/campuses, alias/aliases, quality/quality score or sourceMapping/sourceMappings fields. Internal domain data and the separate published read model do not expand this external V1 payload. Any future inclusion must use a formally authorized new version and explicit consumer evaluation.

## Executable acceptance

Run `npm run contract:check-projection-freeze` locally without a database. The same gate is part of normal `npm run check`; the inherited API contract test and real Department consumer/lifecycle/SLA flows also invoke the canonical checker. Failures are blocking, with no fixture-generation or update option.

The negative tests cover A optional V1 property; B definitions/semantic identity across all seven schemas; C exact regeneration including reversed payload key insertion order; D independent synthetic V2 compatibility with V1 retained; E changed version replacing an old registration or old artifact. Additional cases cover duplicate registrations, release identity, envelope profile, payload, raw-byte changes and coordinated golden/digest rewriting.

OpenAPI baseline SHA-256: `fb57428dd58ca5c72c4bee5f3827f9930746df88dbc5608259dac9d2a21fb607`. Baseline SQL migration count: 18. Required deltas are zero: OpenAPI paths/operations, all 15 Department Browser paths, generated client, migrations and production contract registry. Final verification results are recorded below after execution.

## Final validation record — 2026-09-04, Asia/Shanghai

All 25 acceptance commands below completed with exit 0 through the ignored local runner `.runtime/pv005-b03c/run-gates.mjs` (runner exit 0). The process-only local environment was redacted before log persistence. API regressions passed 346/346 across 21 files, including Department, Release Distribution, B-03A lifecycle and B-03B SLA. Sim Consumer passed 20/20. Freeze/evolution tests passed 20/20, including all A–E negatives. The separate real PostgreSQL/HTTP lifecycle and SLA invocations also passed with persistence, application/pool closure and port release observed.

| Command | Exit |
|---|---:|
| `npm run contract:check-projection-freeze` | 0 |
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts` | 0 |
| `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
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

`npm run check` successfully invokes runtime, repository layout, module boundaries, projection freeze/evolution and database authority checks. Department validation invokes its constraints, repository, projection and application probes. The database authority check verifies generated Kysely types and reports migrationCount 18 and forbiddenDatabaseTypeCount 0. Existing migrations were replayed idempotently; no migration file was added or changed. OpenAPI lint passed; there is no separate source-lint script in this repository. Generated-client positive/negative compilation checks passed. The inherited container integration file was excluded, as in B-03A/B; no formal/container acceptance claim is made.

The runner's before/after protected-source and raw-byte assertions passed (exit 0). OpenAPI SHA before = after = `fb57428dd58ca5c72c4bee5f3827f9930746df88dbc5608259dac9d2a21fb607`; path delta 0, operation delta 0, Department Browser paths 15 unchanged. Generated client and production registry unchanged. Migration count before = after = 18, delta 0. Master V1 digest before = after and Hierarchy V1 digest before = after equal the authorities above. **Seven canonical artifact bytes before = after**, with exact byte comparison in addition to these artifact digests:

| Contract | Artifact SHA-256, before = after |
|---|---|
| `hdi.charge-catalog@1` | `123da65b13ec1f956bfdf4f92c849e1bd9a53dad7fae3609056ba37d5033c9b4` |
| `hdi.charge-catalog@2` | `b00eea7e470158df42967431e2fd08f38ce788a4863821f85998eae1331bc155` |
| `hdi.price-list@0` | `b46c77524a9492f2f07016d6ec4a795b418da9e0b4b6e1d3da328d0ae0e9bbe7` |
| `hdi.price-list@1` | `3babe64dc137d3127c5c953bae725ab2518c092b6803e14e05f0f23e986f4266` |
| `hdi.price-list@2` | `be8b7ccc640df775efbd8558f15c1cfd5f9e0ba98435ac9487e0f6818dd1d04a` |
| `hdi.department-master@1` | `336ab62f8d2230eb5eeb7fa4ac41f8ae12ad0a63a4e6cc937bee416a902b9f26` |
| `hdi.department-hierarchy@1` | `fb71ec35bf39f9ea508b764beb56a386df48922d0015d54662b8a334feae2cf4` |

### Standards

Independent read-only review of candidate tree `a10f529ef58eed3c1550996f53d1dfc7eb422c9f` against START_HEAD: 0 documented-standard violations, 0 actionable smell findings, no blockers. Existing domain ownership, registry and canonical generator authority were preserved. Only this execution record was appended after that candidate; implementation bytes remained unchanged.

### Spec

Independent read-only review of the same fixed candidate: 0 findings, 0 blockers. Required identities, anti-rebaseline pin, A–E negatives, independent compatibility evaluation, normal acceptance integration and scope exclusions were satisfied. Reviewers ran no tests or database commands and made no edits.

### Closure and development diagnostics

`node .runtime/pv005-b03c/check-closure.mjs` exited 0: 18 registered migrations, 0 other application database sessions, verification pool closed. PostgreSQL was confirmed inactive and its 55434 listener absent before terminating the task keepalive (Linux PID 126, Windows launcher PID 6228). Both exited. Task application Node processes: 0; two Codex host CUA kernel/worker processes were identified and preserved. Synthetic persisted verification facts remain; ignored validation logs remain under `.runtime/pv005-b03c`. Final tracked/staged whitespace and protected-path diff checks exited 0. No push occurred.

TDD red checks intentionally exited 1 before implementation for optional schema mutation, fixture rewriting, old artifact version rewriting, synthetic evaluator availability, duplicate registration and reference-dependent compatibility. Their subsequent green commands and the final acceptance command exited 0. The initial API-workspace typecheck exited 1 because a tooling test crossed the API rootDir; the test was moved to the existing tooling TypeScript scope and all typechecks then passed. The first local runner preflight exited 1 on an already-present mixed final newline in migration README; source identity comparison now honors Git attributes, while raw before/after bytes and the canonical fixture pin remain exact. An initial overly broad cleanup assertion exited 1 on Codex-owned Node processes; identifying and excluding only those host processes produced the final task-process check exit 0. No frozen schema, digest, golden file or acceptance expectation was updated to hide a failure.

### Changed files and delivery boundary

Exactly five tracked files changed: this design record, root `package.json`, `tooling/prototype/check-department-consumer-canonical.ts`, `tooling/prototype/department-projection-freeze.test.ts` and `tooling/prototype/evaluate-projection-schema-compatibility.ts`. No new Department version or business fields, API, migration, runtime registry, consumer SDK or excluded subsystem. Opening divergence from local `origin/prototype/phase-02-department-master` was behind 0 / ahead 0; one local commit is authorized after these gates. No fetch/push was performed. PV-005-C-01 is not started.
