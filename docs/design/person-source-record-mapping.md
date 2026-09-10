# PV-006-A-02B — Person Source Record Mapping

Task: PV-006-A-02B. Status: local engineering validation complete; DONE becomes
effective after fresh final-candidate Standards and Spec approval plus the sole local
commit. Classification: **SYNTHETIC / NON_PRODUCTION**. Time zone:
**Asia/Shanghai**. PV-005 remains ENGINEERING_COMPLETE and PV-006 remains
IN_PROGRESS. This work does not establish formal acceptance, production
readiness or real-source-key storage protection.

## Authority and boundary

Execution authority is the user PV-006-A-02B task at Git authority
`7e51b87493e1ce00fdaf918abef846948893f903` on
`prototype/phase-03-person-master`. Domain authority is CONTEXT.md, the Person
mixed-sovereignty direction and report analysis, the A-01 and A-02A designs,
ADR-0019, 0044, 0049, 0071, 0073, 0074, 0083, 0084, 0113 and new ADR-0114.

The capability maps an exact logical source record to an already existing Person.
It does not create or merge Persons, register or mutate Person Identifiers, import
source data, resolve identity, score candidates, connect HR/HIS/EMR, expose HTTP,
publish a Person projection, or change Department/consumer contracts. Engagement,
Assignment, roles, credentials and PV-006-B–G remain NOT_STARTED.

## Identifier versus source mapping

Person Identifier Registry answers which governed identifier a Person owns. Its
identity is `(identifierSystem, identifierValue)`, and that pair is never reassigned
between Persons. Person Source Record Mapping answers which Person the platform
believed an exact external logical record belonged to at a business and record
time. Its identity is:

```text
(governanceObjectId, sourceSystem, sourceEntity, sourceRecordKey)
```

The source record key is opaque and supplied in canonical form by its adapter. It
is not converted into an Identifier, parsed as an employee number or used as a
fallback search criterion. The two registries have separate tables, permissions,
commands and audit taxonomies and create no side effects in each other.

## Stable identity and physical model

Migration `0022_person_source_record_mapping.sql` adds two Person-owned tables.
The stable table `person_master.person_source_mapping` contains a PostgreSQL
UUIDv7 `person_source_mapping_id`, governance scope, exact source system/entity/key,
creation request, creation time and actor. The exact source tuple is full-history
unique. There is deliberately no `person_id`, current Person, current version or
current status cache on this row.

`person_master.person_source_mapping_version` contains the Person target,
per-mapping version number, `MAPPED` or `RETRACTED` status, `REGISTERED`,
`CORRECTED` or `RETRACTED` change kind, direct predecessor, bounded reason,
business interval, record time, actor, request and internal retry hash. Composite
foreign keys bind every version to the same mapping/governance scope and an
existing Person in that scope. A self-referential composite key prevents a version
from superseding another mapping's history.

Both IDs are opaque UUIDv7 values and never reused. Both tables reject UPDATE,
DELETE and TRUNCATE through database triggers, and those privileges are revoked
from PUBLIC. A deferred constraint requires V1 in the stable-row creation
transaction. Native SQL remains schema authority; Kysely types were regenerated
from the migrated PostgreSQL database rather than edited by hand.

## Registration and idempotency

`registerPersonSourceMapping` accepts the exact source identity, an explicit
existing Person and a half-open business interval. V1 is atomically created as
`MAPPED / REGISTERED`, with no predecessor or reason. The request ID serializes
same-operation retries. The same request, actor and exact command returns V1;
changing any stable identity, target Person or validity under that request returns
`SOURCE_MAPPING_OPERATION_CONFLICT`.

A different request for an already registered exact source tuple returns
`SOURCE_MAPPING_ALREADY_EXISTS`, regardless of whether it repeats the old Person
or proposes another Person. It never creates V2. PostgreSQL's exact unique
constraint arbitrates independent concurrent registrations; the loser records a
bounded rejection without the raw key. There is no upsert API.

## Explicit correction and no silent repointing

`correctPersonSourceMapping` is the only command that can append a changed Person
target. It requires the stable mapping ID, `expectedCurrentVersionId`, explicit
corrected Person, half-open business interval and one of:

```text
WRONG_PERSON_BINDING
BUSINESS_VALIDITY_CORRECTION
SOURCE_RECORD_RECONCILIATION
```

The application locks the stable mapping row, resolves the latest version, checks
the expected ID and inserts the next `MAPPED / CORRECTED` version with that latest
version as its direct predecessor. The database independently enforces the next
number, predecessor, status, change kind, reason, record-time monotonicity and the
rule that a changed Person requires `CORRECTED`. A same-Person validity correction
uses the same command and leaves a new immutable version.

Two writers based on one current version cannot both succeed. The first appends
the next version; after acquiring the row lock, the second receives
`SOURCE_MAPPING_STALE_VERSION` and must reread. Same-request correction retries
return the existing correction before the stale-writer check, while a changed
payload under that request conflicts.

The stable mapping row and all predecessor bytes remain unchanged. Direct SQL
UPDATE, DELETE, replacement and register-as-correction are rejected. Thus
`CORRECTION_ALLOWED = YES` and `SILENT_REPOINTING_ALLOWED = NO` are simultaneous
database and application properties.

## Retraction

`retractPersonSourceMapping` requires the correction permission, expected current
version, bounded reason and business interval. It appends `RETRACTED / RETRACTED`
and must copy the predecessor Person so the withdrawn binding remains explicit.
The stable mapping and earlier versions remain. If the record is later confirmed
to map again, `correctPersonSourceMapping` appends a new `MAPPED / CORRECTED`
version; deleting the retraction or registering the tuple again is not allowed.

## Bitemporal semantics

Business intervals are `[businessValidFrom, businessValidTo)`. All platform times
are offset-free Asia/Shanghai strings backed by `timestamp without time zone` and
`tsrange`. Inputs containing `Z` or offsets fail closed. Record time comes from
`platform.local_now()` after the mapping lock, while `versionNo` owns authoritative
per-mapping order.

As-of lookup filters by exact mapping or source tuple plus:

```text
recordedFrom <= recordAsOf
businessValidFrom <= businessAt
businessValidTo is null or businessValidTo > businessAt
```

It selects the highest applicable version number and only then evaluates status;
`RETRACTED` returns null rather than resurrecting an earlier mapping. A correction
recorded later can restate the full original business interval. Queries before its
record time still reproduce the old, now known-wrong Person; queries after its
record time return the corrected Person. A correction beginning at a later business
time leaves the earlier business interval on the predecessor.

## Application module and authorization

The source-mapping capability remains inside the `person-master` deep module. Its
public internal surface is limited to register, correct, retract, get mapping, get
version, list history, mapping as-of and exact source-record lookup. No generic
createVersion, setCurrentPerson, replace or update method is exported.

Permissions are independent:

```text
PERSON_MASTER_SOURCE_MAPPING_READ
PERSON_MASTER_SOURCE_MAPPING_WRITE
PERSON_MASTER_SOURCE_MAPPING_CORRECT
```

Core or Identifier permissions do not imply them. Correction/retraction require
the distinct high-risk correction permission. The existing Person scope and active
human-principal checks remain mandatory; service and inactive principals fail.
The composition root binds source mapping, authorization and audit to one database
transaction without exposing a database handle through the module interface.

## Audit and privacy

Successful registration, correction and retraction append Person Source Mapping
audit events in the same transaction as their business mutation. Correction audit
records the stable/version/predecessor IDs, previous and corrected Person IDs,
bounded reason, result, actor/request/correlation provenance and platform time.
Stale corrections and duplicate registrations use committed bounded rejection
events; business exceptions never masquerade as success.

Audit, logs, errors, metrics and validation receipts exclude the raw
`sourceRecordKey`, any source-key digest and the internal operation hash. Audit may
contain the stable mapping ID, source system/entity, Person/version references and
bounded result, though the current payloads omit system/entity when unnecessary.
Unexpected database errors are reduced to `SOURCE_MAPPING_OPERATION_FAILED`
without cause, detail, SQL parameters or key material.

This implementation stores only synthetic keys. It does not add custom encryption,
plain hashing, tokenization or hard-coded key management, and makes no claim that
real personnel source keys have production-grade at-rest protection. That requires
a separately authorized hardening decision.

## Source-key reuse boundary

V1 assumes the exact source tuple names one permanent logical record lineage. If a
real source reuses a physical primary key for another record, its adapter must
provide a stronger immutable key such as a generation-qualified or historical row
identity. Mapping the reused key from Person A to Person B as an ordinary correction
would conflate two source records and is outside A-02B. No source-system or
connector registry is added here.

## Validation status

Real PostgreSQL 18.6 validation has applied migration 0022 and regenerated 72
database table types. The two new tables expose 51 PostgreSQL 18 constraints
(including represented not-null constraints), eight non-internal triggers and nine
indexes. Constraint probes prove exact uniqueness, first-version atomicity,
same-scope Person and predecessor foreign keys, version/record-time order, all
change-kind guards, immutable rows, no physical deletion and zero forbidden time
zone types.

The application probe uses six existing synthetic Persons, two synthetic source
systems, three source entities and 13 mappings per successful application run. It
proves registration retry/conflict, duplicate registration rejection, explicit
cross-Person and same-Person corrections, stale and simultaneous correction safety,
retraction and correction after retraction, business/record-time history, exact
lookup, independent authorization, audit rollback, raw-key privacy and unchanged
Person/Identifier counts. Deliberate duplicate, stale-version and invalid-Person
failures are observed while stdout and stderr are captured; raw keys are absent
from both streams and every public error message. A real PostgreSQL restart then
recovers both the cross-Person correction history and the full
`MAPPED → RETRACTED → CORRECTED` history, including all three historical as-of
results, through a reopened Fastify application and pool.

Completed regressions include A-01 and A-02A live validation,
Governance API 479/479 excluding the explicitly out-of-scope formal/container
suite, Sim Consumer 20/20, SDK 72/72, Replay 4/4, Department native/application/
projection/repository and HTTP persistence, Consumer Metrics/Audit/SDK/Replay
recovery, contract lint, build, full typecheck, canonical schema freeze 20/20,
seven exact canonical artifacts and database authority at 22 migrations. Fresh
final-candidate review is required before the sole commit; its exact candidate and
verdict are recorded outside this tracked document.

## Frozen contracts and known limitations

OpenAPI remains SHA-256
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`.
Department Master V1 remains
`a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`;
Department Hierarchy V1 remains
`72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.
The generated API client, 15 Department Browser paths and seven canonical artifact
bytes remain frozen.

No fuzzy search, name/DOB match, Identifier fallback, automatic Person creation or
merge, full approval workflow, bulk import, source catalog, connector, HTTP API,
projection, real-system connection or production security is implemented. Formal
ABG, AR-07, Keycloak, containers and Browser acceptance are not executed. The next
task boundary is PV-006-B; this task does not authorize starting it.

## Git provenance

Opening branch, HEAD, clean worktree, configured upstream and live remote all
matched the authority commit. Local remote-tracking state is observation only;
live remote authority was checked by `git ls-remote` without fetch. No branch,
remote or upstream configuration changed. The task permits one local completion
commit after final gates and forbids push, fetch, pull, merge, rebase, reset, stash,
clean, cherry-pick and tag. Final commit and final remote observations are
post-commit facts and therefore are reported outside this tracked document.
