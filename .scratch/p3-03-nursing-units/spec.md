# P3-03 护理单元主数据

Status: ready-for-human

Authority: user-approved P3-03 plan in this chat. Baseline 847987fc02520da9ec013a84be399895c5b53ba3, predecessor 0161, retained OID206108.

Confirmed public test seams: NursingUnit Owner, generated-client actual HTTP, restricted application-role controlled SQL.

Implement all 15 ORG09 source fields, separately published ORG09_CORE_V1, permanent hospital-wide codes, independent properties/bindings/suspension, CREATE/REVISE/REBIND/SUSPEND, immutable B/R history, same-R full-period Department/Campus/source admission, independent verification and approval, atomic Apply/audit/outcome/replay, CSV/JSON/XLSX and finite NURSING_UNIT impact integration.

Administrative real Departments are legal managers without clinical service relations. Registered PLANNING/SUSPENDED campuses permit CORE identity while retired periods do not. REBIND preserves nursing identity and atomically ends the source binding. SUSPEND persists until a later explicit P3-11 restoration; future properties/bindings cannot reactivate it. Non-expanding suspension permits invalid upstream dependencies but still requires current permission, head and independent approval.

care_level is nullable text. Source IDs/versions/status/record times remain evidence, never platform authority. FULL is retained and BLOCKED_DEPENDENCY; core publication does not establish nursing readiness, policy adoption or hospital acceptance.

AC02/03 and the core portion of AC05 must pass. AC01 multi-ward coverage and AC04 actual coverage impacts, plus coverage portions of AC05, remain NOT_RUN pending P3-05. Ward, location-use, beds, Person/responsibility, personal rosters, restoration, permanent retirement, new UI and actual restart are out of this ticket.

Require fresh, populated 0161 upgrade, type/codegen/contracts/build/boundaries, restricted SQL/HTTP, retained database preservation/deployment, affected regressions and independent fixed-tree Spec/Standards review. Preserve original RED/failures and later GREEN. One local completion commit and ignored exact commit/tree handoff. No fetch/push/PR or following ticket.

Implementation: synthetic CORE is implemented. Fresh and populated predecessor upgrade
pass 28/28; the upgrade also preserves a pre-existing generic ORG09 contract while
publishing the separately approved Nursing CORE revision. The 14 affected regression
checks pass. Retained OID206108 stays fixed at prefix0163, with original facts, keys and
ledger preserved; actual workbench generated-client publication, replay, MATCHED
reconciliation and current-access rejection pass. Independent Spec/Standards review,
final command receipts and exact local commit/tree are indexed in the ignored handoff.
The coverage-specific AC portions, FULL, hospital policy adoption, formal acceptance,
new Nursing page and actual service restart retain their separate pending states above.

## Comments

- 2026-10-04: The user authorized pushing, opening PR30, repeated `@codex review`
  and repairs, merging only after current-head review/checks pass, fast-forwarding
  local main, cleaning redundant branches/worktrees and updating the handoff.
  This supersedes the original local-only stop instruction; adjacent tickets and
  all pending acceptance boundaries remain unchanged.
- PR30 review round 1 found a future binding fully masked by earlier suspension
  exposed a reversed Department impact interval. A generated-client real HTTP RED
  reproduces it. Forward migration0164 retains the original accepted interval,
  exposes an empty current interval and marks the reference historical. Fresh and
  populated0161 upgrade now pass29/29, and startup gates pass210/210. The original
  head CI also exposed two legacy completed-disposition fixtures missing the new
  NURSING_UNIT dependency; their input lists are extended without weakening the
  disposition gate. Exact publication review/CI/deployment outcomes are recorded
  in the ignored handoff rather than inferred from these implementation notes.
- 2026-10-05: PR30 review round2 identified outstanding nursing obligations after
  a finite Campus assessment window has ended. A generated-client real HTTP RED
  reproduces the equality boundary. Forward migration0165 preserves historical
  activity while clearing outstanding obligations for ended windows and reuses
  one observation time. Its fresh suite passes30/30, including future finite and
  unbounded windows retaining their obligations; startup gates pass210/210.
  Head addc5f7's 14 local regressions and both hosted CI workflows passed. The
  later head's upgrade/deployment, review and CI must still complete before merge.
