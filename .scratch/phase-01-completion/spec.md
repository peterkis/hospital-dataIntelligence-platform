# Phase 01剩余能力完成规格

Status: ready-for-agent

Baseline commit: `f7dd94f`

Scope: 完成“POC可执行架构基线阶段”尚未闭合的能力和ABG-01至ABG-40门禁；不进入完整POC扩展。

## Problem Statement

当前工程已经通过收费项目发布、价表发布、价格解析、审计、规范快照、Outbox、两个隔离仿真消费者、回执和检查点的核心纵向切片验证，证明了模块化单体、PostgreSQL事务、Keycloak认证、冻结OpenAPI契约和`SNAPSHOT_PULL`交付主链可以共同工作。

但当前可执行实现仍是核心骨架，而不是完整的Phase 01。公开治理能力主要集中在直接发布、解析和消费闭环，管理界面也只覆盖直接发布与解析。草稿生命周期、批量导入、普通职责分离工作流、完整双时态查询、紧急暂停与新发布恢复、补偿发布、审计查询与完整性服务、真实浏览器端到端验证、系统化故障注入、16 MiB精确边界向量，以及ABG-01至ABG-40统一证据编排尚未全部完成。

如果直接把当前核心切片视为阶段完成，会把已经确认的治理规则退化为只能走成功路径的演示：数据管家无法按草稿方式维护，导入无法证明部分成功和幂等重试，审批无法证明普通内容提交人与终审人分离，紧急暂停不能进入闭环，历史查询和补偿发布不能被外部契约使用，且现有证据不足以对全部架构门禁作出通过结论。

## Solution

在现有单仓库、模块化单体和七个深模块基础上增量完成Phase 01，不重写已通过的核心发布、解析和消费链路。所有新增能力继续通过同一个治理应用和冻结OpenAPI契约暴露，管理界面、仿真消费者和验证工具只使用生成客户端。

本规格将收费项目和价表的草稿、导入、版本、查询、工作流、暂停、补偿和审计能力补齐，并把已有成功路径转入完整状态机。批量导入只负责批次、行结果、判重、幂等和证据；领域规则、稳定身份和版本主权仍分别属于`charge-catalog`与`price-list`。发布、快照、Outbox、订阅、投递和回执仍只属于`release-distribution`。

验收采用一个主要的最高层测试接缝：通过冻结OpenAPI生成客户端调用真实治理应用，并连接真实PostgreSQL、Keycloak和隔离仿真消费者完成黑盒场景。管理界面只增加Playwright浏览器接缝以验证人员操作路径；模块级和受控数据库探针只用于无法通过公共契约精确触发的事务写点、并发和篡改故障，不建立第二套验收语义。

完成标志不是“接口可调用”或“测试总体通过率”，而是ABG-01至ABG-40逐项通过、每项均能追溯到冻结输入和证据，并由一次新的正式验证运行生成不可覆盖SHA-256证据包。

## User Stories

1. As a 数据管家, I want to create a charge-item draft without publishing it, so that incomplete content does not become consumable.
2. As a 数据管家, I want to read a charge-item draft by stable identity and draft version, so that I can continue an interrupted governance task.
3. As a 数据管家, I want to update an unpublished charge-item draft, so that corrections do not create false published history.
4. As a 数据管家, I want to delete an unpublished charge-item draft, so that abandoned work can be removed before publication.
5. As a 审计人员, I want attempts to update or delete published charge-item versions to be rejected and audited, so that publication immutability is demonstrable.
6. As a 数据管家, I want a semantic change to an existing charge item to create a new candidate version under the same stable identity, so that identifiers are never reused or overwritten.
7. As a 治理对象Owner, I want service-boundary changes to require a new stable identity rather than a silent version edit, so that historical meaning remains correct.
8. As a 治理用户, I want to list the complete version history of a charge item, so that I can understand how its meaning evolved.
9. As a 治理用户, I want to query a charge item at a specified business time, so that planned and historical applicability is visible.
10. As a 治理用户, I want to query a charge item at a specified record time, so that results before and after a retrospective correction can be reproduced.
11. As a 治理用户, I want to compare two charge-item versions, so that a review can focus on the actual semantic changes.
12. As a 数据管家, I want to create and edit a complete price-list draft, so that a release can be assembled without exposing partial entries.
13. As a 数据管家, I want to remove an unpublished price-list draft, so that abandoned snapshots do not pollute release history.
14. As a 价格Owner, I want every price-list publication to be a complete immutable snapshot, so that consumers never reconstruct a release from mutable deltas.
15. As a 价格Owner, I want to see additions, removals and price changes relative to the preceding release, so that the approval decision has explicit evidence.
16. As a 价格Owner, I want a planned release to carry a business-valid start time, so that future pricing is approved before becoming applicable.
17. As a 价格解析调用方, I want service occurrence time to select the business-valid release while record-as-of selects the known system state, so that billing decisions are reproducible.
18. As a 价格解析调用方, I want an explicit campus price to be considered before the hospital default, so that the fixed two-level rule is applied deterministically.
19. As a 价格解析调用方, I want multiple matches at the same level to fail closed, so that the platform never chooses by update time or arbitrary priority.
20. As a 价格Owner, I want general mode and encounter-specific mode to be mutually exclusive for the same target, scope and time, so that conflicting prices cannot be published.
21. As a 价格Owner, I want outpatient, inpatient, emergency and checkup to be the only actual encounter scenarios, so that “general” remains a wildcard mode rather than a fifth business fact.
22. As a 院区数据管家, I want to propose a campus price difference without overriding the hospital default, so that campus scope does not acquire hospital-wide sovereignty.
23. As a 全院价格Owner, I want every campus price difference to require my explicit approval, so that fixed two-level resolution remains governed.
24. As a 数据管家, I want to upload a UTF-8 CSV batch using a frozen column schema, so that representative file-based initialization is repeatable and auditable.
25. As an API调用方, I want to submit the same logical import through a generated-client JSON batch contract, so that file and REST ingestion use identical governance rules.
26. As a 数据管家, I want every import batch to freeze its source kind, source digest, schema version, governance object and submitted content, so that a retry cannot silently replace input.
27. As a 数据管家, I want all rows sharing the same business key inside one batch to be reported as a duplicate-key conflict, so that row order does not decide which duplicate wins.
28. As a 数据管家, I want non-conflicting valid rows to succeed even when other rows fail, so that one bad record does not roll back a useful batch.
29. As a 数据管家, I want every failed row to retain stable row identity, error code, rule version and evidence, so that remediation is precise.
30. As a 数据管家, I want retrying the original batch to skip already successful rows and preserve their identities, so that retries are idempotent.
31. As a 数据管家, I want failed rows in the original frozen batch to be re-evaluated after referenced governance data or technical conditions are corrected, so that recovery does not duplicate successes.
32. As a 数据管家, I want changed row content to require a new batch, so that an old batch never changes meaning after submission.
33. As a 数据管家, I want a new batch containing an existing business key to create a new draft-version candidate rather than overwrite or silently ignore the published record, so that new imports follow version governance.
34. As a 治理用户, I want to query batch status, row outcomes, success counts, failure counts and retry attempts, so that partial success is transparent.
35. As a 治理用户, I want all imported successes to remain drafts until their own governance workflow is approved, so that import cannot bypass review and publication.
36. As a 治理角色, I want permissions to be granted per governance object, operation, campus scope and validity period, so that authority is not widened to an entire data domain.
37. As a 治理角色, I want to combine multiple permissions on one local principal, so that a person can perform legitimate multiple duties without receiving an unrestricted role.
38. As a 平台安全管理员, I want denied, expired, wrong-campus and wrong-object grants to fail closed, so that names and Keycloak roles cannot become implicit authorization.
39. As a 数据管家, I want to submit a frozen content digest and evidence set into a versioned approval template, so that later edits cannot be approved under an earlier review.
40. As a 专业复核人, I want to review the exact submitted content and record an append-only decision, so that high-risk publication has professional evidence.
41. As a 治理对象Owner, I want to give final approval only after all required prior stages have completed, so that stages cannot be skipped or reordered.
42. As a 治理对象Owner, I want an ordinary domain-content request submitted by myself to be ineligible for my own final approval, so that normal publication satisfies duty separation.
43. As a 平台契约Owner, I want the explicitly classified pure projection-Schema upgrade exception to allow the same authorized person to submit and finally approve, so that the confirmed narrow exception is usable.
44. As a 平台契约Owner, I want that exception to fail when domain content, members, rules or lifecycle state changed, so that it cannot become a general self-approval bypass.
45. As a 流程管理员, I want each change request to freeze the approval-template version, risk result, required stages and duty-separation policy, so that a later template release does not migrate work in progress.
46. As a 流程参与者, I want unknown actions, reverse transitions, skipped stages, script execution and timeout auto-approval to be rejected, so that workflow remains an explicit state machine.
47. As a 治理对象Owner, I want final approval to trigger publication through the same local transaction boundary, so that there is no manual publisher or out-of-band database action.
48. As an 获得紧急暂停专权的人员, I want to suspend an active published price object immediately for future resolutions, so that a high-risk error can be contained without editing published data.
49. As an 审计人员, I want an emergency suspension to append its reason, actor, scope, affected version and effective sequence, so that emergency power remains accountable.
50. As a 复核人, I want every emergency suspension to create a high-priority review and impact issue, so that temporary containment enters a formal closure process.
51. As a 价格解析调用方, I want historical resolutions and earlier as-of queries to remain unchanged after suspension, so that containment does not rewrite history.
52. As a 治理对象Owner, I want recovery from suspension to require an approved new or compensating release, so that no one can toggle the old release back to active.
53. As a 治理对象Owner, I want a compensating publication to reference the superseded or corrective release and its reason, so that rollback is represented as new history.
54. As an 审计人员, I want to query audit events by governance object, stable identity, request and stream sequence, so that a decision can be traced end to end.
55. As an 审计人员, I want the platform to verify an audit hash chain and identify the first invalid event, so that simulated tampering is detectable.
56. As an 审计人员, I want concurrent events with equal local date-time values to retain canonical order through an explicit sequence, so that timestamps never pretend to be a global ordering authority.
57. As a 发布调用方, I want domain publication, release envelope, canonical snapshot bytes, compatibility prechecks, deliveries, audit and Outbox to commit or roll back together, so that no half-publication exists.
58. As a 仿真消费者, I want to download the complete uncompressed canonical artifact by stable snapshot identity and verify its digest while streaming it to storage, so that transport memory behavior does not change artifact identity.
59. As a 仿真消费者, I want repeated notification and download attempts to apply the same aggregate version once, so that at-least-once delivery is safe.
60. As a 仿真消费者, I want an aggregate-version gap to block checkpoint advancement, so that missing releases cannot be skipped silently.
61. As a 仿真消费者Owner, I want every subscription version to declare exact projection type and Schema version support, so that compatibility is explicit rather than inferred.
62. As a 仿真消费者Owner, I want an unsupported release to block only my delivery without blocking publication or compatible consumers, so that compatibility failures are isolated.
63. As a 仿真消费者Owner, I want a new subscription version and controlled replay to deliver the original event and snapshot, so that recovery does not repackage history.
64. As a 平台运维人员, I want a lost post-commit wake-up to be recovered by database polling, so that Outbox correctness does not depend on an in-memory signal.
65. As a 平台运维人员, I want delivery leases to be short, reclaimable and free of database locks during network I/O, so that a failed consumer cannot hold publication resources.
66. As a 平台运维人员, I want transient delivery failures, retry exhaustion and process-crash windows to produce append-only attempts and impact evidence, so that recovery is observable.
67. As a 平台契约Owner, I want every public request and response to originate from executable TypeBox definitions and the frozen OpenAPI 3.1 artifact, so that no parallel DTO or hand-written contract can drift.
68. As a 管理界面用户, I want draft, import, review, publication, history, suspension, recovery, audit and consumer states to be operated through the same service rules as REST, so that the browser does not carry governance sovereignty.
69. As a 管理界面用户, I want a write operation to appear successful only after the server transaction confirms it, so that optimistic browser state cannot fabricate governance results.
70. As a 人员用户, I want Keycloak Authorization Code with PKCE S256 to create an opaque server session without exposing access or refresh tokens to the browser, so that identity and governance authorization remain separated.
71. As a 服务身份, I want Client Credentials to bind to one local service principal and only its object permissions, so that a simulated consumer cannot approve or maintain domain data.
72. As a 平台验证人员, I want exactly 16,777,216 canonical artifact bytes to publish and 16,777,217 bytes to fail before any release side effects, so that the synthetic POC guardrail is executable.
73. As a 平台验证人员, I want changing the host timezone to leave local-date-time business results unchanged, so that all platform date-times are consistently interpreted as Asia/Shanghai without offsets.
74. As a 平台验证人员, I want a clean environment to install exact dependencies, migrate an empty PostgreSQL database, seed identities, start services and rerun all gates without manual SQL, so that the baseline is reproducible.
75. As a 验收人员, I want each ABG-01 through ABG-40 result to carry scenario identity, request identity, frozen versions and evidence references, so that no gate is replaced by a verbal assertion.
76. As a 验收人员, I want every formal rerun to create a new immutable evidence directory and SHA-256 manifest, so that failed and successful history cannot be overwritten or selectively repaired.

## Implementation Decisions

- The implementation remains one modular-monolith governance application plus the independent simulated-consumer application. No microservice, external workflow engine, external message broker or second backend-for-frontend is introduced.
- Existing successful publication, resolution, snapshot, compatibility, delivery and receipt behavior is retained as the baseline. New work extends the state machines around that path rather than creating a parallel “full” implementation.
- `charge-catalog` continues to own charge-item stable identities, drafts, immutable semantic versions, evolution relations, business/record-time history and lifecycle. It gains draft commands, version-candidate commands, history/as-of queries, comparison and compensating-publication preparation.
- `price-list` continues to own price-list identities, drafts, complete release versions, price entries, planned applicability, differences, suspension eligibility and published resolution views. It gains draft assembly, release comparison, historical query and compensating-release preparation.
- `price-resolution` remains the only owner of hospital/campus two-level selection, encounter-mode evaluation, Decimal calculation and append-only resolution evidence. Routes and the browser must not reproduce its selection algorithm.
- `workflow` becomes a complete versioned approval-template and change-request state machine. A request freezes content digest, change class, risk result, template version, required stages, duty policy and evidence. Ordinary domain-content submission and final approval must use different local person principals for the same request; the pure projection-Schema upgrade exception is explicit and fails on scope mismatch.
- A new deep `batch-import` governance capability owns import-batch identity, immutable source metadata, row identity, attempt sequence, checkpoints and row outcomes. It does not own charge-item or price-list business rules and cannot publish domain data. Domain modules expose small import commands that apply the same validation and stable-identity rules as interactive draft commands.
- One import batch targets one governance object and one object kind. Phase 01 file ingestion is a frozen UTF-8 CSV representation with explicit header order; REST ingestion is a JSON batch carrying the same logical row schema. XLSX, multiple file formats and format negotiation are not added.
- Import input becomes immutable when accepted. The platform stores a content digest and normalized row identities. Changed content always creates a new batch; a retry of the original batch reuses the original bytes or normalized payload.
- Pre-validation groups rows by the domain business key before any row writes. More than one row with the same key makes every row in that key group fail with stable duplicate evidence; “first row wins” is forbidden. Other key groups proceed independently.
- Each row is applied in its own bounded transaction so a failed row does not roll back successful rows. Batch summary updates and audit evidence are appended consistently. A crashed attempt can be resumed from durable row state.
- An original-batch retry never re-applies successful rows. Failed rows may be re-evaluated against corrected referenced governance data or recovered technical conditions, but the row content is unchanged. A new batch with an existing stable business key creates a draft version candidate and never overwrites a published version.
- Drafts are mutable only through domain commands and physically deletable only before submission/publication. Published content cannot be updated or deleted through application or normal business database credentials. Deactivation, replacement, retrospective correction and rollback are represented by explicit lifecycle events or new releases.
- Business-effective intervals and record-effective intervals remain separate. Every platform date-time is an Asia/Shanghai local date-time stored as `timestamp without time zone`; ranges use `tsrange`; API values reject `Z` and offsets. JavaScript `Date` is not used for governance time.
- Explicit per-stream monotonic sequences remain the canonical ordering authority. Sequence allocation may leave gaps and never reuses values. Cross-stream reads do not claim a global order from local timestamps.
- PostgreSQL 18.4 native SQL migrations remain the only physical Schema authority. New import, lifecycle, impact and workflow structures must use database constraints for identity, references, state, immutable records, time overlap and mutually exclusive price representations. Application or ORM auto-DDL remains forbidden.
- Database-derived Kysely types are regenerated from the migrated real database and verified in CI. Money, quantity and `int8` values remain strings or precise Decimal values at the application boundary; lossy JavaScript numbers are forbidden.
- Object authorization remains local to the platform and is evaluated on every command by governance object, permission, campus scope and validity interval. Keycloak roles, display names and personnel-master-data records never grant business authority implicitly.
- Emergency suspension is an append-only operation protected by a distinct object-level permission. It immediately blocks future applicable resolutions, creates an impact/review issue and never edits the published version. Only an approved new or compensating release can restore future applicability.
- Audit gains public read and integrity-verification capabilities. Audit events remain append-only and include stream sequence, actor, effective roles, governance object, request, entity/version identity, before/after or content digests, action and authority scope. Verification reports the first broken link without modifying history.
- `release-distribution` remains the sole owner of governance-release envelopes, release members, canonical artifacts, dual digests, Outbox, subscriptions, compatibility results, delivery state, attempts, receipts and checkpoints. Import, workflow and domain modules cannot write its tables directly.
- One release still produces one canonical projection and one canonical snapshot. Schema upgrades produce a new explicit release and never repackage a historical release. Multi-projection delivery and consumer-specific snapshots are not implemented.
- Canonical snapshot download remains a complete, uncompressed, non-segmented public API representation. The Phase 01 server may read the at-most-16 MiB `bytea` fully before responding, while consumers may stream the response to a temporary file and compute the digest incrementally.
- The 16 MiB guard is measured against exact final canonical artifact bytes before publication commit. Exactly 16,777,216 bytes is permitted; 16,777,217 bytes returns `SNAPSHOT_ARTIFACT_TOO_LARGE` with no release, snapshot, audit, Outbox, delivery or checkpoint side effect. Compression, truncation, splitting and alternate storage cannot bypass the guard.
- The 16 MiB value is labelled everywhere as a synthetic Phase 01 guardrail. It is not reused as a managed-export, all-hospital initialization, production capacity, performance SLA or procurement limit.
- All new external contracts are authored through domain-owned executable TypeBox definitions assembled by the composition root, then regenerate and freeze OpenAPI 3.1 and its SHA-256. Generated clients are refreshed from that artifact; handwritten public DTOs or OpenAPI fragments are prohibited.
- The same-origin React/Vite SPA adds only the Phase 01 paths needed to operate drafts, imports, history/diff, workflow, release assembly, emergency suspension/recovery, audit verification and release-consumer evidence. It does not implement rules locally or create a second server framework.
- Outbox delivery remains in-process with post-commit wake-up and database polling fallback. Leasing is a short database transaction; network calls occur outside transactions; result recording is a later transaction. Every consumer keeps independent delivery status and ordering.
- Existing subscriptions may establish a first explicit aggregate version as a baseline only when no checkpoint exists. After that baseline, aggregate versions advance strictly and gaps block application. Receipts cannot substitute for the consumer’s own durable state.
- Test-only fault injection uses an enumerated build/runtime boundary that cannot be enabled in production. Transaction write-point failures, wake-up loss and process-crash windows use controlled application probes; PostgreSQL, Keycloak and network failures use real containers and Toxiproxy.
- No public test-only authentication headers, fake IAM service, direct governance-database maintenance API, manual success receipt or database edit is introduced.
- The formal verifier expands the existing immutable evidence-runner rather than adding a second verification authority. Every gate records one machine-readable terminal result and evidence references under a new run identity.
- Phase 01 is complete only when ABG-01 through ABG-40 all pass in one frozen run, the clean-environment rebuild succeeds, all generated artifacts match their frozen hashes, and no unresolved defect affects identity, time, authorization, workflow, publication, price uniqueness, audit or consumption correctness.

## Testing Decisions

- The primary behavioral seam is the frozen OpenAPI-generated client calling the running governance application. Tests assert externally visible state, error codes, immutable identities, digests, sequences and consumer outcomes rather than internal method calls.
- The browser seam is limited to Playwright Test and proves that a real Keycloak redirect login, opaque Fastify session, CSRF protection and same-origin generated client can complete the required human workflows. Browser tests do not seed success through hidden APIs after the scenario begins.
- Existing Fastify `inject()` tests remain the highest fast seam for route Schema, authentication boundary, public error mapping and server-side rule enforcement that does not require a browser.
- Real PostgreSQL module/integration tests cover native constraints, immutable triggers, overlapping business intervals, dual-time queries, sequence concurrency, per-row import transactions and all-or-nothing publication. An in-memory or SQLite substitute is not accepted.
- Direct database reads in tests are limited to controlled read-only evidence probes for physical invariants, exact stored bytes, zero time-zone-aware columns and fault side effects. They cannot replace public-service behavioral assertions.
- The existing price-list version test remains prior art for business/record-time reproduction. It is extended to cover draft-to-publication history, retrospective correction, comparison, planned releases, suspension and compensating release without rewriting prior published rows.
- The existing vertical-slice integration test remains prior art for the cross-module transaction seam. It is extended with ordinary duty separation, full workflow transitions, publication rollback at each durable write point, audit verification and post-commit behavior.
- The existing live verifier remains prior art for full black-box identity, publication, compatibility, delivery and receipt closure. It becomes the one formal ABG orchestrator and emits a result for every ABG-01 through ABG-40.
- Import tests cover UTF-8 CSV and JSON equivalence, frozen source digest, malformed headers, field validation, reference errors, all-row duplicate groups, partial success, restart recovery, original-batch retry skipping successes, and new-batch same-key version candidates.
- Authorization tests use separate local people, external Keycloak identities and service principals. They cover wrong object, wrong campus, expired grant, explicit deny, service-identity restrictions, ordinary self-approval rejection and the pure-Schema-upgrade exception.
- Workflow tests cover template version freeze, required stage order, content-digest mismatch, rejection, resubmission as a new request, stage authorization, ordinary and high-risk templates, schema-upgrade scope mismatch, and atomic publication after final approval.
- Price tests cover full snapshot publication, general/specific exclusivity, each actual encounter scenario, hospital/campus fixed fallback, same-level conflict failure, zero/no-price results, Decimal multiplication, historical replay and failure explanations.
- Emergency tests cover authorized immediate suspension, unauthorized attempts, future-resolution blocking, unchanged history, automatic impact issue, independent after-the-fact review, prohibited in-place recovery and approved compensating publication.
- Audit tests cover request correlation, actor/role/object/version identity, append-only enforcement, same-timestamp explicit ordering, independently recomputed chains and single-byte simulated tampering that identifies the first invalid event.
- Release tests cover deterministic projection and snapshot bytes, separate digest scopes, unknown Schema identity, a second canonical snapshot rejection, old-Schema retention, incompatible-consumer isolation, controlled replay and unchanged historical artifacts.
- Outbox fault tests cover lost wake-up, polling recovery, lease expiry, `SKIP LOCKED` competition, network calls outside transactions, consumer success followed by process crash before result storage, retry exhaustion, consumer isolation and gap blocking.
- Capacity-boundary tests use deterministic generated canonical projections that produce exactly 16,777,216 and 16,777,217 final bytes. They verify logical bytes rather than TOAST size, response encoding or evidence-package compression, and prove zero side effects on failure.
- Local-date-time tests submit valid values and values containing `Z` or offsets across API, import and browser paths. Host-timezone variation must not alter business results, and Schema/database scans must find no prohibited time-zone-aware governance types.
- Contract gates regenerate OpenAPI and its digest, run Redocly validation, run oasdiff against the frozen baseline, regenerate both consumers’ clients and scan for hand-written contracts or backend-internal imports.
- Workspace and architecture gates scan the single Git root, exact runtime versions, unique lock file, workspaces, dependency direction, module public entries, table ownership, cross-module SQL, cycles, horizontal-layer names, generic business bases and forbidden infrastructure.
- The management interface has browser scenarios for: login/session/CSRF; charge draft CRUD; mixed import and idempotent retry; history/as-of/diff; ordinary and high-risk workflow; price snapshot/conflict/fixed fallback; emergency suspension and compensating recovery; audit verification; and consumer compatibility/replay/receipt evidence.
- Each formal run starts from an empty database and fixed fixture/seed version, records exact dependency and image digests, and creates a new output directory. A failed run is retained and a rerun never edits it.
- The evidence manifest covers environment, migrations, Schema fingerprint, contract, generated-client provenance, test results, browser traces, fault results, audit verification, resolution evidence, snapshots, consumers, receipts and ABG result mapping. Each file has a SHA-256; terminal evidence is read-only.
- No percentage-based pass criterion exists. Any failed ABG gate, missing required subcase or evidence-hash mismatch leaves Phase 01 incomplete.

## Out of Scope

- The complete-POC expansion to all confirmed governance-object categories, including personnel master data, department master data, the representative standard value set and representative data elements.
- The full price-domain acceptance dataset of 24 charge items, at least 36 item versions, three complete price-list snapshots and the complete adjacent-object thin slices.
- A01 through G12 as the formal set of 72 complete-POC REST scenarios and U01 through U20 as the formal set of 20 complete-POC interface scenarios. Phase 01 reuses relevant test assets but exits only through ABG-01 to ABG-40.
- `MANAGED_EXPORT_HANDOFF`, consumer delivery-profile editing, transformations, derived ZIP artifacts, handoff workflows, capacity workload profiles and their two-stage capacity study.
- `RECORD_PUSH`, per-record third-party push progress, third-party callback adapters and real vendor integration.
- Real HIS, finance, physical-examination, insurance or other consumption systems and any real patient, order, execution, bill, settlement or benefit facts.
- Complete pricing-rule, charge-bundle, policy-evidence, insurance-catalog, benefit-rule, order catalog, execution-service and order-to-charge mapping implementations; only already confirmed architectural boundaries remain.
- Multiple projections for one release, consumer-specific snapshots, automatic downgrade, translation, migration or projection negotiation.
- Production message middleware, CDC, distributed cache, search cluster, Kubernetes, high availability, disaster recovery, production SLA, P95/P99, RTO/RPO, shadow billing and production reconciliation.
- Production or whole-hospital capacity conclusions, procurement parameters, tender baselines, production deployment and rating-compliance claims.
- XLSX import, arbitrary import templates, user-authored scripts, BPMN, a general ETL framework or a generic configurable CRUD/version engine.

## Further Notes

- The specification is based on local baseline commit `f7dd94f`. Later implementation must preserve that commit as the comparison point and must not rewrite the already-produced immutable runtime evidence.
- The current successful live run remains evidence that the core path works, but it is not accepted as proof of missing ABG gates. A new formal run is required after this specification is implemented.
- The current repository has no remote issue tracker. This specification is published in the configured local Markdown tracker with `ready-for-agent` status.
- No unresolved product decision is intentionally hidden in this specification. If implementation discovers a required change to transaction boundaries, database Schema authority, identity semantics, version semantics, the one-release/one-snapshot rule or consumer contract identity, work must stop at that boundary and produce a new or superseding ADR before proceeding.

## Comments

No comments yet.
