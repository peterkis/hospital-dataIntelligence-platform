# PV-006-C-01 — Assignment stable relation and placement core

Status: engineering gates passed; DONE takes effect on the sole validated
completion commit after exact-tree Standards/Spec review has zero blockers.

SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY. All domain timestamps represent
Asia/Shanghai local time. No hospital policy, published Assignment, clinical
eligibility, production readiness or ADR-0050 acceptance is asserted.

## Authority and decisions

Execution authority is the user's
`D:\Agent-Prompts\PV-006-C-01-assignment-core\PV-006-C-01-assignment-stable-relation-placement-core.prompt.md`,
including all 72 appendix cases. START_HEAD is
`8b1721ebb2000435415aa2cfd47c398a258d9f09`, START_TREE is
`c0b3670a893bc40cbad6a9e85ffebd7263819977`, branch is
`prototype/phase-03-person-master`. Preflight at 2026-09-06 23:25–23:27 +08:00
confirmed those exact values, a clean index/worktree, the correct upstream and a
live remote target tip equal to START_HEAD. No fetch was used.

| Source fact | C-01-specific decision, separately authorized |
|---|---|
| ADR-0046 binds each Assignment to one Engagement and separates placement from roles | Only DEPARTMENT placement is implemented here |
| ADR-0046 preserves organization identity and immutable history | Stable Assignment permanently binds its Person, Engagement and exact Department target |
| ADR-0046 freezes dependencies for eventual publication | C-01 saves **acceptance dependency evidence**, with no approval/publication workflow |
| B-04 selects latest record-visible complete Engagement authority before business-time evaluation | Its owner adds a bounded complete-period companion using the same state derivation |
| B-04 SUSPENDED remains inside the Engagement period | Test policy `ASSIGNMENT_DEPARTMENT_CORE_V1` requires every requested segment ACTIVE; a suspension requires review and refuses the mutation |
| Department stable identity, record periods, publication and business status are distinct facts | Exactly one record-visible published ACTIVE version must cover the entire proposed interval |
| Upstream changes do not rewrite historical assignments | Only explicit, single-exact-version read-only assessment is implemented |
| ADR-0074 defines local, timezone-free values | Database and application comparisons preserve microseconds and half-open infinity |

The new choices are not attributed to ADR-0046 as already-established details or
to formal hospital HR policy. No force, override or review-release command exists.

## Internal contract and stable identity

`AssignmentCoreApplication` is separate from Person Core and Engagement. It exposes
only createAssignment, reviseAssignment, getAssignment, getAssignmentVersion,
bounded listAssignmentVersions, and assessAssignmentDependencies. No HTTP or
OpenAPI operation is added.

Create accepts a PERSON_MASTER governanceObjectId, existing engagementId,
`CONFIRMED_DISTINCT_PLACEMENT`, exact DEPARTMENT_MASTER governanceObjectId and
Department stable ID, and a complete proposed interval. Person is derived by the
Engagement owner; callers cannot supply personId. The database generates the opaque
UUIDv7 Assignment ID. Names, codes, hierarchy nodes/groups and campus labels never
select an identity. Same-name Department IDs remain distinct, and separate
requests may establish separate structural placements for the same Person.

Revise accepts assignmentId, expectedCurrentVersionId, a complete interval and
VALIDITY_CORRECTION or CONTINUATION_EXTENSION. Any binding field, state, snapshot,
hash, policy result, approval or client record clock is rejected by closed input
validation. The entrypoint also fixes CREATE versus REVISE; supplying the other
command's shape cannot change which operation executes.

Each version replaces the relation's complete accepted period, directly
supersedes the preceding immutable version, and has continuous versionNo and
strictly increasing database record time. There is no current/effective Assignment
eligibility endpoint, primary flag, default purpose or mode placeholder.

## Three clocks and complete periods

A is the requested non-empty half-open interval `[from,to)`, where null end means
positive infinity. R is captured with platform.local_now() **after** dependency
pins. AssignmentVersion.recordedFrom is generated after R when appending the
version. No JavaScript Date or end-minus-one-millisecond comparison is used.

Containment requires `E.from <= A.from` and either an unbounded E or a finite A
whose end does not exceed E.end. Equal right boundaries are valid; finite parents
cannot cover infinite children. The interval is never clipped to make it pass.
Future placements can be accepted when their complete interval is ACTIVE under
the known authority, even when the current day precedes Engagement start.

The Engagement owner reuses B-04's latest-version resolver and state derivation.
It retrieves the last applicable prefix event and a max+1 bounded set of
in-period events, respects record visibility and effective-time/sequence ordering,
and segments at every known event and authority boundary. It does not sample days
or compare only endpoints. An interior one-microsecond suspension therefore
survives a later resume. The historical-assertion interface is not consumed.

The Department owner first selects its unique record-visible published candidate,
then the consumer checks ACTIVE and complete coverage. It never searches old
ACTIVE versions to repair current failure. Publication identity is the actual
Department published-projection row plus its distinct releaseId. Both publishedAt
and the row's actual creation time must be visible at R, preventing later
publication from becoming known merely because the draft's recordedFrom is old.
Ambiguous source configurations refuse with
ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED. No period stitching or new
Department evolution model is introduced.

Existing Department DTOs are seconds-only. Test publication fixtures follow that
contract and cross a real second boundary before revisions; Assignment and
Engagement interval precision is unchanged. RecordedTo and projection supersession
remain Department record-management metadata, not mutable Assignment evidence.

## Transaction and lock matrix

| Step | Actual lock/snapshot | Conflict or purpose |
|---|---|---|
| Current authorization | Grants evaluated at database server time, active human actor and both governance-object types checked | Replays cannot reuse an old permission evaluation |
| Request replay | Assignment-domain governanceObjectId+requestId advisory transaction lock | Serializes identical and conflicting requests only |
| Revision | Assignment stable row FOR UPDATE | One writer per expected version; the second sees stale |
| Engagement pin | Owner stable Engagement row FOR SHARE | Conflicts with existing end/revise/suspend/resume FOR UPDATE |
| Department pin | Owner current published version row FOR SHARE | Conflicts with existing publication's old-version FOR UPDATE and closure |
| Candidate recheck | Fresh selection after waiting, before R | A switched candidate yields DEPENDENCY_CHANGED_DURING_VALIDATION, never cached success |
| Acceptance | Same PostgreSQL transaction holds both pins through version/segments/outcome/audit commit | No nested root reader or partial success |
| Assessment | Local REPEATABLE READ transaction, same scoped owner readers | Both dependencies share one actual MVCC snapshot; global runner behavior is unchanged |

Assessment read audit is appended in a separate READ COMMITTED transaction **after**
the snapshot closes. A real concurrent-read probe demonstrated that appending to
the shared audit stream inside RR can reuse a stale audit sequence after waiting.
The corrected path retains one snapshot for dependencies and serializes audit on
fresh knowledge. Mutation facts/outcomes/success audit remain one transaction.
Immutable Assignment history reads use READ COMMITTED because their selected rows
cannot change; they do not require cross-owner snapshot composition.
The standalone Engagement-period adapter also appends entity/query read audit
after its snapshot closes and propagates audit failure. Its scoped reader remains
part of the caller's mutation or assessment transaction, without nested root reads.

No new upstream write permission or hospital-wide serialization lock is granted.
The existing audit stream lock is reused by audit and by an observed test barrier;
it is not a new Assignment dependency protocol. Denial audit runs only after the
original transaction has rolled back, avoiding nested lock-owning denial paths.
Deadlock and serialization errors are not stored as business refusals. A caller
may retry the same request; no infinite automatic retry loop is installed.

The real concurrency probes inspect pg_blocking_pids, including transitive tuple
wait queues, before releasing barriers. They test both upstream-first and
Assignment-first order for end and publication, duplicate request replay and
expected-version competition. A separate actual PostgreSQL deadlock verifies
rollback and same-request retry; audit fault injection covers rollback after
business inserts.

## Database authority and evidence

0031 adds four tables: assignment, assignment_version,
assignment_validation_segment and assignment_command_outcome. Source-owner
composite reference indexes enforce Person/Engagement/governance pairing,
Department identity/version/publication/release pairing, classification pairing,
and lifecycle-event/Engagement/sequence pairing. Runtime Assignment SQL does not
read Department private tables.

Stable/V1/segments/success-outcome completeness is deferred to transaction end.
Segments must be ordered, contiguous, non-overlapping, ACTIVE and exactly cover
the complete version interval. UPDATE, DELETE and TRUNCATE are blocked. Version
and request identity, actor, supersession, interval containment and record ordering
are constrained. These are structural safeguards, not a claim that a database
superuser cannot forge source evidence.

A rollback-only negative probe exposed SQL CHECK's NULL semantics allowing
partially absent classification metadata. 0032 preserves applied 0031 and adds
an explicit all-null-or-complete classification guard and finite authority-time
guards. The original failure is retained. No 0001–0030 migration was edited.
Live code generation after 0031 observed 85 tables; final migration/type authority
is validated against the complete forward chain and an isolated empty database.

Each version owns explicit-column evidence: policy, R, complete requested period,
Engagement version/number/record time/period, visible sequence, optional frozen
classification, every state segment/event reference, Department version/hash,
publication projection and release IDs, publication time/status/period, and the
server-generated fingerprint. No arbitrary JSON attributes hold primary facts.

The fingerprint canonicalizes microsecond precision and includes actual semantic
dependencies. It excludes R, request clocks and subsequently closed Department
recordedTo metadata. It is an integrity/comparison marker, not cryptographic
identity verification.

## Replay and exact-version assessment

Actor, operation and canonical complete input participate in the operation hash.
Same-request success returns the original version and evidence without duplicate
success audit, even after upstream change. Same-request terminal rejection remains
rejected after a dependency correction; a new request evaluates new knowledge.
Different actor/operation/target/period conflicts. Current permission checks
precede replay.

Assessment always uses the specified version's original complete interval and
reports referenceComparison separately from constraintResult. Rename/publication
can be CHANGED+SATISFIED; end or Department inactivity can be
CHANGED+NOT_SATISFIED; late suspension is CHANGED+REVIEW_REQUIRED; unresolvable
dependencies are NOT_COMPARABLE+UNKNOWN. Permission errors remain errors.
R before the version's recordedFrom is ASSIGNMENT_NOT_KNOWN_AS_OF. Old versions
carry isLatestAssignmentVersionAsOf=false instead of being silently replaced.

Assessment adds only bounded read audit/authorization observations; it never writes
Assignment business tables, status caches, workflows, notifications or outbox.
History returns the originally stored evidence. Upstream changes are exercised
only on this run's new synthetic cohort.

## Capacity, privacy and validation boundaries

The prototype guardrails are 64 candidate lifecycle facts (with max+1 detection),
128 result segments and 64 KiB dependency evidence, not a production SLA. The
candidate bound itself keeps ordinary reachable segment/evidence sizes below the
latter ceilings. A long irrelevant history prefix loads only its last applicable
fact. A 65th in-range fact refuses; no truncated result passes validation.

Audit/provenance contain opaque IDs, dates, enumerated reasons and bounded hashes,
never names, identifiers, contract/source values, connection strings or secrets.
Grant tests cover each required capability, active human actors, unrelated write
permissions, historical-read-only access and upstream write separation. Compiled
negative consumers keep historical assertions, Browser summaries and client
validation flags out of the effective evidence types; closed runtime tests cover
forged clocks/snapshots and unsupported identity/scoping fields.

Evidence root: `.runtime/pv006-c01/`. The run coordinator is
`20260906T232526/`, containing original preflight and command logs; each application,
fresh/recovery run has an exclusive UUID directory. Before any cohort mutation,
15 existing immutable personnel tables were protected at cutoff
`2026-09-06T23:35:49.048976` by count and SHA-256. The retained evidence database
is hdi_prototype, OID 16389; its application role is neither superuser nor CREATEDB.

Final evidence must include the complete 72-case matrix, exact argv/cwd/exits,
fresh/upgrade/schema/type comparison, actual postmaster restart and original-receipt
recovery, negative recovery/cleanup receipts, all A/B/Department/Consumer
regressions, frozen assets, exact staged-tree Standards/Spec review and resource
closure. No test is marked passed merely because it is listed here.

## Executed engineering evidence

The final retained application run `c2bd2113-1283-469c-b61f-bb22b7b63775`
passed all 33 assertion groups, including both queue orders for end, suspension
and Department publication. Its recovery receipt retains 25 Assignment identities,
27 complete versions and 63 exact-version dependency assessments. The 106 raw
Assignment business rows have SHA-256
`fa759287f128c091f7d6a9ef2fc6f518a32684b775131e6f23ebba54d7eade7c`.
The independent owner oracle exercised 500 inputs, seed 60107, six record views,
four business states and 4,674 integer-point assertions; the pure containment
oracle additionally exercised 1,500 cases. Nine contract/architecture tests passed.

Forward upgrade added migrations 0031 and 0032: 30 to 32 migrations and 81 to
85 tables. The four new tables have respectively 24/65/17/16 constraints,
4/5/3/2 non-internal triggers and 5/7/1/1 indexes for stable/version/segment/outcome.
Live codegen and the zero-forbidden-timezone-type gate passed. Migration 0032
closes a SQL CHECK NULL loophole exposed by a real failing constraint probe;
0001-0030 remain unchanged.

Final fresh run `fadfc6e0-773a-43af-ba30-78050be5bebf` installed all migrations
in a receipt-owned empty database, ran official, Department and Person seeds
separately, matched upgrade schema/types with the existing narrow B-04 normalizer,
and passed the complete application probe. Five cleanup negatives passed and
the owned temporary database was removed. Recovery run
`fa5fa7c1-ffa1-4543-b3d3-8fe347cb02df` used a changed postmaster start time and a
new pool to reread all original versions, raw rows and 63 assessments. Comparison
normalizes only subsequently closed Department observation recordedTo metadata;
original Assignment acceptance evidence remains exact. Negative recovery run
`a1c2d5e9-b6d0-442f-9166-f191694a961f` rejected five invalid receipts with actual
child exit 1 and unchanged cohort counts. The original 15-table cutoff/count/hash
manifest matched after all final database work.

Regression run `725592e6-01a3-489f-b369-4ad10e9921cb` passed commands 1-18:
all A/B probes, the governance API suite with only the pre-existing formal
container integration suite excluded, Sim/SDK/Replay, Department/HTTP, Metrics/
Audit, codegen, catalog and freeze. Command 19 printed a valid contract then
hit Windows Node/libuv UV_HANDLE_CLOSING, exit 3221226505. That failure is retained.
The standalone retry and all six remaining gates in
`54a2e97a-796a-4a36-ad04-b709493f0ba6` passed: contract lint, workspace typecheck,
build, full root check with live database authority, canonical bytes and the
B-04 schema-normalizer test. There is no separate root lint script claimed here.

Two earlier regression probes required narrow harness corrections: the Engagement
TRUNCATE negative includes CASCADE to reach the existing immutable guard despite
new inbound foreign keys; the Person Subject exclusion assertion now scopes its
table names to Subject facts. Their immutable assertions and whole-schema timezone
checks remain active. Earlier failed attempts are preserved, not relabelled.

OpenAPI SHA remains
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`;
path/operation delta against START_HEAD is 0/0. All seven canonical artifacts,
15 Department Browser paths, API client and Browser sources remain unchanged.
Database generated types intentionally changed. The root freeze's older comparison
baseline is separate from this ticket's exact START_HEAD comparison.

Preliminary Standards review found missing standalone period read audit (P2);
the adapter now persists query/entity audit after closing its repeatable-read
snapshot, with real failing/passing audit probes. Preliminary Spec review requested
explicit suspension races (P3); both actual owner queue orders now pass. Final
independent reviews bind the staged tree, recorded outside this document in the
commit message and ignored review receipt. No preliminary verdict is reused.

Managed session closure receipts report cleanupPassed=true and retained source
database identity. Some service-stop commands returned 1; the independently
observed service state was inactive and the database unreachable. Those exit codes
are preserved separately from successful cleanup. Complete case matrix, actual
argv/cwd/exits, failed attempts, immutable manifests, resource closure and final
Git observations are indexed under `.runtime/pv006-c01/20260906T232526/`.

## Stop line and final provenance

Only `feat(person): add assignment placement core` may be committed, after all
hard gates pass. The reviewed tree can be recorded in that commit's message body
(outside the tree itself), avoiding a self-referential tracked hash. Its final
SHA and tree comparison belong in an ignored post-commit receipt and the final
reply. No second commit, amend or push is authorized.

C-01 completion leaves C and PV-006 IN_PROGRESS; C-02 and D–G remain NOT_STARTED.
No purpose/mode dictionaries, primary exclusivity, AssignmentRole, credentials,
campus/service placement, movement workflow, IAM, HTTP/UI, projection/release/
consumer feature, formal ABG/AR-07/Keycloak/container/browser acceptance or real
system integration is included.
