import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type KyselyPlugin } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { temporalKey } from '../../apps/governance-api/src/modules/person-master/engagement-rule-segments.js';
import { ASSIGNMENT_SEMANTIC_POLICY } from '../../apps/governance-api/src/modules/person-master/assignment-semantics-policy.js';
import { assignmentTransferChildRequests, validateAssignmentTransfer, type AssignmentAdmissionVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { Jan, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import type { TransferCheck, TransferFixture } from './person-assignment-transfer-fixture.js';

/** A test-local observer after a real SQL INSERT; it never edits or suppresses the SQL. */
export function afterTransferInsert(table: string, contains: string, work: () => Promise<void>): KyselyPlugin {
  const selected = new WeakSet<object>();
  let fired = false;
  return {
    transformQuery(args) {
      if (!fired && args.node.kind === 'InsertQueryNode' && JSON.stringify(args.node).includes(`"name":"${table}"`)
        && JSON.stringify(args.node).includes(contains)) selected.add(args.queryId);
      return args.node;
    },
    async transformResult(args) {
      if (!fired && selected.has(args.queryId)) { fired = true; await work(); }
      return args.result;
    },
  };
}
export async function assertTransferUnchanged(database: Kysely<DB>, f: TransferFixture, source: AssignmentAdmissionVersion, root: string,
  expectedStableCount = 1, rejected = true) {
  const versions = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
    .where('assignment_id', '=', source.assignmentId).execute();
  assert.deepEqual(versions, [{ assignment_version_id: source.assignmentVersionId }]);
  const stable = await database.selectFrom('person_master.assignment').select('assignment_id')
    .where('engagement_id', '=', source.acceptanceEvidence.engagement.engagementId).execute();
  assert.equal(stable.length, expectedStableCount);
  const transfers = await database.selectFrom('person_master.assignment_transfer').select('transfer_id')
    .where('source_assignment_id', '=', source.assignmentId).execute();
  assert.equal(transfers.length, 0);
  const children = assignmentTransferChildRequests(f.scope.governanceObjectId, root);
  assert.equal((await database.selectFrom('person_master.assignment_command_outcome').select('request_id')
    .where('request_id', 'in', [children.source, children.target]).execute()).length, 0);
  assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id')
    .where('request_id', 'in', [children.source, children.target]).execute()).length, 0);
  const rootOutcome = await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', root).execute();
  assert.equal(rootOutcome.length, rejected ? 1 : 0);
  const rootAudits = await database.selectFrom('audit.audit_event').select('action').where('request_id', '=', root).execute();
  assert.deepEqual(rootAudits, rejected ? [{ action: 'PERSON_ASSIGNMENT_REJECTED' }] : []);
  if (rejected) { assert.ok(rootOutcome[0]!.rejection_code); assert.equal(rootOutcome[0]!.transfer_id, null); assert.equal(rootOutcome[0]!.assignment_version_id, null); }
  assert.deepEqual(await f.app().getAssignmentVersion({ ...f.scope, assignmentId: source.assignmentId, assignmentVersionId: source.assignmentVersionId }), source);
  return { sourceVersionId: source.assignmentVersionId, stableCount: stable.length, root, children, rootRejection: rootOutcome[0]?.rejection_code ?? null };
}

export async function runAssignmentTransferBehavior(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  const source = async (to: string | null = null) => (await f.semantics().createClassifiedAssignment(
    f.classifiedCommand((await f.createEngagement()).engagementId, { businessValidTo: to }))).coreVersion;
  await check([], 'Negative control: sequential ordinary roots retain an END on target refusal and produce a knowledge gap on later success', async () => {
    const draft = await f.createDepartment('C0302-NONATOMIC-CONTROL', false), rejectedSource = await source();
    const closedOnFailure = await f.closure().endAssignment(f.endCommand(rejectedSource, Aug));
    await assert.rejects(f.semantics().createClassifiedAssignment(f.classifiedCommand(rejectedSource.acceptanceEvidence.engagement.engagementId, {
      businessValidFrom: Aug, placement: { ...f.transferCommand(rejectedSource).targetPlacement, departmentId: draft.departmentId },
    })), { message: 'ASSIGNMENT_PLACEMENT_UNPUBLISHED' });
    const failedHistory = await f.app().listAssignmentVersions({ ...f.scope, assignmentId: rejectedSource.assignmentId, afterVersionNo: '0', limit: 5 });
    assert.equal(failedHistory.length, 2); assert.equal(failedHistory[1]!.assignmentVersionId, closedOnFailure.assignmentVersionId);
    const s = await source(), ended = await f.closure().endAssignment(f.endCommand(s, Aug)), middle = await f.now();
    const target = await f.semantics().createClassifiedAssignment(f.classifiedCommand(s.acceptanceEvidence.engagement.engagementId, {
      businessValidFrom: Aug, placement: f.transferCommand(s).targetPlacement,
    }));
    assert.ok(ended.recordedFrom < target.coreVersion.recordedFrom); assert.ok(middle < target.coreVersion.recordedFrom);
    const gap = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: s.acceptanceEvidence.engagement.engagementId,
      purposeCode: 'ORGANIZATIONAL_AFFILIATION', scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt: Aug, recordAsOf: middle });
    assert.equal(gap.resolution, 'NONE');
    return { method: 'Post-implementation executed negative control using ordinary independent root transactions; not a pre-implementation baseline run',
      retainedEndOnTargetRefusal: closedOnFailure.assignmentVersionId, sourceEndR: ended.recordedFrom, middle,
      targetR: target.coreVersion.recordedFrom, primaryGap: gap.resolution };
  });
  await check(['AU-03', 'PE-03', 'RQ-04', 'RQ-05', 'BT-02'], 'Closed transfer contract, strict time input and deterministic reserved children', async () => {
    const s = await source(Dec), command = f.transferCommand(s);
    const extras = ['personId', 'engagementId', 'purposeCode', 'modeCode', 'targetAssignmentId', 'recordAsOf', 'recordedFrom',
      'prevalidated', 'validated', 'sourceRequestId', 'force', 'ignoreUnknown', 'roleId', 'credentialId', 'campusId', 'targetEnd', 'clinicalEligibility'];
    for (const key of extras) assert.throws(() => validateAssignmentTransfer({ ...command, [key]: randomUUID() }));
    for (const effectiveAt of ['infinity', '-infinity', '2026-02-30T00:00:00', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00+08:00', '0000-01-01T00:00:00'])
      assert.throws(() => validateAssignmentTransfer({ ...command, effectiveAt }));
    for (const effectiveAt of [Jan, '2025-12-31T23:59:59.999999', Dec, '2027-01-01T00:00:00']) {
      const root = randomUUID(); await assert.rejects(f.transfer(root).transferAssignment({ ...command, effectiveAt }), { message: 'ASSIGNMENT_TRANSFER_PERIOD_INVALID' });
      await assertTransferUnchanged(database, f, s, root);
    }
    const roots = ['a'.repeat(128), 'a'.repeat(127) + 'b', 'a', 'a:source', '中文\\"😀'];
    const observed = [];
    for (const root of roots) {
      const a = assignmentTransferChildRequests(f.scope.governanceObjectId, root);
      const b = assignmentTransferChildRequests(randomUUID(), root);
      assert.ok(a.source.length <= 128 && a.target.length <= 128); assert.notEqual(a.source, b.source); assert.notEqual(a.source, a.target);
      const native = (await sql<{ source: string; target: string }>`select
        person_master.assignment_transfer_child(${f.scope.governanceObjectId}::uuid,${root},'source') as source,
        person_master.assignment_transfer_child(${f.scope.governanceObjectId}::uuid,${root},'target') as target`.execute(database)).rows[0]!;
      assert.deepEqual(native, a); observed.push(a);
      for (const id of [a.source, a.target]) {
        await assert.rejects(f.transfer(id).transferAssignment(command), { message: 'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN' });
        await assert.rejects(f.app(id).createAssignment(f.command(s.acceptanceEvidence.engagement.engagementId)), { message: 'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN' });
        await assert.rejects(f.app(id).reviseAssignment({ ...f.scope, assignmentId: s.assignmentId, expectedCurrentVersionId: s.assignmentVersionId,
          businessValidFrom: Jan, businessValidTo: Dec, reasonCode: 'VALIDITY_CORRECTION' }), { message: 'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN' });
        await assert.rejects(f.closure(id).endAssignment(f.endCommand(s, Aug)), { message: 'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN' });
        await assert.rejects(f.semantics(id).createClassifiedAssignment(f.classifiedCommand(s.acceptanceEvidence.engagement.engagementId)), { message: 'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN' });
      }
    }
    assert.equal(new Set(observed.map(value => value.source)).size, roots.length);
    return { extraFields: extras, rootsTested: roots.length, derived: observed, boundaryRejections: 4 };
  });
  await check(['AU-04', 'AU-05'], 'Source must be classified, exact-head, unclosed and a different stable Department', async () => {
    const e = await f.createEngagement(), raw = await f.app().createAssignment(f.command(e.engagementId));
    const root = randomUUID(); await assert.rejects(f.transfer(root).transferAssignment(f.transferCommand(raw)), { message: 'ASSIGNMENT_TRANSFER_SOURCE_UNCLASSIFIED' });
    await assertTransferUnchanged(database, f, raw, root);
    const s = await source(), input = f.transferCommand(s);
    await assert.rejects(f.transfer().transferAssignment({ ...input, expectedSourceVersionId: randomUUID() }), { message: 'ASSIGNMENT_STALE_VERSION' });
    await assert.rejects(f.transfer().transferAssignment({ ...input, targetPlacement: { ...input.targetPlacement, departmentId: f.department.departmentId } }),
      { message: 'ASSIGNMENT_TRANSFER_SAME_DEPARTMENT' });
    const renamed = await f.createDepartment('C0302-RENAME');
    const s2 = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId,
      { placement: { ...input.targetPlacement, departmentId: renamed.departmentId } }))).coreVersion;
    await f.reviseDepartment(renamed.departmentId, 'ACTIVE', 'SYNTHETIC C0302 RENAMED');
    await assert.rejects(f.transfer().transferAssignment(f.transferCommand(s2, { targetPlacement: { ...input.targetPlacement, departmentId: renamed.departmentId } })),
      { message: 'ASSIGNMENT_TRANSFER_SAME_DEPARTMENT' });
    const closed = await f.closure().endAssignment(f.endCommand(s, '2028-01-01T00:00:00'));
    await assert.rejects(f.transfer().transferAssignment(f.transferCommand(closed)), { message: 'ASSIGNMENT_ALREADY_CLOSED' });
    return { raw: raw.assignmentId, futureClosure: closed.assignmentVersionId, renamedDepartment: renamed.departmentId };
  });
  await check(['PE-07', 'PC-06', 'BT-07'], 'Inactive source Department does not block transfer and source exact acceptance remains unchanged', async () => {
    const d = await f.createDepartment('C0302-INACTIVE-SOURCE'), e = await f.createEngagement();
    const s = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, {
      placement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: d.departmentId } }));
    await f.reviseDepartment(d.departmentId, 'SUSPENDED');
    const transferred = await f.transfer().transferAssignment(f.transferCommand(s.coreVersion));
    assert.deepEqual(await f.app().getAssignmentVersion({ ...f.scope, assignmentId: s.coreVersion.assignmentId, assignmentVersionId: s.coreVersion.assignmentVersionId }), s.coreVersion);
    const inherited = await f.semantics().getAssignmentVersionSemantics({ ...f.scope, assignmentId: transferred.sourceAssignmentId, assignmentVersionId: transferred.sourceClosureVersionId });
    assert.ok(inherited.classification === 'CLASSIFIED' && inherited.semanticRole === 'INHERITED_FOR_CLOSURE');
    assert.deepEqual(inherited.purpose, s.semantics.purpose); assert.equal(inherited.sourceSemanticFingerprint, s.semantics.semanticFingerprint);
    assert.equal(transferred.sourceClosure.closureEvidence.sourceAcceptanceDependencyFingerprint, s.coreVersion.acceptanceEvidence.dependencyFingerprint);
    return { source: s.coreVersion.assignmentVersionId, transfer: transferred.transferId, inherited };
  });
  await check(['PE-09', 'PE-10', 'TX-02', 'RQ-06'], 'Draft, unknown and insufficient target periods refuse without source closure; stable refusal survives target repair', async () => {
    const s = await source(), draft = await f.createDepartment('C0302-DRAFT', false), short = await f.createDepartment('C0302-SHORT', true, Dec);
    const observations = [];
    for (const [departmentId, code] of [[draft.departmentId, 'ASSIGNMENT_PLACEMENT_UNPUBLISHED'], [randomUUID(), 'ASSIGNMENT_PLACEMENT_NOT_FOUND'],
      [short.departmentId, 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED']]) {
      const root = randomUUID(), input = f.transferCommand(s);
      input.targetPlacement; const command = { ...input, targetPlacement: { ...input.targetPlacement, departmentId: departmentId! } };
      await assert.rejects(f.transfer(root).transferAssignment(command), { message: code });
      observations.push(await assertTransferUnchanged(database, f, s, root));
    }
    const root = randomUUID(), input = f.transferCommand(s, { targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: draft.departmentId } });
    await assert.rejects(f.transfer(root).transferAssignment(input), { message: 'ASSIGNMENT_PLACEMENT_UNPUBLISHED' });
    await f.publishDepartment(draft);
    await assert.rejects(f.transfer(root).transferAssignment(input), { message: 'ASSIGNMENT_PLACEMENT_UNPUBLISHED' });
    await assertTransferUnchanged(database, f, s, root);
    const accepted = await f.transfer().transferAssignment(input);
    return { observations, repairedTarget: draft.departmentId, oldRoot: root, newTransfer: accepted.transferId };
  });
  await check(['PE-11', 'PE-12', 'TX-02'], 'Latest shortened Engagement and interior microsecond suspension reject the full residual period', async () => {
    const observations = [];
    for (const kind of ['END', 'SUSPEND'] as const) {
      const e = await f.createEngagement(), s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion;
      if (kind === 'END') await f.lifecycle().endEngagement({ ...f.scope, engagementId: e.engagementId,
        expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Dec, reasonCode: 'SYNTHETIC_C0302_END' });
      else {
        await f.lifecycle().suspendEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '0',
          businessEffectiveAt: '2026-10-01T00:00:00.000001', reasonCode: 'SYNTHETIC_C0302_SUSPEND' });
        await f.lifecycle().resumeEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '1',
          businessEffectiveAt: '2026-10-01T00:00:00.000002', reasonCode: 'SYNTHETIC_C0302_RESUME' });
      }
      const root = randomUUID(); await assert.rejects(f.transfer(root).transferAssignment(f.transferCommand(s)),
        { message: kind === 'END' ? 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' : 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED' });
      observations.push(await assertTransferUnchanged(database, f, s, root));
    }
    return observations;
  });
  await check(['PC-03', 'TX-02'], 'An overlapping raw UNKNOWN remains in the real candidate set after source closure and forces rollback', async () => {
    const e = await f.createEngagement(), s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion;
    await f.app().createAssignment(f.command(e.engagementId, { businessValidFrom: Aug }));
    const root = randomUUID(); await assert.rejects(f.transfer(root).transferAssignment(f.transferCommand(s)), { message: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
    return assertTransferUnchanged(database, f, s, root, 2);
  });
  await check(['PC-02', 'TX-02'], 'A third real PRIMARY inserted in the released tail inside the body is visible and the entire body rolls back', async () => {
    const e = await f.createEngagement(), s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion;
    const root = randomUUID(); let observed = false;
    const result = await database.transaction().execute(async tx => {
      const observer = afterTransferInsert('audit_event', 'PERSON_ASSIGNMENT_ENDED', async () => {
        // No committed state can contain this third PRIMARY while the old primary
        // still occupies its full period. Inject a rollback-only native candidate
        // into the legitimately released tail at the same R, with real evidence
        // rows and the ordinary native guards enabled. Never retain this fixture.
        const t = await tx.selectFrom('person_master.assignment_transfer').selectAll().where('root_request_id', '=', root).executeTakeFirstOrThrow();
        const original = await tx.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', s.assignmentVersionId).executeTakeFirstOrThrow();
        const semantic = await tx.selectFrom('person_master.assignment_version_semantics').selectAll().where('assignment_version_id', '=', s.assignmentVersionId).executeTakeFirstOrThrow();
        const originalStable = await tx.selectFrom('person_master.assignment').selectAll().where('assignment_id', '=', s.assignmentId).executeTakeFirstOrThrow();
        const request = randomUUID(), hash = canonicalSha256({ fixture: 'C0302_ROLLBACK_ONLY_THIRD_PRIMARY', request });
        const { assignment_id: ignoredId, ...stableFields } = originalStable; void ignoredId;
        const identity = await tx.insertInto('person_master.assignment').values({ ...stableFields, creation_request_id: request, created_at: t.recorded_from })
          .returningAll().executeTakeFirstOrThrow();
        const { assignment_version_id: ignoredVersion, business_period: ignoredPeriod, ...versionFields } = original; void ignoredVersion; void ignoredPeriod;
        const dependency = { ...s.acceptanceEvidence, evaluationRecordAsOf: t.recorded_from,
          engagement: { ...s.acceptanceEvidence.engagement, requestedFrom: Aug, recordAsOf: t.recorded_from,
            stateSegments: s.acceptanceEvidence.engagement.stateSegments.map(segment => ({ ...segment, from: Aug })) },
          department: { ...s.acceptanceEvidence.department, recordAsOf: t.recorded_from } };
        const { recordAsOf: ignoredE, ...engagementEvidence } = dependency.engagement;
        const { recordAsOf: ignoredD, recordedTo: ignoredClosing, ...departmentEvidence } = dependency.department; void ignoredE; void ignoredD; void ignoredClosing;
        function normalize(value: unknown): unknown {
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value)) return temporalKey(value);
          if (Array.isArray(value)) return value.map(normalize);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
          return value;
        }
        const fingerprint = canonicalSha256(normalize({ policy: dependency.validationPolicyCode, engagement: engagementEvidence, department: departmentEvidence }));
        const v = await tx.insertInto('person_master.assignment_version').values({ ...versionFields, assignment_id: identity.assignment_id,
          business_valid_from: Aug, recorded_from: t.recorded_from, evaluation_record_as_of: t.recorded_from, request_id: request,
          operation_hash: hash, dependency_fingerprint: fingerprint }).returningAll().executeTakeFirstOrThrow();
        await tx.insertInto('person_master.assignment_validation_segment').values(dependency.engagement.stateSegments.map((segment, index) => ({
          assignment_version_id: v.assignment_version_id, engagement_id: e.engagementId, segment_no: index + 1,
          business_valid_from: segment.from, business_valid_to: segment.to, business_state: 'ACTIVE',
          last_applicable_lifecycle_event_id: segment.lastApplicableLifecycleEventId, lifecycle_sequence: segment.lifecycleSequence,
        }))).execute();
        assert.ok(semantic.evaluation && typeof semantic.evaluation === 'object' && !Array.isArray(semantic.evaluation));
        const evaluation = { ...semantic.evaluation, businessValidFrom: Aug, evaluationRecordAsOf: t.recorded_from,
          dependencyFingerprint: fingerprint.toString('hex'), confirmedPrimaryCount: 0, unclassifiedCandidateCount: 0 };
        await tx.insertInto('person_master.assignment_version_semantics').values({ ...semantic, assignment_id: identity.assignment_id,
          assignment_version_id: v.assignment_version_id, business_valid_from: Aug, semantic_recorded_from: t.recorded_from,
          evaluation_record_as_of: t.recorded_from, request_id: request, operation_hash: hash, evaluation: sql`${JSON.stringify(evaluation)}::jsonb`,
          semantic_fingerprint: canonicalSha256({ assignmentVersionId: v.assignment_version_id, ...ASSIGNMENT_SEMANTIC_POLICY, evaluation }) }).execute();
        await tx.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: f.scope.governanceObjectId,
          request_id: request, created_by: f.actor, operation_type: 'CLASSIFIED_CREATE', operation_hash: hash,
          assignment_version_id: v.assignment_version_id, rejection_code: null }).execute();
        observed = true;
      });
      return (await createAssignmentScope(tx.withPlugin(observer), f.context(f.actor, root))).transfer.transferAssignment(f.transferCommand(s));
    });
    assert.equal(observed, true); assert.ok(!result.ok); assert.equal(result.code, 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');
    return { transientThirdPrimaryObserved: observed, ...await assertTransferUnchanged(database, f, s, root) };
  });
  await check(['PC-04', 'PC-05'], 'Concurrent mode is preserved; independent Purpose and Engagement buckets are not mistaken for conflicts', async () => {
    const e = await f.createEngagement();
    const a = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
    await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { purposeCode: 'CLINICAL_PRACTICE' }));
    const concurrent = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { modeCode: 'STANDING_CONCURRENT' }));
    const x = await f.transfer().transferAssignment(f.transferCommand(concurrent.coreVersion));
    assert.equal(x.preservedModeCode, 'STANDING_CONCURRENT'); assert.equal(x.targetSemantics.evaluation.result, 'NOT_APPLICABLE_NON_PRIMARY');
    const y = await f.transfer().transferAssignment(f.transferCommand(a.coreVersion));
    assert.equal(y.targetSemantics.evaluation.result, 'SATISFIED');
    const independent = await source(); const z = await f.transfer().transferAssignment(f.transferCommand(independent));
    assert.notEqual(z.engagementId, y.engagementId);
    return { concurrent: x.transferId, primary: y.transferId, independent: z.transferId };
  });
  await check(['PC-07', 'TX-02'], 'The original 64-candidate budget still rejects transfer without truncation or source exclusion', async () => {
    const e = await f.createEngagement(), s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion;
    for (let i = 0; i < 64; i++) await f.app().createAssignment(f.command(e.engagementId, { businessValidTo: Jul }));
    const root = randomUUID(); await assert.rejects(f.transfer(root).transferAssignment(f.transferCommand(s)), { message: 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT' });
    return assertTransferUnchanged(database, f, s, root, 65);
  });
  await check(['PE-13', 'PE-14'], 'Current definition retirement refuses target while END remains valid; updated definitions are freshly frozen', async () => {
    const s = await source();
    const term = await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() });
    assert.ok(term); const rollback = new Error('C0302_TERM_PROBE_ROLLBACK'); const observations: unknown[] = [];
    for (const retired of [true, false]) await assert.rejects(database.transaction().execute(async tx => {
      const fresh = await (await createAssignmentScope(tx, f.context())).definitions.appendAssignmentSemanticTermVersion({
        ...f.scope, termId: term.termId, expectedCurrentVersionId: term.termVersionId, label: 'SYNTHETIC C0302 UPDATED',
        definitionState: retired ? 'RETIRED' : 'ENABLED', businessValidFrom: Jan, businessValidTo: retired ? Jul : null,
        reasonCode: retired ? 'RETIREMENT' : 'LABEL_CORRECTION' });
      const root = randomUUID(), module = (await createAssignmentScope(tx, f.context(f.actor, root))).transfer;
      const result = await module.transferAssignment(f.transferCommand(s));
      if (retired) {
        assert.ok(!result.ok); assert.equal(result.code, 'ASSIGNMENT_TERM_NOT_APPLICABLE');
        const closed = await (await createAssignmentScope(tx, f.context())).assignment.endAssignment(f.endCommand(s, Aug));
        assert.ok(closed.ok); assert.equal(closed.value.closureEvidence.sourceSemanticsVersionId, s.assignmentVersionId);
      } else {
        assert.ok(result.ok); assert.equal(result.value.targetSemantics.purpose.termVersionId, fresh.termVersionId);
        assert.notEqual(fresh.termVersionId, term.termVersionId);
        assert.equal(result.value.sourceClosure.closureEvidence.sourceSemanticsVersionId, s.assignmentVersionId);
      }
      await sql`set constraints all immediate`.execute(tx); observations.push({ retired, fresh: fresh.termVersionId, result }); throw rollback;
    }), error => error === rollback);
    assert.deepEqual(await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() }), term);
    return { transactionScopedOnly: true, observations };
  });
}
