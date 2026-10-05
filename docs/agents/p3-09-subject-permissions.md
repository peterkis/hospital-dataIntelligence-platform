# P3-09 diagnostic subjects and institution permissions

Authority: `.scratch/p3-09-subject-permissions/spec.md`, ADR0140 and the external
v3 P3-09 execution prompt. Baseline `3c3f7ace5d451789b3c0ccd65f970dc43557118b`;
predecessor0175. Only this ticket is executed. No external standard is downloaded.

`governance-catalog` owns complete adopted diagnostic subject snapshots, original
source/evidence references, source page/summary, adoption date, independent source
verification and approval. Draft or unverified snapshots cannot grant permission.
Its concrete REF01 register binds an immutable source-system/source-alias and
namespace URI to the database identity. A closed REF01 typed reference identifies
that source alias; original `code_system_version` text (such as `2022版`) remains
distinct from the platform snapshot head. Name, namespace, source document and
issuer are versioned adoption evidence. The received ORG17 row is never rewritten
to make a source alias or source version equal a platform UUID or numeric head.
Approval never rewrites an old exact snapshot. Current admission compares the
individual accepted code's meaning/status against every relevant approved current
snapshot throughout the requested B interval at R. An unrelated new code keeps the
original pin; retired, missing, changed meanings or changed replacements require
blocking review, including replacement changes on an otherwise ACTIVE code. An unchanged approved
successor can carry the original pin beyond its finite end: every current segment
must supply its own snapshot and source-period coverage. The accepted snapshot's
business start still bounds how early that pin can be used. A changed label
creates an informational review case, without replacing the code automatically.
New cases are limited to the released snapshot's current interval at its approval
R: a previously approved snapshot with a later business start takes precedence.
An expired current snapshot leaves a gap instead of restoring an earlier snapshot.
An unresolved blocking case continues to gate admission even if a later snapshot
restores an earlier meaning. An explicit independently checked relationship revision
resolves cases; the case set is included in the frozen candidate so a plan prepared
before the material change cannot resolve later obligations by replaying its digest.
Window evaluation uses the union of currently valid explicitly reviewed permissions
for each requested service and exact adoption. A still-blocked parallel relationship
remains in diagnostic checks/cases; it cannot invalidate coverage supplied by a
different, independently reviewed permission. Gaps remain explicit negative checks.

`care-organization` owns separate MAPPING and PERMISSION relationships. A mapping
records EQUIVALENT, NARROWER, BROADER or RELATED interpretation and evidence; none
grants a license. Each permission fixes target kind/id, institution, physical campus,
explicit services, adopted code and exact institution license version. Target CORE
kinds are LEGAL, ORG and UNIT. ORG also retains an exact public Department-campus
relation as versioned context. One institution may operate multiple campuses.
REGISTER, source approval, matching names and source version numbers confer no grant.

RECORD/REVISE/RETIRE use protected input, independent human verification, a frozen
candidate, independent approval, expected heads and atomic Apply with audit and
durable outcome. Source identifiers are never platform identities. REVISE preserves
the relationship's fixed scope and business start. Explicit service sets are sorted
before both file and direct inputs are staged, so receiving order cannot change
that fixed scope. The newest declaration supplies
the entire period; expiry never falls back to an old open version. RETIRE permanently
closes the relation and may only shorten a previous closure. Its non-expanding path
requires current authorization/evidence/approval but remains available after upstream
license, source or code admission fails. Current recheck and immutable exact history
are separate reads. Whole-batch failure publishes no partial relations.

The 17 source fields remain under the protected ORG17 receiving contract:

| Source field | Responsibility |
|---|---|
| subject_license_id | Stable source alias, distinct from platform relation UUID |
| target_type, target_id | Original target; explicitly checked against typed target |
| code_system_id, code_system_version, subject_code | REF01 source alias and original version text, resolved through the explicit exact adopted snapshot |
| license_ref | Protected original; public facts expose only input/row evidence pointer |
| permitted_scope | Protected original and independently confirmed limitations |
| verifier | Source verifier role; never platform actor authority |
| version_no | Original source version; native JSON integer retained |
| valid_from, valid_to | B declaration; original timestamp and conversion provenance |
| record_status | Original status checked against the requested action |
| source_system_id | Approved source Owner reference |
| source_record_id | Protected locator; public facts expose only input/row pointer |
| approval_ref | Source approval evidence; distinct from platform approval |
| recorded_at | Original source observation, distinct from database-issued R |

Public APIs are `/api/vnext/subject-codes/{command,query}` and
`/api/vnext/subject-permissions/{inputs,inputs/read,verify,preview,plan,review,approve,
apply,resume,reconcile,withdraw,query,history,exact,recheck,evaluate,files}`. Generated
clients are `createSubjectCodeClient` and `createSubjectPermissionClient`.
ORG17 files use `ORG17_CORE_V1` / `STRICT_SUBJECT_PERMISSION_V1`. CSV/JSON/XLSX pass
through the existing bounded parser, protected original store and immutable
validation reports. JSON requires native null and integer source versions; digit
strings for version_no cannot stage. CSV/XLSX textual version cells remain supported. Blank
CSV/XLSX valid_to becomes null only under the published `SUBJECT_EMPTY_END_V1` rule.
All new commands and ORG17 time fields require Asia/Shanghai local strings without
Z or offsets, per ADR0074. No offset-stripping or conversion policy is available.
Invalid files retain their protected originals without a publishable input. Legacy
policy labels remain readable in stored evidence; current normalization rejects them.
Unsupported raw target types, including UNKNOWN and FULL, preserve the input and
report BLOCKED_DEPENDENCY; supported types that disagree with scope remain mismatches.

Run database checks through the repository wrapper; never print credentials or keys:

```powershell
npm.cmd run vnext:p3-09:typecheck
npm.cmd run prototype:db:with -- vnext:p3-09:validate --generate
npm.cmd run prototype:db:with -- vnext:p3-09:upgrade
npm.cmd run vnext:contract:generate
npm.cmd run vnext:contract:verify
npm.cmd run prototype:db:with -- vnext:p3-09:deploy
```

Fresh and populated0175 upgrade run in receipt-owned disposable databases, including
real predecessor Owner facts, checksummed ledger/table preservation, generated SQL
types and authority checks. Deployment uses only the retained receipt/OID, preserves
previous rows and keys and grants an enumerated SQL function surface. Provisioning
does not automatically grant actor access: exact subject tuples and adopted-code
permissions remain explicit. Workbench startup checks the complete installed chain,
function rights and receipt-bound key proof before constructing either Owner.

All task-local evidence, original failures, GREEN runs, review reports and exact
final commit/tree are indexed by `.runtime/vnext/p3-09/handoff.md`. Read the actual
gate result and database wrapper READY/CLOSED/cleanupPassed records; log existence
alone is not acceptance. Never expose `.secret.json` files.

Only offline TEST POLICY ONLY sources are supported here. Hospital policy remains
NOT_ADOPTED and clinical readiness NOT_READY. FULL/unsupported targets are
BLOCKED_DEPENDENCY with originals preserved. P5 personnel registration/service-place
intersection and P7 regulatory categories are deferred. Dedicated browser, full
restart, capacity and formal hospital acceptance remain NOT_RUN. The P0-02 browser
pending gate remains pending; this ticket does not certify production readiness.
