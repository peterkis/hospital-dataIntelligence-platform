import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import type { AssignmentVersion, AssignmentClosureVersion, AssignmentClosureApplication, AssignmentSemanticsApplication,
  CreateAssignment, CreateClassifiedAssignment, ClassifiedAssignmentResult, EndAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { assignmentSemanticDatabaseIdentity, assignmentSemanticRecoveryFingerprint } from './person-assignment-semantics-recovery-support.js';
import { Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { ClosureFixture } from './person-assignment-closure-fixture.js';

type Snapshot<Method extends (...args: never[]) => unknown> = { query: Parameters<Method>[0]; value: Awaited<ReturnType<Method>> };
type SourceReplay = { kind: 'RAW'; command: CreateAssignment; value: AssignmentVersion; context: RequestContext }
  | { kind: 'CLASSIFIED'; command: CreateClassifiedAssignment; value: ClassifiedAssignmentResult; context: RequestContext };
export interface ClosureRecoveryReceipt {
  task: 'PV-006-C-03-01'; mode: 'RECOVERY'; runId: string;
  identity: Awaited<ReturnType<typeof assignmentSemanticDatabaseIdentity>>;
  actor: string;
  versions: AssignmentVersion[];
  sourceReplays: SourceReplay[];
  endReplays: { command: EndAssignment; value: AssignmentClosureVersion; context: RequestContext }[];
  declaredReads: Snapshot<AssignmentClosureApplication['getAssignmentDeclaredPeriodAsOf']>[];
  semanticReads: Snapshot<AssignmentSemanticsApplication['getAssignmentSemanticsAsOf']>[];
  primaryReads: Snapshot<AssignmentSemanticsApplication['resolvePrimaryAffiliation']>[];
  versionIds: string[]; requestIds: string[];
  fingerprint: Awaited<ReturnType<typeof assignmentClosureRecoveryFingerprint>>;
}

export async function assignmentClosureRecoveryFingerprint(database: Kysely<DB>, versionIds: string[], requestIds: string[]) {
  const common = await assignmentSemanticRecoveryFingerprint(database, versionIds, requestIds);
  const closure = (await sql<{ count: number; digest: string }>`select count(*)::int as count,
    encode(digest(coalesce(string_agg(to_jsonb(c)::text,'' order by c.closure_assignment_version_id),''),'sha256'),'hex') as digest
    from person_master.assignment_closure_evidence c where c.closure_assignment_version_id=any(${versionIds}::uuid[])`.execute(database)).rows[0]!;
  return { common, closure };
}

/** Retained, stable recovery sample: raw, primary, concurrent and planned future end. */
export async function prepareAssignmentClosureRecovery(database: Kysely<DB>, f: ClosureFixture, runId: string): Promise<ClosureRecoveryReceipt> {
  const identity = await assignmentSemanticDatabaseIdentity(database);
  const versions: AssignmentVersion[] = [], sourceReplays: SourceReplay[] = [], endReplays: ClosureRecoveryReceipt['endReplays'] = [];
  const declaredReads: ClosureRecoveryReceipt['declaredReads'] = [], semanticReads: ClosureRecoveryReceipt['semanticReads'] = [],
    primaryReads: ClosureRecoveryReceipt['primaryReads'] = [];
  const requestIds: string[] = [];
  for (const kind of ['RAW', 'PRIMARY', 'CONCURRENT', 'FUTURE'] as const) {
    const e = await f.createEngagement(), sourceRequest = randomUUID();
    let source: AssignmentVersion;
    if (kind === 'RAW') {
      const command = f.command(e.engagementId); source = await f.app(sourceRequest).createAssignment(command);
      sourceReplays.push({ kind: 'RAW', command, value: source, context: f.context(f.actor, sourceRequest) });
    } else {
      const command = f.classifiedCommand(e.engagementId, { modeCode: kind === 'CONCURRENT' ? 'STANDING_CONCURRENT' : 'PRIMARY_AFFILIATION' });
      const value = await f.semantics(sourceRequest).createClassifiedAssignment(command); source = value.coreVersion;
      sourceReplays.push({ kind: 'CLASSIFIED', command, value, context: f.context(f.actor, sourceRequest) });
    }
    const oldR = await f.now(), request = randomUUID(), endedAt = kind === 'FUTURE' ? '2027-02-01T00:00:00' : Aug;
    const command = f.endCommand(source, endedAt), closed = await f.closure(request).endAssignment(command), newR = await f.now();
    versions.push(source, closed); endReplays.push({ command, value: closed, context: f.context(f.actor, request) }); requestIds.push(sourceRequest, request);
    const predecessor = (await sql<{ point: string }>`select ${endedAt}::timestamp-interval '1 microsecond' as point`.execute(database)).rows[0]!.point;
    for (const recordAsOf of [oldR, newR]) for (const businessAt of [...new Set([Jan, Jul, Aug, Dec, endedAt, predecessor])]) {
      const query = { ...f.scope, assignmentId: source.assignmentId, businessAt, recordAsOf };
      declaredReads.push({ query, value: await f.closure().getAssignmentDeclaredPeriodAsOf(query) });
      semanticReads.push({ query, value: await f.semantics().getAssignmentSemanticsAsOf(query) });
      const primaryQuery = { ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION' as const,
        scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS' as const, businessAt, recordAsOf };
      primaryReads.push({ query: primaryQuery, value: await f.semantics().resolvePrimaryAffiliation(primaryQuery) });
    }
  }
  assert.equal(versions.length, 8);
  const versionIds = versions.map(v => v.assignmentVersionId);
  return { task: 'PV-006-C-03-01', mode: 'RECOVERY', runId, identity, actor: f.actor, versions, sourceReplays, endReplays,
    declaredReads, semanticReads, primaryReads, versionIds, requestIds,
    fingerprint: await assignmentClosureRecoveryFingerprint(database, versionIds, requestIds) };
}
