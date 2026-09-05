# PV-006-B-04 — Engagement temporal authority reconciliation

Status: local engineering validation complete; DONE becomes effective only with
the sole B-04 completion commit after final-tree Standards/Spec approval.
Next-phase execution authorization: NO.
Boundary: SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY / Asia/Shanghai.

## Authority and observed baseline

Authority is the user prompt and acceptance matrix in
`D:/Agent-Prompts/PV-006-B-04/`, ADR-0019/0045/0049/0071/0073/0074/0083/0084/0115,
and the B-01/B-02/B-03 issue/design history. ADR-0116 records the newly authorized
distinction. The original domain HEAD is `c1abe02edab1a7ebfc64c207a96e3bfc5526620e`.
After the separate user-authorized startup-tooling commit, the execution baseline
is `fa61dc79f0f4298629e4d5c6340f99455c99be98`. The original runtime and migrations
were byte-identical when the baseline application probe ran. The live remote
remained the original domain HEAD; the tooling commit was local only.

`prototype:person:engagement-temporal:baseline` is intentionally pinned to that
unmodified runtime. Its actual run `d2afe1c0-9e9d-4ca6-bb1b-6c9a9a6e3eda` returned
exit 1: RP-01/IN-01 expected a rejection, while real create committed despite
R2/FORBID at the August point. R2 was recorded by PostgreSQL at
`2026-09-05T15:13:11.587239`. Existing global synthetic rule pairs were not modified;
every new pair has its own run prefix. The baseline also confirmed historical
V1 versus lifecycle V2 after END, delayed start and shortened end, with old-R
V1/ACTIVE and unchanged original V1 columns. Those historical observations are
not themselves defects and do not count as new-reader acceptance.

## Capability and permission contracts

| Capability | Authority | Permission |
|---|---|---|
| `findEngagementPeriodAssertionAsOf` | Highest B-applicable, R-visible assertion; tagged HISTORICAL_ASSERTION | Engagement READ |
| Legacy `findEngagementAsOf` | Same historical result and old return shape; deprecated wrapper | Engagement READ |
| `getEngagementEffectiveAsOf` | Highest R-visible complete Engagement version, then B/state | Engagement READ **and** LIFECYCLE_READ |
| `getEngagementBusinessStateAsOf` | Same private resolver, existing minimal result | LIFECYCLE_READ only |
| Rule point query | Highest R-visible version covering B | Existing policy read |
| Rule interval evaluation | Same point semantics on every boundary segment | Internal to authorized mutation |

The new composition reader returns only the read-only `EngagementEffectiveReader`
port. It exposes no transaction, table, write operation, HTTP endpoint or Assignment
decision. Type checks reject historical-to-effective assignment and reader mutation.
The focused architecture check allows historical names only in the core contract,
application wrapper and repository; mutation bodies cannot invoke either historical
name or the private historical helper. Tests and evidence probes use historical
interfaces explicitly. Person/Identifier/Source Mapping algorithms are untouched.

Both permissions are checked before effective object facts are read. Scope and
human/active actor checks remain those of the existing composition; no permission
implies another. Unknown-as-of raises ENGAGEMENT_NOT_KNOWN_AS_OF, with no fifth
business state. Legacy lifecycle callers receive their former minimal shape.

## Snapshot and time semantics

The private temporal resolver reads the relation, highest R-visible complete
version, last R-visible/B-applicable event, maximum R-visible event sequence and
R-visible frozen classification in **one SQL statement** using lateral reads.
It acquires no write locks and changes no platform isolation setting. The winner
version is selected before testing B, so it cannot fall back to a superseded
open period. Lifecycle mutation/state reads and the effective reader use that
same resolver. Type versions remain the exact immutable classification references;
classifiedAt and Type recordedFrom must both be at or before R.

PLANNED/ENDED have isWithinBusinessPeriod=false; ACTIVE/SUSPENDED have true.
Half-open endpoints and six fractional digits are preserved. No clinical,
assignment, approval or licensing conclusion is returned. Query B/R are explicit
and validated; database time is never substituted for the caller's R.

Mutation captures evaluationRecordedAt once after Person and shared policy locks.
Other relationships are selected by highest version with recordedFrom <= that R,
and classification must be visible at R. PostgreSQL range intersection and
normalized six-digit local timestamp ordering preserve microseconds and null tails.
This claims consistency over a committed visible snapshot, not equality between
recorded timestamps and transaction commit times or a general commit-order solution.

## Rule segments, limits and audit

Candidate rules belong to one canonical pair, are visible at R and intersect I.
The algorithm clips every candidate start/end to I, sorts and deduplicates exact
boundaries, and emits nonempty half-open segments. A null end remains unbounded.
Each segment chooses the largest version number covering its start. Missing
coverage is explicit MISSING; a later ALLOW may replace an older FORBID locally.
All segments must ALLOW. Failure priority is FORBID > MISSING > REVIEW_REQUIRED,
including across different other-Engagement intersections.

Limits are 32 rules per intersection, 64 segments per intersection, 32 overlapping
Engagements and 65,536 bytes for serialized evaluation evidence plus 1,024 bytes
per audit event overhead. SQL retrieves limit+1 solely as an overflow sentinel;
overflow is rejected before any business insertion, never truncated into ALLOW.
Aggregate audit overflow similarly yields ENGAGEMENT_TEMPORAL_EVALUATION_LIMIT_EXCEEDED.

Audit contains the fixed evaluation R, pair, actual intersection, other authority
version/number/recordedFrom, each segment and exact winning rule version/decision.
Multi-segment cases retain all winners, with no misleading single winning version.
Rejections retain bounded complete evaluations; limit rejections retain a bounded
limit reason. Successful business writes and audits remain atomic. Existing rejected
result transaction behavior is retained, without partial stable/classification/V1.
No raw basis, employee/contract/source/identifier value is logged.

Existing create request lock, same-Person advisory serialization, stable-row locks
and policy shared/exclusive protocol remain in their former order. Successful
idempotent requests are resolved before policy re-evaluation and still reauthorize.
The 0027-0030 cross-table request and V1 guards are not rewritten.

## Type-version selection review (RP-19)

The existing Type resolver intentionally selects **one** record-visible definition
that covers the complete proposed period, then freezes that exact version. Type
definitions have category/display/period, not ALLOW/FORBID decisions. The new rule
segmentation does not split a relation into multiple classifications or reinterpret
the approved full-period Type choice as a sequence of latest local dictionaries.
No additional Type-model change is needed for the reproduced rule defect. Existing
Type coverage and frozen-reference regressions remain required.

## Environment and migration evidence

Initial application-role CREATE DATABASE failed with 42501. This was a real
permission blocker, preserved in `.runtime/pv006-b04/20260905T144249/`; successful
service startup alone did not remove it. The user subsequently authorized WSL
postgres OS-user peer authentication. Administration now only creates/removes the
receipt-owned `pv006_b04_<random>` database, owned by hdi_prototype. The application
role retains CREATEDB=false; no password is retrieved or role privilege widened.

Fresh run `47b229bb-e701-42e5-b028-99116952d620` proved an empty template0 target,
all 0001-0030 native migrations under the application role (exit 0), 30 migration
records and 81 tables. Ownership identity and zero remaining sessions were checked
before removing that temporary DB. No historical migration was changed.
Seed, full schema/type equivalence and focused fresh application are separate gates.

Fresh schema comparison includes migration IDs, tables, columns/defaults/types,
constraints, triggers, functions, indexes, enums/domains and extensions. Database
identity/OIDs and migration applied timestamps are excluded; semantic definitions
are not. Codegen runs against the fresh database into the ignored run directory,
then compares with tracked generated types. Child processes inherit explicit fresh
DATABASE_URL, so local env loading cannot redirect them to the retained evidence DB.

## Validation and remaining gates

The unit/property suite passed 5 tests, including an independent integer oracle
over 1,500 deterministic inputs at three R values, one-microsecond FORBID, null
tails, differing fractional precision, error priority and compile/architecture guards.
Application run `d38dd765-1639-4d89-be49-e2f5d317bd06` passed the create/revise
rule vectors, effective/state/history matrix, existing backfill visibility,
permission combinations, success retry/conflict, same-Person concurrent mutation,
controlled policy writer/reader queues, audit fault rollback and candidate/segment/
audit-budget overflow assertions. Recovery run `733089fb-3f41-4daa-952f-78cf5b1d4ae9`
observed changed postmaster start time and restored old/new-R contexts, segments,
point winners, original version rows and original audit fingerprints.

Retained failures: an initial revision fixture created a forbidden period gap and
was corrected to extend from its existing start; a 12-connection test pool saturated
because authorization decisions use a separate connection, so the interrupted
attempt was retained and the test pool/concurrency were bounded with spare capacity
and a connection timeout. No production authorization or guard was weakened.
A later focused compile caught the audit column name and passed after using the
existing stable_entity_id column. No failed attempt is counted as PASS.

The completed engineering gates are recorded below. Final-tree Standards/Spec
approval and the sole B-04 local completion commit remain the publication of this
local result, not permission to push or begin another phase. B-01/B-02/B-03 history remains
DONE; C-G remain NOT_STARTED. Formal ABG, AR-07, real integrations, HTTP/UI and
production acceptance are excluded. Final commit provenance belongs in ignored
post-commit evidence, not a self-referential second documentation commit.

## Final engineering evidence

Evidence root is `.runtime/pv006-b04/`. The final ledger, matrix, frozen assets,
review verdicts and post-commit provenance are under `final-e49d46d3/`.
The ledger records actual commands, cwd, exits and preserved failed attempts.

| Gate | Actual result | Run / evidence |
|---|---|---|
| Final retained-DB focused application | PASS, including period/event/sequence concurrent observations | `e49d46d3-43a8-4ff2-b17d-00bfe1c96381/application.json` |
| Actual restart | PASS; `2026-09-05 16:04:37.432527` → `2026-09-05 16:08:30.224826` | `5f08e9d6-0498-4009-b1e2-d6b0cdecc216/application.json` |
| Negative recovery | 5 expected exit-1 rejections; no new Persons/relations/versions/types/rules | `61fd3667-690f-44b1-be50-3652b0e3d7af/negative-recovery.json` |
| Fresh migration/seed/application | PASS; 0001-0030, 30 migrations, 81 tables, app role only | `d2acd43e-7881-4ce2-bd6c-bc723c232791/fresh-install.json` |
| Fresh schema and generated types | PASS; original and normalized manifests retained; generated output in ignored directory | same fresh run |
| A-stage and B-01/02/03 DB regressions | all PASS | `e8dc00fa-4c41-4a2e-931c-fecae6fb0f84/01.log` through `06.log` |
| Governance API | 501/501, 35 files, npm-aware serial invocation | same run `07.log` |
| Sim / SDK / Replay | 20/20, 72/72, 4/4 | same run `08.log` through `10.log` |
| Department / HTTP / Consumer Metrics | all PASS | same run `11.log` through `13.log` |
| Contract lint / typecheck / build / check | all exit 0, database authority included | same run `14.log` through `17.log` |
| Canonical artifacts | 7/7 exact, freeze tests 20/20 | same run `17.log`, `18.log` |
| SQL normalization tests | 1/1; altered strings/operators/quoted identifiers remain unequal | same run `19.log` |
| Pre-existing immutable rows | 15 personnel tables unchanged at cutoff `2026-09-05T15:55:49.587092` | same run `immutable-before.json` / `immutable-after.json` |

API invocation was `node ../../node_modules/vitest/vitest.mjs run
--no-file-parallelism --maxWorkers=1 --exclude
src/composition/phase-01-vertical-slice.integration.test.ts`, cwd
`apps/governance-api`, inheriting the managed npm environment. This is the sole
excluded formal/container suite; no broader exclusion was used. The last focused
unit/property/architecture suite also passed 5/5 and API typecheck exited 0.

Fresh comparison initially detected only formatting/case differences in four
existing probe-restored functions: Department protect_immutable_version,
protect_stable_identity, touch_updated_at and Person guard_engagement_classification.
Raw manifests remain preserved under `aae0f6ff-d54c-45f2-b67d-fa08d6fb6db7/`.
The narrow normalizer applies only to those exact no-argument function identities;
it ignores unquoted case/space, preserves string and quoted-identifier contents,
numbers and operators, and rejects unsupported escape/comment/dollar syntax.
All other definitions are compared exactly. No function, constraint or migration
was excluded or rewritten to obtain equivalence.

The first B-01 regression hit the new evaluation limit because historical probes
had accumulated overlapping relations on the same six Persons; the next attempt
found its old exact public-method list. The probe now creates six isolated Persons
before capturing protected counts and includes the explicitly authorized historical
assertion method. All original business, immutable, authorization, idempotency and
fault assertions remain. Both failed runs are retained (`c2974ff4...`, `279997d8...`)
and the independent full rerun passed.

OpenAPI SHA-256 before/after is
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`;
B-04 path/operation delta is 0, generated client unchanged, 15 Department/hierarchy
paths unchanged. The existing consumer-audit check's historical pathsAdded=2
compares against its older pin; it is not a B-04 delta. Department Master digest
remains `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`
and Hierarchy digest remains
`72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.
Migration delta is 0 and forbidden timezone types remain 0.

Each managed session closed task pools and restored its owned service/distribution;
successful final cleanup is based on observed inactive/unreachable state even when
WSL teardown makes the stop command return 1. Temporary databases were removed
only after receipt/identity/session verification. The retained hdi_prototype DB and
all synthetic evidence cohorts remain. No unrelated process/service was stopped.

The four startup-tool files were independently committed before B-04 as explicitly
requested by the user. B-04 creates only one additional local completion commit,
whose parent must be fa61dc7; from original c1abe02 the two commits are that startup
commit plus B-04. Remote tip observations and push-command history remain separate.
