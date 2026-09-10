# PV-006-A-02A — Person Identifier Registry

Status: local engineering validation complete; DONE becomes effective with the
sole completion commit after fresh final-candidate Standards and Spec approval.
Classification: **SYNTHETIC / NON_PRODUCTION**.
Time zone: **Asia/Shanghai**. **NO REAL PII. NO PRODUCTION IDENTIFIER SECURITY CLAIM.**
PV-006 remains IN_PROGRESS; A-01 remains DONE and PV-005 ENGINEERING_COMPLETE.

## Authority and task scope

Execution authority is the user PV-006-A-02A task, continuing A-01 at
0333d827373e8f97faaa8737145c54acc372f9c1 on prototype/phase-03-person-master.
Domain authority: CONTEXT.md, the Person/Department mixed-sovereignty direction
and report analysis, person-stable-identity-core.md, ADR-0044–0047, 0049–0050,
0019, 0020, 0071, 0073, 0074, 0083, 0084 and new ADR-0113.
Earlier descriptions of source-derived identifiers are clarified by the explicit
namespace versus source-record distinction in ADR-0113 and this task.

Only an internal Identifier capability inside person-master is added. Person Core
continues to hold canonicalName and optional birthDate. No Source Record Mapping,
resolution, merge/split, survivorship, Engagement, Assignment, AssignmentRole,
Credential, IAM/patient binding, Person projection/release/consumer, HTTP or UI.
A-02B and all later Person tasks remain NOT_STARTED. Full ADR-0050 acceptance is
not claimed by this focused six-person registry validation.

## Person identity, namespace and value

personId remains the hospital-wide opaque, permanent identity. An identifier is
the pair (identifierSystem, identifierValue), referencing an already existing
Person in the same PERSON_MASTER governance object. Unknown persons fail closed;
no command creates or merges a Person, including during exact collisions.

identifierSystem is a canonical absolute URI/URN-like namespace, 1–512 ASCII
characters: a scheme and colon followed by a non-empty, non-whitespace printable
ASCII part. Both urn: and https: forms are accepted. International namespaces
must arrive in their canonical URI representation. This is a bounded namespace
syntax check, not a resolver, schema registry or Identifier Type dictionary.
The system never lowercases the scheme, host, path or namespace-specific portion.

identifierValue is 1–256 Unicode code points. Outer Unicode whitespace,
control characters (including NUL/C1) and lone surrogates are rejected.
Internal spaces, case, punctuation, leading zeroes and composed/decomposed Unicode
remain unchanged. The caller must supply its namespace's canonical value; no
global normalization, numeric conversion, guessing or fuzzy matching exists.
Registration requires CONFIRMED_PERSON_IDENTIFIER, which is a caller governance
declaration, not a candidate matching pool or proof about real-world identity.

A namespace identifies a governed personnel identification scheme. A database,
table, import channel or system row key does not establish that authority.
Source system/entity/table/record keys are absent from A-02A runtime models and
are reserved for A-02B Person Source Record Mapping.

## Data model, constraints and indexes

Migration 0021_person_identifier_registry.sql adds two tables; 0001–0020 remain
byte-identical. Applied migration count: **20 → 21**. PostgreSQL is the existing
**18.6** environment, without an engine upgrade or ORM change.

| Table | Responsibility and constraints |
|---|---|
| person_master.person_identifier | UUIDv7 relationship PK; existing person_id + governance_object_id composite FK; canonical system/value; creation request, actor and local time; full-history unique (governance_object_id, identifier_system, identifier_value); unique (governance_object_id, creation_request_id); composite reference key |
| person_master.person_identifier_version | UUIDv7 version PK; composite relationship/person/scope FK; independent version_no; ASSERTED or RETRACTED; business interval; recorded_from; actor/request and validity-only retry hash; unique relationship/version and relationship/request |

Both UUID identities use PostgreSQL uuidv7(), with the relationship and version
tables checking version 7. Exact key columns use deterministic C collation;
Unicode equivalence and case insensitivity cannot silently alter identity.
The ASCII namespace bound also keeps the composite unique index below PostgreSQL's
index tuple bound even with a 256-code-point multibyte value.
The person index supports listing relationships by governance object and Person.
Unique indexes serve exact lookup, request retry and ordered version history.
No fuzzy, name/DOB, partial-value, global value-only or one-per-namespace index exists.

Both tables reject UPDATE, DELETE and TRUNCATE through database triggers; those
mutation privileges are revoked from PUBLIC. Stable person/system/value cannot
be reassigned. A deferred constraint requires V1 before the relationship can
commit. The first version must be ASSERTED and match the creation request/actor.
The insert guard reuses A-01's active Person scope and active human actor rules.
Version insertion locks its relationship, requires the next version number and
strictly increasing finite record time. Invalid, empty and inverted intervals,
future record times, broken foreign keys and out-of-scope versions are rejected.
Controlled DBA/DDL operations remain outside this normal application contract.

Both tables are owned by person-master under db/table-ownership.json. Kysely
types are regenerated from the migrated live database: **70 tables**, not hand-edited.
All domain dates/times remain strings and timestamp/tsrange without time zone;
forbidden timezone type count is **0**.

## Application, authorization and transaction behavior

The independent PersonIdentifierApplication exposes registerPersonIdentifier,
createPersonIdentifierVersion, getPersonIdentifier, listPersonIdentifiers,
listPersonIdentifierVersions, findPersonIdentifierAsOf and findPersonByIdentifier.
The composition root binds existing RequestContext, TransactionRunner,
authorization and audit modules. There is no second top-level identifier module.
PersonCoreApplication and A-01 subject schema/behavior are unchanged.

PERSON_MASTER_IDENTIFIER_READ and PERSON_MASTER_IDENTIFIER_WRITE are independent
permissions on the existing PERSON_MASTER governance object. CORE_WRITE/READ do
not grant Identifier access, and Identifier access does not grant Core access.
Hospital-level object grants are required. Active human actors perform mutations;
service and inactive actors fail. createdBy identifies the governing actor and
never creates a subject-to-IAM relationship.

Scope/human denials use the existing audit module in a separate transaction so
their evidence survives rejected business work. Missing-grant denial uses the
existing independently persisted authorization_decision evidence. No owner table,
Person ACL or alternate permission system is introduced.

Registration serializes the object/request key and compares the stored stable
fields, actor and first version's validity operation identity on retry. The same
request and exact command returns the original V1; a changed command conflicts.
Different requests with the same Person/system/value return an explicit
PERSON_IDENTIFIER_ALREADY_REGISTERED error. Different Persons collide with
PERSON_IDENTIFIER_COLLISION. Neither branch silently becomes an idempotent retry.

The database unique constraint arbitrates concurrent independent registrations.
INSERT ON CONFLICT DO NOTHING permits reading the winning relationship and
appending bounded rejection evidence without an aborted transaction. The rejected
result commits only that evidence; the application then throws the bounded code.
Exactly one concurrent registration can create the relationship. Expiry and
retraction never release the unique binding, and no automatic reassignment exists.

Relationship, V1 and registration/version audit events share one transaction.
Faults after the stable insert/audit or after V1/audit roll back all of them;
later version/audit writes are likewise atomic. A version retry is scoped to the
relationship/request and actor under a row lock; concurrent next versions become
distinct monotonic versions. Retry hashes contain operation kind and assertion
validity only, never the identifier value, its hash or the full registration command.

## Versioning, retraction and bitemporal reads

V1 is ASSERTED. Corrections and ASSERTED/RETRACTED transitions append new versions.
The stable relationship stays unchanged. Correcting a value requires registering
a different relationship while retaining the old evidence; conflicting ownership
requires future explicit identity-resolution authority.

Business intervals are [businessValidFrom, businessValidTo); null end is unbounded.
At businessAt and recordAsOf, choose the highest versionNo whose business interval
contains businessAt and recordedFrom <= recordAsOf. Only then inspect assertion
status: RETRACTED means no effective binding. Filtering out RETRACTED before
selecting the version would incorrectly resurrect the earlier assertion.

As in A-01, corrections supersede only their declared business interval. Outside
that interval, prior assertions continue to apply. Merely shortening a newer
assertion interval does not erase the earlier assertion outside it; retract the
intended interval explicitly to stop its use. Record time comes from
platform.local_now() after the relationship lock, not the caller's event time.
Version numbers own ordering. Earlier recordAsOf values reproduce prior knowledge.

Exact lookup uses the full governance object, system and value plus both time
criteria, returning a Person/Identifier version reference or null. No name/DOB,
substring, case-insensitive, similarity, model or rule-score resolution is used.
An exact NOT_FOUND lookup still records bounded read evidence.

## Audit and sensitive data boundary

The existing append-only audit.audit_event and hash chain are reused. Events are
PERSON_IDENTIFIER_REGISTERED, PERSON_IDENTIFIER_VERSION_CREATED,
PERSON_IDENTIFIER_READ, PERSON_IDENTIFIER_LOOKUP,
PERSON_IDENTIFIER_COLLISION_REJECTED and PERSON_IDENTIFIER_ACCESS_DENIED.
Payloads contain only explicit relationship/Person references, counts, query
kinds, bounded states/results/reasons or permission-scope metadata.
afterHash is always null for Identifier events. Namespace and raw lookup criteria
are also omitted. No raw identifier, normalized value, value digest, full command
or database exception detail is copied to audit, metrics, logs or reports.

The application boundary maps unexpected database/other failures to
PERSON_IDENTIFIER_OPERATION_FAILED, without retaining cause, SQL parameters or
detail. Public errors otherwise use an exact allowlist of bounded codes.
Internal get/list can return values to authorized callers; these results are
sensitive data, not log/event payloads. Probe output uses IDs, counts and booleans.

**This prototype does not establish production-grade storage protection for real
sensitive identifiers.** Only synthetic personnel/legacy-personnel namespace data
is used. No real staff/national/passport/HR/HIS/EMR identifiers are introduced.
Encryption, tokenization, keyed lookup, KMS, masking and retention for real sensitive
identifiers require later production hardening. No ad hoc crypto or plain-hash
security claim is made.

## Synthetic fixtures and validation evidence

The application fixture reuses six existing A-01 synthetic Persons, registers
16 relationships per execution across two namespaces, and proves the Person rows
are unchanged. It includes same-value cross-namespace different Persons, multiple
values per Person/namespace, case/punctuation preservation, duplicate registration,
cross-Person collisions, simultaneous retries, simultaneous collisions and
concurrent next versions. Bounded retraction leaves past knowledge and unaffected
business periods intact. Constraint tests use rollback-only synthetic rows.

An actual PostgreSQL restart changes pg_postmaster_start_time(); the recovery
probe reopens Fastify and its pool, compares persisted versions and checks the
historical exact lookup. Its persisted receipt contains only references, versions
and server start time, no raw values. Before restart, other DB sessions were 0.

Early constraint runs failed because the unknown-Person probe reused the existing
unique key before reaching its FK, and TRUNCATE encountered deferred fixture
events before reaching its mutation guard. The probe now isolates the FK key and
flushes valid deferred fixtures before testing TRUNCATE. Both failures remain in
the command ledger; neither required weakening a database invariant.

Final gate results and command exits are recorded below. This is
local prototype verification, not formal ABG, AR-07, Keycloak, container, Browser,
real-system or full Person POC acceptance.

## Frozen contracts and A-02B boundary

| Contract | Required before/after SHA-256 |
|---|---|
| Department Master V1 | a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc |
| Department Hierarchy V1 | 72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372 |
| OpenAPI | f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035 |

Seven canonical artifacts must retain exact deterministic bytes. OpenAPI path and
operation delta are 0; all 15 Department Browser paths, generated client, Department
module, consumer SDK/replay/audit/metrics/SLA/subscription implementations and
previous migrations remain unchanged. They are regression targets only.

This task stops after its sole local commit. A-02B Source Record Mapping is still
NOT_STARTED. No Person source records, projection, API or UI are implemented.

## Git provenance

AUTHORITY_HEAD = START_HEAD = LOCAL_HEAD_AT_START =
0333d827373e8f97faaa8737145c54acc372f9c1.
BRANCH = prototype/phase-03-person-master. Opening worktree/index were clean.
LOCAL_UPSTREAM_STATE = CONFIGURED; LOCAL_UPSTREAM_REF =
refs/remotes/origin/prototype/phase-03-person-master; upstream SHA at start equals
the authority SHA; behind/ahead = 0/0. origin/main behind/ahead = 0/61 is an
observation, not a gate. REMOTE_PERSON_SHA_AT_START equals the authority SHA,
verified by ls-remote without fetch. No new branch or upstream configuration.

FINAL_COMMIT, final remote observation and push-command evidence are post-commit
facts recorded in the final response and ignored .runtime/pv006-a02a receipt.
The document belongs to the sole completion commit and cannot embed its own SHA
while also leaving a clean worktree. Completion state becomes effective with that
validated containing commit. Later user publication is POST_TASK_ACTION.

## Resource closure

Application and recovery probes closed Fastify and their DB pools. Final database
observation: 39 synthetic Person subjects (33 at start plus 6 from required A-01
regression), 32 Identifier relationships and 40 versions from two 16-Identifier
application runs, zero other DB sessions and zero orphan identifiers. Registry
operations themselves left the Person rows unchanged. These are retained immutable
development/probe records, not ADR-0050 acceptance coverage.

Task-started PostgreSQL was stopped and systemctl reported inactive. The WSL
keepalive (Linux PID 126, Windows PID 17168) exited. Final tracked validation child
process count was 0; temporary listeners on 3000/55434 were 0. Consumer/HTTP flows
also reported pool closure and port release. Unrelated host processes were not
terminated. Redacted ignored evidence remains in .runtime/pv006-a02a/.

## Final validation and independent review

Identifier public contract tests: **54/54**. Real PostgreSQL constraints,
registration/collision/idempotency/concurrency, immutable bitemporal assertions,
retraction, authorization separation, transaction/audit fault rollback and actual
database restart recovery: **PASS**. Value privacy checked in audit DB rows,
errors, generated logs and JSON receipts; Identifier after_hash values are null.

A-01 regression: **PASS**, including 32 Core contract tests. Governance API:
**461/461 across 30 files**; the formal/container vertical-slice integration file
was explicitly excluded. Sim Consumer: **20/20**. SDK: **72/72**. Replay: **4/4**.
Department constraints/repository/projection/application and HTTP persistence:
**PASS**. Consumer Metrics flow includes SDK, Replay, Audit and process recovery:
**PASS**. Canonical schema freeze: **20/20**, exact artifacts **7/7**.
Contract lint, full typecheck, build and npm run check: **PASS**. The full check
included repository layout, module boundaries, SDK/audit contracts and the live
database authority: 21 migrations, 70 generated tables, zero forbidden time types.
There is no separate source-lint script; contract:lint is the repository's lint
command. The consumer-audit checker reports two historical paths relative to its
own earlier baseline; A-02A's verified OpenAPI path and operation delta is **0**.

Protected-file comparison: **58/58 raw bytes unchanged**, plus five A-01 core files
unchanged against the authority Git blobs (working-tree line endings normalized
for that Git comparison). Generated client and all 15 Department Browser paths
remain unchanged. Runtime/model scope search found no forbidden adjacent fields.

Initial independent Standards review of tree 8855cfd7b67c0122840ba4101ccce31f31934443:
**0 hard violations, 0 blockers**; one nonblocking possible duplication judgment
for the composition scope/actor check. The repeated gate is retained to preserve
A-01 behavior and avoid an unrelated refactor. Initial independent Spec review:
**0 findings, 0 blockers**. Fresh reviews of the final staged tree are required
before the sole commit; the exact reviewed tree and verdict are in the final receipt.

Formal ABG, AR-07, Keycloak, container formal acceptance, Browser acceptance and
real HIS/EMR/HR connections: **NOT EXECUTED**. No production or full Person Master
completion claim. A-02B and B–G remain NOT_STARTED.

## Changed files and necessity

All paths below are repository-relative; there are 21 changed files.

| File | Why A-02A needs the change |
|---|---|
| .scratch/phase-03-person-master/spec.md | Split A-02A/A-02B and record their distinct lifecycle states |
| .scratch/phase-03-person-master/issues/02-person-identifier-registry.md | Authorized local implementation issue and gates |
| CONTEXT.md | Define Identifier and namespace without source-record ambiguity |
| docs/adr/0113-model-person-identifiers-as-non-reusable-governed-relations.md | Record the permanent non-reuse and privacy decision |
| docs/design/person-identifier-registry.md | Design, limits, provenance and validation evidence |
| db/migrations/0021_person_identifier_registry.sql | Native schema, permissions and database invariants |
| db/table-ownership.json | Document both new tables under existing Person ownership |
| apps/governance-api/src/platform/database/database-types.generated.ts | Live database-derived types for the two tables |
| apps/governance-api/src/modules/person-master/identifier-contracts.ts | Small public capability types and canonical validation |
| apps/governance-api/src/modules/person-master/identifier-application.ts | Transaction entry and bounded failure boundary |
| apps/governance-api/src/modules/person-master/identifier-repository.ts | Person-owned registry invariants and persistence |
| apps/governance-api/src/modules/person-master/identifier-contract.test.ts | Public contract validation and scope/privacy tests |
| apps/governance-api/src/modules/person-master/index.ts | Export the independent internal capability |
| apps/governance-api/src/composition/create-person-identifier-application.ts | Concrete transaction, scope, actor, authorization and audit wiring |
| apps/governance-api/src/modules/authorization/index.ts | Two independent Identifier operation permissions |
| apps/governance-api/src/modules/audit/index.ts | Bounded Identifier event and aggregate taxonomy |
| tooling/prototype/person-identifier-fixture.ts | Existing six-person cohort, separate synthetic actor and namespaces |
| tooling/prototype/person-identifier-constraint-probe.ts | Real PostgreSQL invariant proof in rollback-only transactions |
| tooling/prototype/person-identifier-application-probe.ts | Public application, concurrency, privacy, rollback and restart proof |
| tooling/prototype/person-subject-constraint-probe.ts | Replace obsolete exact-20 assumption with presence of A-01 migration and minimum count; all A-01 invariants retained |
| package.json | Focused Identifier validation commands only |

## Executed validation command ledger

All invocations below were executed through the redacting task runner. Earlier failures remain visible.

| # | Command | Exit |
|---|---|---:|
| 1 | `node .runtime/pv006-a02a/baseline.mjs` | 0 |
| 2 | `npm run prototype:db:migrate` | 0 |
| 3 | `npm run db:types:generate --workspace @hospital-data-intelligence/governance-api` | 0 |
| 4 | `npm run typecheck --workspace @hospital-data-intelligence/governance-api` | 0 |
| 5 | `npm run prototype:person:identifier:validate` | 1 |
| 6 | `npm run prototype:person:identifier:constraints` | 1 |
| 7 | `npm run prototype:person:identifier:constraints` | 0 |
| 8 | `npm run prototype:person:identifier:application` | 0 |
| 9 | `npm run typecheck` | 0 |
| 10 | `npm run prototype:person:identifier:validate` | 0 |
| 11 | `node .runtime/pv006-a02a/database-observation.mjs` | 0 |
| 12 | `npm run prototype:person:identifier:application -- --recover` | 0 |
| 13 | `npm run prototype:person:validate` | 0 |
| 14 | `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts --fileParallelism=false` | 0 |
| 15 | `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 16 | `npm run test --workspace @hospital-data-intelligence/release-consumer-sdk` | 0 |
| 17 | `npm run test:consumer-replay` | 0 |
| 18 | `npm run prototype:department:validate` | 0 |
| 19 | `npm run prototype:department:http:validate` | 0 |
| 20 | `npm run prototype:consumer:metrics:validate` | 0 |
| 21 | `npm run contract:lint` | 0 |
| 22 | `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 |
| 23 | `npm run typecheck` | 0 |
| 24 | `npm run build` | 0 |
| 25 | `npm run check` | 0 |
| 26 | `node .runtime/pv006-a02a/check-frozen.mjs` | 0 |
| 27 | `node .runtime/pv006-a02a/database-observation.mjs` | 0 |

An additional direct Identifier unit invocation returned exit 0 (54/54); the complete final API suite includes it.
The shell command `wsl -d Anolis-8.9-HDI-POC -u root -- systemctl restart postgresql-18` returned 0 before recovery.
Final `systemctl stop postgresql-18` returned 0; `is-active` returned 3 with inactive; keepalive kill and resource closure checks returned 0.
