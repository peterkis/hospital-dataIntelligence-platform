# Human maintenance MVP — M1-B

Status: ready-for-human

Latest authorization, 2026-10-11: the human explicitly requested committing and pushing the completed M0/M1 work to the current feature branch. This supersedes the earlier commit/push stop for publication only; it does not authorize PR creation, merge, M2, later phases, or history cleanup. User attachments, database-design documents, the unchanged local DESIGN.MD, and runtime evidence stay local.

Latest UI delivery: New Unit now has a directly reloadable, grouped CREATE draft form; Department opens an authorized accepted-record table; Organization/Campus opens the existing actual read flow within the shared shell. Navigation preserves actor, including an unlisted organization actor without falling back to maker. Final browser checks at the actual 4317 entry passed draft save/refresh, reference reading, focus return, identity isolation, 1366/1280/1024 layout, and served JS/CSS hash checks. One synthetic private CREATE draft was saved; complete CREATE submission/approval/Apply and other-object write workflows remain NOT_RUN. Evidence: `.runtime/product-mvp/M1/20261011-163037-20384-navigation/RESULT.md`. No Owner/DDL/grant changes were made in this UI continuation. Current status remains ready-for-human; publication is not business or clinical acceptance.

Current authorization: 2026-10-11, implement M1 after M0. Only M1-A (business-unit reading, search and side peek) is executed before the human confirms the screen. M1-B and M2–M7 remain NOT_RUN. No commit/push/merge/history cleanup.

Baseline: branch `codex/human-maintenance-workbench`, HEAD `b4307686087040fd80a153a1cbe47e407ed491c4`, existing uncommitted M0 and user changes preserved. Root DESIGN.MD remains unchanged and authoritative.

Scope: one unit-specific workbench reader, compact navigation, read-time reference loading, existing Owner list search/state filters, explicitly labelled registration names for inactive objects, generated contracts and finite targeted tests. No DDL, grants, new search infrastructure, business save or approval changes.

Execution result: code/build/type/contract checks and real retained-DB HTTP checks pass. Browser script creation was blocked twice by the tool (safety status could not be determined), so browser execution, screenshots, responsive/focus verification and human visual acceptance remain BLOCKED/NOT_RUN. Do not mark M1-A accepted or proceed to M1-B.

Result and restart entry: `.runtime/product-mvp/M1/20261011-121910-8692/RESULT.md`. All controllable new output is on D; the existing contract verifier also writes to `.runtime/vnext/current-contract/`. The owned DB/API session closed successfully, retaining the development database.

Continuation, 2026-10-11: completed the remaining M1-A browser reading and layout checks using installed Chrome and the real Owner/API/database. Fixed scoped state-tab/detail-heading CSS, replaced unavailable association UUID labels with an explicit unreadable-name message, and separated HTTP401/403 permission denial from permission transport failure. Search beyond the first page, keyboard search, non-modal peek, full/direct/reloaded detail, history reading, list focus/scroll restoration, 1440/1366/1280/1024 layouts, empty results, read transport failure/retry, identity and governance-scope isolation passed. Two representative final screenshots are available; historical failed attempts are retained. No business write calls were made. Existing NOT_EFFECTIVE fixture count remains zero, so real inactive-detail presentation remains NOT_RUN. M1-03 through M1-07 write scenarios, keyboard editing in M1-08, M1-B and M2–M7 remain NOT_RUN.

Current status: ready-for-human, waiting for explicit screen and layout confirmation; automated checks do not supply that confirmation. Current result and corrected-build restart entry: `.runtime/product-mvp/M1/20261011-125006-18172-browser/RESULT.md` and `start-workbench.ps1`. The earlier blocked browser record above is preserved as history. Stop at M1-A.

## M1-B — current authorization and delivery, 2026-10-11

The human confirmed the M1-A layout and requested continuation, then explicitly authorized generating synthetic basis material. The earlier M1-A stop and BLOCKED/NOT_RUN entries above are historical; they remain preserved.

Scope: one existing UNIT property revision, using the existing protected-material, private draft, submission, independent receiving verification, frozen candidate, approval, Apply, recovery and reconciliation APIs. No domain/DDL/grant changes or new dependencies. The editor binds immutable identity, code, relationships, precise period and accepted head automatically; the operator edits name/phone/service description and provides a reason. Server draft409 preserves input and requires an explicit merge. Unknown results lock navigation and retain original request locators. API/body caches remain separated by identity and governance scope.

Actual retained synthetic DB/browser result: unit `01a10635-881d-7355-b912-7e798c13446b`, code `TEST_4163f57e-3511-4604-b584-295a7b578daa`, changed phone and service description through maker submission and reviewer verification/approval. Apply executed once, its response was intentionally dropped, and refresh recovered the original request via resume/reconcile/readback. Head1→2 and history1→2; stable ID, code, prior-version hash and binding hash preserved. Clinical readiness remains NOT_READY.

PASS: current frontend type/build, 17 targeted tests (3 new adapter tests +14 existing shared UI tests), module boundaries, static routing, real browser draft save/refresh, two-session409/explicit merge, draft ACK loss/recovery, independent material read/verification/approval, same-person alias and unauthorized-write rejection, Apply ACK loss/refresh/recovery, keyboard search/edit, four widths, direct/reloaded detail, returned filter/focus, NURSING read-only smoke, final artifact hashes and screen checks.

NOT_RUN: strict UNIT READ-without-WRITE subject (no such existing fixture; no grants added), live permission revocation, native target-head conflict at Apply (private-draft version409 tested), every alternate receiving-rule/FULL/create/rebind path, production/clinical acceptance, M2–M7. Kernel write closure passed; these gaps must not be relabelled PASS. Unknown VERIFY/MATERIAL requests after a refresh lack a dedicated existing request-result query; the UI keeps their locators and prevents new requests rather than claiming unsupported restoration. Automatic recovery for those cases was not validated.

Current outcome: ready-for-human for business operability confirmation. Evidence, preserved failures, two final representative screenshots and current-build startup: `.runtime/product-mvp/M1/20261011-134109-12772-maintenance/RESULT.md` and `start-workbench.ps1`. No commit/push/merge/history cleanup. Stop after M1-B.
