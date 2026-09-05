# PV-006-B-02 — Person Engagement Classification and Overlap

Task: PV-006-B-02. Status: local engineering validation complete; DONE becomes
effective with the sole completion commit after fresh final-candidate Standards
and Spec approval. Classification: **SYNTHETIC / NON_PRODUCTION**. Policy boundary:
**TEST POLICY ONLY - NOT HOSPITAL HR POLICY**. Time zone: **Asia/Shanghai**.

This slice proves that an Engagement freezes one governed type-definition
version and that overlapping business periods for the same Person are decided by
one explicit, versioned rule pair. It does not establish production policy,
formal Person POC acceptance or B-03 lifecycle semantics.

## Authority and boundary

ADR-0045 fixes four top-level categories, versioned secondary types, independent
Engagement IDs and `ALLOW / FORBID / REVIEW_REQUIRED` overlap decisions. ADR-0049
keeps policy ownership separate from ordinary scoped writers. B-01 remains the
authority for stable relation identity, immutable period versions, record time,
idempotency and revision concurrency.

Repository inspection found no reusable generic code-system/value-set module.
Existing versioning infrastructure is owned by its respective domain rather than
a general reference-data service. B-02 therefore adds the minimum versioned Type
definition inside the existing `person-master` deep module. It does not create a
second platform-wide code-system framework; a later authorized reference-data
slice may adapt this boundary without rewriting frozen classifications.

Explicit exclusions remain:

- no `PLANNED / ACTIVE / SUSPENDED / ENDED`, `isActive`, `isCurrent` or employment status;
- no suspend/resume/end commands;
- no Department, campus, job, Assignment, Role or Credential fields;
- no Person wide-table field, HTTP API, projection, release or consumer change;
- no real HR/contract values and no claim that the synthetic matrix is hospital policy.

## Type model and frozen classification

The native `0024_person_engagement_classification_overlap.sql` migration adds:

| Relation | Responsibility |
|---|---|
| `engagement_type` | Stable governance-scoped `type_code` identity |
| `engagement_type_version` | Immutable category/display/business-valid/recorded definition versions |
| `engagement_classification` | Immutable 1:1 Engagement-to-exact-Type-version freeze |

The four closed category codes are:

```text
LABOR_OR_HR
DISPATCH_OR_SERVICE
EXTERNAL_PROFESSIONAL
TRAINING_OR_LEARNING
```

The representative type fixture contains exactly the confirmed POC set needed by
this slice: `PERMANENT_EMPLOYEE`, `CONTRACT_EMPLOYEE`,
`REEMPLOYED_PERSONNEL`, `DISPATCHED_PERSONNEL`, `EXTERNAL_EXPERT`,
`CONSULTATION_EXPERT`, `VISITING_TRAINEE`, `RESIDENT_TRAINEE` and `INTERN`.
Display names are versioned attributes, never logical keys.

Create resolves a Type version that was record-visible at the database mutation
time and covers the complete proposed business period. Stable Engagement,
classification, V1 and audit share one transaction. A deferred PostgreSQL
constraint rejects every newly inserted Engagement lacking classification.
Classification rows reject UPDATE, DELETE and TRUNCATE, and no revision command
accepts a type field. A substantive legal/administrative type change therefore
requires a new Engagement ID.

The pre-B-02 database contained 18 synthetic B-01 relations without type facts.
Migration 0024 preserves both B-01 tables at row level and adds an external
classification for each. Those test relations are explicitly backfilled to the
representative `CONTRACT_EMPLOYEE` V1 definition. This is synthetic migration
provenance, not an inference about people or hospital policy.

The backfill does not rewrite record time. Current reads expose the frozen type;
an as-of read before the classification and Type version were recorded returns
the historical B-01 period assertion with nullable classification fields. It
never injects later classification knowledge into an earlier `recordAsOf` view.

## Versioned overlap matrix

`engagement_overlap_rule` stores one stable canonical pair and
`engagement_overlap_rule_version` stores immutable decision, business validity,
record time and direct supersession. Pair identity is canonicalized as lexical
`min(typeA,typeB), max(typeA,typeB)` in both the application and PostgreSQL.
The database rejects reverse-order rows, so `A/B` and `B/A` cannot disagree.
Equality is allowed, which supports explicit same-type rules.

The fixture is deliberately small:

| Canonical pair | Decision | Meaning |
|---|---|---|
| `CONTRACT_EMPLOYEE / CONTRACT_EMPLOYEE` | `ALLOW` | proves explicit same-type allow |
| `CONTRACT_EMPLOYEE / PERMANENT_EMPLOYEE` | `FORBID` | proves hard rejection |
| `CONSULTATION_EXPERT / CONTRACT_EMPLOYEE` | `REVIEW_REQUIRED` | proves review fail-closed |
| `INTERN / REEMPLOYED_PERSONNEL` | no row | proves missing-rule fail-closed |

`EXTERNAL_EXPERT / VISITING_TRAINEE` additionally has record-time V1 `ALLOW`
and V2 `FORBID` to prove historical `recordAsOf` reconstruction. These decisions
are test vectors only and require an HR/management Owner before any production use.

## Evaluation semantics

The latest known period version of every other Engagement for the same Person is
compared with the proposed `[businessValidFrom,businessValidTo)` interval using
PostgreSQL `tsrange &&`. A null end is positive infinity; touching boundaries do
not overlap. Different Persons are never candidates.

For each non-empty intersection, the evaluator uses the current database record
time and selects the highest record-visible rule version whose business validity
covers the complete intersection:

```text
ALLOW            -> continue mutation
FORBID           -> ENGAGEMENT_OVERLAP_FORBIDDEN; no mutation
REVIEW_REQUIRED  -> ENGAGEMENT_OVERLAP_REVIEW_REQUIRED; no mutation
missing rule     -> ENGAGEMENT_OVERLAP_RULE_MISSING; no mutation
```

B-02 intentionally has no review workflow, so `REVIEW_REQUIRED` cannot be used
as an implicit allow. Create and period revision execute the same evaluator. A
rejected period correction leaves the prior Engagement version unchanged.

## Concurrency and history

Every overlap-sensitive mutation takes a transaction-scoped advisory lock keyed
by governance object plus Person ID. Concurrent creates for the same Person
therefore serialize across distinct Engagement IDs; after the first commits, the
second evaluates the new relation and cannot produce write skew. Separate Persons
use different keys. Existing per-Engagement row locking continues to protect
revision sequencing and stale expected versions.

Policy append transactions additionally take an exclusive governance-scope
advisory lock. Engagement evaluation takes its shared counterpart and freezes one
`evaluationRecordedAt`, so every Type/rule lookup and audit record in the mutation
uses the same policy-visible record-time boundary.

Type and rule stable rows, version rows and classification rows all reject normal
UPDATE, DELETE and TRUNCATE. Version triggers lock the stable row, require direct
supersession and strictly increasing database record time. Historical Engagements
continue to expose the exact frozen Type version even after later Type display or
category definitions exist.

## Authorization and audit

Operational Engagement read/write permissions remain independent. Policy access
uses four additional permissions:

```text
PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ
PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE
PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ
PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE
```

The synthetic policy owner has these permissions but not Engagement write. The
synthetic Engagement writer has operational permissions but not policy write.
Operational evaluation may read the governing definitions internally; that does
not grant the actor a policy-management capability.

Audit records Type/rule version creation, classification freeze, successful
evaluation and fail-closed rejection. Payloads contain opaque Engagement/Person
IDs, type codes, rule decision/version and bounded result codes. They exclude
relation-basis declarations, contract numbers, employee numbers and external
basis references.

## Validation contract

The B-02 PostgreSQL/application probes cover all four categories, nine types,
Type V1/V2, rule V1/V2 record-time reads, pair symmetry, three decisions, missing
rule, same-type, half-open/open-ended periods, different Persons, create and
revision rejection, type freeze, owner separation, bounded audit and two
concurrent forbidden creates with exactly one success. Restart mode must recover
the same Type/rule/classification facts and reproduce their decisions through a
new pool.

No ADR is added. Canonical pair storage and review-without-workflow fail-closed
are bounded realizations of ADR-0045's accepted versioned matrix and the
repository's existing fail-closed governance posture, not a new domain principle.

## Local engineering validation

Real PostgreSQL 18.6 applied migration 0024 after the native migration count was
confirmed as 23. Generated Kysely authority was regenerated from 79 live tables.
The five B-02 relations expose 106 PostgreSQL constraints, 19 non-internal
triggers and 21 indexes in the final probe. Forbidden timezone types are zero.

The synthetic live policy contains nine stable Type definitions, ten Type
versions, four stable rule pairs and five rule versions. The B-02 acceptance
matrix is:

```text
engagementFourCategoriesAvailable = true
engagementSubtypeDefinitionsVersioned = true
engagementClassificationFrozen = true
engagementTypeMutationOnSameIdBlocked = true
overlapRulesVersioned = true
overlapPairSymmetric = true
overlapAllowWorks = true
overlapForbidBlocks = true
overlapReviewRequiredFailsClosed = true
overlapMissingRuleFailsClosed = true
overlapBusinessTimeAware = true
overlapConcurrencySafe = true
differentPersonsIndependent = true
syntheticPolicyOnly = true
personCoreUnchanged = true
engagementCoreHistoryPreserved = true
businessLifecycleAbsent = true
assignmentAbsent = true
openApiUnchanged = true
generatedClientUnchanged = true
departmentFrozen = true
forbiddenTimezoneTypes = 0
```

An actual PostgreSQL stop produced `inactive` with no 55434 listener. After
restart, `pg_postmaster_start_time()` changed and a new pool recovered the exact
classified Engagement, Type version and rule version, reproduced `FORBID`, and
left all six B-02 business-object counts unchanged.

Final functional/regression gates before candidate freeze:

- B-02 constraint/policy/application probes passed, including one success and
  one rejection for concurrent forbidden creates;
- B-01 constraint/application, A-01, A-02A and A-02B live probes passed;
- Governance API passed 491/491 across 33 files with the formal container suite
  explicitly excluded; Sim Consumer passed 20/20; Release SDK passed 72/72;
  consumer replay passed 4/4;
- Department constraint/repository/projection/application and all 15 HTTP paths
  passed; Consumer Metrics/restart passed;
- Schema Freeze passed 20/20 and all seven canonical artifacts were byte-exact;
  OpenAPI remained SHA-256
  `f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`;
- contract lint, full workspace typecheck, build and repository `check` passed.

Failures were not rewritten as passes. The first DB check recorded
`ECONNREFUSED` before the authorized WSL service was restored. The first 0024
attempt transactionally rolled back an incomplete supersession FK and passed
after governance scope was added. The first npm-filtered API invocation did not
forward Vitest flags, so it wrongly ran the unavailable formal container test and
parallel consumer processes; the correct direct, serial invocation passed
491/491. A parallel Redocly invocation validated the schema but then hit a
Windows libuv assertion; its independent rerun exited zero. Department HTTP
preparation exposed a verifier that counted every retained DRAFT hierarchy
version; it was narrowed to the three existing fixed fixture IDs and then all 15
paths passed without a Department behavior or contract change. Initial review
blockers (policy DB scope and pre-backfill record-time leakage) were fixed and
their old verdicts invalidated before the required fresh final review.

## B-03 stop line

Successful B-02 completion leaves `PV-006-B` in progress and B-03 not started.
No current business state can be inferred from an open-ended period or an
`ALLOW` decision. B-03 requires separate authority.
