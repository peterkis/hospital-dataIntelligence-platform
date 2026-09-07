# PV-006-C-03-02 — Atomic Assignment Transfer

Status: Engineering and R1 label remediation verified. DONE activates only on the
sole local commit of the final Standards/Spec-approved tree; the ignored final
receipt records actual activation. Two accepted historical deviations remain.
LOCAL_AUTHORITY_NO_EXTERNAL_NETWORK. SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY.
Domain date-times are offset-free Asia/Shanghai strings.

## Authority and source facts

Only the external C-03-02 local-only prompt and the user's retry authorize this
ticket. Clean preflight matched branch `prototype/phase-03-person-master`, HEAD
`7666716dd24320dbba28cd02400755318e9bee7f`, tree
`733a5f18f800de56859dca3ac976261cb8df9984`, parent
`9ea890d839721959db0ad3f8f6241489b88d8265`. Upstream is local cache only.

| Existing source fact | C-03-02 decision and adaptation |
|---|---|
| ADR-0046 models transfer as old closure plus a new identity | Same Person, Engagement and Purpose/Mode codes; different real Department stable ID |
| Closure and semantic root applications each open their own transaction | A new composition root opens one RC transaction and calls only Person-owner modules |
| Version uniqueness is governance+request; the outcome ledger has one version reference | The original ledger adds an exclusive TRANSFER receipt reference; deterministic child requests preserve old completion requirements |
| Private closure append exists, but its native guard always generates its own clock | A forward-only narrow branch resolves the mapped source child to the header's database-issued R |
| C-02 candidates and native guards observe source's current complete declaration | Insert the actual closure before evaluating target; never pass source as an exclusion |
| ADMISSION evidence, closure inheritance, old replay and RC guards are mandatory | Existing private writes, candidate budgets and completion triggers remain; transfer adds pairing constraints |
| C-01 admits a full period using pinned current owner dependencies | Target must newly pass the entire residual [T,U), even if source could separately close |
| Existing row evidence is immutable | Protect original columns at a pre-migration cutoff; add one transfer mapping table and one nullable outcome reference |

ADR-0119 records the newly authorized decisions. Source must be classified;
unclassified data needs a separate adoption command. The command cannot change
Person, Engagement, Purpose/Mode, target end, or caller recording time. Current
target definitions are reselected, while closure retains its original definitions.
No hospital transfer approval, release, role/credential or clinical authorization
is implied by these synthetic engineering rules.

## Identity, periods and evidence

For source [F,U), require F<T and (U is null or T<U). Source appends a CLOSURE
[F,T); target is a newly generated stable Assignment with classified ADMISSION V1
[T,U). The two periods are disjoint and their union equals the original. Null is
positive infinity, with no sentinel, clipping, sampling or precision loss.

The sole `assignment_transfer` table is a complete immutable mapping, never a
committable PENDING workflow. Its native header trigger generates all four new
IDs and R after the fences. Deferrable FKs permit the header to precede the rows
in the same transaction; native completion requires both sides, exact source
predecessor, codes, periods, clocks, root and child outcomes and success audits.
Source has at most one transfer-out and a new target has at most one transfer-in.

The transfer result reads the mapped exact versions, never either current head.
It returns both evidence branches, original/closed/residual periods, common R,
root and child requests, policy and a deterministic fingerprint of the immutable
mapping and exact evidence. The header need not be patched after inserts to store
a second mutable result: every referenced row and the mapping are immutable.
The root success audit persists the resulting fingerprint and endpoint references.

## Lock map and failure flow

| Step | Actual fence or operation |
|---|---|
| Current access | Active human and PERSON_MASTER scope; READ, END, WRITE, TRANSFER, SEMANTICS_READ/WRITE and target owner permissions |
| Root authority | Existing ASSIGNMENT advisory lock over scope+root request; authorize before successful or rejected replay |
| Source | Exact scoped Assignment FOR UPDATE; select lock-after head, ADMISSION and exact classified semantics |
| Engagement | Existing owner `pinClassifiedEngagement`, directly FOR UPDATE |
| Target | Existing Department `pinDepartment`: current published version FOR SHARE, fresh selection after waiting |
| Definitions | Purpose and Mode stable rows in term-ID order FOR SHARE |
| Body boundary | SAVEPOINT transfer_body after necessary fences; issue complete mapping and R |
| Source write | Private END with mapped child; ordinary non-expansive evidence/outcome/success audit |
| Target write | Private classified create, fresh full-period dependency and candidate evaluation against the real pending closure |
| Root finish | Original outcome ledger TRANSFER reference, root audit, named deferrable completion checks, release savepoint and commit |

Public application scopes reject `~assignment-transfer:` requests. Internally
derived requests use a 64-hex SHA-256 of canonical [governance scope, root request]
plus source/target suffix, not truncation. SQL checks the full mapping, actor,
child operation hashes, IDs and side. The source child cannot be reused as a
standalone END or target child as an independent CREATE. All roots share the
original request ledger; changing operation, payload or actor conflicts.

If the target returns a bounded domain refusal after END has been inserted,
ROLLBACK TO transfer_body removes both sides, header, children and all child
success audits. An explicit absence check precedes the sole root rejection and
rejection audit in the outer transaction. Rejection payloads refer to existing
source identity, not rolled-back versions. A later repaired dependency does not
change that root's rejection; a new root is required.

Private children return refusals to their parent and never persist independent
refusals. SQL errors, deadlocks, stale dependency snapshots, transport faults and
audit failures propagate through full rollback. No catch-all rejection or infinite
retry exists. A changed publication may produce the existing technical
DEPENDENCY_CHANGED_DURING_VALIDATION; a bounded same-root retry reselects it.
The real COMMIT-ACK-loss probe queries the root after its test-local response loss;
it does not infer rollback merely from the thrown error.

Source current Department admission or reference permission is not consulted.
Target scope reference permission is independently required. Receipt reads need
Assignment READ and SEMANTICS_READ; they do not require current positive target
eligibility or TRANSFER permission. The RR receipt snapshot closes before the
read-audit RC transaction, and read audit failure propagates.

## Two notions of atomicity

```text
             old knowledge                 R_transfer and later
source       [F,----------------U)          [F,----T)
target       NOT_KNOWN                            [T,------U)
```

At R_transfer, source closure, target stable creation, target V1, target semantic
record time, dependency evaluation and transfer mapping share one database-issued
operation knowledge time. Audit append keeps its actual clock and sequence. This
R is not a PostgreSQL commit timestamp and does not claim that an in-flight
transaction was visible before commit.

Existing primary, declared-period and semantic as-of entrypoints select latest
record-visible complete versions. Before R they know the old source alone. From
R they know both sides; T is the exact business boundary, and finite U is excluded.
Intentional delay between writes cannot create a row-time NONE interval. Ordinary
END continues 0035's independent clock; ordinary create/revise retain their guards.

## Native and application guarantees

Application code owns closed input, current authorization, fresh owner ports,
bounded evaluation and deterministic fingerprint construction. Native SQL owns
referential pairing, request uniqueness, residual conservation, shared R, source
head and identity checks, evidence-kind completeness, RC writes and immutability.
Tests exercise enabled native guards. A schema owner or superuser able to change
DDL is outside that guarantee; no administrative-proof claim is made.

Applied 0036 introduced the mapping and participants. A real rollback-only SQL
negative then demonstrated an extra-root receipt borrowing defect. Forward 0037
binds the newly inserted root outcome to the header's exact root, actor, scope and
operation hash and enforces the policy digest. A later native SQL negative
demonstrated that a target success audit could name another stable identity.
Forward 0038 requires exact participant stable IDs, entity kinds and a root audit
without a foreign entity-version reference. Applied migrations are not rewritten;
original 0001–0035 remain unchanged.

## Validation state and stop line

The external prompt contains 76 acceptance rows. Runtime evidence is under
`.runtime/pv006-c0302/`; command failures and successful reruns have separate
identities. The initial port conflict and preservation-helper clock omission are
infrastructure/tooling failures, not feature evidence. A YEAR 0000 contract RED,
post-R injected candidate stale-snapshot refusal, test-observer mismatch and the
native extra-root RED are preserved separately.

An overlapping third PRIMARY cannot coexist in a normally committed source
PRIMARY's original bucket. Its targeted negative uses a rollback-only native
candidate in the transient released tail at the same R, with native guards
enabled. This is explicitly different from the controlled concurrency cases,
where the Engagement fence forbids another transaction from interleaving.

Fresh install, real service restart/cold recovery, complete regression and frozen
surfaces have passed. Two independent final-tree reviews and the sole local
completion commit remain the final exit gates. Do not call the ticket DONE until
both are observed in the ignored final receipts.
No push, remote observation, formal ABG/AR-07, container/Keycloak acceptance,
browser flow, real hospital data or production operation is authorized.

Only C-03's END and this atomic transfer are in the authorized aggregate. C and
PV-006 remain IN_PROGRESS; other C extensions and D–G remain NOT_STARTED.
NEXT_PHASE_EXECUTION_AUTHORIZED=NO.

## Executed engineering evidence

### Review disposition

The first frozen candidate (0534ef84e5772bf572b8a42511b43d1289d86b6c) received
Standards PASS and Spec two P2 blockers, both based on read-only code/receipt
inspection without independent DB execution. The initial missing-capability RED
was not run before implementation, contrary to prompt section 15. This historical
sequence cannot be repaired by relabelling later negative controls.

The definition concurrency group also appended race labels to shared retained
definition authority. Future mutation is restricted to a fresh temporary DB with
verified task/mode/name/OID/owner/endpoint ownership receipt. Retained runs record
that group as SKIPPED_BY_SCOPE and require definition preservation; fresh CC-06
evidence is required separately. This does not undo historical effects.

Read-only restoration inspection 32963283-b097-4a2d-9586-0d1759e658d6 found initial
pre-race version 13, race versions starting at 14, intervening C02 NARROW/RETIRED
versions, and current version 27 with the race label. The expected-ownership guard
refused correction before any append. All prior versions and frozen receipts are
retained. User disposition is required for this historical scope deviation and
the RED chronology gap. The matrix below records pre-review engineering outcomes
and does not declare final acceptance, DONE, or C-03 COMPLETE.

Post-review validation: fresh run 09360f88-203f-4349-bf57-3bf9b6c564ff passed
official migrations, four Assignment layers, schema/types equality, six cleanup
negatives and owned database removal. Its transfer run
c4942242-2ab4-4b7f-9e15-b9a9cc327fc6 passed all 37 groups, including the isolated
definition race. Retained run b1982e7b-d8a8-4b0e-9bee-443c30a941dd passed 36 groups,
recorded the definition race as SKIPPED_BY_SCOPE, and asserted every shared
definition row unchanged. Both managed sessions closed with target exit 0 and
cleanupPassed=true. Tooling TypeScript and diff checks passed. Earlier full
regression and real restart receipts remain earlier evidence; they were not
relabelled as reruns of these test-tooling changes. The current 76-row disposition
is `acceptance-review-blocked.json` in the coordinator directory.

Coordinator: `.runtime/pv006-c0302/local-only-20260907/`.
`acceptance-precommit.json` maps all 76 source-prompt rows to real per-case
receipts: 74 engineering/source-scope rows PASS; EV-07 and EV-08 are explicitly
pending until the actual same-tree review and local commit. Final activation is
recorded only in ignored `acceptance-final.json`, avoiding self-referential commits.

| Gate | Actual evidence |
|---|---|
| Baseline protection | Retained hdi_prototype OID 16389; 23 Person tables, original-column cutoff 2026-09-08T00:00:27.654516; all counts/hashes unchanged after final restart/regression |
| Migration/type authority | 35→38 migrations, 89→90 tables; 0001–0035 unchanged; generated types from actual PostgreSQL |
| New native objects | One assignment_transfer table: 29 columns, 61 catalog constraints, 4 non-internal triggers, 8 indexes; four new functions, plus narrow existing guard replacements |
| Final application | 861742eb-0c39-47ce-a6e2-341ace38856c: 37 groups PASS on 38 migrations, including contract, rollback, native SQL, permissions, queues, deadlock, transport and exact receipt tests |
| Temporal oracle | 12 generated finite/unbounded microsecond fixtures; 250 business/record point combinations through existing primary, declared-period and semantic entrypoints; separate deliberate SQL delay and A→B→C checks |
| Unit/architecture | Three transfer tests including exhaustive integer-set conservation; existing architecture assertions retained and adapted to the shared private factory |
| Full regression | 7040b503-3fa6-492e-93b9-08c00170e586: all 29 commands exit 0; API 40 files/519 tests, Sim 20, SDK 72, Replay 4, complete old Person/Engagement/Assignment and Department/Consumer capabilities, contract lint/typecheck/build/root check |
| Fresh | 58b7fa29-6ba4-424b-a5d9-0247785cd09b: verified empty template0 database; official 0001–0038, separate seeds, C01/C02/C0301/C0302 probes, unchanged narrow schema normalizer and generated-type equality |
| Fresh cleanup | All three ticket-owned temporary databases, including the initial seed-prefix failure, were removed after name/OID/owner/endpoint/session checks; final run exercised six refused cleanup receipts |
| Actual restart | b180e8aa-18b2-476f-8730-b0318e87979a: systemctl restart exit 0; postmaster 2026-09-08 02:29:07.854489→02:29:18.217793, Asia/Shanghai |
| Transfer cold recovery | 6a13153a-8a71-485e-a112-e5353a6956d3: four exact pairs, five original classified-create replays, one stable refused root; 51 declared, 51 semantic and 34 primary reads |
| Original recovery rows | 83 common rows, four closure rows and 22 transfer/root-outcome rows retain hashes; original receipt bytes unchanged; C0301/C02/C01 cold recovery and their negative subprocesses also passed |
| Invalid recovery | 2810c7f8-e099-4d31-9597-7b193219f0e8: 14 actual child exit-1 refusals covering missing/wrong task/mode/run/database/OID/endpoint and source/target/transfer/version references; all cohort/audit counts unchanged |
| Final native/frozen gate | 2312e4a3-2f1d-42ee-a392-a9ca533713c0: 288 retained transfers, zero clock/period/root pairing mismatches; 7 canonical assets, OpenAPI/client/Browser and 15 Department paths unchanged; forbidden timezone types 0 |

No test exclusion was added. The only API exclusion remains the pre-existing
formal/container integration suite. Old probes received only current migration
counts, the C0302 owned temporary-name prefix, the extra inbound-FK TRUNCATE list
and the private factory architecture assertion; core negatives remain.

The explicit-root negative control demonstrates retained END on a later target
refusal and an as-of NONE gap between ordinary independent root writes. It was
run after implementation and is not represented as a pre-implementation
missing-capability DB RED. Actual development REDs include YEAR 0000 contract
validation, root receipt borrowing and audit stable-identity pairing. Their
failures and corrected runs remain separate in `failures-and-retries.json`.

Managed sessions report cleanupPassed=true. Some service-stop commands returned
1 while the wrapper independently observed inactive/unreachable service and
successful owned-distribution termination; those distinctions remain in logs.
The retained database and synthetic evidence cohorts remain. No unrelated process,
distribution or database was removed, and no platform approval/model/Git/TLS or
credential settings were changed. Project external-network and push command attempts are 0; remote
tips remain NOT_OBSERVED and remote containment UNKNOWN. Model-service traffic is
outside that project-command count; this is not a machine-offline claim.

## R1 exception disposition and controlled completion

The user's `PV-006-C-03-02-R1-exception-acceptance-and-controlled-resume.md`
authorizes this ticket's controlled finish. Its preserved bytes and hash are in
`.runtime/pv006-c0302/r1-20260908/authorization.md` and `preflight.json`.
The blocked review and all earlier receipts above remain historical snapshots.

| Deviation | Historical fact | R1 disposition |
|---|---|---|
| C0302-DEV-01 | Initial pre-implementation RED = NOT_PERFORMED | ACCEPTED_ONE_TIME_PROCESS_EXCEPTION; chronology was not rewritten; later negative controls remain later |
| C0302-DEV-02 | Earlier shared-definition label mutation = OCCURRED | ACCEPTED_HISTORICAL_SCOPE_DEVIATION; prospective isolation verified; current label corrected by a new owner version; old versions and frozen references unchanged |

R1 preflight matched retained HEAD `7666716dd24320dbba28cd02400755318e9bee7f`,
index tree `05e9e120aeb11ae8891814ef4409a3b224126451`, 45 staged paths, no
unstaged or nonignored untracked paths, and zero new commits. R1 changes only
the existing one-time repair script and these design/spec/issue dispositions,
plus two new tooling files: a narrow label-command guard and its executable
test. These two files increase the final ticket path count from 45 to 47.
They provide a testable boundary for current-period preservation and refusal
of wrong identity, changed head, RETIRED state, or bounded end. No application,
DDL, migration, role, permission or fixture definition implementation changed
during R1. The new guard's actual failing test precedes its implementation;
`guard-red.log`, `guard-green.log` and `rerun-1.log` preserve its own chronology.
An initial read-only inspection exposed PostgreSQL name-array decoding and
failed before mutation; the corrected text-array inspection passed. One CLI
invocation consumed the restore option as npm configuration and only inspected;
the corrected argument forwarding is shown in `restore-2.log`. Neither earlier
attempt is described as a restoration write.

The target is retained synthetic `hdi_prototype`, OID `16389`, governance object
`76000000-0000-7000-8000-000000000001`, stable term
`01a07a47-7058-7538-8e23-ce87d5a02051`, PURPOSE / ORGANIZATIONAL_AFFILIATION.
The script reads exact IDs from the preserved original inspection, locks the
same request and stable term, verifies the full original v13 and prior-head
rows, and invokes existing `appendAssignmentSemanticTermVersion` through its
authorized owner scope in that transaction. Current effective human-actor
grants are checked by the existing scope; no grants were added.

| Restoration fact | Actual value |
|---|---|
| Historical label source | v13 `01a07c47-32a2-7565-b8c8-524f46a6a099` |
| Prior head | v27 `01a07d14-466b-7960-923f-b01c04b61ceb` |
| New head | v28 `01a07e2a-c4b9-7120-9dd0-2891fac86245`, directly superseding v27 |
| Label | SYNTHETIC C0302 DEFINITION RACE → SYNTHETIC ORGANIZATIONAL_AFFILIATION |
| State / business from / to | Before and after: ENABLED / 2026-01-01T00:00:00 / null; taken from locked v27, not copied from v13 |
| New database recordedFrom | 2026-09-08T07:18:47.225053 Asia/Shanghai |
| Request | `c5aefcd6-ab09-40b9-85ce-001401a49c13` |
| Restoration operation | `38c9c5be-1f33-4e73-b1f2-c408742188e2` |
| Append receipt | R1 subdirectory `7bc5e65f-fd75-467f-be10-3820ffe2a28d/definition-repair.json`, including owner audit reference |
| Independent-process replay | R1 subdirectory `b3907cff-56d6-44b1-9dd7-5b7db78df872/definition-repair.json`: ALREADY_RESTORED |

Existing Person and audit rows are fingerprinted by primary-key values and
deterministic all-column hashes. Within the restoration transaction every old
row remains equal; the only permitted additions are the identified term version
and its one success audit. Replay creates neither. Complete intermediate history,
including C02 NARROW and RETIRED versions, is preserved. Actual owner reads at
prior/new/current record times distinguish the race label from the corrected
label. An exact previously frozen Assignment semantic result retains its race
label. All historical frozen-reference rows match, with before/after SHA256
`3c85a40569978303ca109f453e5cb57518ea2e5dd0a1f9ff35f2ad229e4321b4`.
This restores the current display label; it does not restore the database to v13.

R1 retained application run `db27dc02-0638-4655-8931-1ee0f3fd5157` has 36 PASS
and one SKIPPED_BY_SCOPE. All 32 shared definition rows remain unchanged.
Its skipped definition-race group is covered by earlier post-isolation fresh
run `c4942242-2ab4-4b7f-9e15-b9a9cc327fc6` (37 PASS), whose owned database was
removed by fresh runner `09360f88-203f-4349-bf57-3bf9b6c564ff`. The skip remains
a skip. `tested-content-map.json` and `coverage.json` explicitly bind the
previous 29-command regression, fresh and real restart to their source/content
and data scope. R1 repair files are not invoked by those earlier chains; runtime
and DDL are unchanged. Earlier transfer-probe execution is superseded by the
current retained result plus the post-isolation fresh definition-race result.

`rerun-commands.json` records eight current commands, all exit 0: the new guard
test, retained full focused probe, full transfer gate, original-column preservation,
live generated types, catalog, freeze, and the six-command remaining-gates
runner. The latter (`515ba0ac-3cd1-4acb-b67b-5fb18079ac28`) includes contract
lint, full typecheck/build/root check with live database authority, canonical
assets and temporal schema test. Native gate
`79463a3a-b458-43de-b8ea-68435f4f0ee2` observes 404 transfers and zero invalid
pairings. The original 23-table cutoff/column manifest still matches.
All R1 managed sessions report cleanupPassed=true; actual stop exits 0/1 and
independently observed inactive/unreachable state remain distinct in logs.

Final Standards and Spec independently review the same staged tree and these
receipts. Their actual verdicts, tree and method are recorded in ignored
`review-final.json`; `acceptance-final.json` activates EV-07 only from that
review and EV-08 only after the actual sole local commit and clean-tree checks.
No new unresolved blocker is waived by R1. On that commit C-03-02 becomes DONE
and C-03 COMPLETE only for END and atomic transfer; C and PV-006 remain
IN_PROGRESS, subsequent tickets and D–G NOT_STARTED, next-phase authorization NO.
