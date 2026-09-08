# PV-006-C-04 — Source-linked temporary assignment

Status: DONE effective only on the sole independently reviewed local completion
commit after all 78 gates. SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
All domain timestamps are offset-free Asia/Shanghai with microsecond precision.

## Authority and distinction from existing facts

The external C04 prompt authorizes only SECONDMENT at local HEAD
`2ddce887263e1841912240534701c27db59cec1d`, tree
`53ea424e7042ceccaaab9881ed86b9eb8f5ac132`, parent
`7666716dd24320dbba28cd02400755318e9bee7f`, branch
`prototype/phase-03-person-master`. Initial index/worktree were clean. The actual
root AGENTS and database wrapper runbook apply. No external project network,
remote verification, package installation, push or later ticket is authorized.

| Existing repository fact | C04 newly authorized test-policy decision |
|---|---|
| ADR-0046 separates identity, Engagement, placement and timed roles, and retains the source for secondment | Only finite SECONDMENT from an exact classified PRIMARY source, depth one |
| ADR-0049 separates Person, Department and professional ownership | Same Person/Engagement/Purpose, different real Departments, no cross-legal-entity dispatch |
| C02 freezes exact Purpose/Mode definitions and latest complete declarations | Existing generic writers retain PRIMARY/STANDING only; readers and definition governance know SECONDMENT |
| C03 END is non-expansive; transfer closes source and creates the residual target | Temporary creation writes only the new child; it never calls END or transfer |
| Current schema has no full Campus/Location/FTE/clinical-qualification model | Source-primary completeness and at most one overlapping secondment per E/Purpose; no physical scheduling or clinical permission claim |

Multi-campus growth may require short support, stable cross-area service or
permanent transfer. These are examples, not an inferred hospital policy. A place
is not a Department identity; serving another location never creates a duplicate
Person or silently changes a primary affiliation. Same Department at another
campus is not a valid different Department for this slice.

## Dependency map and operation matrix

| Boundary | C04 treatment |
|---|---|
| Ordinary public create/adopt/correct/revise | Original input subset; current authorization and request replay precede child revision guards |
| Definition governance / known read mode | SECONDMENT recognized; exact source historical PRIMARY definition remains a fact even if retired |
| Owner ports | Same scoped Engagement effective-period reader and strong pin, two sorted Department publication pins, sorted term pins |
| Private assembly | Person-owner temporary coordinator plus core admission preparation/append in one transaction; no public validated flag or caller R |
| Request authority | Existing assignment_command_outcome, one TEMPORARY_CREATE root and exact target version |
| Persistence | Existing stable/V1/segments/semantics; one immutable assignment_temporary_source extension |
| Native / audit | Forward 0039 closes SECONDMENT/link/outcome pairing; inherited guards continue; bounded creation/rejection/read-assessment audit |

| Operation | Source | Child | Knowledge and constraints |
|---|---|---|---|
| Create secondment | Exact current PRIMARY ADMISSION; read/lock only | New stable ID and finite ADMISSION | Full source/Engagement/two-Department coverage, fresh Purpose/SECONDMENT definitions, complete primary/temporary candidate sets |
| Natural expiry | No write | No write | At B >= to, declaration is outside its period; explicit closure remains false |
| Early END | No write or availability requirement | Non-expansive CLOSURE inheriting SECONDMENT | Original link/admission remain, shorter latest period determines occupancy |
| Read receipt | Frozen exact source version | Frozen exact V1 and semantics | Current source/head cannot replace the original proof |
| As-of declaration | No validity cascade | Latest complete version at R, then B | R before V1 is NOT_KNOWN; link is known with V1 |
| Full assessment | Latest complete original source at requested R | Specified child's full selected period | Compare original references separately from SATISFIED/NOT_SATISFIED/REVIEW_REQUIRED/UNKNOWN |

Target extension, rescheduling, semantic conversion, reparenting, transfer and
chain secondment are unsupported. Source's own lawful END, transfer or correction
remains allowed and does not mutate the child. A source closure can still cover a
child's historical window; it may assess CHANGED+SATISFIED while new creation from
that closed source is refused. Expiry neither proves actual return nor creates a
replacement primary relationship.

## Atomicity, locks and native guarantee boundary

Create uses one READ COMMITTED root: current permission checks; shared request
advisory and replay; source Assignment FOR UPDATE; same Engagement directly
FOR UPDATE; source/target published Department references sorted by Department ID;
Purpose/SECONDMENT term identities sorted by term ID; fresh database evaluation R.
Candidate reads never lock other Assignments after Engagement. Existing source
END/transfer/revise follows the compatible own-Assignment -> Engagement order.

All application domain refusals precede business inserts. The source-link header
is inserted first with deferred target references; its native guard rechecks the
source head and fences, issues the new common recordedFrom and computes a SHA-256
over its PostgreSQL JSONB row representation excluding the fingerprint itself.
The target stable identity, V1 and semantic record use that recordedFrom. The
earlier evaluation R remains the same controlled dependency observation. Source
record times are untouched. Target/segments/semantics/outcome/audits must complete
in the same transaction; any later error rolls everything back.

Native FKs/checks bind identity, scope, exact source semantics, period containment,
one source per target and one operation/request/actor/hash. Header-first insertion
prevents adding a link to an old target. Deferred checks require the target V1,
SECONDMENT semantic, root outcome and all success audits. The source header and
all old immutable rows reject UPDATE/DELETE/TRUNCATE. Ordinary child ADMISSION
revisions and use as a transfer source are rejected. Existing RC-only semantic
guards remain active. Native candidate checks use latest complete periods with
closure inheritance, avoiding historical-period exclusion errors.

Engagement lifecycle segmentation and Department owner interpretation remain
application owner algorithms; SQL guarantees structural reference pairing and
bounded current candidate checks, not a second general temporal policy engine.
The schema owner/superuser can change DDL; these are ordinary-writer guarantees.
Technical SQL/transport errors do not become permanent business refusals. Current
authorization precedes replay; a committed root returns its original exact result
even after later source changes. Readers use one local RR snapshot and append
bounded read audit after it closes.

## Execution chronology, isolation and evidence

Coordinator: `.runtime/pv006-c04/local-only-20260908/`. The authorization bytes,
preflight and one-page dependency map are preserved there. Initial tests ran at
08:54:06–08:54:39 on 2026-09-08, exit 1, tests-only tree
`da93ed23577d7cb3af5fa6903944d032a610d86e`, before any runtime/DDL edit. Four tests
failed explicitly for absent dedicated capability; the generic sourceless
SECONDMENT rejection passed. Downstream containment/source/assessment assertions
were not falsely reported as executed in that missing-capability state.

The retained baseline is hdi_prototype/OID 16389 with 38 migrations, 90 tables,
24 protected Person tables and 32 shared definition versions. Original columns
and cutoff hashes preserve old rows, and full old-definition ID/hash manifests
also detect appended history. Retained may only add previously absent SECONDMENT
V1 through the owner; seed replay has a separate receipt. Definition changes,
retirement, narrowing and corruption probes require a fresh database whose
name/OID/owner/endpoint/runId match the create-exclusive ownership receipt.

The first development fresh run `e423c706-9f10-45c1-a061-a4b32df21779` installed
0001–0039 into an empty owned database, generated real types and passed all five
initial behavior tests. It was removed after receipt validation; it was an early
development result, not completion or formal acceptance.

Final owned fresh `a21b082b-b612-449b-b7f4-12276224f283` passed the complete
0001–0039 chain (39 migrations / 91 tables), real codegen equality, retained/fresh
schema equality and post-probe native schema equality. Its focused receipt
`7defc032-a704-4d6c-9cb3-7b270af6b6d8` contains 46 passing groups, including native
negative cases, source/target publication races and fresh-only definition races.
Retained `7bcdd66a-5145-4ee2-a73c-01d2efd7a17d` has 33 PASS + 3 SKIPPED_BY_SCOPE:
shared-definition races, retirement/narrowing and destructive native probes stay
fresh-only. Every current code/input/probe/migration hash matches this retained
run and the final fresh. The coordinator's `evidence-inventory.json` records the
complete equality; no different-code validation is reused for the final candidate.

The final fresh's regression receipt `ed0cfdae-bb2d-4c85-8943-efb9310112dc` records
31 commands with exit 0: current A/B/C/END/transfer/Department/Consumer, API 40 files
and 519 tests, Sim 20, SDK 72, Replay 4, closed-input compile checks, 2,000 independent
discrete-microsecond oracle cases, fixture guards, catalog/frozen assets, contract
lint, typecheck, build and root check. The existing formal-container vertical-slice
integration file is explicitly excluded, not claimed as prototype or formal PASS.
No browser smoke was performed; frozen admin-web/client/OpenAPI bytes are checked.

Actual restart `75511534-69d1-47d5-8eb3-a4d4a2d13d6d` changed the postmaster from
`2026-09-08T12:08:31.462720` to `2026-09-08T12:08:41.838711`, with no other client
backends before restart. New-pool recovery reproduced six creates, one refusal,
36 declarations and 12 assessments from the original unchanged receipt. Seven
actual negative recovery subprocesses refused wrong inputs without creating a
replacement cohort. All owned fresh databases were removed; pool/service/WSL
cleanup receipts record observed state separately from command exits.

Failed runs remain evidence. The original SQL injection adapter was corrected;
the old C02 TRUNCATE probe now includes the new FK-dependent table and still
expects the original immutable trigger rejection. Empty fresh regression seeds
the original A/B policy requests before shared fixtures and runs A before B/C,
preserving old idempotency and permission assertions. An old Consumer SLA probe
failed intermittently at its fixed 1.1-second sleep because the HTTP clock has
second precision while events have microseconds. It now waits until that same
business clock strictly exceeds the actual event's SLA deadline, then retains the
original LATE/applyOverdue/metrics assertions. Only safe source locations were
added to its diagnostic output; production Consumer behavior did not change.

The first independent Standards review rejected candidate
`c9ddc8772a9558cb00739a71e17610283b05567c` for omitting temporal query conditions
from sensitive as-of access audit (ADR-0006). An added real database test failed
against that unchanged runtime, then passed after the narrow composition fix.
Reads now bind the exact selected version; as-of reads record validated B/R from
the returned declaration, after the RR snapshot closes. The test distinguishes
three historical selections and an exact admission receipt without business-row
mutation. `audit-review-fix.json` binds identical test hashes across RED/GREEN.
Both old-tree reviews are superseded for submission; the final new tree requires
independent Standards and Spec approval again.

The middle-only competing PRIMARY state cannot be persisted through normal
native guards. Its application negative uses controlled candidate-result
corruption over actual SQL rows, while the native writer is independently shown
to refuse the conflicting state. Native temporary-overlap negatives hide only
the application candidate; SQL sees the real rows. Missing-row probes use zero-row
INSERT SELECT with the original operation type. No trigger is disabled, and no
unpersisted injected observation is described as a stored business fact.

The coordinator's `coverage.json` maps all 78 rows to actual APP/DB, oracle,
compile, chronology, Git, review and resource evidence. It does not call these
78 independent database tests. Final preservation, exact argv/cwd/time/exit logs,
original 0001–0038 hashes and old immutable row/definition manifests are linked
there. Retained skips remain SKIPPED_BY_SCOPE with matching fresh PASS. Review
methods/findings belong in `review.json`; final commit/tree/parent/clean facts in
`final.json`. DONE takes effect only after zero outstanding Standards/Spec
blockers and the sole authorized commit, never by converting pending gates to
PASS. The cumulative retained evidence database remains.

## Frozen surfaces and stop line

No Assignment HTTP/API, UI, Person projection, release/consumer expansion, formal
acceptance, hospital approvals, notifications, roles, credentials, FTE or location
model is added. Seven canonical assets, formal OpenAPI, generated client and all
15 Department browser paths remain frozen. OpenAPI expected SHA-256 is
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`.

Only `feat(person): add source-linked temporary assignment core` may be committed,
once, after final same-tree Standards/Spec review with zero outstanding blockers.
The ignored final receipt records commit/tree/parent/clean-worktree facts.
REMOTE_VERIFICATION=NOT_PERFORMED_BY_SCOPE; REMOTE_TARGET_TIP=NOT_OBSERVED;
REMOTE_TARGET_CONTAINS_FINAL_COMMIT=UNKNOWN. C and PV-006 remain IN_PROGRESS;
other C extensions and D–G remain NOT_STARTED. Earlier C03 exceptions are historical
facts, not exceptions to any C04 requirement.
