import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, ValuesNode, ValueNode, type Kysely, type KyselyPlugin, type Transaction, type InsertObject } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { createAuditModule } from '../../apps/governance-api/src/modules/audit/index.js';
import { appendAssignmentClosure } from '../../apps/governance-api/src/modules/person-master/assignment-closure-store.js';
import { assignmentTransferChildRequests, ASSIGNMENT_TRANSFER_POLICY, ASSIGNMENT_TRANSFER_POLICY_DIGEST } from '../../apps/governance-api/src/modules/person-master/index.js';
import { Aug, Dec } from './person-assignment-fixture.js';
import type { TransferCheck, TransferFixture } from './person-assignment-transfer-fixture.js';

const ROLLBACK = new Error('C0302_SQL_PROBE_ROLLBACK');
export async function runAssignmentTransferSql(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  const s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId, { businessValidTo: Dec }))).coreVersion;
  const prior = await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', s.assignmentVersionId).executeTakeFirstOrThrow();
  const stable = await database.selectFrom('person_master.assignment').selectAll().where('assignment_id', '=', s.assignmentId).executeTakeFirstOrThrow();
  const successfulSource = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
  const complete = await f.transfer().transferAssignment(f.transferCommand(successfulSource));
  const completedHeader = await database.selectFrom('person_master.assignment_transfer').selectAll().where('transfer_id', '=', complete.transferId).executeTakeFirstOrThrow();
  async function negative(name: string, work: (tx: Transaction<DB>) => Promise<unknown>, expected = '23514|23503', isolation: 'read committed' | 'repeatable read' = 'read committed') {
    let evidence: { name: string; sqlState: string; message: string } | undefined;
    try { await database.transaction().setIsolationLevel(isolation).execute(async tx => {
      await work(tx); await sql`set constraints all immediate`.execute(tx); throw ROLLBACK;
    }); } catch (error) {
      if (error !== ROLLBACK) {
        assert.ok(error && typeof error === 'object' && 'code' in error, `${name}: NATIVE_SQL_ERROR_REQUIRED: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
        evidence = { name, sqlState: String(error.code), message: error instanceof Error ? error.message : 'POSTGRES_ERROR' };
      }
    }
    assert.ok(evidence, `${name}: SQL_NEGATIVE_ACCEPTED`); assert.match(evidence.sqlState, new RegExp(expected)); return evidence;
  }
  function header(tx: Transaction<DB>, changes: Partial<InsertObject<DB, 'person_master.assignment_transfer'>> = {}) {
    const root = randomUUID(), children = assignmentTransferChildRequests(f.scope.governanceObjectId, root);
    return tx.insertInto('person_master.assignment_transfer').values({
      governance_object_id: f.scope.governanceObjectId, root_request_id: root, created_by: f.actor,
      operation_hash: Buffer.alloc(32, 4), source_operation_hash: Buffer.alloc(32, 5), target_operation_hash: Buffer.alloc(32, 6),
      source_assignment_id: s.assignmentId, source_previous_version_id: s.assignmentVersionId,
      person_id: stable.person_id, engagement_id: stable.engagement_id,
      source_department_governance_object_id: stable.department_governance_object_id, source_department_id: stable.department_id,
      target_department_governance_object_id: f.transferCommand(s).targetPlacement.departmentGovernanceObjectId, target_department_id: f.target.departmentId,
      source_original_from: s.businessValidFrom, source_original_to: s.businessValidTo, effective_at: Aug,
      preserved_purpose_code: 'ORGANIZATIONAL_AFFILIATION', preserved_mode_code: 'PRIMARY_AFFILIATION',
      source_request_id: children.source, target_request_id: children.target,
      policy_code: ASSIGNMENT_TRANSFER_POLICY.policyCode, policy_version: 1, policy_digest: Buffer.from(ASSIGNMENT_TRANSFER_POLICY_DIGEST, 'hex'), ...changes,
    }).returningAll().executeTakeFirstOrThrow();
  }
  await check(['TX-08', 'TX-10'], 'Native successful audits must identify the exact transfer participants and entity kind', async () => {
    const observations = [];
    for (const [action, column, value] of [
      ['PERSON_ASSIGNMENT_CREATED', 'stable_entity_id', randomUUID()],
      ['ASSIGNMENT_SEMANTICS_RECORDED', 'stable_entity_id', randomUUID()],
      ['PERSON_ASSIGNMENT_CREATED', 'entity_type', 'PERSON_SUBJECT'],
      ['ASSIGNMENT_SEMANTICS_RECORDED', 'entity_type', 'PERSON_SUBJECT'],
      ['PERSON_ASSIGNMENT_ENDED', 'entity_type', 'PERSON_SUBJECT'],
      ['PERSON_ASSIGNMENT_ENDED', 'stable_entity_id', randomUUID()],
      ['PERSON_ASSIGNMENT_TRANSFERRED', 'stable_entity_id', randomUUID()],
      ['PERSON_ASSIGNMENT_TRANSFERRED', 'entity_version_id', randomUUID()],
      ['PERSON_ASSIGNMENT_TRANSFERRED', 'entity_type', 'PERSON_SUBJECT'],
    ]) {
      let altered = false;
      const plugin: KyselyPlugin = {
        transformQuery(args) {
          if (!altered && args.node.kind === 'InsertQueryNode' && args.node.values && ValuesNode.is(args.node.values)
            && JSON.stringify(args.node).includes('"name":"audit_event"') && JSON.stringify(args.node).includes(JSON.stringify(action))) {
            const index = args.node.columns?.findIndex(item => item.column.name === column); assert.ok(index !== undefined && index >= 0);
            altered = true;
            return { ...args.node, values: ValuesNode.create(args.node.values.values.map(row => row.kind === 'PrimitiveValueListNode'
              ? { ...row, values: row.values.map((item, position) => position === index ? value : item) }
              : { ...row, values: row.values.map((item, position) => position === index ? ValueNode.create(value) : item) })) };
          }
          return args.node;
        }, async transformResult(args) { return args.result; },
      };
      observations.push(await negative(`wrong audit ${action}:${column}`, async tx => {
        await (await createAssignmentScope(tx.withPlugin(plugin), f.context())).transfer.transferAssignment(f.transferCommand(s));
      }, '23514'));
      assert.equal(altered, true);
    }
    return { method: 'test-local native INSERT parameter mutation; all guards enabled; rollback-only', observations };
  });
  await check(['RQ-03', 'TX-10'], 'Native extra root cannot borrow an already completed foreign request receipt', async () => {
    return negative('extra root referencing existing transfer', tx => tx.insertInto('person_master.assignment_command_outcome').values({
      governance_object_id: f.scope.governanceObjectId, request_id: randomUUID(), created_by: f.actor, operation_type: 'TRANSFER',
      operation_hash: completedHeader.operation_hash, assignment_version_id: null, transfer_id: complete.transferId, rejection_code: null,
    }).execute());
  });
  await check(['TX-08', 'TX-09', 'CC-07'], 'Native unpaired header and standalone child cannot commit; RR header writes fail explicitly', async () => {
    const observations = [];
    observations.push(await negative('header without participants', tx => header(tx)));
    observations.push(await negative('RR transfer header', tx => header(tx), '0A000', 'repeatable read'));
    const children = assignmentTransferChildRequests(f.scope.governanceObjectId, randomUUID());
    observations.push(await negative('source child without parent', tx => appendAssignmentClosure(tx, f.context(f.actor, children.source), prior,
      f.endCommand(s, Aug), Buffer.alloc(32, 5))));
    observations.push(await negative('target child without parent', tx => tx.insertInto('person_master.assignment').values({
      governance_object_id: f.scope.governanceObjectId, engagement_id: stable.engagement_id, person_id: stable.person_id,
      department_governance_object_id: stable.department_governance_object_id, department_id: stable.department_id,
      placement_scope: 'DEPARTMENT', relation_basis: 'CONFIRMED_DISTINCT_PLACEMENT', creation_request_id: children.target, created_by: f.actor,
    }).execute()));
    observations.push(await negative('source child with complete END evidence but no target or root', async tx => {
      const t = await header(tx), ctx = f.context(f.actor, t.source_request_id);
      const closed = await appendAssignmentClosure(tx, ctx, prior, f.endCommand(s, Aug), t.source_operation_hash);
      await tx.insertInto('person_master.assignment_command_outcome').values({ governance_object_id: f.scope.governanceObjectId,
        request_id: t.source_request_id, created_by: f.actor, operation_type: 'END', operation_hash: t.source_operation_hash,
        assignment_version_id: closed.assignmentVersionId, rejection_code: null }).execute();
      await createAuditModule(tx, ctx).append({ governanceObjectId: f.scope.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT',
        aggregateId: s.assignmentId, aggregateVersionId: closed.assignmentVersionId, eventType: 'PERSON_ASSIGNMENT_ENDED',
        payload: { fixture: 'SYNTHETIC_ROLLBACK_ONLY' }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
    }));
    observations.push(await negative('explicit NOT NULL is not deferrable', tx => header(tx, { effective_at: sql`null` }), '23502'));
    return observations;
  });
  await check(['BT-02', 'TX-10'], 'Native target evaluation and semantic clocks reject wrong pairings including past and future clocks', async () => {
    const observations = [], d = complete.targetAdmission.acceptanceEvidence.department;
    const semantic = await database.selectFrom('person_master.assignment_version_semantics').selectAll()
      .where('assignment_version_id', '=', s.assignmentVersionId).executeTakeFirstOrThrow();
    for (const badClock of ['2026-01-01T00:00:00', '2099-01-01T00:00:00']) for (const target of ['EVALUATION', 'SEMANTIC']) {
      observations.push(await negative(`forged ${target} clock ${badClock}`, async tx => {
        const t = await header(tx);
        const identity = await tx.insertInto('person_master.assignment').values({ governance_object_id: t.governance_object_id,
          engagement_id: t.engagement_id, person_id: t.person_id, department_governance_object_id: t.target_department_governance_object_id,
          department_id: t.target_department_id, placement_scope: 'DEPARTMENT', relation_basis: 'CONFIRMED_DISTINCT_PLACEMENT',
          creation_request_id: t.target_request_id, created_by: f.actor }).returningAll().executeTakeFirstOrThrow();
        const { assignment_version_id: ignoredId, business_period: ignoredRange, ...fields } = prior; void ignoredId; void ignoredRange;
        const version = await tx.insertInto('person_master.assignment_version').values({ ...fields, assignment_id: identity.assignment_id,
          department_id: t.target_department_id, business_valid_from: Aug, recorded_from: t.recorded_from,
          evaluation_record_as_of: target === 'EVALUATION' ? badClock : t.recorded_from, request_id: t.target_request_id, operation_hash: t.target_operation_hash,
          department_version_id: d.departmentVersionId, department_version_no: d.versionNo, department_content_hash: Buffer.from(d.contentHash, 'hex'),
          department_recorded_from: d.recordedFrom, department_recorded_to: d.recordedTo, department_release_id: d.releaseId,
          department_publication_projection_id: d.publicationProjectionId, department_published_at: d.publishedAt,
          department_business_status: 'ACTIVE', department_valid_from: d.businessValidFrom, department_valid_to: d.businessValidTo,
        }).returningAll().executeTakeFirstOrThrow();
        await tx.insertInto('person_master.assignment_version_semantics').values({ ...semantic, assignment_version_id: version.assignment_version_id,
          assignment_id: identity.assignment_id, business_valid_from: Aug, semantic_recorded_from: badClock, evaluation_record_as_of: t.recorded_from,
          request_id: t.target_request_id, operation_hash: t.target_operation_hash }).execute();
      }, '23514'));
    }
    return observations;
  });
  await check(['TX-10', 'TX-11', 'BT-02'], 'Native transfer mapping rejects mismatched identity, periods, namespace and frozen policy', async () => {
    const observations = [];
    for (const changes of [
      { person_id: randomUUID() }, { engagement_id: randomUUID() }, { source_previous_version_id: randomUUID() },
      { source_assignment_id: randomUUID() }, { governance_object_id: randomUUID() }, { source_department_id: randomUUID() },
      { target_department_id: stable.department_id }, { target_department_governance_object_id: randomUUID() },
      { source_original_from: Aug }, { source_original_to: null }, { effective_at: Dec }, { preserved_purpose_code: 'CLINICAL_PRACTICE' },
      { preserved_mode_code: 'STANDING_CONCURRENT' }, { source_request_id: complete.sourceRequestId }, { target_request_id: complete.targetRequestId },
      { policy_digest: Buffer.alloc(32, 0) },
    ]) observations.push(await negative(`invalid mapping ${Object.keys(changes).join()}`, tx => header(tx, changes)));
    observations.push(await negative('second transfer from closed source', tx => tx.insertInto('person_master.assignment_transfer').values(completedHeader).execute()));
    observations.push(await negative('root result cannot contain both references', tx => tx.insertInto('person_master.assignment_command_outcome').values({
      governance_object_id: f.scope.governanceObjectId, request_id: randomUUID(), created_by: f.actor, operation_type: 'TRANSFER',
      operation_hash: Buffer.alloc(32, 4), assignment_version_id: complete.targetAdmissionVersionId, transfer_id: complete.transferId, rejection_code: null,
    }).execute()));
    observations.push(await negative('null root result cannot pass SQL three-valued logic', tx => tx.insertInto('person_master.assignment_command_outcome').values({
      governance_object_id: f.scope.governanceObjectId, request_id: randomUUID(), created_by: f.actor, operation_type: 'TRANSFER',
      operation_hash: Buffer.alloc(32, 4), assignment_version_id: null, transfer_id: null, rejection_code: null,
    }).execute()));
    return observations;
  });
  await check(['TX-08'], 'Omitting each root/child outcome or success audit reaches a native deferred completeness refusal', async () => {
    const omissions = [
      ['assignment_command_outcome', 'TRANSFER'], ['assignment_command_outcome', 'END'], ['assignment_command_outcome', 'CLASSIFIED_CREATE'],
      ['audit_event', 'PERSON_ASSIGNMENT_ENDED'], ['audit_event', 'PERSON_ASSIGNMENT_CREATED'],
      ['audit_event', 'ASSIGNMENT_SEMANTICS_RECORDED'], ['audit_event', 'PERSON_ASSIGNMENT_TRANSFERRED'],
    ];
    const observations = [];
    for (const [table, marker] of omissions) {
      let omitted = false;
      const suppressed = new WeakSet<object>();
      const plugin: KyselyPlugin = {
        transformQuery(args) {
          if (!omitted && args.node.kind === 'InsertQueryNode' && JSON.stringify(args.node).includes(`"name":"${table}"`)
            && JSON.stringify(args.node).includes(JSON.stringify(marker))) {
            omitted = true;
            suppressed.add(args.queryId);
            // Execute an actual zero-row INSERT of the same native column types.
            // No trigger is disabled and no existing row is removed.
            assert.ok(args.node.columns);
            return { ...args.node, values: sql`select ${sql.join(args.node.columns.map(column => sql.ref(column.column.name)))}
              from ${sql.table(table === 'audit_event' ? 'audit.audit_event' : 'person_master.assignment_command_outcome')} where false`.toOperationNode() };
          }
          return args.node;
        }, async transformResult(args) {
          // Let the application continue to the real deferred guard despite the
          // deliberately missing audit's returning row. This is a negative fixture.
          if (suppressed.has(args.queryId)) return { ...args.result, rows: [{ audit_event_id: randomUUID(), recorded_at: '2026-09-08T00:00:00' }] };
          return args.result;
        },
      };
      observations.push(await negative(`omitted ${table}:${marker}`, async tx => {
        await (await createAssignmentScope(tx.withPlugin(plugin), f.context())).transfer.transferAssignment(f.transferCommand(s));
      }));
      assert.equal(omitted, true);
    }
    return { method: 'test-local SQL omission; real deferred database guard refusal; rollback-only', observations };
  });
  await check(['TX-12'], 'Transfer mapping is immutable under UPDATE, DELETE and TRUNCATE with all original guards enabled', async () => {
    const observations = [];
    observations.push(await negative('transfer UPDATE', tx => sql`update person_master.assignment_transfer set effective_at=effective_at where transfer_id=${complete.transferId}::uuid`.execute(tx), '55000'));
    observations.push(await negative('transfer DELETE', tx => sql`delete from person_master.assignment_transfer where transfer_id=${complete.transferId}::uuid`.execute(tx), '55000'));
    observations.push(await negative('transfer TRUNCATE', tx => sql`truncate person_master.assignment_transfer cascade`.execute(tx), '55000'));
    assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: complete.transferId }), complete);
    return observations;
  });
}
