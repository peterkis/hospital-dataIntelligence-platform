# P3-08 business capabilities and scoped parameter values

Authority: user-approved `.scratch/p3-08-unit-capabilities/spec.md`; ADR0139.
Baseline15313bf9c51f9b3d1c729871e497c72c6ded0be6; predecessor0170.

`care-organization` owns UnitCapability identity, all source aliases, declarations,
and lifecycle commands. A grant fixes Unit/Campus/Subject/services/type/setting.
Campus governance NORTH/SOUTH and Campus UUID are separate checked coordinates.
Equal names or Department membership never propagate capabilities. Unit REBIND
preserves the capability's original scope; a new target grant is explicit.
ORDER and EXECUTE have independent grants. GENERAL is not a care setting.

GRANT(Y/N), REVISE, ACTIVATE, SUSPEND, RESUME and END always use protected input,
independent verification, a frozen candidate, review, approval and atomic Apply.
REVISE cannot alter anchors or lifecycle. The newest declaration supplies the
whole declared interval; finite expiry never falls back to an older open version.
Disabled and suspended relationships reserve their scope. END masks subsequent
arrangements permanently; another END may only confirm or shorten its boundary.
An ended identity cannot resume or extend. Non-expanding SUSPEND/END can proceed
when upstream admission fails, subject to current access, evidence and approval.

GOV09 definitions remain definition metadata. Actual values are separately owned
and independently approved by governance-catalog. Four value types are supported:
TEXT exact strings; INTEGER/DECIMAL lossless strings; BOOLEAN native booleans.
Values carry an exact definition/version/digest, source and closed business scope.
Secret parameter keys, recognized credentials and executable-expression markers
are rejected. No arbitrary text, numeric clinical rule or expression is executed.
Only BOOLEAN_GATE_V1 executes: true satisfies its condition; false denies it.
An empty rule_ref needs independent NO_ADDITIONAL_RULE confirmation. Unknown or
nonempty unresolved references block. Draft values do not replace approved values;
new approved definitions/values block old adoption until explicit approved REVISE.
Original approved pins remain permanently readable with current authorization.

## Source and API contract

ORG16_CORE_V1 / STRICT_CAPABILITY_V1 retain all15 fields:

| Field | Destination |
| --- | --- |
| capability_id | Permanent source alias, distinct from platform UUID |
| unit_id | Typed stable Unit anchor |
| capability_type | Exact TEST POLICY ONLY adopted enum |
| care_setting | Exact TEST POLICY ONLY adopted enum |
| enabled | GRANT initialization or explicit lifecycle intent |
| rule_ref | Stable parameter reference or independently confirmed absence |
| approval_dept | Versioned business approval Department label |
| version_no | Source version evidence; not target head |
| valid_from | Half-open local business start |
| valid_to | Half-open local end; explicit null is unbounded |
| record_status | Independent source evidence |
| source_system_id | Exact governed source identity |
| source_record_id | Protected source locator; never public logs |
| approval_ref | Source approval evidence; not platform approval |
| recorded_at | Source time evidence; not database record time |

CSV, JSON and XLSX share the existing protected intake/parser and Owner validation.
Original bytes/tokens and conversion provenance are retained. Native JSON null and
integer source versions follow the published field contract. CAPABILITY_EMPTY_END_V1
explicitly converts CSV/XLSX blank valid_to to null and retains conversion evidence;
manual/JSON blank strings never become an unlimited period. Unknown fields,
duplicate JSON keys, workbook formulas/macros/links/hidden content fail closed.
No global trim, case folding or zero repair occurs. Asia/Shanghai local timestamps
have no offset and support microseconds. +08:00 is accepted only with the explicitly
published SOURCE_PLUS08_TO_LOCAL rule; Z and other offsets never silently convert.
FULL remains its own blocked dependency contract.

TypeBox generates the OpenAPI and generated clients. API prefixes:
`/api/vnext/unit-capabilities/*` and `/api/vnext/parameter-values/*`.
Capability endpoints include inputs/read, files, verify, preview, withdraw, plan,
review, approve, apply, resume, reconcile, query, exact, history, diff, list and
evaluate. Parameter endpoints include commands, query, history and evaluate.
Use createUnitCapabilityClient/createParameterValueClient from the generated SDK.

Window evaluation returns explicit segments/gaps/reasons, exact actual version
references, acceptedBasis and current basis. CURRENT_ADMISSION rejects caller R;
HISTORICAL accepts recordAsOf as an explanation, never a write authorization token.
Whole clinical readiness remains NOT_READY, even for a SATISFIED capability.

## Transaction and finite impacts

Apply uses the existing coordinator and CatalogTransactionScope, global writer /
authorization lock901002, database-issued transaction-bound R proof, protected
materials, immutable facts/audit and durable outcome in one root transaction.
The controlled mutation independently rechecks scopes, head, approved frozen hash,
current Unit/Department/Campus/Subject/license and parameter invariants. Application
roles cannot directly read or DML Owner tables. Audit or write failure rolls back
the whole unit. A changed dependency invalidates approval as STALE_VALIDATION.

COMMIT_UNKNOWN / delivery loss must recover the exact original candidate/request
through resume before evaluating anything new, with current read authorization.
MATCHED reconciliation checks the original facts and versions. Revoked access also
blocks replay/recovery. Never substitute a new head, Unit or request.

Department/Campus include UNIT_CAPABILITY finite Owner references and remaining
obligations. Rename may be CHANGED+SATISFIED. Paused capabilities still reserve
restoration obligations; only exact committed END/new GRANT dispositions apply.
Ended or already expired historical references retain accepted evidence and open
no future obligation. Later END shortening cannot invalidate the older exact
committed proof. Existing committed old Department outcomes remain recoverable;
old unapplied candidates need the new coverage and independent approval.
PERSONNEL/PATIENT/real clinical consumers remain NOT_EVALUABLE.

## Operations and evidence

Use the prototype wrapper for all ordinary DB operations. Do not print connection
strings, source locators, payload keys or ciphertext. Keep failed evidence intact.

```powershell
npm.cmd run vnext:p3-08:unit
npm.cmd run vnext:p3-08:typecheck
npm.cmd run prototype:db:with -- vnext:p3-08:validate
npm.cmd run prototype:db:with -- vnext:p3-08:upgrade
npm.cmd run prototype:db:with -- vnext:p3-08:regression
npm.cmd run prototype:db:with -- vnext:p3-08:deploy
```

validate owns a fresh receipt-bound database. upgrade creates actual0170 Owner
facts, checks their hashes/ledger, then appends0171-0174 and runs the same real
Owner/HTTP/restricted-SQL suite. --generate (without a second -- after the script
name) regenerates DB types in an owned fresh run. Every DB success also requires
DATABASE_SESSION_READY, target exit0 and cleanupPassed=true. Retained deploy is
separate: preserve original OID/rows/ledger/keys, provision exactly the public ports,
start actual workbench on an owned loopback port, publish bounded synthetic values
and a capability using generated HTTP, verify replay/resume/MATCHED/403, then close
only that service. Never drop the retained receipt database.

Evidence is ignored under `.runtime/vnext/p3-08`; handoff pins commit/tree and links
commands, original RED, final GREEN, per-AC component evidence and deferred work.
Migration0001-0170 and predecessor evidence are immutable. Clean only this run's
receipt-owned temporary databases/roles/keys/pools/services. Preserve user branches,
stashes and unrelated ignored material. Stop after one local completion commit;
no push, PR or next ticket.

Delivery labels are separate: synthetic CORE component results; FULL
BLOCKED_DEPENDENCY; hospital policy NOT_ADOPTED; P5 privilege/real HIS order history,
P3-09 clinical licensing, browser, full restart and formal acceptance NOT_RUN.
AC01/04/05 concern actual capability behavior. AC02/03 prove component suspension
and historical version retention only. A023 demonstrates current operating-license
rejection, while the P3-09 diagnostic-license portion remains NOT_RUN.
