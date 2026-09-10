# PV-006-B-01 — Engagement Stable Relation & Immutable Version Core

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Authority: user PV-006-B-01 task; CONTEXT.md; ADR-0019, 0044, 0045, 0049,
0050, 0071, 0073, 0074, 0083 and 0084; the Person mixed-sovereignty direction;
Person Stable Identity, Identifier Registry and Source Record Mapping designs.

Create a permanent Engagement aggregate for each separately confirmed formal
hospital relation. Bind the stable Engagement to exactly one existing Person for
its entire lifetime. Creation atomically appends V1; continuity, extension and
fact/validity correction append immutable versions on the same Engagement ID.
Every revision requires an expected-current-version guard and a bounded B-01
reason. A later new relation or materially different legal/administrative basis
uses a new create command and a new Engagement ID.

Authorized validation: internal contract tests; real PostgreSQL migration,
constraint, application, concurrency, audit rollback, bitemporal and restart
probes; A-01/A-02, Department and consumer regressions; frozen OpenAPI, client,
Department and canonical artifacts; one local completion commit after all gates.
All fixtures are SYNTHETIC / NON_PRODUCTION and all platform date-times are
Asia/Shanghai local strings.

Excluded: Engagement type/classification, overlap policy, business lifecycle or
state, Assignment, AssignmentRole, Credential, Person projection/release/consumer,
HTTP/UI, contract-document management, real HR/HIS/EMR data, formal acceptance and
production claims. B-02, B-03 and PV-006-C–G remain NOT_STARTED. No push.

## Comments

Opening branch, HEAD, clean worktree, configured upstream and live remote all
matched `prototype/phase-03-person-master` at
`1b911a03b27e2fd391d70b1b123d47b455f4cee7`. Migration 0023 was absent and was
the next free native migration. No fetch, pull, merge, rebase, reset or other
forbidden Git mutation was used.

Local engineering validation passed on PostgreSQL 18.6: migration 22→23; stable
single-Person ownership; atomic V1; immutable V1/V2/V3 history; stale and
concurrent writer protection; bitemporal queries; authorization/audit rollback;
and actual database restart recovery. The two new tables expose 41 constraints,
eight non-internal triggers and eight indexes; forbidden timezone types and
orphan Engagements are zero.

A-01, A-02A and A-02B validations passed. Governance API passed 488/488 tests in
32 files with the formal container suite excluded. Department constraints,
repository, projection, application and 15-path HTTP validation passed. Sim
Consumer passed 20/20, SDK 72/72, Replay 4/4, projection freeze 20/20 and 7/7
canonical artifacts remained exact. Contract lint, typecheck, build and full
repository/database-authority check passed. OpenAPI and generated client are
unchanged.

Fresh final-candidate Standards and Spec review is required before the sole local
completion commit. B-02, B-03 and PV-006-C–G remain NOT_STARTED. No push.
