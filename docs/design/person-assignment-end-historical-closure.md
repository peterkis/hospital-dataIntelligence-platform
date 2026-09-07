# PV-006-C-03-01 — Assignment end and historical closure

Status: engineering gates passed. DONE takes effect only on the sole local
completion commit after same-tree independent Standards/Spec approval.
SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
All domain date-times are offset-free Asia/Shanghai values.

## Authority and source findings

Only the user C-03-01 local-only prompt authorizes this ticket. Exact clean local
preflight matched branch prototype/phase-03-person-master, HEAD
9ea890d839721959db0ad3f8f6241489b88d8265, tree
adf08ae8708a4a6a21d03706065b60808691f311 and parent
8490afa128bf5b4a72a4cdb9fe29672e4f1fba03. Tracking references are local cache only.
REMOTE_VERIFICATION=NOT_PERFORMED_BY_SCOPE; remote tips NOT_OBSERVED and final
containment UNKNOWN. No external project network or dependency installation.

ADR-0046 establishes immutable placement under one Engagement. ADR-0117 freezes
version semantics and reads latest complete period before the business point.
The existing repository mutation pins and observes positive dependencies before
saving. Its version getter requires ACTIVE segments; its replay treats every
non-CREATE/REVISE operation as classified. Those paths cannot express closure
without a new evidence branch. This is source analysis, not database RED.

ADR-0118 records the newly authorized distinction and terminal policy. For prior
period P=[F,U) and finite T, END requires T>F and (U=null or T<=U); N=[F,T).
The equal finite end is a first explicit confirmation, not a second END. Future
and historical T are allowed; T=F is not planned cancellation. Recording closure
does not imply its end boundary has already been reached at a queried B.

## Evidence and reading design

ADMISSION retains all original evidence, full ACTIVE coverage and exact semantic
pairing. CLOSURE appends to the same assignment_version axis with LIFECYCLE_END,
no new positive fields or validation segments, and exactly one append-only
assignment_closure_evidence row. Its direct predecessor remains the source of
acceptance and optional frozen semantics. The closure fingerprint is independent;
old acceptance payloads, periods, evaluation clocks and hashes are never rewritten.

Exact/history return a real admission-or-closure union. Existing accepted JSON
shapes and successful create/revise return types remain admission-only. Closure
assessment rejects ASSIGNMENT_CLOSURE_NOT_ADMISSION_VERSION; callers may explicitly
assess the original source acceptance version and its original complete interval.
Closure getters never label the remaining period ACTIVE or SATISFIED.

Classified closure exposes INHERITED_FOR_CLOSURE with direct source version,
source semantic clock, closure knowledge clock and frozen Purpose/Mode references.
Its primaryEvaluation is NOT_REEVALUATED_NON_EXPANSIVE. Raw closure stays
UNCLASSIFIED. Current term retirement or upstream state is not consulted.

For V1 PRIMARY=[Jan1,infinity), V2 END=[Jan1,Aug1), an R seeing V2 still declares
PRIMARY in July and releases it at Aug1. An earlier R still sees V1 in September.
Application and native SQL candidate selection must both choose highest core first,
then follow only legitimate closure inheritance. Unknown raw relations similarly
occupy only their selected period. Closing scans no other candidates and cannot
be blocked by unrelated UNKNOWN, collision or candidate-budget exhaustion. Creating
a replacement always retains the full separate positive admission path.

## Authorization, locks and terminal boundary

Current active human and ACTIVE PERSON_MASTER scope require Assignment READ plus
independent END. Classified closure additionally requires SEMANTICS_READ, with no
SEMANTICS_WRITE, definition-write, upstream-write or current Department-read grant.
END does not inherit from WRITE and cannot grant creation or expansion authority.

The implemented mutation order is current authorization → common ASSIGNMENT request
advisory/replay → own stable Assignment UPDATE → expected head → same stable
Engagement UPDATE identity fence → DB clock/proof → version/evidence/END outcome/
success audit → commit. It takes no Department or definition locks and no other
Assignment locks. Closure direct SQL uses the same strong E fence and requires
READ COMMITTED. Historical multi-record reads use a local RR snapshot and append
their read audit after it closes. Both queue orders were observed through pg_blocking_pids, including transitive waiters.

Current permissions precede success/rejection replay. Hashes include actor,
operation, scope, stable target, expected version, normalized microsecond T and
reason. All operations share the original ledger. A new request against a closure
head returns ASSIGNMENT_ALREADY_CLOSED before stale-head evaluation; earlier
successful requests replay their original exact version. SQL also rejects any
new version after closure. System failures roll back instead of becoming stable
business refusals. No infinite automatic retry is introduced.

## Validation and stop line

The source prompt contains 68 required cases, initially NOT_RUN. Evidence is kept
under `.runtime/pv006-c0301/` with a local-only coordinator directory. An original
column list plus cutoff/count/hash protects all existing Person facts, including
old accepted payloads. Fresh and upgrade must use the unchanged native migration
chain and narrow existing schema normalizer. Real service restart and invalid
receipt subprocesses must run before same-tree independent Standards/Spec review.
Early failed commands remain evidence; they do not count as feature validation.

Only one completion commit is allowed after every gate passes. C-03 and PV-006
remain IN_PROGRESS, C-03-02 / D–G remain NOT_STARTED. No transfer, new target,
roles, credentials, HTTP, browser, projection, publishing or formal acceptance.

## Executed evidence

Coordinator: `.runtime/pv006-c0301/local-only-20260907/`. The source prompt's 68
rows are mapped individually in `acceptance-precommit.json`; review and commit
remain pending until their actual receipts are written. Runtime checks do not
stand in for independent review. Final SHA and reviewed-tree/commit-tree equality
are recorded only in ignored final receipts, avoiding a second documentation commit.

| Gate | Actual observation |
|---|---|
| Retained database | hdi_prototype, OID 16389, PostgreSQL 18; 34→35 migrations, 88→89 tables |
| Initial original-column protection | 22 Person tables, cutoff 2026-09-07T21:22:14.543830; descriptor/count/hash equality passed after regression and restart |
| Closure application | run bfa42df8-e498-43ff-b218-5b1bb49514df, 27 groups passed |
| Non-expansion unit oracle | 2,000 finite-set comparisons, seed 60301; four contract/type tests passed |
| Historical application oracle | 36 fixtures / 406 business-record point assertions, seed 6030107; raw, PRIMARY and CONCURRENT |
| Full regression | run 3b1234f6-92cd-4036-808e-02ed670cab83, 28 commands, all exit 0 |
| Governance API | npm-aware serial; 39 files / 516 tests, only the pre-existing formal/container integration suite excluded |
| C-01 / C-02 | full C-01 application and original SQL negatives; C-02 application 21 groups and SQL 6 groups |
| Other regressions | A-01/A-02A/A-02B, B-01/B-02/B-03/B-04, Department native/repository/projection/application/HTTP, Sim/SDK/Replay, consumer Metrics/Audit |
| Build gates | contract lint, full workspace typecheck/build, root check including live database authority |
| Fresh | run 2ee0d710-2a5c-4966-869b-426ec76530b8: official 0001–0035 on verified empty template0 database; separate official/Department/Person seeds; C-01/C-02/closure probes passed |
| Schema authority | fresh/upgrade equality under unchanged narrow B-04 normalizer; generated types equal; forbidden timezone types 0 |
| Actual restart | run 88069a8c-1844-48d9-8c36-cff23af8d1b1: systemctl restart exit 0; postmaster 22:41:23.870824→22:41:34.294557 on 2026-09-07, Asia/Shanghai |
| Cold recovery | run f12e97bf-66e1-4c1e-a953-b7af06bd0265: new pool, 8 exact versions, 42 declared-period + 42 semantic + 42 primary reads; 4 END + 4 old admission replays |
| Recovery integrity | 41 source/core/semantic/outcome/audit rows and 4 closure rows retain their hashes; original receipt bytes unchanged |
| Negative recovery | run 73059d13-6e4c-4d6f-b471-983ba6e3e83e: six actual child exit-1 refusals for missing receipt, wrong run ID/mode/database/OID/endpoint, no cohort/count change |
| Legacy cold recovery | C-01 c0ed2ff1-9ff3-48fe-adc2-3fdee2f25545 and C-02 1c9a929f-a8c9-453b-8bac-cdd84ba8a450 passed using this run's original receipts; five negative-receipt children each also passed |
| Frozen surfaces | gate run 47ffa808-4f95-497c-9bb6-3072590eaef6: 34 original migrations unchanged, 7 canonical artifacts, 15 Department paths, client and Browser unchanged |

The new closure table has 24 columns, 45 catalog constraints, four non-internal
triggers and two indexes. assignment_version has 41 columns including evidence_kind;
17 previously physical NOT NULL admission fields are now enforced together in the
explicit ADMISSION branch. Each missing field was independently refused by real
PostgreSQL. The original 0032 all-or-none classification and 0034 semantic write
isolation negatives were rerun. No applied migration was amended.

OpenAPI SHA-256 remains
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`.
Department Master V1 remains
`a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`,
and Department Hierarchy V1 remains
`72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.
The existing core.autocrlf=true checkout setting is retained. Original migration
Git content is checked with the existing clean filter and each working file's
raw SHA is recorded; no migration bytes are rewritten to normalize line endings.

## What the probes establish

Department SUSPENDED and Engagement ENDED both allow non-expansive closure under
current READ+END authority, while the positive admission path still refuses new
invalid placements. READ+END without WRITE or current upstream grants can close
raw relations; adding only SEMANTICS_READ allows classified closure. Revocation
defeats END and old admission replay. Source Person/Engagement/Department hashes
are unchanged across END, and no new stable Assignment is created.

The real primary-history RED returned UNKNOWN before the end boundary because
the old candidate query expected a new semantic row. The corrected query selects
latest core first and follows closure's direct frozen pointer. July stays PRIMARY,
Aug1 releases it, and old R still declares the old open primary. A raw neighbor
remains UNKNOWN only inside its selected remaining interval. END succeeds even
with 65 other candidates; it does not claim bucket completeness. New positive
admission retains C-02's candidate budget and all other original gates.

Retirement/shortening of the shared current definition was exercised through the
owner module inside a rollback-only transaction. END and its deferred native
constraints passed with the frozen old definition and overlapping raw facts; the
outer definition head and source JSON remained unchanged after rollback. This is
transaction-scoped APP/DB evidence, not a claim of a retained retired dictionary.
No second Person authority was created.

Faults after version, closure evidence, outcome and audit each rolled back all
closure rows and requests. Real deadlock and connection termination also rolled
back without permanent business refusals, and bounded same-request retries
succeeded. The connection test binds the real application factory to one test-owned
pg pool with listeners for expected transport error events; platform-wide pool
handling was not changed. Closure writes explicitly use READ COMMITTED and native
RR writes refuse; historical RR queries close before their audit transaction.

Native SQL proves direct parent/period/reference/provenance pairing, evidence-kind
exclusion, absence of fake ACTIVE segments, terminal protection, immutability and
required END outcome/audit. These guards apply to ordinary writes with guards
enabled; a schema owner or superuser able to change DDL can alter them. Checksums
do not assert administrator-proof identity or evidence security.

## Retained failures and narrow test adaptations

The first intended RED is cda9d398-f3c3-4dc5-aaad-5770623e67ad: after real Department
suspension and correct ordinary-revise refusal, the END module did not exist.
The primary-history RED is bc34953f-985f-4f19-b2ea-0664a8c0dba8 (UNKNOWN versus UNIQUE).
The initial invalid INACTIVE Department fixture, attempted second Person authority,
missing fault point, wrapper invocation without npm context, catalog array decoding
error and pre-application 0035 syntax failure remain separate failed attempts.
The syntax failure rolled back before 0035 was applied; only the corrected migration
was applied. The initial catalog's 45 was a partial-schema count; the corrected
pre-RED catalog verified all 88 owned tables before cohort mutation.

Fresh run f41f7829-9976-49ab-b8f8-513489b1a482 passed schema/types but stopped at
the old TRUNCATE fixture's new inbound FK. The original 55000 assertions were
retained and their explicit table lists now include closure evidence, so they reach
the same immutable guards. No test was removed or excluded to make counts pass.
C-01's keep helper now preserves its input type; C-02's SQL fixture asserts and
captures the admission-only non-null evaluation clock. These are adaptations to
the intentional public history union and physical evidence split, not casts.

The first forced-connection run exited on an unhandled pg error event. Its complete
command failure is retained; the corrected task-owned pool and per-case receipts
were used for subsequent successful runs. Original failures are never relabelled PASS.

Both receipt-owned fresh databases were removed after exact name/OID/owner/endpoint
and zero-session checks; five cleanup negatives were exercised on each. The retained
database was not removed. Managed session receipts report cleanupPassed=true and
distinguish service-stop exit code (some 1), observed inactive/unreachable state,
and distribution termination. No dependency download, external project network,
remote Git operation, push, formal ABG/AR-07, Keycloak or real hospital system ran.
