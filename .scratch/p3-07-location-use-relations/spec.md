# P3-07 组织地点使用关系及用途字典

Status: ready-for-agent

Authority: user-approved implementation plan in this chat, 2026-10-07.
Baseline cb7cbfecf692bdfbac8f017bd570ac1b31256123, tree 26502214b32398b03b53d1b01c386d5fec6016bb, predecessor migration 0200.

Implement ORG13 all15 source fields, separate ORG13_CORE_V1/STRICT_LOCATION_USE_V1, stable relationships, CREATE/REVISE/permanent END, actual protected CSV/JSON/XLSX, current authorization, independent verification/approval, Catalog atomic Apply/outcome/replay/resume/MATCHED, typed API/generated clients and complete-window B/R reads. Only ORG/UNIT/WARD/NURSING targets and ROOM/CLINIC_ROOM/OPERATING_ROOM/WAREHOUSE/DISPENSING_WINDOW locations. Fixed target/campus/usage-type/location/start; a move is atomic END+CREATE. Latest finite declaration never falls back to an older open declaration. Pure reduction/END retain original accepted basis even when upstream admission fails.

Whole-location SHARED/EXCLUSIVE versioned policies: any EXCLUSIVE overlapping another declaration conflicts, across purposes too. Primary uniqueness is target type+target ID+campus+usage-type stable ID, not display name/version. Disabled dictionary or upstream objects never release reservations automatically. Existing Owner admission remains; no new clinical permission requirement or personnel migration.

Maintain hospital-wide purpose dictionary in location-master: DB stable ID, permanently owned stable code, immutable approved content, name/description revision with unchanged meaning, new identity/code for changed meaning. Initial synthetic examples CLINICAL/OFFICE/NURSING_STATION/STORAGE; arbitrary independently approved new codes supported. ENABLE/DISABLE are immediate DB-timed HUMAN maintenance actions with current permission, expected head, request identity and reason, without independent approval. They cannot publish draft content. Retain actor/time and exact request recovery. Disable prevents current use and expansion while retaining declarations; re-enable re-evaluates other dependencies without re-approving original relationships. Preserve historical disabled spans.

Public test seams confirmed by the approved plan: actual Owner, generated-client real loopback HTTP, signed controlled SQL as the restricted application role, and real dictionary page browser. No database/Owner mocks as business proof.

Add minimal /admin/vnext/location-usage-types page: create/revise/verify/approve/enable/disable/history, immutable published code/meaning, current actor isolation, stable pending request recovery, stale head and authorization failures; browser at1366x768 and1920x1080.

One receipt-bound durable DB, OID206108; old0001–0200 migrations byte unchanged, owned temporary fresh and populated0200 upgrade, codegen/contract/type/build/authority/affected regression, independent final Spec/Standards source review, controlled retained deployment and preservation. No second result ledger or generic policy/dictionary platform.

Hospital policy NOT_ADOPTED, clinical NOT_READY, ORG13-FULL BLOCKED_DEPENDENCY; organization-space page, full restart, capacity and formal acceptance NOT_RUN. Frozen old failures, handoffs, source pack and attachments preserved.

One local completion commit and ignored .runtime/vnext/p3-07 handoff; no fetch/push/PR/merge or P3-10/P3-11 implementation.

Additional authority, user instruction in this chat, 2026-10-07: publish the branch and PR, request `@codex review`, diagnose and repair findings, then push and repeat review until all actionable findings are resolved. Merge, main fast-forward, cleanup and later tickets remain outside this authorization.

The first installed P3-07 prefix is 0203. Review repairs must preserve all0001–0203 bytes and use forward migrations. Department boundary reads authorize only sources contributing effective property/lifecycle periods inside the requested B/R window, preserving that Owner's existing finite-version fallback and terminal replacement behavior. The separate location-use permanent-END/latest-finite rules remain unchanged. Validate real populated0203→0204 preservation in addition to the original0200 predecessor upgrade.

Hospital-wide dictionary evidence uses the artifact's exact immutable campus through a finite actorful Catalog context port, with existing protected READ, source-version, purpose and contract checks. No new external campus field or NORTH/SOUTH fallback probing is introduced. Historical dictionary access stays metadata-only; byte viewing retains original expiry, authenticated binding and audit. Relationship evidence stays bound to its declared campus. Forward0205 preserves0001–0204 bytes and originalNORTH material digest domains; validate populated0203→0205 and approval of an original pendingNORTH verification without re-verifying.
