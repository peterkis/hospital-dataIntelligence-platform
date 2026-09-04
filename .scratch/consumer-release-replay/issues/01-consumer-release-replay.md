# PV-005-C-02 — Consumer Release Replay CLI

Status: ready-for-agent

Acceptance: the user-provided C-02 matrix and `../spec.md`.

## Comments

2026-09-04: Preconditions verified and START_HEAD recorded. Work is restricted
to the exact-release CLI and the SDK/API seams necessary for safe replay.

2026-09-04: Execution DONE. Final 14 commands exit 0; SDK 65/65, CLI 4/4,
Sim Consumer 20/20, API 348/348, verification 714/714 and canonical freeze 20/20.
Real Master checkpoint 221 remains 221 when replaying 220; Hierarchy 82 remains
82 when replaying 81. Exact receipt IDs and hash-chained audit history persist
after restart. Dry-run zero mutation, lifecycle/digest refusals and safe output
passed. Resources closed and synthetic PostgreSQL evidence retained. The complete
31-file report is `docs/design/consumer-release-replay-cli.md`. One specified
local commit only, no push; stop after delivery.
