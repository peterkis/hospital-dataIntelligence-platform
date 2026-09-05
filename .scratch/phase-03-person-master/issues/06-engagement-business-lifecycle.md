# PV-006-B-03 — Engagement Lifecycle / Business-State Semantics

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Authority: user PV-006-B-03 task; CONTEXT.md; ADR-0007, 0009, 0019, 0044,
0045, 0049, 0050, 0071, 0073–0075, 0079, 0083–0084 and 0115; B-01/B-02
designs; and the phase-03 Person Master spec.

Start authority:

- Branch: `prototype/phase-03-person-master`
- `START_HEAD`: `c887b1d27b909c2e4a80d6349edc10843c65efbe`
- `AUTHORITY_HEAD`: `c887b1d27b909c2e4a80d6349edc10843c65efbe`
- B-01 state: DONE on the sole validated completion commit
- B-02 state: DONE on the sole validated completion commit
- Live remote at start: `c887b1d27b909c2e4a80d6349edc10843c65efbe`
- Opening worktree/index: clean; upstream divergence 0/0

## Scope

Add append-only Engagement suspension/resume evidence, derived
PLANNED/ACTIVE/SUSPENDED/ENDED queries for explicit business and record times,
immutable end-period versions, explicit correction/re-engagement separation,
independent lifecycle permissions, bounded audit and real PostgreSQL
concurrency/restart proof. Business state must remain absent from Person,
stable Engagement and governance workflow state.

Excluded: full governance workflow, planned suspension, Assignment,
AssignmentRole, Credential, Person/Engagement HTTP API, projection, release,
consumer changes, real HR policy or real data. PV-006-C–G remain NOT_STARTED.
One local completion commit after every gate; no push or prohibited Git action.

## Comments

Real PostgreSQL opening check first returned `ECONNREFUSED`; the existing
Anolis-8.9-HDI-POC PostgreSQL 18 service was restored with a task-tracked WSL
keepalive and the unchanged hard gate passed. Migration authority was 24, making
0025 next-free. The first post-0025 application probe exposed a NULL comparison
bug in the end-version trigger. Applied migration history was retained and the
next-free 0026 migration corrected the guard instead of hiding the failed probe.

Local engineering validation passed on PostgreSQL 18.6. The lifecycle event table
has 24 constraints, four non-internal triggers and five indexes; the append-only
rejection replay table has 19 constraints, three triggers and three indexes.
Generated Kysely authority covers 81 live tables and forbidden timezone types
remain zero. The
application proof covers all four derived states, append-only suspend/resume,
end from ACTIVE and SUSPENDED, terminal ENDED behavior, idempotency, stale
sequence/version rejection, late facts, corrected end dates, ordinary reopen
blocking, new-ID re-engagement, three concurrency cases, independent states for
one Person, separate governance state, human authorization, bounded audit and
conservative overlap occupancy. Migration 0027 and the application boundary make
successful and rejected request outcomes idempotent across suspend/resume/end;
same request with a changed payload conflicts. Actual PostgreSQL restart recovery
replayed both late-suspension and corrected-end old/new `recordAsOf` pairs in
addition to preserving period versions, lifecycle facts and derived states.

B-01/B-02 and all A-stage live validations passed. Governance API passed 496/496
tests across 34 files with the formal container suite explicitly excluded;
Department constraints/repository/projection/application and 15 HTTP paths,
Consumer/Audit/Metrics, Sim Consumer 20/20, Release SDK 72/72 and Replay 4/4
passed. Projection freeze passed 20/20, all seven canonical artifacts were exact,
OpenAPI remained SHA-256
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`,
and generated client diff is zero. Contract lint, full typecheck, build and the
complete repository/database-authority check passed.

Retained diagnostics are not rewritten as passes: two initial database checks
observed `ECONNREFUSED` until the task-tracked WSL keepalive was corrected; the
first lifecycle application probe exposed the 0025 NULL guard bug fixed by 0026;
the first B-01 regression found its obsolete repository-wide migration-count
assertion; and two incorrectly forwarded Vitest commands reached the unavailable
formal container suite. A complete direct run then reported 490/496 with
transient Consumer failures and a missing `npm_execpath`; the corrected,
independent npm-aware serial run passed 496/496. No neighboring Consumer or
Department behavior was changed for these execution issues.

The first frozen Spec review found three P1 proof/idempotency blockers: rejected
request outcomes were not replayable, restart recovery did not re-query the two
historical record-time pairs, and the end/overlap proof used an ALLOW pair. That
tree was invalidated. Migration 0027, cross-command rejection replay, receipt
history fields and a FORBID-pair before/after proof corrected all three; their
targeted real-PostgreSQL and restart gates were rerun before a fresh review.

The next frozen Standards/Spec review found four additional P1 blockers: ordinary
revision could repurpose lifecycle request identity, database cross-table guards
checked before stable-row serialization, a retroactive second end could bypass
the correction path, and the live idempotency matrix was incomplete. Migration
0028 replaces the version-side guards with one stable-row-first authority for all
revisions; 0029 removes the superseded functions. Application guards now reject
ordinary-revision repurposing and an already-ended relation, while direct-SQL
request/boundary races and successful/rejected suspend/resume/end replay/conflict
matrices are executable PostgreSQL proofs. That candidate and both reviews were
invalidated before the new gates ran.

The following frozen Standards review found one further P1 database-authority
gap: lifecycle event/rejection rows could be inserted after the stable relation
but before V1 in one direct SQL transaction. Migration 0030 makes both append
guards require V1 and makes every version, including V1, check lifecycle request
identity after taking the stable-row lock. Rollback-only direct SQL probes now
prove event-before-V1, rejection-before-V1 and V1-request reuse all fail without
leaving a stable row. That candidate and its review were invalidated before the
new gates and final review.

Fresh final-candidate Standards and Spec approval is required before the sole
local commit. PV-006-C–G remain NOT_STARTED. No push.
