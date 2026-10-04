# P3-01 business units

Authority: the implementation plan approved in the P3-01 chat, tracked in
`.scratch/p3-01-campus-business-units/spec.md`. Package task P3-01 is source
material; the approved plan supplies its identity, receiving and period decisions.
Baseline: `387f3b11d1d95af5db87ed7a7ca8da36acc336e8`, installed prefix 0151.

`care-organization` owns unit identity, permanent hospital-wide codes, immutable
properties, bindings and receiving evidence. It uses the public Department
lifecycle and Operating Owner transaction ports and the existing Apply
coordinator. The composition root injects finite Unit ports into Department and
Campus impacts. Other downstream domains remain `NOT_EVALUABLE`.

`CREATE` allocates a database identity; `REVISE` changes properties and preserves
the binding stream; `REBIND` ends the actual source binding and creates a target
binding in one transaction, preserving Department and unit identity; `CLOSE`
permanently masks every later open arrangement. REBIND is not a property version
for business-time resolution. A contiguous final finite binding may be extended
by REVISE only after full replacement-period admission; gaps, implicit campus
changes and Department retargeting are rejected.

CORE publication, current period admission and clinical readiness are separate.
Empty responsible Person means pending P5-02; a supplied unresolved Person blocks
without erasure. Clinical readiness stays `NOT_READY`, with named responsibility
and capability reasons. ORG07-FULL remains `BLOCKED_DEPENDENCY`. The enum adoption
is `SYNTHETIC_ADOPTED / TEST POLICY ONLY`; hospital policy is `NOT_ADOPTED`.

Historical list authorization filters R before selecting binding permissions.
Campus controlled SQL observes the same integrated finite report as its injected
port. Historical overlap stays active evidence; outstanding obligations start at
the observation time. Readiness never replaces the separately approved Campus
completion event. Each revision has at most 100 expanded property/binding writes.

## Field responsibility

Every protected input retains these 19 source fields. Public facts retain the
source alias/revision/status/approval/time and a protected record-locator pointer.

| Source | Owner treatment |
|---|---|
| unit_id | Creation alias; cannot choose a new platform UUID |
| unit_code | Immutable claims across changes and closure; global uniqueness |
| unit_name | Property stream |
| org_id | Actual Department identity, immutable for the unit |
| campus_id | Typed Campus binding, authorized and fully covered |
| legal_entity_id | Typed operating Subject matching Department service relation |
| unit_type | Exact published contract adoption; OTHER needs classification review |
| public_phone | Independent nullable property |
| service_description | Independent nullable property |
| receiving_rule_ref | Original reference plus exact source rule version and protected material; no patient execution |
| business_owner_id | Original retained; empty pending, nonempty blocked until P5-02 |
| version_no | Source revision; platform head comes from database |
| valid_from | Asia/Shanghai local lower bound, inclusive, microseconds |
| valid_to | Exclusive upper bound; empty source value means unbounded |
| record_status | Source intent; cannot grant approval or clinical use |
| source_system_id | Exact registered source and effective coverage |
| source_record_id | Protected locator; public pointer to input and physical row |
| approval_ref | Source approval; does not replace platform approval |
| recorded_at | Source time; target R comes from database |

Explicit service codes and exact Department service-relation version are required
operation metadata. Neither names nor unit types infer them. Receiving review is
immutable and pins the input digest, classification, material and complete period.
Absence of a rule requires independently confirmed no-special-restriction evidence;
unknown absence blocks. The MACHINE source condition checks evidence completion,
and retains the source rule's exact identity/field/text. Source `+08:00` conversion
requires its separately published conversion rule; raw input is preserved.

## Runtime and validation

Routes: `/api/vnext/business-units/*`. Client: `createBusinessUnitClient`.
All source files use `STRICT_UNIT_V1` and shared CSV/JSON/XLSX defenses.
No UI is added. Startup requires the complete release manifest and provisioned
care schema/function access. The application role cannot read/write Owner tables.
SQL verifies transaction signatures, frozen fact hashes, global code claims,
expected heads, stable anchors, disjoint complete bindings and permanent closure.
Facts, bindings, claims, audit and outcome share the Apply transaction.

Use the repository database wrapper, without printing connection strings:

```powershell
npm.cmd run vnext:p3-01:unit
npm.cmd run vnext:p3-01:typecheck
npm.cmd run prototype:db:with -- vnext:p3-01:validate
npm.cmd run prototype:db:with -- vnext:p3-01:upgrade
npm.cmd run prototype:db:with -- vnext:p3-01:deploy
```

Validate/upgrade own temporary databases with receipt-verified cleanup. Upgrade
first builds real Department, Subject, Campus, license, verified scope and Location
facts through prefix-0151 public Owners, then compares all predecessor row digests
and the ledger. Deploy upgrades only the retained receipt database, preserves
original rows/keys/ledger/OID and exercises generated HTTP on the real runtime.
Successful commands require READY, target exit 0 and cleanupPassed=true.

Evidence is indexed by ignored `.runtime/vnext/p3-01/handoff.md`. It includes
original RED/GREEN, fresh, populated upgrade, restricted SQL, HTTP, affected
regressions, review method and exact final tree/commit. COMMIT_UNKNOWN recovers the
original outcome before current admission; recovery still rechecks its accepted
scope's current authorization. Technical gates do not establish hospital policy
adoption or formal hospital acceptance. P3-06's inherited failures remain recorded.
