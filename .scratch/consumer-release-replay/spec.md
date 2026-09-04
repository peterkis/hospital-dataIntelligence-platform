# PV-005-C-02 — Consumer Release Replay CLI

START_HEAD: `3dcd9e018b6ffe2ca1c0c73cb4aada709de434f8`.
Branch: `prototype/phase-02-department-master`; opening worktree/index clean.
C-01 DONE is recorded in `.scratch/release-consumer-sdk/issues/01-release-consumer-sdk.md`.
HEAD is its sole commit over `666f0260c7ef67374e725ea07ed2d55948690b59`.
Local upstream divergence 0/0; local origin/main behind 0/ahead 56. No fetch/push.

Implement explicit, bounded, idempotent, fail-closed, auditable exact-release
replay. Default is read-only dry-run. Apply requires an explicit operation ID
and reason. The same operation ID identifies retries; a different repair is a
new explicit operation. Preserve receipts, immutable versions/artifacts and
monotonic checkpoints. Only ACTIVE is eligible. No force, rewind, bulk replay,
scheduler, arbitrary SQL, UI, or real HIS/EMR.

Use the C-01 SDK for verification and receipt/checkpoint handling. Its existing
poll records pull attempts and its ordinary apply skips old releases: add a
bounded read-only exact metadata query and explicit SDK replay seam, without
changing ordinary consumption behavior. Subscription versions are resolved from
the delivery's frozen compatibility reference, never the current version.

Tests exercise the requested CLI/SDK public boundaries and real PostgreSQL /
Fastify for Master and Hierarchy, including restart, negative validation,
zero-mutation dry-run, exact receipt reuse and old-release checkpoint stability.
The executable downstream adapter is synthetic/non-production, Asia/Shanghai.
Commit only `feat(tooling): add consumer release replay cli`, do not push, stop.
