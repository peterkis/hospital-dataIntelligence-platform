# PV-006-A-02A — Person Identifier Registry

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Authority: user PV-006-A-02A task; CONTEXT.md; ADR-0044, 0049, 0050, 0071,
0073, 0074, 0083, 0084 and the Person mixed-sovereignty direction.

Register confirmed namespace/value relationships against existing Person subjects.
Keep personId canonical. Enforce full-history exact uniqueness in the governance
scope, immutable relationships/versions, business and record-time reads, retraction,
request idempotency, independent identifier permissions and atomic audit.
No raw value or value hash in audit, logs, errors or validation output.
All data is SYNTHETIC / NON_PRODUCTION, Asia/Shanghai; no real PII or production
sensitive-identifier storage claim.

Authorized tests: public internal application/contract plus native PostgreSQL
constraints, transaction faults, concurrent registration/versioning and actual
database/application restart. Existing Person/Department/consumer regressions,
frozen OpenAPI/client/canonical artifacts, complete check and independent
Standards/Spec review must pass before one local completion commit.

Excluded: source mapping, identity resolution/merge, Person auto creation,
Engagement, Assignment, roles, credentials, IAM/patient binding, projection,
release, consumer, HTTP and UI. A-02B and later tasks remain NOT_STARTED.

## Comments

Opening branch and local/remote SHA match 0333d827373e8f97faaa8737145c54acc372f9c1;
worktree clean. Upstream origin/prototype/phase-03-person-master at the same SHA,
behind/ahead 0/0; origin/main comparison 0/61 is observation only. Migrations
0001–0020 exist; 0021 absent. No forbidden Git operation performed.

Local engineering gates passed on PostgreSQL 18.6: migration 20→21, 54 Identifier
contract tests, live constraints/application/concurrency/audit rollback and actual
DB restart recovery, A-01 regression, full API 461/461, inherited Department and
consumer gates, typecheck/build/lint/full check and frozen contracts. No real data
or formal acceptance. Resource closure observed zero task children, listeners,
other application DB sessions and orphan identifiers; task DB and keepalive stopped.
Initial independent Standards and Spec reviews: zero blockers. One nonblocking
scope-gate duplication judgment is retained to avoid refactoring frozen A-01.
Fresh final-candidate approval remains mandatory before creating the sole commit.
