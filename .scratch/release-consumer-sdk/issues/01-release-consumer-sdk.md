# PV-005-C-01 — Extract and verify Release Consumer SDK

Status: ready-for-agent

## Acceptance

- Follow npm workspace/ESM convention; public export and positive/negative compile tests.
- Generated Client owns HTTP; SDK owns validation/receipt/checkpoint protocol;
  adapter owns atomic business application and local recovery persistence.
- Exact identity → content digest → exact projection/version → schema digest →
  envelope → payload validation → callback → APPLIED → checkpoint closure.
- Retain Sim Consumer's 20 safety behaviors, synthetic state and failure injection.
- Real PostgreSQL/Fastify verifies both Department pairs and three process restart
  windows; apply once, recover receipt/checkpoint, filter older events.
- Stable lifecycle/access/errors; safe output; no scheduler/provisioning/replay CLI.
- Preserve seven canonical artifacts, OpenAPI, existing generated client and migrations.
- Run all inherited B-series gates, relevant existing suites and SDK checks;
  close resources, commit once locally, no push, stop.

## Comments

2026-09-04: Started with clean branch and actual HEAD recorded in the specification.
Prior B-series container/formal acceptance exclusions remain distinct from this
synthetic prototype validation. Completion and final results will be appended.


2026-09-04: Execution DONE. SDK 47/47, inherited Sim Consumer 20/20, API 347/347,
verification tooling 714/714 and freeze/evolution 20/20 passed; all recorded
acceptance commands exit 0. Real Master/Hierarchy process restart and receipt
recovery passed. Canonical artifact and OpenAPI deltas are zero. Resources closed.
Exactly one local delivery commit is authorized; no push and no adjacent work.
