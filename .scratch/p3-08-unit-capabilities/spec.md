# P3-08 unit capabilities and scoped parameter values

Status: ready-for-human

Authority: the user approved the complete P3-08 plan and requested implementation.
Baseline: 15313bf9c51f9b3d1c729871e497c72c6ded0be6; tree
e2e078a2fc5f9d56974e0d5441b8bd1fefd274a7; predecessor 0170; retained OID206108.
Public test seams: actual Owner interfaces, generated-client real HTTP, and
controlled SQL through the restricted application role. These seams were approved
with the plan. External pack originals and prior evidence remain unchanged.

## Accepted behavior

care-organization owns stable UnitCapability identities, immutable declarations,
and GRANT/REVISE/ACTIVATE/SUSPEND/RESUME/END facts. Unit, Campus, Subject, explicit
service set, capability type and care setting are fixed anchors. Crossing campuses
requires a new grant; a Unit REBIND never carries its original capability along.
ORDER and EXECUTE are independent. Synthetic capability and care-setting code sets
are versioned TEST POLICY ONLY; price GENERAL has no meaning here.

GRANT Y is enabled and GRANT N is disabled. ACTIVATE opens disabled relations;
RESUME opens explicitly suspended relations. REVISE changes properties, evidence,
parameter adoption or a fully revalidated period, never lifecycle or anchors.
SUSPEND and END are non-expanding, currently authorized, independently approved
commands even when upstream admission fails. END permanently masks future facts;
it cannot extend or restore the identity. Natural expiration is derived; a period
extension on a non-ended identity requires complete new admission. Disabled or
suspended declarations continue reserving their scope until END/finite expiration.

governance-catalog owns exact, scoped TEXT/INTEGER/DECIMAL/BOOLEAN value versions
under existing approved GOV09 definitions and independent parameter permissions.
Values reuse definition signing, request identity and audit mechanisms. Only
BOOLEAN_GATE_V1 has executable capability semantics. A changed current approved
definition/value blocks new capability admission until explicit re-adoption;
drafts do not replace approved runtime values. Original accepted evidence remains.
Empty rule_ref requires independent NO_ADDITIONAL_RULE confirmation. Unresolved
nonempty references are retained and blocked, never silently cleared.

## Input and transaction contract

ORG16_CORE_V1/STRICT_CAPABILITY_V1 include all 15 source fields. CSV/JSON/XLSX
and manual input use one Owner path. Native numbers/nulls and original bytes/cells
are retained; source IDs/revisions/status/time/approval remain evidence. Target
UUID/head/R are database authorities. Plus08 conversion requires a published
explicit rule; domain local time is Asia/Shanghai, half-open, microsecond, null
unbounded. FULL is separate and remains BLOCKED_DEPENDENCY.

Shared writer/authorization lock, one root transaction and one database R bind
input, contract, review, expected heads, material and complete upstream windows.
Facts/audit/outcome commit together; stale dependencies require new approval.
COMMIT_UNKNOWN resolves the exact original outcome before current authorization,
not through new admission. No generic CRUD, approval platform, rule DSL or outbox.

UNIT_CAPABILITY joins finite Department/Campus reference/impact interfaces.
Original accepted evidence and current constraints are separate. Disposition uses
exact committed END/new GRANT results. Suspension is not permanent disposal.
Ended historical references generate no new future obligations; original committed
proof survives later revisions. Unapplied old candidates need updated assessment.
Unimplemented downstream Owners remain NOT_EVALUABLE.

## Completion

Require focused real DB/HTTP/restricted SQL, failure/rollback/concurrency/replay,
one owned fresh and populated0170 upgrade with predecessor preservation, generated
types/contracts/current callers, compilation/build/boundaries/startup, affected
regressions and one independent same-tree Spec/Standards review. Retained deployment
preserves OID/rows/ledger/keys and verifies actual workbench generated HTTP plus
MATCHED reconciliation. Wrapper READY, exit0 and cleanupPassed=true are necessary.

AC01/04/05 and capability components of AC02/03 are mandatory. Actual P5 privilege
assessment and HIS/EMR order history remain NOT_RUN. A023 clinical subject/licensing
integration awaits P3-09. Hospital policy NOT_ADOPTED; overall clinical NOT_READY;
FULL BLOCKED_DEPENDENCY; dedicated browser/full restart/formal acceptance NOT_RUN.

One local completion commit and ignored exact commit/tree handoff, no push/PR or
following ticket. Cleanup only task-owned resources. Preserve existing branches,
stashes, protected evidence, original failures and 0001-0170 migration bytes.

## Comments

- 2026-10-05: User authorized this plan, including retained synthetic deployment
  and local completion commit. Work is confined to P3-08.
- 2026-10-05: Synthetic CORE implementation is present; fresh and populated0170
  upgrade each passed38 actual Owner/HTTP/restricted-SQL tests. Final regression,
  retained deployment, commit/tree and deferred human policy authority are recorded
  separately in the ignored P3-08 handoff; this status does not adopt hospital policy.
