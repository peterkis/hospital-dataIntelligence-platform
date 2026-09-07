# PV-006-C-03-02 — Atomic assignment transfer

Status: ready-for-agent
Phase: DONE effective only on the sole R1-reviewed local completion commit

Only C-03-02 is authorized. LOCAL_AUTHORITY_NO_EXTERNAL_NETWORK.
SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY / Asia/Shanghai.

Implement same-transaction non-expansive source closure and fresh classified target
admission, residual-period conservation, shared database knowledge time, root replay,
savepoint rollback of deterministic target rejection, and immutable exact receipts.
Authority: external local-only prompt at
`D:\Agent-Prompts\PV-006-C-03-02-atomic-assignment-transfer\PV-006-C-03-02-atomic-assignment-transfer.local-only.prompt.md`.
All 76 cases must have actual evidence before DONE and the sole local commit.
No push; no subsequent ticket is authorized.

## Comments

- Final review of tree 0534ef84e5772bf572b8a42511b43d1289d86b6c found two P2
  blockers: missing pre-implementation RED chronology, and retained shared
  definition mutations in the concurrency probe. Standards found zero blockers.
  These reviews inspected code and producer receipts; they did not rerun a DB.
- Prospective definition races now require a verified receipt-owned fresh DB;
  retained runs record SKIPPED_BY_SCOPE and assert shared definitions unchanged.
  Historical race versions remain immutable. Current-value restoration was
  refused before writes because intervening C02 regression versions were found;
  a verified inspection is retained in run 32963283-b097-4a2d-9586-0d1759e658d6.
- The missing initial RED sequence cannot be reconstructed retroactively. User
  disposition is required; later negative controls remain labelled as later.
  The old 74-PASS engineering matrix is historical evidence, not final acceptance.

- Exact clean preflight matched HEAD 7666716dd24320dbba28cd02400755318e9bee7f,
  tree 733a5f18f800de56859dca3ac976261cb8df9984, parent 9ea890d839721959db0ad3f8f6241489b88d8265.
- First database startup failed due to unrelated WXWork binding fixed port 55434.
  No unrelated process was stopped. User released the port; managed retry passed.
- Original-column baseline: 35 migrations, 89 tables, 23 Person tables protected.
  Initial preservation helper lacked the closure clock column; corrected before
  successful baseline capture. This failure is not application validation.
- Engineering gates passed on migrations 0001–0038: 37 application/SQL/queue/
  temporal groups, all 29 complete regression commands, official fresh chain,
  real restart with all four Assignment recovery layers, invalid-receipt and
  owned-cleanup checks. The original 23-table column/cutoff hashes remain equal.
- Pre-review 76-row proof mapping is
  `.runtime/pv006-c0302/local-only-20260907/acceptance-precommit.json`.
  EV-07/EV-08 activate only through actual independent same-tree review and the
  sole local commit, recorded in ignored `acceptance-final.json`.
- Design and complete evidence index:
  `docs/design/person-assignment-atomic-transfer.md`.
- Completion commit: `feat(person): add atomic assignment transfer`.
  C-03 completion covers only END and this atomic transfer; C and PV-006 remain
  IN_PROGRESS; other C extensions and D–G remain NOT_STARTED. No push or next ticket.

- R1 accepts C0302-DEV-01 once: initial RED remains NOT_PERFORMED; subsequent
  controls and the original finding are preserved. C0302-DEV-02 remains an
  accepted historical scope deviation. The R1 owner append restored only the
  confirmed stable term's label, v27→v28, preserving current business fields,
  every old version and all frozen references. Same-request cross-process replay
  returned ALREADY_RESTORED. No role or schema change was made during R1.
- Current retained probe db27dc02-0638-4655-8931-1ee0f3fd5157: 36 PASS plus
  one SKIPPED_BY_SCOPE, 32 shared definition rows unchanged. Post-isolation
  fresh 37-PASS evidence supplies the skipped race group. Earlier 29-command
  regression/fresh/restart are explicitly reused with content and data-scope
  mapping, not claimed as R1 reruns. All eight R1 commands (including the nested
  six-command lint/typecheck/build/check gates) exit 0.
- R1 proof directory: `.runtime/pv006-c0302/r1-20260908/`; see coverage.json,
  rerun-commands.json and the design's R1 addendum. Original blocked receipts
  remain intact. Actual final same-tree review is review-final.json; final SHA,
  clean-tree evidence and EV-08 activation belong only in acceptance-final.json
  after the unique local commit. Any new blocker prevents that activation.
