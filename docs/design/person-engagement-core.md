# PV-006-B-01 — Person Engagement Stable Relation Core

Task: PV-006-B-01. Status: local engineering validation complete; DONE becomes
effective with the sole completion commit after fresh final-candidate Standards
and Spec approval.
Classification: **SYNTHETIC / NON_PRODUCTION**. Time zone: **Asia/Shanghai**.
PV-005 remains ENGINEERING_COMPLETE and PV-006 remains IN_PROGRESS. This slice
does not establish formal acceptance, production readiness, full Person Master
completion or ADR-0050 acceptance.

## Authority and relation boundary

Authority is AGENTS.md, CONTEXT.md, the local issue/spec conventions, the Person
and Department mixed-sovereignty direction, ADR-0019, 0044, 0045, 0049, 0050,
0071, 0073, 0074, 0083 and 0084, plus the accepted A-stage Person designs.

An Engagement is a formal relation between one existing Person and the hospital.
It is not a field on `person_subject`, and it is not a current employment view.
Each separately confirmed legal or administrative relation receives its own
opaque stable identity. One Person may therefore own zero, one or many Engagement
IDs. B-01 deliberately allows those relations to coexist; this proves structural
independence and does not assert that their business periods are allowed to
overlap. B-02 owns classification and overlap policy.

The create interface requires the declaration
`CONFIRMED_DISTINCT_RELATION_BASIS`. This is a caller precondition proving that
the command intentionally creates a separate relation. It is not a stored type,
status, contract number or basis reference. B-01 stores no contract document,
employee number, source key or other potentially sensitive external identifier.

| Concern | B-01 decision |
|---|---|
| Person identity | Existing opaque `personId`; never created, merged or changed by Engagement |
| Stable Engagement | New PostgreSQL `uuidv7()` `engagementId`; never reused or reassigned |
| Continuity/extension | Append a new version under the same `engagementId` |
| Later new relation | Explicit new create command and a new `engagementId`; no automatic `rehire()` |
| Type/classification | Absent; B-02 |
| Overlap rules | Absent; B-02 |
| Business lifecycle/state | Absent; B-03 |
| Assignment/Department/Role | Absent; PV-006-C/D |
| Credential | Absent; PV-006-E |
| HTTP/projection/release/consumer | Absent; PV-006-F |

## Deep module and interface

`EngagementCoreApplication` is an independent deep module interface inside the
existing `person-master` schema owner. The interface exposes only:

```text
createEngagement
reviseEngagement
getEngagement
getEngagementVersion
listEngagementVersions
listPersonEngagements
findEngagementAsOf
```

There is no `updateEngagement`, `patchEngagement`, `upsertEngagement`, delete or
automatic rehire interface. Composition is the only location that binds the
transaction runner, authorization and audit adapters. Callers do not see Kysely,
`pg`, table details or transaction handles. Person Core remains a separate
interface and is not enlarged with Engagement methods.

## Stable relation and immutable versions

Native migration `0023_person_engagement_core.sql` owns the physical schema.

| Table | Responsibility |
|---|---|
| `person_master.engagement` | Stable `engagement_id`, permanent `person_id` ownership, governance scope and creation provenance |
| `person_master.engagement_version` | Immutable version number, direct supersession, bounded revision reason, half-open business period, record time and retry identity |

The stable table has a composite foreign key to
`person_subject(person_id, governance_object_id)`. The version table has a
composite foreign key to
`engagement(engagement_id, person_id, governance_object_id)`. Because stable rows
and all version rows reject UPDATE, DELETE and TRUNCATE, an Engagement cannot be
transferred to another Person through either row shape. UUIDv7 is generated only
by PostgreSQL; callers cannot provide either stable or version IDs.

Stable creation and V1 insertion share one transaction. A deferred constraint
trigger refuses to commit a stable row without V1. V1 must reuse the stable row's
creation request and actor, carry version number 1, and have no superseded version
or revision reason. Audit is appended in the same transaction; audit failure
rolls back both stable and version rows.

Later versions must directly supersede the current version and persist one of:

```text
FACT_CORRECTION
VALIDITY_CORRECTION
CONTINUATION_EXTENSION
```

The stable row is locked before the database calculates or accepts the next
version. A unique `(engagement_id, version_no)` constraint, a unique
`(engagement_id, request_id)` constraint and the trigger-owned sequence check
prevent duplicate V2 facts. `expectedCurrentVersionId` is mandatory at the
module interface; after locking, a stale writer fails with
`ENGAGEMENT_STALE_VERSION` and cannot silently create V3.

## Bitemporal semantics

B-04 clarification: this section describes historical period assertions only.
Effective relation validation uses the latest record-visible complete period,
as specified in `person-engagement-temporal-authority-reconciliation.md` and
ADR-0116. The legacy as-of result and historical validation remain preserved.

Every version uses a business interval `[businessValidFrom, businessValidTo)`.
A null end is an open-ended interval only; it does not mean ACTIVE. Empty or
inverted periods fail at both the interface and database constraint. Record time
is assigned by `platform.local_now()` as an Asia/Shanghai local timestamp without
time zone and must strictly increase per Engagement.

For business instant B and record instant R, `findEngagementAsOf` selects the
highest `version_no` satisfying:

```text
recorded_from <= R
business_valid_from <= B
business_valid_to is null OR business_valid_to > B
```

This reconstructs the latest applicable relation-period assertion known at R.
It does not derive current employment status or a lifecycle state.

## Idempotency and concurrency

Create requests serialize on governance object plus request ID. Replaying the
same request, actor and complete payload returns the same logical V1. Reusing the
request ID with a different Person, declaration or period fails with
`ENGAGEMENT_OPERATION_CONFLICT`.

Revision retries serialize on the stable Engagement row. The same request and
payload returns the existing version; a different payload conflicts. Two writers
based on the same current version yield one successor and one stale result. Two
separate create commands for the same Person may both succeed because B-01 has no
classification or overlap authority.

## Authorization, human actor and audit

The existing `PERSON_MASTER` governance object is reused. No
`PERSON_ENGAGEMENT` governance object type is introduced. Two independent
permissions are added:

```text
PERSON_MASTER_ENGAGEMENT_READ
PERSON_MASTER_ENGAGEMENT_WRITE
```

Person Core, Identifier and Source Mapping permissions do not imply Engagement
access. Mutation requires an active human `PERSON` security principal. The actor
is creation/audit provenance only and is never automatically bound to the target
Person.

Audit reuses `audit.audit_event` and the existing hash chain. Successful create,
revision and reads append bounded events in the same transaction. Stale revision
and invalid scope/actor denials also retain bounded evidence. Payloads carry
opaque platform IDs and reason codes only; the relation-basis declaration,
contract/reference values and source identifiers are absent from audit and
consumer metrics.

## Database and validation contract

The database is the final authority for:

- stable and version UUIDv7 identities;
- existing Person and same-governance scope;
- one permanent Person per Engagement;
- first-version atomicity and zero orphan stable rows;
- per-Engagement monotonic version and record time;
- direct supersession and bounded reason codes;
- half-open business periods;
- stable/version UPDATE, DELETE and TRUNCATE rejection;
- `timestamp without time zone`/`tsrange` use and zero forbidden timezone types.

The live validation surface consists of a constraint probe and an application
probe over PostgreSQL 18. Application evidence covers nine synthetic Engagements
for six existing synthetic Persons, including two Persons with multiple
Engagements, one V1/V2/V3 history, another V1/V2 history, idempotent concurrent
create, stale concurrent revision, bitemporal reads, audit rollback and unchanged
Person/Identifier/Source Mapping counts. A separate recovery mode must read the
same facts after an actual PostgreSQL restart through a new pool.

Final local validation passed on PostgreSQL 18.6. Migration count advanced
22→23; codegen introspected 74 tables; the Engagement tables expose 41
constraints, eight non-internal triggers and eight indexes. Both constraint and
application probes passed, and a direct recovery invocation after an actual
PostgreSQL service restart recovered the stable rows, V1/V2/V3 histories and
three record-time as-of results. Forbidden timezone types and orphan Engagements
were zero. Each successful application cohort created nine stable synthetic
Engagements and twelve versions. Two cohorts are intentionally retained as
immutable development evidence, so the final live database contains 18
Engagements and 24 versions, alongside 51 synthetic Person subjects, 64
identifiers and 107 source mappings.

Regression results: A-01, A-02A and A-02B live validations passed; Governance API
passed 488/488 tests across 32 files with the formal container suite excluded;
Department constraint/repository/projection/application and 15-path HTTP flows
passed; Consumer Metrics/restart passed; Sim Consumer passed 20/20; Release SDK
passed 72/72; Replay passed 4/4; projection freeze passed 20/20; all seven
canonical artifacts were byte-exact. Contract lint, full typecheck, build and the
complete repository/database-authority check passed.

Retained diagnostics: the first database check observed `ECONNREFUSED` before the
WSL keepalive was corrected, then passed without weakening the gate. An initial
test filter was not forwarded by npm; the valid direct Vitest run first reported
487 pass and one harness-only failure because `npm_execpath` was absent. Supplying
the real npm CLI environment produced the final 488/488 pass. A-02B's regression
probe initially assumed the whole repository would permanently contain exactly
22 migrations; it was narrowed to assert that its own 0022 authority remains
present, then passed. The first `npm run check` reached its final database step
without `DATABASE_URL`; rerunning the same check with the ignored env file passed.
An npm recovery argument was also not forwarded, causing one additional synthetic
cohort; a second real restart and direct recovery invocation supplied the valid
persistence evidence. No neighboring business implementation was changed for
these execution issues.

## Frozen contracts and scope exclusions

The slice adds no HTTP route and requires zero OpenAPI/client path or operation
change. The required frozen values are:

| Asset | Required SHA-256/state |
|---|---|
| OpenAPI | `f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035` |
| Department Master V1 | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` |
| Department Hierarchy V1 | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` |
| Canonical Department artifacts | 7/7 exact bytes unchanged |
| Generated client | unchanged |
| Department Browser | 15 paths unchanged |

No Person projection schema, release, SDK support, replay behavior or metrics
behavior is added. B-02, B-03 and PV-006-C–G remain outside this module.

## Git provenance

Opening branch, local HEAD, upstream and live remote were all
`prototype/phase-03-person-master` at
`1b911a03b27e2fd391d70b1b123d47b455f4cee7`, with a clean worktree and 0/0
upstream divergence. No new branch is created. The sole completion commit, if all
gates pass, uses `feat(person): add engagement relation core`; no push is allowed.
Final local and remote facts are observed independently after the commit rather
than embedded as a self-referential hash in this tracked document.
