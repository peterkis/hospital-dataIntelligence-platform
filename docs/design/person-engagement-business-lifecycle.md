# PV-006-B-03 — Person Engagement Business Lifecycle

Task: PV-006-B-03. Status: local engineering validation complete; DONE becomes
effective with the sole completion commit after fresh final-candidate Standards
and Spec approval.
Classification: **SYNTHETIC / NON_PRODUCTION**. Time zone: **Asia/Shanghai**.
PV-006 remains IN_PROGRESS. This slice does not establish formal acceptance,
production readiness, full Person Master completion or real hospital policy.

## Authority and state boundary

ADR-0045 separates Engagement business state from governance workflow state.
ADR-0115 fixes the derived-state implementation: a business state is a query
result, not mutable authority. The existing `PERSON_MASTER` governance object
may remain `ACTIVE` while any number of its Engagements are PLANNED, ACTIVE,
SUSPENDED or ENDED. No lifecycle command changes `governance_object.status`, a
workflow status, Person subject facts or Person stable identity.

| Concern | Authority |
|---|---|
| Person identity | `person_subject`; no employment or lifecycle field |
| Stable formal relation | `engagement`; one permanent Person binding |
| Relation business period | immutable `engagement_version` |
| Suspend/resume evidence | append-only `engagement_lifecycle_event` |
| Governance draft/review/publish/invalidate | existing governance/workflow modules; unchanged |
| Business state | derived for explicit `businessAt + recordAsOf` |

The closed business-state set is exactly `PLANNED`, `ACTIVE`, `SUSPENDED` and
`ENDED`. `INACTIVE`, `DISABLED`, `TERMINATED` and `EXPIRED` are not aliases.

## Derived-state model

`getEngagementBusinessStateAsOf` first selects the highest Engagement version
with `recorded_from <= recordAsOf`. It then applies the following precedence:

1. `businessAt < businessValidFrom` → `PLANNED`.
2. non-null `businessValidTo <= businessAt` → `ENDED`.
3. otherwise select the latest lifecycle fact visible at `recordAsOf` whose
   `businessEffectiveAt <= businessAt`, ordered by business-effective time and
   then per-Engagement sequence.
4. the applicable `SUSPENDED` fact → `SUSPENDED`; no fact or `RESUMED` → `ACTIVE`.

The result carries the selected `engagementVersionId`, optional
`lastApplicableLifecycleEventId` and record-visible `lifecycleSequence`. It
does not return or populate a cached status row. An Engagement not yet known at
the requested record time fails with bounded `ENGAGEMENT_NOT_KNOWN_AS_OF`.

## Lifecycle commands and evidence

The lifecycle seam is `EngagementLifecycleApplication`:

```text
getEngagementBusinessStateAsOf(...)
suspendEngagement(... expectedLifecycleSequence ...)
resumeEngagement(... expectedLifecycleSequence ...)
endEngagement(... expectedCurrentEngagementVersionId ...)
```

Suspend and resume append one row containing an opaque event ID, Engagement and
governance scope, closed event type, business-effective time, database record
time, positive per-Engagement sequence, human actor, request ID, bounded reason
code and operation hash. It deliberately contains no Person, Department,
Assignment, Role or Credential snapshot. UPDATE, DELETE and TRUNCATE are blocked
by database triggers and revoked privileges.

Suspend is accepted only inside the known relation period while the derived
state is ACTIVE. Planned, already suspended and ended relations fail closed.
Resume is accepted only while SUSPENDED. POC V1 rejects pre-start scheduled
suspension rather than creating a future workflow.

## End, correction and later re-engagement

`endEngagement` does not append an `ENDED` flag. It appends the next immutable
Engagement version with the same business start and an end boundary, using the
bounded internal revision reason `LIFECYCLE_END`. It accepts ACTIVE or SUSPENDED
relations, requires the expected current version and refuses an end before the
start, an already ended relation, or an end that would strand a same-time or
future lifecycle fact outside the shortened period.

An erroneous historical end date is repaired only with the existing explicit
`VALIDITY_CORRECTION`, expected-current-version guard and append-only version
history. The old `recordAsOf` can still return ENDED while a later `recordAsOf`
returns ACTIVE for the same business time. A revision whose new period starts at
or after the previous end is rejected as
`ENGAGEMENT_ENDED_REOPEN_FORBIDDEN`; a true later re-engagement therefore uses a
new create command and a new Engagement ID. The explicit correction authority
must not be used to disguise a real later relation.

## Bitemporal and late-arriving evidence

Lifecycle record visibility is `recordedAt <= recordAsOf`; business applicability
is `businessEffectiveAt <= businessAt`. A later-recorded suspension may therefore
change a past business-time answer from ACTIVE to SUSPENDED only for later
record-time queries. The prior query remains reproducible because the old event
set and period versions are never overwritten. Event sequence records append
order; business-effective ordering determines which visible fact applies.

## Overlap interaction

B-02 remains the sole owner of the versioned overlap matrix. Suspension never
removes an Engagement from overlap evaluation in POC V1, so a suspended relation
continues to occupy its full business period. Ending appends a shorter business
period; a later new Engagement beginning at the new half-open end boundary no
longer overlaps. No B-02 rule or classification is changed by B-03.

## Authorization, human actor and audit

Lifecycle access uses independent permissions:

```text
PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ
PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE
```

Core, Identifier, Source Mapping, Classification and Overlap permissions do not
imply lifecycle access. Mutation also requires an active human `PERSON` security
principal; a service identity cannot stand in for that actor. Successful facts
and reads append `PERSON_ENGAGEMENT_SUSPENDED`, `PERSON_ENGAGEMENT_RESUMED`,
`PERSON_ENGAGEMENT_ENDED` and `PERSON_ENGAGEMENT_BUSINESS_STATE_READ` audit
events in the business transaction. Rejections use a bounded lifecycle event.
Audit contains opaque platform IDs, state/reason codes and sequence/version
references, never relation-basis, contract, employee or external source values.

## Idempotency and concurrency

Lifecycle-event requests are unique per Engagement and request ID. Same request,
actor and payload returns the original event or original bounded rejection; a
changed payload conflicts. Rejected outcomes use an append-only, bounded
`engagement_lifecycle_rejection` replay authority so a failed request ID cannot
later be repurposed. Request reuse is checked across event, rejection and every
later Engagement-version row, including ordinary correction/extension. The
stable Engagement row serializes suspend/resume/end. Two suspend commands based
on the same sequence produce one event and one stale result. Suspend/end and
resume/end races cannot strand an event at or beyond an end boundary: only the
first compatible mutation commits and the other fails closed. `endEngagement`
uses the immutable version request key for equivalent retry behavior.

## Migration and restart proof

Migration `0025_person_engagement_business_lifecycle.sql` adds the lifecycle
table, constraints, indexes, permissions and lifecycle end revision reason.
The first live application probe exposed SQL NULL three-value behavior in its
end-version guard. Rather than rewriting the applied history,
`0026_person_engagement_lifecycle_guard_correction.sql` replaces that guard and
adds the end/event boundary check. Final Spec review then identified that rejected
requests also require replay authority; next-free migration
`0027_person_engagement_lifecycle_rejection_idempotency.sql` adds an append-only
bounded rejection ledger and cross-table request-conflict guards. The next review
found that version-side checks had to cover ordinary revisions and lock before
cross-table inspection. `0028_person_engagement_lifecycle_serialization_guard.sql`
replaces them with one stable-row-first guard for every non-V1 version and rejects
a second ordinary end after the prior boundary has elapsed; next-free 0029 removes
the two superseded functions. Final database-authority review then found a
stable-before-V1 insertion window; `0030_person_engagement_lifecycle_v1_guard.sql`
requires V1 before event or rejection evidence and applies cross-table request
checks to V1 itself after stable-row locking. All six are native sequential
migrations and generated Kysely types remain database-derived.

Restart validation must capture PostgreSQL start time and immutable IDs/counts,
stop the actual service, then use a new pool after a changed start time to
recover period versions, lifecycle events, derived ACTIVE/SUSPENDED/ENDED states
and both late-suspension and corrected-end old/new record-time query pairs.

The final PostgreSQL 18.6 proof stopped the service to an `inactive` state with
the application check returning `ECONNREFUSED`, restarted it to a changed
postmaster start time, and recovered the exact receipt through a new pool. The
temporary receipt and its empty directory were then removed. The lifecycle event
table exposes 24 constraints, four non-internal triggers and five indexes; the
rejection replay table exposes 19 constraints, three triggers and three indexes.
Database-derived Kysely types cover 81 tables and forbidden timezone types are zero.

## Acceptance matrix

```text
plannedDerived = true
activeDerived = true
suspendedDerived = true
endedDerived = true
businessStateNotStoredOnPerson = true
businessStateSeparatedFromGovernanceState = true
suspendAppendOnly = true
resumeAppendOnly = true
endCreatesImmutableEngagementVersion = true
endedOrdinaryReopenBlocked = true
reengagementRequiresNewEngagementId = true
lateFactBitemporal = true
recordAsOfHistoryPreserved = true
lifecycleConcurrencySafe = true
multipleEngagementStatesIndependent = true
suspensionDoesNotReleaseOverlapByDefault = true
personCoreUnchanged = true
identifierRegistryUnchanged = true
sourceMappingUnchanged = true
classificationRulesPreserved = true
assignmentAbsent = true
credentialAbsent = true
openApiUnchanged = true
generatedClientUnchanged = true
departmentFrozen = true
forbiddenTimezoneTypes = 0
restartPersistenceObserved = true
```

## Frozen surfaces and next boundary

B-03 adds no public HTTP route, OpenAPI operation, generated client behavior,
projection, release or consumer support. Department Master V1, Department
Hierarchy V1, seven canonical artifacts and 15 Department Browser paths remain
frozen. Assignment is the next possible Person slice but remains NOT_STARTED;
this design introduces no campus, Department, placement, role or credential fact.
