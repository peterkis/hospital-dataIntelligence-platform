# PV-006-C-02 — Assignment Purpose / Mode & Scoped Primary Affiliation

Status: ready-for-agent
Phase: DONE (effective only on the sole reviewed local completion commit)

Authority: user C-02 1.1.0-local-only revision and explicit existing-edit resume authorization; source prompt is
`D:\Agent-Prompts\PV-006-C-02-local-only\PV-006-C-02-assignment-purpose-mode-primary-affiliation.local-only.prompt.md`.
Branch `prototype/phase-03-person-master`, START_HEAD
`8490afa128bf5b4a72a4cdb9fe29672e4f1fba03`, START_TREE
`a30783e06179eb9979492ce3af2ed152b8421da1`.

Only independent versioned Purpose/Mode, exact AssignmentVersion pairing,
explicit adoption/correction, and scoped at-most-one primary affiliation are
authorized. SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY; Asia/Shanghai.
All 63 cases in the source prompt are mandatory; NOT_RUN is not passing evidence.

Design: `docs/design/person-assignment-purpose-mode-primary-affiliation.md`.
Evidence coordinator: `.runtime/pv006-c02/resume-20260907-r1/`.
Current local-only coordinator: `.runtime/pv006-c02/local-only-20260907/`.

One local completion commit only, after real PostgreSQL, concurrency, fresh,
restart, regression, frozen contracts and exact-tree Standards/Spec approval:
`feat(person): add assignment semantics and scoped primary affiliation`.
No push; C-03 and D–G remain NOT_STARTED.

## Comments

The first preflight stopped on a Schannel TLS failure without implementation,
database startup or edits. R1 re-ran the actual git ls-remote command and observed
the exact authorized SHA, exit 0. Local branch/head/tree and clean worktree also
matched. PREVIOUS_PRECHECK_STATUS=BLOCKED_REMOTE_VERIFICATION_UNAVAILABLE;
RESUME_PREFLIGHT_STATUS=PASS. No alternate remote authority or Git configuration
change was used.

Implementation and validation are in progress. The initial missing-capability
RED and subsequent scenario runs are retained separately; no completion status
or global 63-case PASS is asserted yet.

2026-09-07 local-only revision replaces the task's real-time remote requirement.
Local HEAD/tree matched, but existing C-02 edits triggered the clean-worktree stop.
The user explicitly authorized resuming those edits. No reset/stash/clean is used.
REMOTE_VERIFICATION=NOT_PERFORMED_BY_SCOPE; external project requests remain prohibited.

Local engineering gates passed: final C02 application 21 groups, SQL 6 groups,
fresh 0001–0034 / 88 tables and schema/type equality, real C01/C02 restart and
negative recovery, all 25 regression commands, 19-table preservation and frozen
assets. Candidate matrix: `.runtime/pv006-c02/local-only-20260907/acceptance-precommit.json`.
The four review/commit entries remain pending in that candidate receipt; completion
is effective only after same-tree independent review and the single local commit.
Final receipts use `acceptance-final.json`, `reviews.json`, and `post-commit.json`
in that coordinator. C and PV-006 remain IN_PROGRESS; C-03/D–G remain NOT_STARTED.
