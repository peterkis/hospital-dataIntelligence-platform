import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import type { AssignmentTransferResult, TransferAssignment, AssignmentClosureApplication, AssignmentSemanticsApplication,
  ClassifiedAssignmentResult, CreateClassifiedAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { assignmentSemanticDatabaseIdentity } from './person-assignment-semantics-recovery-support.js';
import { assignmentClosureRecoveryFingerprint } from './person-assignment-closure-recovery-support.js';
import { Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { TransferFixture } from './person-assignment-transfer-fixture.js';

type Snapshot<Method extends (...args: never[]) => unknown> = { query: Parameters<Method>[0]; value: Awaited<ReturnType<Method>> };
export interface TransferRecoveryReceipt {
  task: 'PV-006-C-03-02'; mode: 'RECOVERY'; runId: string;
  identity: Awaited<ReturnType<typeof assignmentSemanticDatabaseIdentity>>;
  actor: string;
  transfers: { command: TransferAssignment; context: RequestContext; value: AssignmentTransferResult }[];
  sourceReplays: { command: CreateClassifiedAssignment; context: RequestContext; value: ClassifiedAssignmentResult }[];
  refusals: { command: TransferAssignment; context: RequestContext; code: string }[];
  declaredReads: Snapshot<AssignmentClosureApplication['getAssignmentDeclaredPeriodAsOf']>[];
  semanticReads: Snapshot<AssignmentSemanticsApplication['getAssignmentSemanticsAsOf']>[];
  primaryReads: Snapshot<AssignmentSemanticsApplication['resolvePrimaryAffiliation']>[];
  versionIds: string[]; transferIds: string[]; requestIds: string[];
  fingerprint: Awaited<ReturnType<typeof assignmentTransferRecoveryFingerprint>>;
  contentHash: string;
}
export async function assignmentTransferRecoveryFingerprint(database: Kysely<DB>, versionIds: string[], transferIds: string[], requests: string[]) {
  const common = await assignmentClosureRecoveryFingerprint(database, versionIds, requests);
  const roots = (await sql<{ count: number; digest: string }>`select count(*)::int as count,
    encode(digest(coalesce(string_agg(j,'' order by kind,j),''),'sha256'),'hex') as digest from (
      select 'transfer' as kind,to_jsonb(t)::text as j from person_master.assignment_transfer t where transfer_id=any(${transferIds}::uuid[])
      union all select 'outcome',to_jsonb(o)::text from person_master.assignment_command_outcome o where request_id=any(${requests}::text[])
    ) rows`.execute(database)).rows[0]!;
  return { common, roots };
}
export async function prepareAssignmentTransferRecovery(database: Kysely<DB>, f: TransferFixture, runId: string): Promise<TransferRecoveryReceipt> {
  const identity = await assignmentSemanticDatabaseIdentity(database);
  const transfers: TransferRecoveryReceipt['transfers'] = [], sourceReplays: TransferRecoveryReceipt['sourceReplays'] = [],
    refusals: TransferRecoveryReceipt['refusals'] = [], declaredReads: TransferRecoveryReceipt['declaredReads'] = [],
    semanticReads: TransferRecoveryReceipt['semanticReads'] = [], primaryReads: TransferRecoveryReceipt['primaryReads'] = [];
  const requestIds: string[] = [];
  for (const kind of ['FINITE', 'UNBOUNDED', 'CONCURRENT', 'FUTURE'] as const) {
    const e = await f.createEngagement(), sourceRoot = randomUUID();
    const command = f.classifiedCommand(e.engagementId, { businessValidTo: kind === 'FINITE' ? Dec : null,
      modeCode: kind === 'CONCURRENT' ? 'STANDING_CONCURRENT' : 'PRIMARY_AFFILIATION' });
    const source = await f.semantics(sourceRoot).createClassifiedAssignment(command);
    sourceReplays.push({ command, context: f.context(f.actor, sourceRoot), value: source });
    const oldR = await f.now(), root = randomUUID();
    const transferCommand = f.transferCommand(source.coreVersion, { effectiveAt: kind === 'FUTURE' ? '2032-08-01T00:00:00' : Aug });
    const value = await f.transfer(root).transferAssignment(transferCommand);
    transfers.push({ command: transferCommand, context: f.context(f.actor, root), value });
    requestIds.push(sourceRoot, root, value.sourceRequestId, value.targetRequestId);
    for (const recordAsOf of [oldR, value.transferRecordedFrom]) for (const businessAt of [...new Set([Jan, Jul, Aug, Dec, value.effectiveAt])]) {
      for (const assignmentId of recordAsOf === oldR ? [value.sourceAssignmentId] : [value.sourceAssignmentId, value.targetAssignmentId]) {
        const query = { ...f.scope, assignmentId, businessAt, recordAsOf };
        declaredReads.push({ query, value: await f.closure().getAssignmentDeclaredPeriodAsOf(query) });
        semanticReads.push({ query, value: await f.semantics().getAssignmentSemanticsAsOf(query) });
      }
      const query = { ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION' as const,
        scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS' as const, businessAt, recordAsOf };
      primaryReads.push({ query, value: await f.semantics().resolvePrimaryAffiliation(query) });
    }
  }
  const e = await f.createEngagement(), rejectedSourceRoot = randomUUID(), create = f.classifiedCommand(e.engagementId);
  const rejectedSource = await f.semantics(rejectedSourceRoot).createClassifiedAssignment(create);
  sourceReplays.push({ command: create, context: f.context(f.actor, rejectedSourceRoot), value: rejectedSource }); requestIds.push(rejectedSourceRoot);
  const raw = await f.app().createAssignment(f.command(e.engagementId));
  const root = randomUUID(), command = f.transferCommand(rejectedSource.coreVersion), code = 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE';
  await assert.rejects(f.transfer(root).transferAssignment(command), { message: code });
  // Repair the unrelated UNKNOWN using a separate explicit command. The rejected
  // root must stay rejected after repair and across restart.
  await f.closure().endAssignment(f.endCommand(raw, Aug));
  refusals.push({ command, context: f.context(f.actor, root), code }); requestIds.push(root);
  const versionIds = [...sourceReplays.map(item => item.value.coreVersion.assignmentVersionId),
    ...transfers.flatMap(item => [item.value.sourceClosureVersionId, item.value.targetAdmissionVersionId])];
  const transferIds = transfers.map(item => item.value.transferId);
  const body: Omit<TransferRecoveryReceipt, 'contentHash'> = { task: 'PV-006-C-03-02', mode: 'RECOVERY', runId, identity, actor: f.actor, transfers, sourceReplays, refusals,
    declaredReads, semanticReads, primaryReads, versionIds, transferIds, requestIds,
    fingerprint: await assignmentTransferRecoveryFingerprint(database, versionIds, transferIds, requestIds) };
  return { ...body, contentHash: canonicalSha256(body).toString('hex') };
}
