# PV-005-C-01 — Release Consumer SDK

Status: ready-for-agent

User-authorized scope: extract the established release consumption protocol into
one reusable consumer-side private npm workspace based on Generated Client;
migrate Sim Consumer, retain recovery and add typed validation failures. No push,
no replay CLI, no server shortcut, no subscription self-provisioning, and exactly
one local commit `feat(consumer): add release consumer sdk`.

Prerequisites verified at START_HEAD `666f0260c7ef67374e725ea07ed2d55948690b59`:
B-03A `733072bc592b82c3ceb0bda4a7be16e2979c64e6`, B-03B
`e366a073692587797472ff96623ef7d586364e78`, B-03C START_HEAD itself; all DONE.
Branch `prototype/phase-02-department-master`; opening index/worktree clean.

Implementation and acceptance: [ticket](issues/01-release-consumer-sdk.md).
Design and command evidence: [design](../../docs/design/release-consumer-sdk.md).
