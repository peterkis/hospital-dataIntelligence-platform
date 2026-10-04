# P3-01 院区业务单元

Status: ready-for-human

Authority: user-approved implementation plan in this chat. Baseline:
387f3b11d1d95af5db87ed7a7ca8da36acc336e8; installed predecessor 0151.

Public test seams confirmed: care-organization Owner, generated-client real
loopback HTTP, controlled SQL invoked as the actual restricted application role.

Implement all 19 ORG07 source fields, independent CORE contract, immutable unit
identity/property/binding history, hospital-wide permanent codes, full-window
Department/Campus/Subject/operating/service admission, independent receiving
evidence, atomic same-unit cross-campus REBIND, terminal non-expanding CLOSE,
protected input, approval/outcome/audit/replay, strict file intake, current
runtime/client, and finite Department/Campus impact integration.

Multiple units per Department/Campus are allowed. Empty business_owner_id is a
pending responsibility and permits CORE publication; nonempty unready references
block without erasure. CORE never asserts clinical readiness. FULL is blocked on
named downstream owners. Planned opening alone is insufficient; only separately
approved future operating coverage admits a future unit version.

No Person/responsibility creation, wards/nursing/beds, LocationUse, patient rule
execution, new UI, real policy adoption, production acceptance or following ticket.

Require original five ACs, actual DB/HTTP/SQL gates, fresh and populated 0151
upgrade/codegen, retained OID206108 preservation and persistent HTTP, fixed-tree
independent Spec/Standards review. Preserve original RED and later GREEN.
One local completion commit, ignored exact commit/tree handoff; no fetch/push/PR.

## Comments

2026-10-04: synthetic DOMAIN/API implementation complete. Fresh and populated
0151→0161 upgrade each passed 26/26; restricted SQL, actual generated HTTP,
affected regressions and retained OID206108 preservation passed. Independent
Spec/Standards review repairs cover historical list authorization, integrated
Campus SQL, event-based disposition completion and late closure obligations.
Startup gates now cover every incomplete Unit migration prefix and missing Unit
provisioning. Exact final commit/tree and command logs are indexed in ignored
`.runtime/vnext/p3-01/handoff.md`. This state requests human review of local
delivery; hospital policy/acceptance and ORG07-FULL remain separately unready.
