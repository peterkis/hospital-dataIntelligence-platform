# PV-006 — Person Master

Status: ready-for-agent
Phase: IN_PROGRESS

Authority: CONTEXT.md, ADR-0024, 0044–0050, 0019, 0071, 0073–0074,
0083–0084 and `docs/design/person-department-mixed-sovereignty-poc-direction.md`.
Execution authority: user PV-006-A-01 and resume PV-006-A-01-R1.

A-02A is authorized by the user PV-006-A-02A task. PV-005 remains ENGINEERING_COMPLETE; formal acceptance
and production status are unchanged. All fixtures are SYNTHETIC, NON_PRODUCTION,
and all application date-times use Asia/Shanghai local strings.

PV-006-B-01 is separately authorized by the user Engagement Stable Relation &
Immutable Version Core task at authority HEAD
`1b911a03b27e2fd391d70b1b123d47b455f4cee7`. Only B-01 is authorized.

| Task | Scope | State |
|---|---|---|
| PV-006-A-01 | Person Stable Identity & Subject Core | DONE on the sole validated completion commit |
| PV-006-A-02A | Person Identifier Registry | DONE on the sole validated completion commit |
| PV-006-A-02B | Person Source Record Mapping | DONE on the sole validated completion commit |
| PV-006-B | Engagement | COMPLETE on the B-03 sole validated completion commit |
| PV-006-B-01 | Engagement Stable Relation & Immutable Version Core | DONE on the sole validated completion commit |
| PV-006-B-02 | Engagement Type / Classification & Overlap Rules | DONE on the sole validated completion commit |
| PV-006-B-03 | Engagement Lifecycle / Business-State Semantics | DONE on the sole validated completion commit |
| PV-006-B-04 | Engagement Temporal Authority Reconciliation | DONE effective on the sole validated B-04 completion commit |
| PV-006-C | Assignment | IN_PROGRESS |
| PV-006-C-01 | Assignment Stable Relation & Placement Core | DONE effective on the sole validated C-01 completion commit |
| PV-006-D | Assignment Role | NOT_STARTED |
| PV-006-E | Credential | NOT_STARTED |
| PV-006-F | Projection / Release / Consumer | NOT_STARTED |
| PV-006-G | Full synthetic acceptance | NOT_STARTED |

Person is a hospital-wide, permanent natural-person identity. Engagement,
placement, roles, credentials, identifiers, accounts and patient identities are
separate authorities. Matching names or dates never authorize a merge.

## Comments

PV-006-C-01 is separately authorized by the user's assignment placement core
prompt at HEAD `8b1721ebb2000435415aa2cfd47c398a258d9f09`, tree
`c0b3670a893bc40cbad6a9e85ffebd7263819977`. Only DEPARTMENT placement core,
complete-period owner dependencies and exact-version read-only assessment are
authorized. ASSIGNMENT_DEPARTMENT_CORE_V1 is synthetic test policy only.
One local completion commit after all 72 gates; no push or C-02/D-G work.

PV-006-B-04 is separately authorized by the user's engagement temporal authority
reconciliation prompt. Its supplemental B engineering gate is PASS; final-tree
Standards/Spec approval and the sole local B-04 commit activate completion. See issue 07.
The initial empty-database permission block was resolved by the user's explicit
WSL postgres peer-administration authorization. The original B-01/B-02/B-03
DONE records and historical B completion remain unchanged. The user-authorized
startup-tooling commit `fa61dc79f0f4298629e4d5c6340f99455c99be98` is the resumed
execution baseline above domain authority `c1abe02edab1a7ebfc64c207a96e3bfc5526620e`.
Real baseline create/point disagreement has been reproduced; this does not
establish a fix or authorize C-G by itself. Subsequent implementation and all
engineering gates passed as recorded in the B-04 design. No B-04 completion commit
until every gate passes. NEXT_PHASE_EXECUTION_AUTHORIZED=NO; C-G stay NOT_STARTED.

A-02A continues the existing Person branch at authority
0333d827373e8f97faaa8737145c54acc372f9c1. Registry and source mapping are separate
tasks. Only registry implementation and one local completion commit are authorized;
no push or next task. Local upstream is observed, not required to be absent.

R1 authorizes source/upstream/remote source `dc2c4882fc2fc82d6f5f2e853c3c61b429282f2a`,
divergence 0/0, and a new local `prototype/phase-03-person-master` without upstream.
One local completion commit after all gates, no push, stop before A-02.

PV-006-A-02B is authorized by the user Person Source Record Mapping task at
`7e51b87493e1ce00fdaf918abef846948893f903`. It may add only the internal,
synthetic source-record mapping capability and one local completion commit.
Person binding corrections must append immutable versions through an explicit
correction command; re-registration and row mutation may not repoint a mapping.
PV-006-B and later work remain NOT_STARTED. No push.

A-02B local engineering gates passed against real PostgreSQL 18.6: migration
21→22, immutable stable mapping/version constraints, explicit correction,
stale/concurrent correction protection, retraction, bitemporal history, privacy,
transaction rollback and actual restart recovery. A-01, A-02A, Department,
consumer, frozen-contract, typecheck, build and repository/database-authority
regressions passed. Completion becomes effective only with fresh final-candidate
Standards/Spec approval and the sole local commit. PV-006-A-02 is then complete as
the aggregate of A-02A and A-02B; PV-006 itself remains IN_PROGRESS.

PV-006-B-01 is authorized as the first Engagement slice. It may add only the
stable Person-to-hospital relation, immutable bitemporal period versions,
continuity/correction revisions, independent read/write permission and audit,
and one local completion commit after all gates. It must not add classification,
overlap policy, business lifecycle/status, Assignment, Role, Credential,
projection/release/consumer, HTTP or UI. B-02 and B-03 remain NOT_STARTED.

B-01 local engineering gates passed against real PostgreSQL 18.6: migration
22→23, stable single-Person ownership, atomic V1, immutable bitemporal versions,
idempotency, stale/concurrent revision protection, audit rollback and actual
restart recovery. A-01, A-02A, A-02B, Department, consumer, frozen-contract,
typecheck, build and repository/database-authority regressions passed. Completion
becomes effective with fresh final-candidate Standards/Spec approval and the sole
local commit. PV-006-B remains IN_PROGRESS because B-02 and B-03 are NOT_STARTED.

PV-006-B-02 is authorized by the user Engagement Type / Classification &
Overlap Rules task at local B-01 authority
`221dfa6a0d18cf4fb89fed3c1082ed8896022913`. It may add only versioned Engagement
Type definitions, immutable type-version classification, versioned symmetric
overlap rules, overlap evaluation for create/period revision, separated policy
permissions and bounded audit. Its representative matrix is synthetic test
policy only. B-03, Assignment, Role, Credential, HTTP, projection, release and
consumer work remain unauthorized. One local completion commit; no push.

B-02 local engineering gates passed against real PostgreSQL 18.6: migration
23→24, four versioned categories and nine representative Types, immutable
classification, symmetric immutable rule versions, record-time history, all
three decisions plus missing-rule fail-closed, half-open/open periods,
create/revision evaluation, exact one-of-two forbidden concurrency, bounded
audit, policy-owner separation and actual restart recovery. Pre-B-02 as-of reads
do not receive later backfill classification. B-01, A-01/A-02, Department,
consumer, OpenAPI/client/canonical freeze, contract lint, typecheck, build and
repository/database-authority regressions passed. Completion becomes effective
with fresh final-candidate Standards/Spec approval and the sole local commit.
PV-006-B remains IN_PROGRESS because B-03 is NOT_STARTED.

PV-006-B-03 is authorized by the user Engagement Lifecycle / Business-State
Semantics task at B-02 authority
`c887b1d27b909c2e4a80d6349edc10843c65efbe`. It may add only derived
PLANNED/ACTIVE/SUSPENDED/ENDED semantics, append-only suspend/resume evidence,
immutable end-period versions, correction/re-engagement guards, independent
lifecycle authorization and bounded audit. It must not add governance workflow,
Assignment, Role, Credential, HTTP, projection, release or consumer behavior.

B-03 local engineering gates passed against real PostgreSQL 18.6: migrations
24→25→26→27→28→29→30, append-only lifecycle constraints, rejected-request replay
and database-serialized cross-table request authority, state derivation,
idempotency,
stale/concurrent suspend protection, suspend/end and resume/end serialization,
late-fact and corrected-end bitemporal history, multiple independent Engagement
states, separate Person/governance state, overlap preservation and actual restart
recovery. B-01/B-02, A-01/A-02, Department, Consumer, SDK, Replay, OpenAPI/client,
canonical artifacts, contract lint, typecheck, build and repository/database
authority regressions passed. Completion becomes effective with fresh final-
candidate Standards/Spec approval and the sole local commit. PV-006-B is then
COMPLETE; PV-006 remains IN_PROGRESS and PV-006-C–G remain NOT_STARTED.
