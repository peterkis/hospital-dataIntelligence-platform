---
status: accepted
clarifies: 0074
extends: 0089
---

# Consumer SLA uses immutable subscription versions and absolute durations

PV-005-B-03B places SLA metadata on the existing immutable consumer subscription version, outside Department payloads and canonical digests. Operational status derives from that policy, subscription lifecycle, assigned releases and verified APPLIED/checkpoint facts; the owning service principal remains the responsibility reference.

ADR-0074 storage and Asia/Shanghai API display remain unchanged. PostgreSQL explicitly interprets existing local values with `AT TIME ZONE 'Asia/Shanghai'`, then extracts exact Unix microseconds for absolute duration arithmetic. B-03B authorizes this narrow operational time boundary; it introduces no timezone column, naive datetime subtraction, host-timezone parsing or cross-stream ordering. See [PostgreSQL time functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT). Stream sequence remains authoritative. Historical local values cannot recover ambiguity their source never recorded.

Success time uses the server-recorded first valid APPLIED receipt for the checkpoint release. Client `processedAt` remains receipt evidence and cannot set operational success time. Checkpoint advancement now records platform time consistently on insert and update; replay of an applied release does not advance it. No materialized last-success field is added.
