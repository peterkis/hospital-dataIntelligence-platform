# P2-04 organization identifiers, aliases and Department recoding

## Confirmed scope and authority

Baseline: local `main@3cad73fc70b37fa4160a83a812a67ff81eb0e1c4`. The user authorized implementation of the confirmed plan using implement, at public Owner, real HTTP and actual database role seams. This ticket ends with local commits and review; no fetch, push, PR or subsequent ticket work is authorized.

CORE provides LEGAL/CAMPUS/ORG aliases, official Department code registration/recoding, correction, end, retract, file/manual intake, candidate review/approval/apply/recovery and B/R reads. FULL, unimplemented targets, hospital policy adoption, the P2-07 maintenance page and formal acceptance remain separate. The finite policies are explicitly synthetic; no connector or production policy is implied.

## Rules and storage

`department-master/organization-identifier` owns stable relationships and immutable full versions. `HOSPITAL_CODE` is unique for life in `SYNTHETIC_DEPARTMENT_CODE`, never reusable or revived. `ALIAS`, `FORMER_NAME` and `SEARCH_CODE` use their corresponding finite synthetic schemes; duplicate values may exist on different targets. Schemes bind allowed kinds/targets and issuer `SYNTHETIC_ORGANIZATION_PERSONNEL`. Their adopted contract code sets have explicit validity and source provenance. Issuer is policy, while `source_system_id` remains input provenance.

Exact text is preserved. Whitespace-padded values are rejected instead of trimmed; no case conversion, punctuation removal, Unicode normalization or guessed zero padding occurs. XLSX identifier values must be text. Names, aliases and search codes cannot create a caller-selected platform ID or resolve official identity.

REGISTER creates a database-assigned relationship. CORRECT appends an alias version, retaining target/kind/scheme. END only shortens the latest interval. RETRACT withdraws the assertion at new R while old R remains readable. CHANGE ends a Department code and registers its successor in the same root transaction, using the original row with separate command steps. One revision has at most 100 source entries and 100 expanded commands. Final preferred/code timelines are checked independent of row order and by deferred database constraints before commit.

The preferred bucket is target type + ID + kind + scheme + exact language, including empty language. Explicit handover may end an old preferred alias and register/correct a successor atomically; no automatic demotion occurs. Local Asia/Shanghai time has microsecond precision and half-open `[from,to)` semantics. Offset-bearing timestamps are rejected. Readers select the latest complete version at R, then evaluate B; end/retract never reveal a superseded open version.

Migration 0115 adds identifier/access/input/verification/version storage with immutable triggers, RLS and restricted function grants. Migration 0116 admits the finite ORG23 contract/parser and integrates ORG04. `department.code` stays initial evidence; a permanent reservation is created with new ORG04 identities. ORG04 create and ORG23 share the common lock 901002 and reservation check. ORG04 revisions can cite owned codes but cannot recode. Current reads expose `initialCode`, `effectiveCode`, `codeVersion`, `codeEvidence`; no effective code yields null. Original ORG04 evidence explains pre-migration R without backdating new facts. Existing hierarchy and mapping snapshots are not rewritten.

## All 16 source fields

All fields remain in the sealed original input, preview and frozen approval basis; source evidence does not overwrite platform authority.

| Source field | Fact/evidence and guard |
|---|---|
| org_identifier_id | Source row alias only; database generates formal ID |
| target_type | Explicit Owner family; CORE LEGAL/CAMPUS/ORG, other types blocked |
| target_id | Exact typed target; current authorization and entire interval coverage |
| identifier_kind | Source category; HOSPITAL_CODE/ALIAS/FORMER_NAME/SEARCH_CODE, SOURCE_CODE handoff |
| identifier_system | Finite versioned scheme and independently verified policy |
| identifier_value | Exact text, leading zeros preserved; official reservation or alias value |
| language | Exact language bucket, empty is independent |
| is_preferred | Y/N evidence mapped to a version fact; temporal bucket uniqueness |
| version_no | Source version, separate from database version number |
| valid_from | Inclusive local business bound |
| valid_to | Exclusive local bound; empty means unbounded |
| record_status | Original source intent; explicit command controls platform lifecycle; CORE admission requires ACTIVE |
| source_system_id | Exact GOV01 source reference and qualified coverage |
| source_record_id | Protected source locator, never identity resolution |
| approval_ref | Source approval evidence, never platform approval authority |
| recorded_at | Local source record time, separate from actual database R |

ORG23_CORE_V1 is a distinct contract identity and retains the complete schema. The finite adapter and STRICT_ORGANIZATION_IDENTIFIER_V1 XLSX parser cannot downgrade FULL. SOURCE_CODE yields a frozen blocked issue with ORG22 Owner and required source identity/context/period/target fields. The existing ORG22 workflow supplies its complete input and independent approval; P2-04 does not guess context or create a second fact.

## Public interface and lifecycle

`openOrganizationIdentifiers` exports the public Owner. `/api/vnext/organization-identifiers` routes cover inputs/read/preview/validate/verify/plan/review/approve/apply/resume/list/history/query/resolve/targets/preferred/diff/files. `createOrganizationIdentifierClient` is generated-schema typed. Ordinary JSON requests retain the 300000 byte limit; XLSX raw files retain 1 MiB and frozen candidates 512 KiB. Oversized batches fail explicitly and are not split.

Manual input and a single ORG23 XLSX worksheet share the same Owner. File input retains raw bytes, digest and physical row number, and records normal import validation evidence. Commands carry explicit expectedHead, reason and evidence. Inputs bind the maker's personnel identity; alias accounts do not create new people. Independent verification binds input digest, policy decision, reason and evidence. Final candidate review exposes every original row, blocked issue, contract, verification, target basis, prior head, diff and expanded command.

Apply rechecks current executor/reviewer/verification permissions, actual personnel separation and dependency digest under one transaction. Another authorized writer may execute the approved request; the frozen original submitter identity still determines maker/checker separation. Changes fail STALE_VALIDATION and write no formal facts. Source retirement does not forbid a separately approved safe end/retract. Recovery uses the original request/candidate and returns the original committed result with current access checks; it does not reapply facts.

Exact official resolution returns the precise identifier version and typed target. Alias/search schemes cannot use it. Alias queries return a set; preferred returns the chosen bucket assertion. Historical reads explicitly mark assertions and do not grant operational permission.

## Requirements and verification index

| Requirement | Evidence in tooling/vnext/p2-04-db.test.ts (public seams) |
|---|---|
| AC-01 alias does not merge identity | Duplicate aliases on two real Department IDs; distinct relationships |
| AC-02 official conflict rejection | ORG04/ORG23 reservation, concurrent official recodes, permanent ownership/no revive |
| AC-03 leading zeros | Atomic 0012 recode and text XLSX 0012/physical row 2; numeric source is rejected by strict parser |
| AC-04 search code is not identity | Search-code XLSX and forbidden alias/search scheme resolution |
| AC-05 withdrawal keeps history | Correction/retraction, old R and unchanged original version |
| Q14 source namespace separation | SOURCE_CODE blocked with full raw retention and ORG22 handoff; no formal fact/approval |
| Atomic timelines | Preferred handover in reverse row order, language separation, strict END shortening, finite initial code, middle coverage gap, no fallback |
| Approval/current permission | Same-person verify/approve denial, maker identity, revoked access, verifier target grant, replacement verification staleness |
| Transaction/recovery | SQL second-row fault rollback, retry, real HTTP replay and same facts |
| Database authority | Actual application role direct INSERT/UPDATE/key SELECT denied with 42501 |
| Limits/profile/targets | Expanded 101 command rejection, FULL/offset/unsupported target block; actual LEGAL/CAMPUS Owner profiles |
| Upstream exit | Explicit source retirement followed by end and retract |

Unit tests cover the closed 16-field schema, no silent normalization and CORE/FULL adapter split. Fresh and 0114-to-current runs verify exact ordered/checksummed migration lineage and generated database types. The upgrade cohort compares predecessor ledger/data hashes. `--upgrade-periods` creates a real approved finite ORG04 assertion on 0114 and verifies unchanged original history, old R, new R and the microsecond end boundary after migration. Temporary and persistent fixtures share one synthetic contract builder. Persistent deployment verifies old row/key preservation and runs real HTTP against receipt-bound synthetic permissions, retaining original requests for recovery. The ignored `.runtime/vnext/p2-04-handoff.md` records actual commands, failures, final results, review and final commit/tree; local green is not formal acceptance.

Run through the repository wrapper: `npm.cmd run prototype:db:with -- vnext:p2-04:validate`, `... --upgrade`, and `... vnext:p2-04:deploy`. Required wrapper evidence is ready, target exit 0 and cleanupPassed=true. The final applicable suite covers P2-01/02/03, shared Apply/files/validation/workbench and migration gates plus typecheck/build/boundaries. No UI browser acceptance or production restart is claimed.
