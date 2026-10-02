# P2-06 Department impacts — design and verification index

This document records the implemented design and its acceptance mapping. The exact completion commit/tree, final review and command results belong to `.runtime/vnext/p2-06/handoff.md`; synthetic engineering checks do not establish formal acceptance.

The approved plan connects finite reverse references, immutable assessments, evolution approval/application, independent Owner dispositions and synthetic handoff receipts. It reuses Department and Catalog public transaction ports and the existing serialization lock. The source requirements are P2-06 AC-01 through AC-05, Q15 and A017; ORG26/27's 17 fields remain owned by P2-05.

## Boundaries

Current Owners cover hierarchy snapshots, source mappings, identifiers and evolution evidence. Personnel, units, wards and external systems remain NOT_EVALUABLE. Historical accepted references are different from current admission. Snapshot names, trees and exact references are frozen. A change assessment cannot execute a downstream command.

Reviewed pending dispositions do not block master-data effectiveness. Unknown/manual evidence gaps do. Unapplied old candidates need new assessment and approval; already committed outcomes remain recoverable under current authorization.

## Verification

Approved seams: public Owner, real loopback HTTP and actual PostgreSQL application roles. Database runners use `npm.cmd run prototype:db:with -- <script>`. Success requires ready, target exit 0 and cleanupPassed=true. Raw command results are retained under ignored `.runtime/vnext/p2-06/`.

- Initial public assessment test: missing capability RED, then available references versus NOT_EVALUABLE GREEN.
- Temporary-task whitelist and schema inventory failures are engineering setup failures, not business RED.
- AC-01: rename preserves Department identity and original exact references; `CHANGED + SATISFIED` is independent of the retained snapshot. Public Owner database test and frozen STATISTICAL comparison.
- AC-02: existing P2-05 admission tests cover new/expanded references after exit. P2-06 links accepted mapping shrink/withdrawal results; partial old or new relationship periods remain open. Permanent codes remain reserved.
- AC-03: ADR-0133 permits only `STATISTICAL / FROZEN_SOURCE`. Public hierarchy publication, subsequent owner-Department rename, exact snapshot equality. FINANCE and unsupported aggregation remain blocked.
- AC-04: real loopback HTTP with two SERVICE consumers. Unanswered, FAILED and PARTIAL outcomes keep OPEN; only all acknowledgements permit SIMULATED_COMPLETED. The original event still reads `handoff: NOT_EXECUTED`.
- AC-05: request replay, no-op recheck, stale expected head and concurrent assignments. No-op commands persist their request identity without appending another case event.
- Upgrade: exact baseline Owner source from `6e16cbd` creates populated 0121 facts, committed and pending approvals before migration. Entire predecessor row digest and keys remain unchanged. Pending old approval fails; fresh approval succeeds; original committed replay succeeds. Explicit late assessment creates `LATER_OBSERVATION` cases without changing original event facts.
- Authorization: exact reference/source and material authorization, natural-person separation, service-only receipts, actual role table-write denial, invalid signatures, rollback at case/audit/outcome, and committed recovery.
- Review regressions: a closed/revoked replacement hierarchy cannot be proved by its former publication candidate; an exact same-meaning hierarchy shrink is a valid closure proof; a mapping semantic retarget is not a closure correction. Public hierarchy responses expose the exact version ID required by disposition proofs.
- Final candidate review and persistent deployment: see the ignored handoff and command index rather than treating intermediate green slices as the completion gate.

## Record and API decisions

Catalog owns immutable assessment/case identities and append-only case events. Department signs a transaction-bound ticket and supplies semantic observations; Catalog never reads the Department key. Finite SQL readers only query Department-owned hierarchy, mapping and identifier facts. A 2,000-reference budget fails explicitly; presentation pagination never cuts the approval basis.

`/api/vnext/department-impacts/` provides assess, assessment read/list, case read/list, assign, disposition, independent approval, recheck, receipt and assigned-service handoff read. Closed TypeBox schemas, generated OpenAPI/client and negative compile examples define the input boundary. Actor identity comes from the development server identity adapter.

P2-05 verification either selects an exact existing assessment or records one before verification. Frozen approval binds the digest, rules, material and complete references. Apply repeats the observation under the shared advisory lock; SQL repeats the reverse dependency comparison. Automatic unsatisfied mapping/hierarchy references conflict with a manual UNAFFECTED declaration. Manual review never changes NOT_EVALUABLE machine coverage.

Q15 evidence is limited to Department evolution and explicit disposition of its supported references. A017 evidence is limited to this finite dependency observation, original snapshot preservation and synthetic handoff. Neither closes P2-08, the whole phase, or real downstream migration.

Formal policy adoption, FULL profiles, maintenance UI, actual restart, real integration and formal acceptance remain separate pending/not-run conclusions.

## Legacy code closure sample

The initial persistent observation had one open predecessor-code obligation. On 2026-10-02 the user authorized ending its identifier assertion at the accepted split boundary, `2026-06-01T00:00:00`. The Identifier Owner appends END, then the impact workflow links that committed result as CLOSE_RELATION, independently approves it and rechecks the case. Original versions, permanent code ownership and the accepted evolution remain intact.

Run `npm.cmd run prototype:db:with -- vnext:p2-06:close-legacy-code --inspect` before `--close`. This receipt-bound sample uses generated clients over loopback HTTP and saves exact requests for recovery. Replaying closure verifies two identifier versions, four case events, zero unresolved cases, pre-boundary resolution, post-boundary non-resolution, old-record-time lookup and old-event replay. Evidence is under `.runtime/vnext/p2-06/legacy-code-closure/`. Do not reopen or delete this history to demonstrate a pending state; use a separate synthetic case.
