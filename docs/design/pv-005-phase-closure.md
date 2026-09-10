# PV-005 — Git Provenance Reconciliation and Phase Closure

Task: **PV-005-CLOSE**. Recorded on 2026-09-04, Asia/Shanghai.
Scope: documentation-only engineering closure of the existing synthetic,
non-production Department baseline. No next domain is authorized.

## 1. Final engineering status

**PV-005: ENGINEERING_COMPLETE**

This status closes the implemented PV-005 engineering scope, using the existing
B/C delivery reports and the current source/artifact checks below. It does not
declare FORMALLY_ACCEPTED, PRODUCTION_READY, PRODUCTION_VALIDATED or HIS_INTEGRATED.
The closure regression has one explicit environment limitation: `npm run check`
exited 1 at the live database authority step because `DATABASE_URL` was absent.
That result is retained as a failure to complete that gate, not relabelled PASS.
No PostgreSQL service was started to widen this closure into another live run.

## 2. Final branch and code baseline

```text
Branch=prototype/phase-02-department-master
START_HEAD=569a56a98ccd343972b47cf73ccbca59b9346574
Code baseline subject=feat(observability): add release consumer metrics
Code baseline tree=7a3d3ebcf0ad578b3d6f8e22008fcb8f0ee6da15
LOCAL_UPSTREAM_REF=refs/remotes/origin/prototype/phase-02-department-master
LOCAL_UPSTREAM_SHA_AT_START=569a56a98ccd343972b47cf73ccbca59b9346574
Opening worktree/index=CLEAN
Opening upstream...HEAD left/right=0/0
Opening origin/main...HEAD left/right=0/59
```

The sole authorized delivery is a local commit introducing this document,
`docs(phase): close pv-005 engineering baseline`, directly above START_HEAD.
Its own SHA is recorded by Git and the final task response; the engineering
baseline above remains the code-bearing commit. No separate current PV-005
phase/status machine was found in the repository, phase plan or local tracker.
Historical ticket triage labels are not a phase machine and are left unchanged.

## 3. Commit ancestry

The graph, first-parent log, ancestry-path list and commit objects agree on one
linear chain. All eight objects below are commits with exactly one parent.
There are seven descendants of `dce2390` through START_HEAD, with no intervening
merge. The previously omitted commit is `733072bc592b82c3ceb0bda4a7be16e2979c64e6`;
its parent was read from Git, not inferred. Dates below are Git metadata and
retain their recorded offsets; they are not application LocalDateTime fields.

| Commit | Actual parent | Subject | Author date | Committer date |
|---|---|---|---|---|
| `dce23903b0147910d7b0f90e6d431a30627d6fcc` | `80ed445c7710deb72db5560acc49be3652d8fbdc` | feat(api): add department release consumer contract | 2026-09-04T10:33:19+08:00 | 2026-09-04T10:33:19+08:00 |
| `733072bc592b82c3ceb0bda4a7be16e2979c64e6` | `dce23903b0147910d7b0f90e6d431a30627d6fcc` | feat(api): add consumer subscription lifecycle | 2026-09-04T11:24:08+08:00 | 2026-09-04T11:24:08+08:00 |
| `e366a073692587797472ff96623ef7d586364e78` | `733072bc592b82c3ceb0bda4a7be16e2979c64e6` | feat(api): add consumer operational sla metadata | 2026-09-04T11:52:06+08:00 | 2026-09-04T11:52:06+08:00 |
| `666f0260c7ef67374e725ea07ed2d55948690b59` | `e366a073692587797472ff96623ef7d586364e78` | test(contract): freeze department projection v1 evolution | 2026-09-04T12:47:31+08:00 | 2026-09-04T12:47:31+08:00 |
| `3dcd9e018b6ffe2ca1c0c73cb4aada709de434f8` | `666f0260c7ef67374e725ea07ed2d55948690b59` | feat(consumer): add release consumer sdk | 2026-09-04T15:10:02+08:00 | 2026-09-04T15:10:02+08:00 |
| `b3c9ae58dbec4e3d2429c06763b1613065f7d570` | `3dcd9e018b6ffe2ca1c0c73cb4aada709de434f8` | feat(tooling): add consumer release replay cli | 2026-09-04T16:08:16+08:00 | 2026-09-04T16:08:16+08:00 |
| `6c8b4e43cc6daf8aa5c52a8258b875fd3317b4b7` | `b3c9ae58dbec4e3d2429c06763b1613065f7d570` | feat(audit): add consumer release audit trail | 2026-09-04T16:52:58+08:00 | 2026-09-04T16:52:58+08:00 |
| `569a56a98ccd343972b47cf73ccbca59b9346574` | `6c8b4e43cc6daf8aa5c52a8258b875fd3317b4b7` | feat(observability): add release consumer metrics | 2026-09-04T18:32:20+08:00 | 2026-09-04T18:32:20+08:00 |

Read-only commands executed successfully:

```text
git log --graph --decorate --oneline --all -80
git log --first-parent --oneline dce23903b0147910d7b0f90e6d431a30627d6fcc..HEAD
git rev-list --ancestry-path dce23903b0147910d7b0f90e6d431a30627d6fcc..HEAD
git log --reverse --format='commit %H%nparent %P%nsubject %s%nauthor date %aI%ncommitter date %cI%n' dce23903b0147910d7b0f90e6d431a30627d6fcc^..HEAD
```

## 4. Git remote/upstream provenance

**Conclusion A: explicit git push observed**, in the sense that the local Git
remote-tracking reflog explicitly records push updates. This classifies the
recorded operation, not a recovered shell command line or an identified human.

```text
REMOTE_STATE_CONFIRMED: YES
PUSH_ACTOR_DETERMINED: NO
PUSH_ACTOR_UNDETERMINED
Most likely mechanism: successful local Git push operations updating origin's tracking ref
```

The user's independent pre-task GitHub observation was
`refs/heads/prototype/phase-02-department-master = 569a56a98ccd343972b47cf73ccbca59b9346574`.
After preserving local evidence, this task confirmed the same advertised remote
state with `git ls-remote --heads origin refs/heads/prototype/phase-02-department-master`
(exit 0). This read-only remote query did not fetch objects or update tracking refs.

### Remote-tracking reflog

`git reflog show --date=iso refs/remotes/origin/prototype/phase-02-department-master`
and the raw reflog file contain 17 entries. Every message is `update by push`.
The raw old/new IDs form a continuous chain from an all-zero old ID through
START_HEAD. The observed log covers creation of this tracking ref through the
current tip without a gap; a local reflog is not a GitHub audit log and does not
establish the absence of all possible historical edits or external operations.

| Recorded time (+0800) | Old commit | New commit | Message |
|---|---|---|---|
| 2026-09-03 14:04:38 | all-zero / absent | `9b1175e` | update by push |
| 2026-09-03 16:02:17 | `9b1175e` | `291de4c` | update by push |
| 2026-09-03 16:55:22 | `291de4c` | `a2eb71b` | update by push |
| 2026-09-03 17:14:36 | `a2eb71b` | `c73b969` | update by push |
| 2026-09-03 19:04:20 | `c73b969` | `5d62f96` | update by push |
| 2026-09-03 19:16:16 | `5d62f96` | `d6a586b` | update by push |
| 2026-09-03 22:33:08 | `d6a586b` | `4733dfc` | update by push |
| 2026-09-04 08:04:00 | `4733dfc` | `a81aa31` | update by push |
| 2026-09-04 09:45:15 | `a81aa31` | `80ed445` | update by push |
| 2026-09-04 10:35:24 | `80ed445` | `dce2390` | update by push |
| 2026-09-04 11:29:00 | `dce2390` | `733072b` | update by push |
| 2026-09-04 12:24:25 | `733072b` | `e366a07` | update by push |
| 2026-09-04 12:50:05 | `e366a07` | `666f026` | update by push |
| 2026-09-04 15:16:38 | `666f026` | `3dcd9e0` | update by push |
| 2026-09-04 16:09:57 | `3dcd9e0` | `b3c9ae5` | update by push |
| 2026-09-04 17:01:02 | `b3c9ae5` | `6c8b4e4` | update by push |
| 2026-09-04 18:57:56 | `6c8b4e4` | `569a56a` | update by push |

The final raw transition has old ID
`6c8b4e43cc6daf8aa5c52a8258b875fd3317b4b7`, new ID
`569a56a98ccd343972b47cf73ccbca59b9346574`, epoch `1788519476`, offset `+0800`.
The reflog identity is the configured local Git identity `zqpet`; it does not
identify the authenticated GitHub actor, executable, UI, task or human operator.

### Branch and all-ref reflogs

The branch reflog has 18 entries before this task's commit: creation from
`ba77cd2` at 2026-09-03 12:33:47 +0800, then 17 ordinary commits. The latest
commit entry is 2026-09-04 18:32:20 +0800. No branch reset, amend, rebase or merge
appears in this observed PV-005 log. `git reflog show --date=iso --all` agrees;
its older 2026-08-30 `origin/HEAD` fetch entry is unrelated to this target ref.
No fetch, pull, remote update, reset or update-ref message appears in the target
remote-tracking log. `core.logallrefupdates=true`; reflogs are present and enabled.

Evidence file SHA-256 values captured before any documentation write:

| Local evidence | SHA-256 |
|---|---|
| `.git/logs/refs/remotes/origin/prototype/phase-02-department-master` | `dabb05f9ada007eb1f185a46207d50330ab26a6a905b7ae0d7e7ba504a16140e` |
| `.git/logs/refs/heads/prototype/phase-02-department-master` | `4443b1a420c47745c68e38f504ff992661138010062c07be6fe20160f0621852` |
| `.git/config` | `1fb840e22032c43812994d681351e190362d2ee41a95f44244bb5eda502005c4` |

The branch reflog will gain the authorized documentation commit; the preserved
remote-tracking ref, its reflog and config must remain unchanged.

### Config, hooks and repository automation

`git config --show-origin --get-regexp` returned these explicit values, all from
`.git/config`:

```text
branch.prototype/phase-02-department-master.remote origin
branch.prototype/phase-02-department-master.merge refs/heads/prototype/phase-02-department-master
remote.origin.url https://github.com/peterkis/hospital-dataIntelligence-platform.git
remote.origin.fetch +refs/heads/*:refs/remotes/origin/*
core.logallrefupdates true
```

There is no explicit push refspec, separate push URL, `push.default`,
`push.autoSetupRemote`, `remote.pushDefault`, branch-specific `pushRemote`,
`core.hooksPath` or Git alias in the effective queried configuration. The
corresponding no-match queries exit 1; that means unset, not a config failure.
The expected origin branch is the actual upstream, so D is unsupported.

`.git/hooks` contains 14 `.sample` files only. No active post-commit, pre-push,
post-rewrite, post-merge, pre-commit, prepare-commit-msg or commit-msg hook exists.
No configured hooksPath exists. No hook was run or modified.

Read-only `rg` searches covered repository manifests, AGENTS.md, `.agents`,
tooling and hooks, then ignored `.runtime` task-helper sources. Search terms
included `git push`, `push --set-upstream`, `gh pr`, `gh repo`, `update-ref`,
`refs/remotes/origin`, and Git/push tokens at helper call sites. Matches were
skill documentation, a script that blocks dangerous Git commands, historical
no-push prose, array `.push()` calls, read-only evidence commands and staging
helpers. No push/remote-ref-update execution source was found. The directories
`scripts`, `.agent`, `.codex`, `.vscode`, `.github` and `.husky` are absent.
No discovered helper was executed. An initial secondary search had a quoting
error and was corrected before drawing this conclusion.

Thus B (automatic push), C (manual tracking-ref advance) and E (external-only
remote update) have no supporting evidence in the inspected scope. A is better
supported than F because actual push-update records are present. The caller
could still have been a human CLI, IDE or external helper using this repository;
no caller attribution is made, and global app/session history was not audited.

## 5. Why NO PUSH and the remote state differ

[C-04's report](consumer-operational-metrics.md) is part of the 18:32:20 commit;
the local push update to that commit occurred at 18:57:56, 25 minutes 36 seconds
later. A statement frozen into the commit cannot establish what happened later.
The same separation between commit and later push records occurs throughout B/C.

There is also a concrete limitation in the local report-generation evidence:
the ignored `.runtime/pv005-c04/collect-final-evidence.mjs:37` assigns `push:false`
as a literal, and `.runtime/pv005-c04/write-delivery-record.mjs:87` writes
`Push performed: NO` as literal prose. These are declarations, not checks of
reflog or GitHub state. Neither helper contains an observed push invocation.

The reconciled statement is: the historical task report declared no push;
Git records later local push updates, and the remote now contains the commit.
It remains undetermined whether the earlier task, a later user action or another
tool initiated those updates. This closure preserves the original reports and
adds this correction of their evidentiary scope; it does not rewrite history.
**Push performed by PV-005-CLOSE: NO.**

## 6. Frozen Department V1 digests

The existing canonical checker regenerated all seven frozen artifacts, compared
exact bytes and validated schema/payload/envelope identities. The 20 existing
freeze/evolution tests passed. Department identity remains:

| Contract | Schema SHA-256 | Frozen fixture artifact SHA-256 |
|---|---|---|
| `hdi.department-master@1` | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` | `336ab62f8d2230eb5eeb7fa4ac41f8ae12ad0a63a4e6cc937bee416a902b9f26` |
| `hdi.department-hierarchy@1` | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` | `fb71ec35bf39f9ea508b764beb56a386df48922d0015d54662b8a334feae2cf4` |

Fixture artifact hashes describe the published deterministic test vectors, not
every legitimate release's bytes. Schema versions, fixture pins and generator
authority were unchanged. See
[Department projection schema evolution](department-projection-schema-evolution.md)
and ADRs [0088](../adr/0088-domain-owned-versioned-projection-schemas.md) and
[0091](../adr/0091-govern-projection-schema-upgrades-as-high-risk-contract-changes.md).

## 7. OpenAPI authority

The authority chain remains domain/route TypeBox definitions -> frozen OpenAPI
-> Generated Client -> SDK, under
[ADR-0076](../adr/0076-generate-and-freeze-openapi-from-typebox-contracts.md).
The current `contracts/openapi/phase-01.openapi.json` has SHA-256
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`, matching
its `.sha256` authority file. It contains 56 paths.

The existing consumer-audit OpenAPI gate passed; it permits C-03's two audit
paths while asserting all previous paths/components and canonical schemas are
unchanged. The SDK generation check ran in `--check` mode and passed. A read-only
comparison against `80ed445c7710deb72db5560acc49be3652d8fbdc` independently confirmed
all 15 Department governance browser path definitions remain identical.
The first ad-hoc path-count probe used the wrong prefix and returned zero;
the corrected check selected the actual `/v1/department-governance/` baseline
paths and asserted all 15, rather than accepting that diagnostic as evidence.
No OpenAPI or client regeneration/write was performed by this task.

## 8. Migration count and database authority

There are **19** ordered SQL migration files, `0001` through `0019`; the last is
`0019_consumer_release_audit_indexes.sql`. No migration was added or modified.
The static part of the existing database authority check verified sequence and
forbidden migration date/time types before failing on the absent connection
configuration. A separate read-only in-memory audit reused its exported
date/time guard and checked the same migration/table-name/SQL-ownership rules:
19 migrations, 66 generated table-name entries covered, 10 module owners,
zero forbidden migration time types. Its scope is source consistency only.

The existing database authority unit tests passed 16/16 with controlled query
and spawn seams. Neither those tests nor the static audit certify live catalog
types, applied migration count or Kysely codegen agreement with a live database.
Those were not reverified here. The previous live validation belongs to the
unchanged [C-04 report](consumer-operational-metrics.md), not this closure run.

## 9. Capability closure matrix

| Capability | Engineering state and evidence |
|---|---|
| Department Master V1 | FROZEN; current canonical schema and exact artifact gate pass |
| Department Hierarchy V1 | FROZEN; current canonical schema and exact artifact gate pass |
| Release distribution | COMPLETE; immutable release/snapshot, exact compatibility, receipt/checkpoint chain in `release-distribution`; [contract report](department-release-distribution-consumer-contract.md) |
| Subscription versioning | COMPLETE; immutable versions and delivery-bound exact support; [distribution contract](department-release-distribution-consumer-contract.md) |
| Lifecycle | COMPLETE; ACTIVE/SUSPENDED/REVOKED/ARCHIVED access and transition boundary; [lifecycle report](consumer-subscription-lifecycle.md) |
| SLA metadata/read model | COMPLETE; existing versioned metadata and derived operational status; [SLA report](consumer-operational-sla.md) |
| Schema freeze/evolution gate | COMPLETE; immutable V1, seven-contract byte gate, bounded proposal evaluation; [evolution report](department-projection-schema-evolution.md) |
| Release Consumer SDK | COMPLETE; Generated Client boundary, verified artifact, durable adapter/recovery/receipt protocol; [SDK report](release-consumer-sdk.md) |
| Exact release replay | COMPLETE; exact historical release context, dry-run/apply separation, monotonic checkpoint and recovery; [replay report](consumer-release-replay-cli.md) |
| Append-only Consumer audit | COMPLETE; existing audit hash chain and UPDATE/DELETE protection, platform versus consumer evidence, idempotent append; [audit report](consumer-release-audit-trail.md) |
| Operational metrics | COMPLETE; read-only durable-fact aggregation, six bounded families, prototype observability route; [metrics report](consumer-operational-metrics.md) |

Current source inspection confirmed the existing release-distribution lifecycle,
operational/replay/audit seams, SDK public entry, audit storage protections and
read-only metrics composition. Detailed historical PostgreSQL/HTTP/recovery
results remain in the linked reports. No new acceptance result is inferred from
their test totals, and no existing runtime capability was changed here.

## 10. Closure validation scope

| Command/check executed in this task | Exit | Result |
|---|---:|---|
| `git diff --check` | 0 | Opening tracked tree has no whitespace errors |
| `npm run check` | **1** | Stops at `DATABASE_AUTHORITY_DATABASE_URL_MISSING`; no live DB connection is established |
| `npm run check:runtime` (within check) | 0 | Node 24.18.0 / npm 11.9.0 |
| `npm run check:repo:layout` (within check) | 0 | 9 workspaces, one Git root/lockfile |
| `npm run check:module-boundaries` (within check) | 0 | 10 module entries; no forbidden structure |
| `npm run contract:check-projection-freeze` (within check) | 0 | 20/20 existing tests |
| `npm run contract:check-consumer-sdk` (within check) | 0 | Generated contract agreement and package boundary |
| `npm run contract:check-consumer-audit` (within check) | 0 | OpenAPI authority/delta check |
| `npm run check:database-authority` (within check) | **1** | Live database authority gate incomplete; missing connection configuration |
| `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 | Seven exact artifacts; both Department V1 digests unchanged |
| `npm run test --workspace @hospital-data-intelligence/verification-tooling -- src/check-database-authority.test.ts` | 0 | 16/16 existing authority unit tests; no live database |
| Read-only stdin Node static source audit | 0 | Ordered migrations, generated table-name coverage, module SQL ownership, OpenAPI hash |
| Read-only stdin Node Department path baseline comparison | 0 | 15/15 existing browser path definitions unchanged |

The two stdin audits created no script files and did not replace or weaken any
gate. The aggregate `npm run check` result remains exit 1. The current code tree
was still clean after investigation and validation, immediately before creating
this document. Only the specified documentation path is authorized for staging
and the single local commit; final path/diff and remote-evidence checks are
recorded with that commit in the task response.

## 11. Explicit exclusions

No Department consumer direct-query API is introduced: consumption continues
through the governed release/snapshot contract. Frozen consumer V1 projections
exclude campus, alias, quality and source mapping fields. This is a statement
about the consumer V1 boundary and the excluded expansions; existing Department
governance browser/read-model quality and source-mapping surfaces already exist
and remain frozen. It would be inaccurate to claim those names are absent from
the entire repository or its historical governance API.

No real HIS/EMR connection, Person Master work, new master-data domain, new API,
migration, schema, runtime capability, monitoring deployment or production
deployment is part of PV-005-CLOSE. No Git fetch/pull/push, history rewrite,
branch switch, merge/rebase, stash/clean, tag, PR, remote branch mutation or
remote-tracking ref mutation was performed. Git config and hooks were unchanged.

## 12. Remaining formal acceptance work

Formal ABG, AR-07, formal Keycloak validation, container formal acceptance,
browser acceptance, real HIS/EMR validation and production deployment remain
outside this engineering closure. None was executed by this task. They require
their own explicit authorization and applicable frozen-baseline evidence.
Any future live database authority revalidation must likewise use its authorized
environment; the static closure evidence is not a substitute.

## 13. Next authorized domain

**None yet.** Person Master has not started. This engineering baseline provides
a traceable starting point for a separately authorized phase; it does not
authorize planning or implementation of that phase. Stop after local closure.

## Appendix — complete opening Git command results

These are the opening command outputs before any file edit or remote query.
Empty `git status --short` output is retained as the adjacent exit-code line.

```text
COMMAND: git rev-parse --abbrev-ref HEAD
prototype/phase-02-department-master
EXIT_CODE=0
COMMAND: git rev-parse HEAD
569a56a98ccd343972b47cf73ccbca59b9346574
EXIT_CODE=0
COMMAND: git status --short
EXIT_CODE=0
COMMAND: git remote -v
origin	https://github.com/peterkis/hospital-dataIntelligence-platform.git (fetch)
origin	https://github.com/peterkis/hospital-dataIntelligence-platform.git (push)
EXIT_CODE=0
COMMAND: git branch -vv
  main                                       c4396be [origin/main] feat: complete phase 01 executable verification baseline
  phase-01-acceptance-readiness              c41ad4f [origin/phase-01-acceptance-readiness] fix(verification): bind runtime database connection to shared authority checks
  prototype/phase-01-db-validation           905614e [origin/prototype/phase-01-db-validation: ahead 1] feat(prototype): validate core governance flow on external PostgreSQL
  prototype/phase-01-demo-ready              ba77cd2 [origin/prototype/phase-01-demo-ready] feat(prototype): create hospital governance demo edition
  prototype/phase-01-guided-ui               5b31898 [origin/prototype/phase-01-guided-ui] feat(prototype): add guided governance demo UI
  prototype/phase-01-http-validation         878f048 [origin/prototype/phase-01-http-validation] feat(prototype): validate governance flow through HTTP API
  prototype/phase-01-time-contract-hardening 7b11d02 [origin/prototype/phase-01-time-contract-hardening] fix(prototype): enforce Asia Shanghai local datetime contract
* prototype/phase-02-department-master       569a56a [origin/prototype/phase-02-department-master] feat(observability): add release consumer metrics
EXIT_CODE=0
COMMAND: git rev-parse --symbolic-full-name @{upstream}
refs/remotes/origin/prototype/phase-02-department-master
EXIT_CODE=0
COMMAND: git rev-parse @{upstream}
569a56a98ccd343972b47cf73ccbca59b9346574
EXIT_CODE=0
COMMAND: git rev-list --left-right --count @{upstream}...HEAD
0	0
EXIT_CODE=0
COMMAND: git rev-list --left-right --count origin/main...HEAD
0	59
EXIT_CODE=0
```
