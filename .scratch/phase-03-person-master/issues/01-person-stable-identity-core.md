# PV-006-A-01 — Person Stable Identity & Subject Core

Status: ready-for-human
Execution: DONE on the sole validated completion commit

Implement stable subject plus immutable identity versions; canonicalName and
optional birthDate only. Use existing UUIDv7, RequestContext, TransactionRunner,
object authorization and append-only audit. Native migration 0020, generated
database types and explicit Person module table ownership are required.

Authorized test seams: Person public internal application/contract and native
PostgreSQL constraints. Prove atomic first version/audit, request retry identity,
non-reuse, immutable history, monotonic concurrent version creation, Unicode and
date validation, scope rejection, business/record-time reads, and reopen recovery.
Direct database probes are explicitly required by the user for constraint proof.

No HTTP/Browser API, projection, release/consumer registration, identifiers,
source mappings, engagements, assignments, roles, credentials, IAM or patient
binding. No real data, formal ABG, AR-07, containers or browser acceptance.

Gate: real PostgreSQL integration, units, inherited relevant regressions,
lint/typecheck/layout/boundaries/database authority, frozen OpenAPI/client and
seven canonical artifacts, independent Standards/Spec reviews with zero blockers,
complete resource cleanup. If live DB unavailable, BLOCKED and no final commit.

## Comments

Initial preflight blocked before implementation; files changed 0, commits 0.
R1 refreshed the source snapshot. Final delivery must separately report command
execution history and read-only remote facts. No investigation of PV-005 actor.
