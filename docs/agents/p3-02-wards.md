# P3-02 病区主数据

Authority: user-approved plan in `.scratch/p3-02-wards/spec.md`; ADR0138.
Baseline805abf078c1686c9429df2c15d127a7fb67ef66f; predecessor0165.

`care-organization` is the sole Ward Owner. Ward identity, properties and management
are independent of Department, Unit, Nursing and Location. Every code is hospital-wide
and permanently claimed. Source aliases never assign a platform UUID or retarget an
existing identity. Equal names never merge Wards.

A newer Ward property assertion supersedes older assertions from its business
start. When that latest finite assertion ends, queries and coverage do not fall
back to an older unbounded assertion. Earlier R still retains the earlier view.

CREATE allocates identity and complete management. REVISE appends properties and may
extend only the existing contiguous final management period after full replacement
admission. REBIND atomically ends the actual source management and establishes a
same-campus target, preserving Ward identity. Campus changes require P3-11. CLOSE is
permanent, non-expanding and masks all later arrangements without deleting bindings.
Invalid upstream admission cannot trap closure; current permissions, expected head,
evidence and independent approval still apply. A property revision cannot reopen it.

Every published CORE Ward needs a real published Unit in the same Campus over its
entire business interval. A transaction-scoped Unit port combines controlled complete
coverage with current Department/service/Subject/operating admission at one R.
The database issues that R after the shared write lock; the Owner caches it per
transaction and uses it for both reviewer/executor admission and persisted Ward
properties/management. The mutation carries its transaction-bound database HMAC
proof, so a caller-supplied or cross-transaction point is rejected. Read-only
queries retain their ordinary B/R parameters.
Ward classification, management applicability and receiving basis are independently
verified. Applicable specialty, mixed, age or isolation restrictions need the exact
source rule version, protected material and complete period. Absence also needs explicit
confirmation. Unknown is blocked. No patient rule is executed. Clinical readiness stays
NOT_READY; CORE never substitutes for ORG08-FULL or hospital policy adoption.

## All16 source fields

| Source | Treatment |
|---|---|
| ward_id | Permanent source creation alias, not platform identity |
| ward_code | Permanent hospital-wide code claim |
| ward_name | Versioned text, not a merge key |
| campus_id | Exact Campus and governance-scope agreement |
| managing_unit_id | Exact Unit management; null draft retained, published CORE requires admission |
| ward_type | Independently reviewed versioned text, max256 characters |
| admission_rule_ref | Nullable reference with exact receiving evidence when applicable |
| public_phone | Nullable office text |
| version_no | Source integer revision only; raw native value retained, platform head database-generated |
| valid_from | Inclusive business boundary |
| valid_to | Exclusive end; source empty/null means unbounded |
| record_status | Source intent, never approval or clinical activation |
| source_system_id | Exact registered GOV01 source and R-visible evidence |
| source_record_id | Protected locator; public input/physical-row evidence pointer |
| approval_ref | Source signoff, separate from platform verification/approval |
| recorded_at | Source recording time, distinct from database-generated actual R |

ORG08_CORE_V1 has an explicit field list independent from FULL. STRICT_WARD_V1 uses
the shared CSV/JSON/XLSX intake, one ORG08 worksheet, the existing resource and active
content barriers, and only the declared Ward nullable fields. Native JSON source
version_no may be a bounded integer or its explicit decimal text representation.
File JSON preserves the numeric/null lexemes while representing the approved cells
as normalized text. No other parser policy is made permissive. Native time is local
Asia/Shanghai with microseconds; source +08 conversion needs its exact published rule.
Raw bytes, offsets and source values remain protected; transformed writes are digest-bound.

## Interfaces and impacts

`openWard` / `WardOwner`, routes `/api/vnext/wards/*`, `createWardClient` provide input,
verification, preview/plan, independent review/approval, Apply, candidate withdrawal,
exact recovery/reconciliation, B/R/history/exact/diff/list/coverage/evaluation and files.
The application role only executes controlled functions; no Owner-table DML.
Facts, management, code claims, audit and outcome commit in one root transaction.
Lost ACK recovery returns the original durable result before new admission checks;
current access is always rechecked. Delivery-attempt responseStatus is separate from
the durable outcome returned by resume.

Department/Campus reverse readers include finite WARD management references. Original
accepted versions/periods/digests remain distinct from current evaluation. Exact committed
Ward results prove dispositions; a candidate cannot. Missing scope access blocks complete
assessment. Masked future references are historical empty intervals, never reversed
intervals. Ended finite Campus windows have no outstanding obligation but retain history.
An exact committed REBIND proves the end of its actual source management for the
matching frozen reference case; it does not assert permanent closure of the Ward.
Catalog retains the frozen case ledger and exposes a controlled obligation reader
with current case/event authority. Ward reads that port rather than Catalog tables.
Campus dependency spans use the latest property assertion visible at the requested
R as well as management and closure boundaries; old R retains the original spans.
Reference discovery first selects the requested Departments, then authorizes all
matching management references; unrelated unreadable Units do not enter that set.
Current evolution/lifecycle inputs and reviews declare ten domains including WARD;
the signed historical eight/nine-domain evidence remains readable, while unapplied
older proposals must be replaced/reassessed and approved under the current declaration.

Forward repair0168 selects Ward bindings by the requested governance scope before
authorizing their objects. A committed REBIND remains valid disposition evidence
after later property revisions; exact candidate, request, outcome and frozen source
binding checks still apply. Department version parts come from the independently
accepted Unit relation, separately from current lifecycle coverage. For0167 Ward
bindings whose top-level projection is empty, the reader exposes the exact parts
already retained inside the original admitted pieces. It never rewrites the binding,
its original digest or an existing frozen impact case.

## Validation and operation

```powershell
npm.cmd run vnext:p3-02:unit
npm.cmd run vnext:p3-02:typecheck
npm.cmd run prototype:db:with -- vnext:p3-02:validate
npm.cmd run prototype:db:with -- vnext:p3-02:upgrade
npm.cmd run prototype:db:with -- vnext:p3-02:validate --ward-upgrade
npm.cmd run prototype:db:with -- vnext:p3-02:regression
npm.cmd run prototype:db:with -- vnext:p3-02:deploy
npm.cmd run prototype:db:with -- vnext:workbench:persistent
```

Validate owns a fresh receipt database. Upgrade first builds real Unit/Nursing and
upstream Owner facts at0165, then verifies old row and ledger preservation. The
additional validation mode, `validate --ward-upgrade`, builds a real
Ward at0167 and checks its unchanged history/digest after the forward repair. Deploy
only forward-upgrades the retained receipt database, preserves OID/old rows/keys/ledger
and exercises generated HTTP on the real workbench. Startup checks the complete manifest
before credentials and the exact Ward key/provisioning before constructing business Owners
or listening. All task pools and owned temporary resources close through the managed path.
Success requires READY, target exit0 and cleanupPassed=true. Never print connection strings
or secret receipts. Installed migrations are immutable; subsequent repair is forward-only.

Actual outcomes, AC mapping, failure/GREEN logs, review method and final commit/tree
are recorded in ignored `.runtime/vnext/p3-02/handoff.md`. Script existence does not prove PASS.
AC03 real shared admission remains P3-04; AC04 beds remains P7-05. Ward browser/UI is P3-10;
cross-campus migration/restorable pause is P3-11. Hospital policy NOT_ADOPTED, FULL
BLOCKED_DEPENDENCY, formal acceptance and actual restart NOT_RUN. Prior P3-06/P1-03
failures and pending acceptance remain inherited. Local completion only; no fetch/push/PR.
The user subsequently authorized PR31 publication, repeated GitHub Codex review/fix,
exact-head merge, main fast-forward and verified cleanup; that explicit authorization
supersedes the original local-only fence as recorded in the task specification.
