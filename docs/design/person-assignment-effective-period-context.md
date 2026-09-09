# PV-006-C-05 — Assignment effective period context

Status: engineering validation passed; DONE effective only on the sole
independently reviewed local completion commit. SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
All domain timestamps are offset-free Asia/Shanghai with microsecond precision.
Authority and all 64 acceptance cases are the external user C-05 execution file.
The final evidence section distinguishes executed validation from pending review/commit activation.

## Existing call graph, inspected before implementation

| Entry | Actual owner path | Meaning / transaction |
|---|---|---|
| getAssignmentDeclaredPeriodAsOf | closure root → createAssignmentScope → Assignment core → latest complete version at R | Declaration at point B; root appends read audit after the snapshot |
| assignmentSemanticExact | Person-private store → exact ADMISSION semantic or verified closure → frozen source semantic | Immutable classification, no current definition selection |
| assessAssignmentDependencies | ordinary root → scoped core exact ADMISSION → observe → Engagement period and Department placement owners | Exact version's full period; local RR, then separate RC read audit; rejects closure/temporary |
| assessTemporaryDependencies | temporary root → scoped temporary module → private assessment → original link, exact target, latest stable source, owner ports and candidates | Exact target full period; six components, RR followed by RC audit |
| getEngagementEffectivePeriodAsOf | scoped Engagement owner → latest full temporal resolver + prefix/in-window lifecycle facts | Entire explicit W at R; 64 facts / 128 segments / 65536 bytes |
| getDepartmentPlacementReferenceAsOf | scoped Department owner → unique R-visible published projection/version | Actual publication visibility and active-period facts; no draft fallback |

The public roots each start their own transaction. Calling several roots cannot
construct one MVCC observation. C-05 must use their scoped owner ports inside one
local business-read-only RR transaction, end it, then append bounded read audit in RC.

The selected immutable version and the requested window are distinct inputs.
Full assessment keeps its full period; a new window evaluator cannot clone a
version and alter its period. Declaration coverage is computed after selecting
the largest versionNo visible at R. PARTIAL/NONE returns the exact uncovered
periods and NOT_EVALUATED after the complete static permission combination.

Original admission/closure/link references explain past evidence; observed refs
describe this W/R. A closed historical window may be structurally satisfied.
SECONDMENT retains its original source link and separately observes the latest
version of the same source stable ID. Transfer does not reparent it.

FULL and SATISFIED describe structural facts only. The result does not preserve
actor grants, lock future dependency state, approve a role or confer clinical
permission. Future mutations need their own authorization, versions, fences,
role/qualification rules and transaction evidence. Those mutations are outside
C-05 and remain unauthorized.

## Implemented contract and four independent dimensions

The new root returns only `AssignmentEffectivePeriodReader`. Its sole query has
governanceObjectId, assignmentId, requestedFrom, requestedTo and recordAsOf;
unknown keys, invalid identifiers, offsets, year zero, empty intervals and
non-finite starts fail closed. Null end retains positive infinity. Inputs and
output times normalize to six fractional digits before comparison and hashing.
There is no point-query overload, caller version selector, approval flag or SQL.

The result separates latest declaration coverage, frozen semantic references,
original evidence references and observed window dependencies. `FULL` means all
of W is in the selected complete version. `PARTIAL` or `NONE` includes the exact
uncovered intervals and `NOT_EVALUATED/REQUEST_OUTSIDE_DECLARED_PERIOD`; the
reader never silently evaluates only an intersection. Before V1 it throws
`ASSIGNMENT_NOT_KNOWN_AS_OF` instead of manufacturing a state.

| Input shape | Selection and meaning |
|---|---|
| Ordinary ADMISSION | Latest complete version at R; original dependency/semantic fingerprints remain exact |
| Unclassified legacy | UNCLASSIFIED plus null semantic references; structural satisfaction does not infer a Purpose or Mode |
| CLOSURE | Selected closure and separate closure fingerprint; direct original acceptance and inherited frozen semantics remain visible |
| Transfer source / target | Source reads its closed residual period, target its independent admission; no automatic stable-ID following |
| SECONDMENT | Latest target declaration first; immutable original link/source refs plus separately observed current original-source version |

`evaluateOrdinaryAssignmentWindow` and `evaluateTemporaryAssignmentWindow` are
owner-private functions receiving explicit windows. Existing full assessments
pass the original full selected period, keep their old return shapes and retain
their original referenceComparison semantics. New results do not compare
different-window hashes to imply changed dependencies. No immutable Version is
cloned with altered bounds. Ordinary assessment still rejects CLOSURE and
temporary versions through its pre-existing errors.

Ordinary dependencies are complete Engagement authority/state segments and
R-visible published target Department coverage. SECONDMENT additionally observes
the same source stable ID's complete period and inherited PRIMARY semantics,
whole-window source-primary completeness, source Department and other temporary
overlaps excluding itself. Components retain the existing aggregate priority
NOT_SATISFIED > REVIEW_REQUIRED > UNKNOWN > SATISFIED. Source graph depth stays one.

## Authorization, consistency, limits and audit

Current active human and object-scope checks use database local_now, never caller
R. Assignment READ/SEMANTICS_READ, Engagement READ/LIFECYCLE_READ and target
Department reference permission apply before delivering any coverage branch.
SECONDMENT also requires the source Department permission. Missing permissions
propagate; unknown business dependencies are limited to fixed owner reason codes.
Denied reads retain bounded access-denied audit without inventing a version ID.

All business-owner SELECTs share the root's local REPEATABLE READ transaction.
Existing authorization_decision records remain in that transaction; these are
authorization observations, not new Person/Assignment or audit-stream facts.
The database transaction is therefore not declared PostgreSQL READ ONLY.
Using a second simultaneous authorization writer was tested and then removed
to preserve operation with a one-connection pool. Business reads acquire no
FOR SHARE/FOR UPDATE or new advisory business locks. Existing writer isolation
and lock order remain unchanged. After RR ends, separate READ COMMITTED audit
binds validated W/R, selected version, original refs, coverage, result, bounded
reasons and the exact context fingerprint; audit failure propagates.

The context fingerprint covers normalized W/R and the bounded structural result,
including observed version/publication/event/candidate references. It excludes
request/audit IDs, wall-clock, elapsed time and mutable Department record-closing
metadata. R is record knowledge, not a commit timestamp. Controlled races permit
one internally consistent old observation while upstream commits, then a new
observation on the next call; no future writer guarantee is implied.

Existing owner bounds remain 64 candidates/lifecycle facts, 128 segments and
65536 UTF-8 bytes. New result encoding independently checks candidate/segment/
byte bounds. Limit errors or explicit bounded UNKNOWN never truncate into
SATISFIED. Reasons are deduplicated, sorted and restricted to a closed enumeration.
The independent oracle enumerates integer microsecond sets; it does not reuse
the production containment/difference algorithm as its expected result.

## Environment ownership and evidence chronology

Initial tests-only tree `3e36fe855e36c2ab89924ecb2d3116cfdca2815d` contains only
the four tests and their npm test registration. The unchanged test bytes have
SHA-256 `bfffea81dea041fcebc021d83608d52018cea92e5b932c32d4a1b7b1d02e4fae`.
The actual initial RED failed all four imports before fixture or downstream
assertions; those assertions are NOT_REACHED, not observed baseline violations.
An implementation attempt later exposed PostgreSQL READ ONLY rejecting existing
authorization-decision INSERTs; that distinct failure remains in the logs.

The retained protection cutoff is `2026-09-09T09:30:21.454420`, after initial
development cohorts but before expanded focused runs: 25 Person tables and all
33 shared definition versions, on hdi_prototype/OID 16389, 39 migrations/91 tables.
The protection does not pretend to be a pre-initial-fixture snapshot. Initial
tests independently compare all shared definitions and use only new cohort facts.
The full validation coordinator adds pre/post hashes of every audit row at its
own cutoff. No old original row is repaired, rewritten or deleted.

Fresh validation delegates creation/migrations/seed/schema/codegen/regressions/
cleanup to the existing C04 owned-database runner. Its exclusive ownership
receipt additionally binds `consumerTask=PV-006-C-05`; C05 destructive and shared
definition tests require that exact binding plus the runner's task/mode/name/
OID/owner/endpoint checks. Retained skips these cases. Existing C04 and A/B/C
regressions remain explicitly labelled as regressions under that owned job.
No new schema normalizer or migration exists.

Recovery has a fixed RECOVER_ONLY path, an exclusive original receipt plus
run-bound receipt hash, current source hashes, original requests/actor and live
database identity checks. It cannot create a replacement cohort. Its vectors
exclude the actor intentionally revoked in the authorization negative; recovery
must not turn that historical successful read into a new permission grant.
Actual service restart first requires zero unrelated client backends, changes
postmaster_start_time and reuses the unchanged original receipt with a new pool.
Wrong receipt variants execute as real refusing subprocesses with unchanged
business and audit counts. Managed-session cleanup distinguishes stop exit from
observed inactive/unreachable state and retains the accumulated evidence database.

The first frozen implementation tree, `6a1148052b9e51ba58cf61c61fae0aaa58bfda37`,
received one P2 finding per independent axis. Standards found a tautological
post-publication comparison; Spec found missing bounded denial audit for unknown
Assignments. Both findings and their original reports remain in
`.runtime/pv006-c05/initial-20260909/review-preliminary.json`. Unknown-read audit
has a separate actual two-test RED (`C05_UNKNOWN_READ_DENIAL_AUDIT_MISSING`) and
same-test GREEN. These supplement rather than replace the original tests-only RED.

First full validation `062ba3ca-a35c-4e54-88aa-c55736f42106` passed retained,
owned fresh and all 31 regression/gate commands. It really restarted PostgreSQL
from `2026-09-09T09:55:25.581989` to `2026-09-09T10:07:39.801883`, then recovery
failed after 19 successful vectors: a pre-publication R captured after a draft
fell in the native Department clock boundary, and the later result was UNKNOWN.
The original receipt and failed recovery remain untouched; this is not a PASS.

The first attempt to strengthen the test by delaying publication then hit the
real `department_version_bitemporal_exclusion` guard in run
`07ebca8e-bc9c-41d9-8afd-1c65cd86a536`; its publication transaction rolled back.
The corrected fixture saves a committed R/context before the draft, verifies
the actual draft record time is later, and uses that exact version clock for
the existing publication APIs. The optional fixture clock leaves older callers'
default behavior intact. Post-publication reads must equal the saved context
and retain the exact original Department version. No Department runtime,
migration, schema normalizer or native guard was changed. General late-commit
or rounded-record-clock history is not redefined by this ticket.

Recovery vectors use explicit R over fixed committed facts. The deliberately
old MVCC results from concurrent reads at a future R are tested as concurrency
evidence, not promised as cross-connection historical reconstruction after the
writer has committed.

All execution is LOCAL_AUTHORITY_NO_EXTERNAL_NETWORK. Remote verification is
NOT_PERFORMED_BY_SCOPE, remote tip NOT_OBSERVED and final remote containment
UNKNOWN. No push, browser smoke, formal ABG/AR-07, Keycloak/container acceptance,
real hospital integration, new Mode, AssignmentRole or later ticket is included.

## Current executed engineering evidence

Coordinator: `.runtime/pv006-c05/5352527e-95be-4099-b08b-9bae21f7f6f8/`.
Index and 64-row matrix: `.runtime/pv006-c05/initial-20260909/`.
The current retained, fresh, old temporary focused and full regression runs have
identical source/test/input-script/migration manifests, verified against current
working files in `evidence-inventory.json`. Earlier failures are not substituted
for these current passes.

| Gate | Actual current evidence |
|---|---|
| Initial RED / same-test GREEN | Four initial missing-capability failures; unchanged original test SHA; current four tests pass |
| Review audit correction | Two missing-denial-audit REDs; same two tests now pass with normalized query and null version |
| Retained focused | `87df318c-f34a-4236-bca3-bfbde3ea86fd`: 9 passing groups + 1 scoped skip; static source/target permissions and one-connection pool included |
| Fresh focused | `6f06e7c2-9c52-484c-8fb5-07aca4e284f6`: 12 passing groups, including retirement, controlled candidates/proof, native rejection and selected/unknown audit faults |
| Interval oracle | 3,900 independently enumerated microsecond sets / 54,600 point assertions; exact lifecycle microsecond and same-point sequence assertions also execute |
| MVCC races | Actual target SELECT paused via test-only driver barrier; source END/publication commit before reader resumes; old result internally consistent, next result sees new dependency |
| Original full APIs | Current C01/C02/C03/transfer regressions and old C04 46 groups pass; full assessments retain original intervals and fingerprints |
| Full regressions | `c196fa27-8747-4003-a942-043c178cfe90`: all 31 commands exit 0; API 40 files/519 tests, Sim20, SDK72, Replay4, Department/HTTP/metrics/audit and all build gates |
| Fresh authority | `e4875bf4-c41a-4ffb-a965-048374efcbd6`: empty owned database, official 0001-0039, separate seeds, 91 tables, real generated types/schema equality, native schema unchanged after probes |
| Actual restart | `f8901606-9f7a-42e1-8214-f69691f352ef`: postmaster `2026-09-09T10:17:22.605502` → `2026-09-09T10:29:12.441170`, command exit 0 and no unrelated clients |
| Cold recovery | `e8d0a926-5d75-44bc-906d-20746981a2c7`: 29 fixed-committed-fact W/R results, fingerprints and refs reproduced; original row hashes and receipt unchanged; no new cohort |
| Bad recovery receipts | `d97950ce-387d-469e-9077-e60e1a415b6d`: nine actual exit-1 child refusals; task/mode/DB/OID/actor/hash/endpoint/run/source changes rejected by original receipt binding before DB-dependent work; counts unchanged |
| Preservation | Original 25-table cutoff, all 33 retained shared definition versions and original audit hashes match; 39 migration raw-byte hashes match earliest C05 manifest |
| Frozen surfaces | OpenAPI/client/admin-web unchanged; seven canonical artifacts, 15 Department paths, API operation delta 0, forbidden timezone database types 0 |
| Resources | Final owned fresh database removed after exact receipt checks and six cleanup negatives; pools closed; wrapper target 0 / cleanupPassed true / stop exit 0 / inactive and unreachable; retained evidence DB preserved |

CS-06 combines distinct evidence types: the new reader's 64-candidate/overflow
test is SQL-backed application execution with explicitly substituted returned
rows. Current C01 native lifecycle budget and C04 native overflow/oversized
whole-assessment probes supply owner-boundary database evidence. There was no
direct C05 persisted-lifecycle-overflow or oversized-output test. The unchanged
64-fact owner limit is stricter than the downstream segment/byte ceilings; the
new guard never truncates to SATISFIED. These are not described as 64 independent
database tests: the matrix maps shared assertions, native observations, compile
checks, review and Git facts to 64 acceptance rows.

Four historical migration working files already use CRLF while their Git blobs
use repository-normalized LF (0033, 0036-0038). They were not rewritten. Their raw
hashes match the earliest C05 source manifest, all 39 canonical Git contents match
START_HEAD, and database/fresh migration checksums and schema equality passed.
The initial raw-working-file versus Git-blob byte comparison failure is recorded
as an evidence-comparison distinction, not a migration edit or an ignored DB gate.

Final Standards/Spec reviews must inspect the same final staged tree including
these documents. The two preliminary P2 findings remain historical; their fixes
and current reruns are preserved. `acceptance-precommit.json` leaves EV-10/EV-12
pending; only ignored final review/commit receipts activate them. No SHA is added
to tracked documents after commit and no amend is authorized.

On that sole completion commit C05 becomes DONE and the consumer read boundary
ENGINEERING_VERIFIED. C and PV-006 stay IN_PROGRESS; all other C extensions and
D-G remain NOT_STARTED, with NEXT_PHASE_EXECUTION_AUTHORIZED=NO.
