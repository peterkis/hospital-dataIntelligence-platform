# PV-006-A-02B — Person Source Record Mapping

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Authority: user PV-006-A-02B task; CONTEXT.md; ADR-0019, 0044, 0049, 0071,
0073, 0074, 0083, 0084, 0113 and 0114; the Person mixed-sovereignty direction;
Person Stable Identity and Person Identifier Registry designs.

Create a permanent mapping aggregate for each exact governance-object/source-
system/source-entity/source-record-key tuple. Store Person targets only in
immutable mapping versions. Registration creates V1 atomically; correction and
retraction require an explicit command, expected-current-version concurrency
guard, bounded reason, direct supersession and same-transaction audit. A second
registration never repoints an existing mapping.

Authorized validation: internal contract and application tests; real PostgreSQL
migration, constraint, concurrency, bitemporal, privacy, transaction and restart
probes; existing Person, Department and consumer regressions; frozen OpenAPI,
client and canonical artifacts; one local completion commit after all gates.
All fixtures are SYNTHETIC / NON_PRODUCTION and all platform date-times are
Asia/Shanghai local strings.

Excluded: Person creation or merge, Identifier mutation, fuzzy resolution,
source-system registry, import/connectors, Engagement, Assignment, roles,
credentials, Person projection/release/consumer, HTTP, UI, real HR/HIS/EMR data,
formal acceptance and production security claims. PV-006-B and later tasks remain
NOT_STARTED. No push.

## Comments

Opening branch, HEAD, clean worktree, configured upstream and live remote all
matched `prototype/phase-03-person-master` at
`7e51b87493e1ce00fdaf918abef846948893f903`. Migrations 0001–0021 exist and 0022
was absent. No fetch, pull, merge, rebase, reset or other forbidden Git mutation.

Local engineering validation passed on PostgreSQL 18.6: migration 21→22; 18 Source
Mapping contract tests; live constraints, application, simultaneous corrections,
bitemporal history, audit/privacy rollback and actual database restart recovery;
A-01 and A-02A regression; Governance API 479/479 excluding only the formal
container suite; Sim Consumer 20/20; SDK 72/72; Replay 4/4; Department and Consumer
Metrics flows; OpenAPI/client/canonical freezes; typecheck, build and full check.
The two new tables have 51 PostgreSQL 18 constraints, eight non-internal triggers
and nine indexes; forbidden timezone types and orphan mappings are zero.

Fresh final-candidate Standards and Spec review is required before the sole local
completion commit. No push or PV-006-B work is authorized.
