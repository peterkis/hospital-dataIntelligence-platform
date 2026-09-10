# PV-005-C-04 — Consumer Operational Metrics

START_HEAD: `6c8b4e43cc6daf8aa5c52a8258b875fd3317b4b7`.
Branch: `prototype/phase-02-department-master`; opening index/worktree clean;
C-01 SDK, C-02 Replay and C-03 Audit DONE verified. Upstream behind/ahead 0/0;
local origin/main behind/ahead 0/58. No fetch/push.

Implement the user C-04 acceptance matrix: committed publication count with no
rollback/retry inflation; APPLIED success distinct from snapshot/HTTP/report;
callback failure; content/schema/processing digest failure; normal/replay modes;
dry-run excluded; true time-based checkpoint lag; ACTIVE configured SLA only;
bounded aggregate labels, no identifiers or secrets, restart recovery.

Reuse Release/Receipt/Checkpoint/Lifecycle/SLA/Replay/Audit. Search existing
observability first. Minimal platform endpoint only, existing prototype posture;
no monitoring stack, alert integrations, clinical consumers or adjacent domains.
Preserve Department Browser, canonical digests and seven artifact bytes.
Run inherited suites and both Master/Hierarchy complete C-chain E2E, invalid
pairs/objects/owners/principals/isolation/digests/lifecycle negatives. Independent
Standards and Spec review. Record every command/result and close resources.
One local commit: `feat(observability): add release consumer metrics`. Then stop.
