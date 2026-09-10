# PV-006-B-02 — Engagement Type / Classification & Overlap Rules

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Authority: user PV-006-B-02 task; CONTEXT.md; ADR-0045 and ADR-0049;
`docs/design/person-engagement-core.md`;
`docs/design/person-department-mixed-sovereignty-poc-direction.md`; and the
phase-03 Person Master spec.

Start authority:

- Branch: `prototype/phase-03-person-master`
- `START_HEAD`: `221dfa6a0d18cf4fb89fed3c1082ed8896022913`
- `AUTHORITY_HEAD`: `221dfa6a0d18cf4fb89fed3c1082ed8896022913`
- B-01 state: DONE on the sole validated completion commit
- Remote at start: `1b911a03b27e2fd391d70b1b123d47b455f4cee7`
- `REMOTE_CONTAINS_START_HEAD`: NO; explicitly permitted local B-01 authority

## Scope

Add versioned Engagement Type definitions, immutable per-Engagement type-version
classification, versioned canonical symmetric overlap rules, and fail-closed
overlap evaluation for create and period revision. All fixtures and policy
decisions are `SYNTHETIC / NON_PRODUCTION` and `TEST POLICY ONLY - NOT HOSPITAL
HR POLICY`.

The slice must preserve the B-01 stable relation and immutable version history.
It must not add business lifecycle, Assignment, AssignmentRole, Credential,
Person HTTP/projection/release/consumer behavior, real HR policy or real data.

## Completion gate

Real PostgreSQL migration, rule history, classification freeze, business-time
evaluation, missing-rule/FORBID/REVIEW_REQUIRED rejection, person-scoped
concurrency, restart persistence, B-01/A-stage/Department/consumer/freeze
regressions, full checks and fresh Standards/Spec reviews must all pass before
the sole local completion commit. No push or prohibited Git operation is allowed.

## Comments

Migration authority before this slice was 23 and next-free was 0024. The first
live database check returned `ECONNREFUSED`; the authorized Anolis PostgreSQL 18
service was restored with a task-tracked WSL keepalive and the unchanged hard
gate then passed. The first transactional 0024 application safely rolled back
because the type supersession FK omitted governance scope; the migration was
corrected to use the existing three-column unique authority and then applied.

The first staged Standards review found two blockers: missing database scope
guards on policy tables and retroactive classification on pre-backfill as-of
reads. Both were corrected and verified through exact negative/live history
probes. The first Spec review found the same scope blocker. Those verdicts are
superseded; the final changed tree requires fresh Standards and Spec approval.
