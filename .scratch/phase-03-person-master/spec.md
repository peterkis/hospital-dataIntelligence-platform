# PV-006 — Person Master

Status: ready-for-agent
Phase: IN_PROGRESS

Authority: CONTEXT.md, ADR-0024, 0044–0050, 0019, 0071, 0073–0074,
0083–0084 and `docs/design/person-department-mixed-sovereignty-poc-direction.md`.
Execution authority: user PV-006-A-01 and resume PV-006-A-01-R1.

A-02A is authorized by the user PV-006-A-02A task. PV-005 remains ENGINEERING_COMPLETE; formal acceptance
and production status are unchanged. All fixtures are SYNTHETIC, NON_PRODUCTION,
and all application date-times use Asia/Shanghai local strings.

| Task | Scope | State |
|---|---|---|
| PV-006-A-01 | Person Stable Identity & Subject Core | DONE on the sole validated completion commit |
| PV-006-A-02A | Person Identifier Registry | DONE on the sole validated completion commit |
| PV-006-A-02B | Person Source Record Mapping | DONE on the sole validated completion commit |
| PV-006-B | Engagement | NOT_STARTED |
| PV-006-C | Assignment | NOT_STARTED |
| PV-006-D | Assignment Role | NOT_STARTED |
| PV-006-E | Credential | NOT_STARTED |
| PV-006-F | Projection / Release / Consumer | NOT_STARTED |
| PV-006-G | Full synthetic acceptance | NOT_STARTED |

Person is a hospital-wide, permanent natural-person identity. Engagement,
placement, roles, credentials, identifiers, accounts and patient identities are
separate authorities. Matching names or dates never authorize a merge.

## Comments

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
