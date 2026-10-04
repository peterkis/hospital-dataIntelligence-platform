# P3-03 护理单元

Authority: user-approved plan recorded in `.scratch/p3-03-nursing-units/spec.md`.
Baseline: 847987fc02520da9ec013a84be399895c5b53ba3, predecessor 0161.
ADR0137 governs the synthetic CORE decisions.

`care-organization` is the only Nursing Owner. It retains hospital-wide permanent
identity/code ownership, independent immutable property and management-binding
assertions, and continuous suspension events. It shares Catalog, protected-file
intake, approval, Apply, transaction authorization, keys and audit capabilities.

CREATE allocates the platform ID. REVISE changes properties or code inside the
existing binding period. REBIND atomically ends the source binding and establishes
the target, preserving identity; both campus scopes and manager references need
current authorization. SUSPEND masks new admission from its business boundary,
including future arrangements, without deleting bindings. P3-11 owns restoration
and permanent retirement. Upstream admission does not trap non-expanding pause.

CORE admits full-period real Department and non-retired Campus master references
at one R. Administrative managers and PLANNING/SUSPENDED campuses are permitted;
no clinical service relation is inferred. Original accepted evidence and current
recheck are distinct. Nursing readiness remains NOT_READY; duty, ward coverage,
capability and operating permission remain explicitly unavailable.
Each upstream Owner supplies its own controlled coverage projection. Source
qualification uses the Catalog's exact, R-visible definition and evidence chain;
withdrawal changes the current evaluation while earlier acceptance stays intact.

All ORG09 15 fields are retained. Nursing ID is a source creation alias; source
version, status, approval and recorded time are provenance. Source locators remain
protected. care_level and office_phone are nullable text.
Direct JSON accepts literal null for those two fields and retains it in protected
staged input. STRICT_NURSING_V1 file JSON normalizes those null values to its blank
text-cell representation while retaining the original null lexemes/raw artifact;
the Owner publishes null facts. Other fields/scalars and parser policies stay strict.
Native API dates are Asia/Shanghai local with microseconds; source +08 conversion requires its exact
published rule. ORG09_CORE_V1 is separate from FULL, which remains blocked.

| Source field | Owner responsibility |
| --- | --- |
| nursing_unit_id | Source alias; source + alias cannot create a second identity. Updates require a typed platform target and expected head. |
| nursing_code | Permanent hospital-wide claim; revision appends the new claim and retains old claims. |
| nursing_name | Versioned text; equal names never merge identities. |
| campus_id | Exact Campus UUID, typed binding and input governance scope must agree. |
| managing_org_id | Exact real Department UUID; administrative management needs no clinical service relation. |
| care_level | Nullable versioned text; grants no clinical capability. |
| office_phone | Nullable office text; no personal contact inference. |
| version_no | Source revision only; database assigns platform sequence. |
| valid_from | Local inclusive business boundary. |
| valid_to | Local exclusive boundary, or unbounded when empty. |
| record_status | Source intent only; cannot approve a platform change. |
| source_system_id | Registered exact GOV01 source; validity checked for expanding paths. |
| source_record_id | Protected raw locator; ordinary facts contain its input/row evidence pointer. |
| approval_ref | Source approval evidence required for publication; platform approval remains independent. |
| recorded_at | Source recording time; actual platform R is allocated by the database. |

Routes: `/api/vnext/nursing-units/*`; client: `createNursingUnitClient`. Inputs,
verification, preview, planning, independent review/approval, Apply, withdrawal,
exact result recovery, reconciliation, B/R reads, history/diff/list and complete
period evaluation are available. CSV/JSON/XLSX use STRICT_NURSING_V1 and the
existing shared defenses. No Nursing page or clinical execution is introduced.

NURSING_UNIT references are reverse-read through the finite Department/Campus
interfaces. Disposition accepts exact committed Nursing results and current
permissions. Unknown downstream domains never become zero-impact conclusions.
Hospital-wide Department exits collect Nursing bindings across all governance
scopes and authorize their actual campuses; an inaccessible scope blocks the
assessment instead of producing a partial EVALUATED report.
An earlier suspension can fully mask an already recorded future binding. Its
original accepted interval remains immutable; its current impact interval is
empty at the binding's start, and the reference is marked historical rather than
current. This avoids a reversed interval without discarding accepted evidence.
Finite Campus impact windows retain historical activity after their end, but
have no outstanding nursing obligation when their end is at or before the
observation time. Future finite and unbounded windows still evaluate remaining
obligations. The nursing reader uses one observation time for history and status.
AC01 actual multi-ward coverage, AC04 actual coverage effects, and the coverage
portion of AC05 stay NOT_RUN pending P3-05. This ticket's master-reference portion
of AC05 and AC02/03 are exercised separately.

| Acceptance | P3-03 evidence seam | Remaining acceptance |
| --- | --- | --- |
| AC01 multi-ward coverage | No one-to-one ward constraint or placeholder ward facts | Actual configuration NOT_RUN, P3-05 |
| AC02 nurse-station room rejected | Owner, generated HTTP and restricted SQL reject wrong typed owners | Physical coverage is outside this ticket |
| AC03 duplicate stable versions rejected | Database IDs/sequences, permanent source identity, head/concurrency rejection and legal exact replay | Formal hospital acceptance NOT_RUN |
| AC04 suspension coverage impact | Persistent pause, retained history and explicit unavailable coverage | Actual ward coverage impact NOT_RUN, P3-05 |
| AC05 inconsistent campus cannot publish | Row UUID, typed target, input scope, current source/target authority and atomic admission | Coverage consistency NOT_RUN, P3-05 |

## Validation and operation

```powershell
npm.cmd run vnext:p3-03:unit
npm.cmd run vnext:p3-03:typecheck
npm.cmd run prototype:db:with -- vnext:p3-03:validate
npm.cmd run prototype:db:with -- vnext:p3-03:upgrade
npm.cmd run prototype:db:with -- vnext:p3-03:regression
npm.cmd run prototype:db:with -- vnext:p3-03:deploy
npm.cmd run prototype:db:with -- vnext:workbench:persistent
```

validate owns a fresh receipt database; upgrade creates real predecessor Owner
facts at 0161 before applying the new prefix, then preserves predecessor rows and
ledger. Deploy only upgrades the retained receipt database and preserves OID,
keys, ledger and old rows before exercising the generated client against the real
workbench. Application roles receive controlled function execution, no Owner table
DML. Success requires READY, targetExitCode=0 and cleanupPassed=true.

Check ignored `.runtime/vnext/p3-03/handoff.md` for actual results and exact final
commit/tree. Do not infer PASS from script availability or this design. Original
failures and subsequent GREEN are retained; actual restart, Nursing browser and
formal hospital acceptance are separately NOT_RUN. Hospital policy NOT_ADOPTED;
TEST POLICY ONLY is the synthetic contract adoption.
