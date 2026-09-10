# PV-006-B-04 — Engagement Temporal Authority Reconciliation

Status: ready-for-human
Execution: local engineering validation complete; DONE effective only with the sole B-04 commit after final-tree Standards/Spec approval

Authority: user PV-006-B-04 prompt and its acceptance-matrix.md under
`D:/Agent-Prompts/PV-006-B-04/`. Only B-04 is authorized. No push or PV-006-C.

The original domain authority is `c1abe02edab1a7ebfc64c207a96e3bfc5526620e`.
The user separately authorized persistence of four database startup tools in
`fa61dc79f0f4298629e4d5c6340f99455c99be98`, then explicitly resumed this task.
That tooling commit is the current execution baseline, tree
`de075b5f66efa1ce31471719f994ff0102ce4263`. Opening worktree was clean; live
remote Person tip remained the original domain authority. No application or
migration differences from that authority were present before reproduction.

## Comments

Subsequent user authorization explicitly permits the WSL postgres OS-user peer
path for task-owned database creation. Fresh run
`47b229bb-e701-42e5-b028-99116952d620` passed all 30 migrations and 81-table checks
as hdi_prototype, without granting CREATEDB to it, and cleaned only its receipt-owned
DB. The earlier permission blocker below is resolved; its failure evidence remains.
Implementation and detailed gate status are tracked in
`docs/design/person-engagement-temporal-authority-reconciliation.md`.

On 2026-09-05 (Asia/Shanghai), executed:

```text
node node_modules/typescript/bin/tsc -p tooling/prototype/tsconfig.json --noEmit
npm run prototype:db:with -- prototype:person:engagement-temporal:baseline
```

Focused compilation exited 0. The actual PostgreSQL application baseline
probe and wrapper exited 1: RP-01/IN-01 expected FORBID rejection but the create
path committed a second overlapping relation. The point query selected R2,
version 2/FORBID, recorded at `2026-09-05T15:13:11.587239`; the intersection was
`[2026-06-01T00:00:00,2026-09-01T00:00:00)`. This is a real RED, not source inference.
The run used a unique synthetic type pair and newly created synthetic Persons,
without changing existing default rules or relaxing permissions/guards.

EA-01/02 baseline observations confirmed historical V1 versus lifecycle V2/ENDED,
old-R V1/ACTIVE, and unchanged original V1 columns. EA-03/04 confirmed historical
V1 versus corrected V2/PLANNED and V2/ENDED. These observations do not satisfy
the full EA acceptance cases: the new effective reader is not implemented.

Evidence directory:
`.runtime/pv006-b04/d2afe1c0-9e9d-4ca6-bb1b-6c9a9a6e3eda/`.
`baseline.json` preserves exact IDs and database-returned record timestamps.
`acceptance-results.json` distinguishes RED and NOT_RUN with partial observations.
The previous actual CREATE DATABASE failure (SQLSTATE 42501, database absent
before and after) remains under `.runtime/pv006-b04/20260905T144249/`.

The same managed session confirmed `hdi_prototype`, 30 migrations, and
`can_create_database=false` (neither CREATEDB nor superuser). The configured
runbook provides startup/cleanup, not an authorized empty-database bootstrap.
Prompt section 16.2 requires BLOCKED_CLEAN_INSTALL_VALIDATION for this missing
capability. Resuming completion requires an authorized task-scoped empty-database
creation/bootstrap path. No elevated role or unrelated credentials were used.

The application pool closed; wrapper cleanupPassed=true, service inactive,
database unreachable, and its owned distribution terminated. The nonzero
service-stop command exit (1) is retained separately from observed successful
cleanup. Created synthetic cohort evidence is preserved. No temporary database
was created in this resumed run.

At the initial baseline stop, no runtime fix, DDL, effective reader, fresh migration
chain, actual-restart recovery, full regression suite or final review was claimed.
B-01/B-02/B-03 historical DONE evidence remains unchanged. The B-04 supplemental
gate is OPEN/BLOCKED; C-G remain NOT_STARTED. No B-04 completion commit exists.

Subsequent closeout: the implementation, fresh schema/type/seed/application proof,
actual restart, five negative recovery cases, 19-command full regression chain,
15-table immutable fingerprints and frozen artifacts have now passed. The earlier
OPEN/BLOCKED statement above is historical. See the B-04 design final evidence
table and `.runtime/pv006-b04/final-e49d46d3/acceptance-results.json`.
The B supplemental engineering gate is PASS; final reviewed-tree approval and
the sole local completion commit activate DONE. C-G remain NOT_STARTED and
NEXT_PHASE_EXECUTION_AUTHORIZED=NO. No push is authorized.
