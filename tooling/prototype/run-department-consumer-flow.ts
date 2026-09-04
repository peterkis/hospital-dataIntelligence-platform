import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { Check } from 'typebox/value';
import { createGovernanceApiClient, type GovernanceApiOperations } from '@hospital-data-intelligence/generated-api-client';
import { runSimulatedConsumerOnce } from '../../apps/sim-consumer/src/consumer.js';
import { buildApplication } from '../../apps/governance-api/src/composition/build-application.js';
import { createScopedModules, PHASE_01_PROJECTION_CONTRACTS, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createPhase01VerticalSlice } from '../../apps/governance-api/src/composition/phase-01-vertical-slice.js';
import { createDepartmentGovernanceHttpDependencies } from '../../apps/governance-api/src/composition/create-department-governance-http-dependencies.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import {
  DepartmentMasterProjectionSchema, DepartmentHierarchyProjectionSchema,
  type HierarchyNodeInput,
} from '../../apps/governance-api/src/modules/department-master/index.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTransactionRunner, type RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { canonicalSha256, sha256Bytes } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { createPrototypeAuthentication, PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';
import { PROTOTYPE_FIXTURE as fixture } from './prototype-fixture.js';
import { checkDepartmentConsumerCanonical } from './check-department-consumer-canonical.js';
import { checkConsumerLifecycleFlow } from './check-consumer-lifecycle-flow.js';
import { checkConsumerSlaFlow } from './check-consumer-sla-flow.js';

const masterObject = fixture.departmentMasterObjectId;
const hierarchyObject = '74100000-0000-7000-8000-000000000001';
const hierarchyView = '73000000-0000-7000-8000-000000000001';
const subscriptionPath = '/v1/phase-01/consumer-subscriptions' as const;
const versionPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions' as const;
const eventsPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/events' as const;
const snapshotPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content' as const;
const receiptPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts' as const;
const csrf = { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN };
type Client = ReturnType<typeof createGovernanceApiClient>;
type Event = GovernanceApiOperations['listPhase01ConsumerEvents']['responses'][200]['content']['application/json']['events'][number];
type SubscriptionBody = GovernanceApiOperations['createPhase01ConsumerSubscription']['requestBody']['content']['application/json'];

// This composition exists only in tooling. Production still resolves Keycloak JWTs.
export async function runDepartmentConsumerFlow(options: { verifyLifecycle?: boolean; verifySla?: boolean } = {}) {
  assert.notEqual(process.env['NODE_ENV']?.toLowerCase(), 'production');
  const connectionString = process.env['DATABASE_URL'];
  assert.ok(connectionString, 'PROTOTYPE_DATABASE_CONFIGURATION_REQUIRED');
  const suffix = randomUUID();
  const applicationName = `hdi-department-consumer-${suffix}`;
  const handle = createDatabase({ connectionString, max: 4, application_name: applicationName });
  const database = handle.database;
  const runner = createTransactionRunner<ScopedModules>(database, (transaction, context) =>
    createScopedModules(transaction, context, database));
  const workflow = createWorkflowApplication(runner);
  const secondServiceId = randomUUID();
  const disabledServiceId = randomUUID();
  const masterToken = randomUUID();
  const hierarchyToken = randomUUID();
  const personToken = randomUUID();
  const prototypeAuthentication = createPrototypeAuthentication({
    host: '127.0.0.1', nodeEnvironment: 'test', prototypeMode: 'true',
  });
  const resolvePrincipal = async (request: FastifyRequest) => {
    const authorization = request.headers.authorization;
    if (authorization === `Bearer ${masterToken}`) {
      return { principalId: fixture.serviceConsumerPrincipalId, principalKind: 'SERVICE' as const };
    }
    if (authorization === `Bearer ${hierarchyToken}`) {
      return { principalId: secondServiceId, principalKind: 'SERVICE' as const };
    }
    if (authorization === `Bearer ${personToken}`) {
      return { principalId: fixture.actorPrincipalId, principalKind: 'PERSON' as const };
    }
    if (authorization) throw new Error('SERVICE_TOKEN_UNAUTHENTICATED');
    return prototypeAuthentication.resolvePrincipal(request);
  };
  const context = (actorPrincipalId: string = fixture.actorPrincipalId): RequestContext => ({
    actorPrincipalId, requestId: randomUUID(), correlationId: suffix, occurredAt: now(),
  });
  const application = await buildApplication({
    phase01: { transactionRunner: runner, workflowApplication: workflow,
      verticalSlice: createPhase01VerticalSlice(runner), resolvePrincipal, now },
    departmentGovernance: createDepartmentGovernanceHttpDependencies({
      database, transactionRunner: runner, workflowApplication: workflow, resolvePrincipal, now,
    }),
  });
  const stateDirectory = await mkdtemp(join(tmpdir(), 'hdi-department-consumer-'));
  const statePaths = [join(stateDirectory, 'master.json'), join(stateDirectory, 'hierarchy.json')];
  const checks: Record<string, boolean> = {};
  const consumed: { subscriptionId: string; event: Event }[] = [];
  let lifecycleHistories: Awaited<ReturnType<ScopedModules['releaseDistribution']['getSubscriptionHistory']>>[] = [];
  let slaResult: Awaited<ReturnType<typeof checkConsumerSlaFlow>> | undefined;
  let migrationCount = 0;
  let forbiddenTimezoneTypeCount = -1;
  try {
    checkDepartmentConsumerCanonical();
    checks['canonicalDepartmentSchemaDigestsUnchanged'] = true;
    await database.insertInto('platform.security_principal').values([
      { security_principal_id: secondServiceId, principal_code: `PROTOTYPE-SYNTHETIC-CONSUMER-${suffix}`, principal_kind: 'SERVICE', status: 'ACTIVE' },
      { security_principal_id: disabledServiceId, principal_code: `PROTOTYPE-SYNTHETIC-DISABLED-${suffix}`, principal_kind: 'SERVICE', status: 'DISABLED' },
    ]).execute();
    const baseUrl = await application.listen({ host: '127.0.0.1', port: 0 });
    const browser = (code: string): Client => createGovernanceApiClient({
      baseUrl, csrfToken: PROTOTYPE_CSRF_TOKEN,
      fetch(input, init) {
        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        headers.set('x-prototype-principal-code', code);
        return fetch(input, { ...init, headers });
      },
    });
    const owner = browser('prototype-owner');
    const reviewer = browser('prototype-reviewer');
    const approver = browser('prototype-final-owner');
    const serviceA = createGovernanceApiClient({ baseUrl, accessToken: masterToken });
    const serviceB = createGovernanceApiClient({ baseUrl, accessToken: hierarchyToken });
    const person = createGovernanceApiClient({ baseUrl, accessToken: personToken });
    const masterBody: SubscriptionBody = {
      subscriptionCode: `PROTOTYPE-SYNTHETIC-MASTER-${suffix}`, servicePrincipalId: fixture.serviceConsumerPrincipalId,
      governanceObjectId: masterObject, projectionType: 'hdi.department-master', projectionSchemaVersion: '1',
    };
    const hierarchyBody: SubscriptionBody = {
      subscriptionCode: `PROTOTYPE-SYNTHETIC-HIERARCHY-${suffix}`, servicePrincipalId: secondServiceId,
      governanceObjectId: hierarchyObject, projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1',
    };
    const create = (body: SubscriptionBody, client = owner) => client.POST(subscriptionPath, { params: { header: csrf }, body });
    for (const body of [
      { ...masterBody, governanceObjectId: hierarchyObject },
      { ...hierarchyBody, governanceObjectId: masterObject },
    ]) await rejected(create(body), 400, 'CONSUMER_PROJECTION_GOVERNANCE_OBJECT_MISMATCH');
    checks['governanceObjectProjectionMismatchRejected'] = true;
    for (const servicePrincipalId of [fixture.actorPrincipalId, disabledServiceId, randomUUID()]) {
      await rejected(create({ ...masterBody, servicePrincipalId }), 400, 'CONSUMER_SERVICE_PRINCIPAL_INVALID');
    }
    checks['servicePrincipalKindEnforced'] = true;
    // Deliberately invalid wire input goes through the real HTTP validator.
    for (const projectionSchemaVersion of ['0', '2', 'unknown']) {
      const response = await fetch(`${baseUrl}${subscriptionPath}`, { method: 'POST',
        headers: { ...csrf, 'content-type': 'application/json', 'x-prototype-principal-code': 'prototype-owner' },
        body: JSON.stringify({ ...masterBody, projectionSchemaVersion }) });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, 'REQUEST_SCHEMA_INVALID');
    }
    checks['invalidProjectionPairRejected'] = true;
    await rejected(create(masterBody, serviceA), 403, 'PRINCIPAL_KIND_FORBIDDEN');
    await rejected(create(masterBody, reviewer), 403, 'OBJECT_PERMISSION_FORBIDDEN');
    const rejectedCount = await database.selectFrom('release_distribution.consumer_subscription')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('subscription_code', 'like', `%${suffix}`).executeTakeFirstOrThrow();
    assert.equal(rejectedCount.count, '0');
    checks['failedSubscriptionCreatesNoRows'] = true;
    const master = data(await create(masterBody));
    const hierarchy = data(await create(hierarchyBody));
    checks['departmentMasterSubscriptionSupported'] = true;
    checks['departmentHierarchySubscriptionSupported'] = true;

    const supportHistory = async (subscriptionId: string) => database
      .selectFrom('release_distribution.consumer_subscription_version as version')
      .innerJoin('release_distribution.consumer_projection_support as support',
        'support.consumer_subscription_version_id', 'version.consumer_subscription_version_id')
      .select(['version.version_no', 'support.projection_type', 'support.projection_schema_version', 'support.projection_schema_digest'])
      .where('version.consumer_subscription_id', '=', subscriptionId).orderBy('version.version_no').execute();
    for (const [subscription, body] of [[master, masterBody], [hierarchy, hierarchyBody]] as const) {
      const before = await supportHistory(subscription.subscriptionId);
      const version = data(await owner.POST(versionPath, { params: { path: subscription, header: csrf },
        body: { governanceObjectId: body.governanceObjectId, projectionType: body.projectionType, projectionSchemaVersion: '1' } }));
      assert.equal(version.versionNo, '2');
      const after = await supportHistory(subscription.subscriptionId);
      assert.deepEqual(after.slice(0, 1), before);
      assert.equal(after[1]?.projection_schema_digest.toString('hex'), before[0]?.projection_schema_digest.toString('hex'));
      await rejected(owner.POST(versionPath, { params: { path: subscription, header: csrf },
        body: { governanceObjectId: body.governanceObjectId,
          projectionType: body.projectionType === 'hdi.department-master' ? 'hdi.department-hierarchy' : 'hdi.department-master', projectionSchemaVersion: '1' } }),
      400, 'CONSUMER_PROJECTION_GOVERNANCE_OBJECT_MISMATCH');
      await rejected(owner.POST(versionPath, { params: { path: subscription, header: csrf },
        body: { governanceObjectId: body.governanceObjectId === masterObject ? hierarchyObject : masterObject,
          projectionType: body.projectionType, projectionSchemaVersion: '1' } }), 404, 'CONSUMER_SUBSCRIPTION_NOT_FOUND');
      assert.deepEqual(await supportHistory(subscription.subscriptionId), after);
    }
    checks['subscriptionVersionHistoryImmutable'] = true;

    // Module callers get the same fail-closed guards, including internal Charge/Price pairs.
    for (const contract of PHASE_01_PROJECTION_CONTRACTS) {
      const object = contract.projectionType === 'hdi.charge-catalog' ? fixture.chargeCatalogObjectId
        : contract.projectionType === 'hdi.price-list' ? fixture.priceListObjectId
          : contract.projectionType === 'hdi.department-master' ? masterObject : hierarchyObject;
      const rollback = new Error('SYNTHETIC_MODULE_ROLLBACK');
      await assert.rejects(runner.run(context(), async (modules) => {
        await modules.releaseDistribution.createSubscription({ ...masterBody,
          subscriptionCode: `PROTOTYPE-MODULE-${suffix}`, governanceObjectId: object,
          projectionType: contract.projectionType, projectionSchemaVersion: contract.schemaVersion });
        throw rollback;
      }), (error) => error === rollback);
      await assert.rejects(runner.run(context(), (modules) => modules.releaseDistribution.createSubscription({
        ...masterBody, governanceObjectId: object, projectionType: contract.projectionType, projectionSchemaVersion: 'unknown',
      })), { message: 'PROJECTION_CONTRACT_UNKNOWN' });
    }
    checks['existingPriceAndChargePairsSupported'] = true;

    // Immutable test fixture representing an old, incompatible consumer declaration.
    const blocked = data(await create({ ...masterBody, subscriptionCode: `PROTOTYPE-SYNTHETIC-BLOCKED-${suffix}` }));
    await database.transaction().execute(async (transaction) => {
      const version = await transaction.insertInto('release_distribution.consumer_subscription_version')
        .values({ consumer_subscription_id: blocked.subscriptionId, version_no: '2', recorded_sequence: '2', status: 'ACTIVE' })
        .returning('consumer_subscription_version_id').executeTakeFirstOrThrow();
      await transaction.insertInto('release_distribution.consumer_projection_support').values({
        consumer_subscription_version_id: version.consumer_subscription_version_id,
        projection_type: 'hdi.department-master', projection_schema_version: '1', projection_schema_digest: Buffer.alloc(32),
      }).execute();
    });
    const blockedHistory = await supportHistory(blocked.subscriptionId);

    const draft = data(await owner.POST('/v1/department-governance/department-drafts', { params: { header: csrf }, body: {
      governanceObjectId: masterObject, departmentCode: `PV005B02B-${suffix}`,
      content: { standardName: `PROTOTYPE SYNTHETIC CONSUMER ${suffix}`, shortName: null,
        departmentType: 'AUXILIARY', subjectMappingApplicability: 'EXEMPT_AUXILIARY', lifecycleStatus: 'ACTIVE',
        businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, campusIds: [] },
    } }));
    const submitted = data(await owner.POST('/v1/department-governance/departments/{departmentId}/versions/{departmentVersionId}/submissions', {
      params: { path: draft, header: csrf }, body: { governanceObjectId: masterObject, expectedContentHash: draft.contentHash, changeReason: 'PROTOTYPE SYNTHETIC CONSUMER VALIDATION' },
    }));
    assert.ok(submitted.governanceRequestId);
    const decision = { governanceObjectId: masterObject, departmentId: draft.departmentId,
      departmentVersionId: draft.departmentVersionId, seenContentHash: draft.contentHash,
      decision: 'APPROVED' as const, reason: 'PROTOTYPE SYNTHETIC CONSUMER VALIDATION' };
    const parameters = { path: { governanceRequestId: submitted.governanceRequestId }, header: csrf };
    data(await reviewer.POST('/v1/department-governance/requests/{governanceRequestId}/reviews', { params: parameters, body: decision }));
    const published = data(await approver.POST('/v1/department-governance/requests/{governanceRequestId}/approvals', { params: parameters, body: decision }));
    assert.equal(published.status, 'PUBLISHED');
    const masterEvent = await onlyEvent(serviceA, master.subscriptionId);
    checks['departmentMasterEventObserved'] = masterEvent.projectionType === 'hdi.department-master';

    // Reuse the administrative stable view and its frozen references; create a new version.
    const current = await database.selectFrom('department_master.department_hierarchy_view_version')
      .select('department_hierarchy_view_version_id').where('department_hierarchy_view_id', '=', hierarchyView)
      .orderBy('version_no', 'desc').limit(1).executeTakeFirstOrThrow();
    // Inject one local instant for this synthetic hierarchy transition. The
    // existing model closes the preceding recorded period at publication;
    // draft and publication must share that boundary even across a clock tick.
    const hierarchyTime = now();
    const hierarchyContext = (actor: string = fixture.actorPrincipalId): RequestContext => ({
      ...context(actor), occurredAt: hierarchyTime,
    });
    const hierarchyDraft = await runner.run(hierarchyContext(), async (modules) => {
      await modules.authorization.requireObjectPermission({ governanceObjectId: hierarchyObject, permissionCode: 'DEPARTMENT_HIERARCHY_DRAFT_WRITE' });
      const source = await modules.departmentMaster.getHierarchySnapshot({ governanceObjectId: hierarchyObject, hierarchyViewVersionId: current.department_hierarchy_view_version_id });
      assert.ok(source);
      const nodes: HierarchyNodeInput[] = source.nodes.map((node) => ({
        nodeKey: node.id, parentNodeKey: node.parentNodeId, displayName: node.displayName, sortOrder: node.sortOrder,
        ...(node.nodeKind === 'GROUP' ? { nodeKind: 'GROUP', groupId: node.groupId, groupVersionId: node.groupVersionId }
          : { nodeKind: 'DEPARTMENT', departmentId: node.departmentId, departmentVersionId: node.departmentVersionId }),
      }));
      return modules.departmentMaster.createHierarchyViewVersion({ governanceObjectId: hierarchyObject,
        hierarchyViewId: hierarchyView, businessValidFrom: source.version.businessValidFrom, businessValidTo: source.version.businessValidTo,
        recordedFrom: hierarchyTime, actorPrincipalId: fixture.actorPrincipalId, nodes });
    });
    const request = await workflow.submit(hierarchyContext(), { governanceObjectId: hierarchyObject,
      entityType: 'DEPARTMENT_HIERARCHY_VIEW_VERSION', stableEntityId: hierarchyView, entityVersionId: hierarchyDraft.version.id,
      changeKind: 'VERSION_CHANGE', riskClassification: 'NORMAL', submittedContentDigest: hierarchyDraft.version.contentHash.toString('hex'),
      changeReason: 'PROTOTYPE SYNTHETIC HIERARCHY CONSUMER', campusId: null, frozenEvidence: { synthetic: true } });
    const action = { changeRequestId: request.changeRequestId, actionResult: 'APPROVED' as const,
      reason: 'PROTOTYPE SYNTHETIC HIERARCHY CONSUMER', seenContentDigest: hierarchyDraft.version.contentHash.toString('hex'), campusId: null };
    await workflow.act(hierarchyContext(fixture.reviewerPrincipalId), { ...action, stageType: 'PROFESSIONAL_REVIEW' });
    const hierarchyPublication = await workflow.act(hierarchyContext(fixture.approverPrincipalId), { ...action, stageType: 'OWNER_FINAL_APPROVAL' });
    assert.ok(hierarchyPublication.publication);
    const hierarchyEvent = await onlyEvent(serviceB, hierarchy.subscriptionId);
    checks['departmentHierarchyEventObserved'] = hierarchyEvent.projectionType === 'hdi.department-hierarchy';

    for (const [subscription, event] of [[master, masterEvent], [hierarchy, hierarchyEvent]] as const) {
      const counts = await sql<{ releases: string; snapshots: string; events: string; compatibility: string }>`
        select (select count(*) from release_distribution.governance_release where release_id = ${event.releaseId}::uuid)::text as releases,
          (select count(*) from release_distribution.release_snapshot where release_id = ${event.releaseId}::uuid)::text as snapshots,
          (select count(*) from release_distribution.outbox_event where release_id = ${event.releaseId}::uuid)::text as events,
          (select result from release_distribution.release_consumer_compatibility
            where release_id = ${event.releaseId}::uuid and consumer_subscription_id = ${subscription.subscriptionId}::uuid
            order by result_sequence desc limit 1) as compatibility
      `.execute(database);
      assert.deepEqual(counts.rows[0], { releases: '1', snapshots: '1', events: '1', compatibility: 'SUPPORTED' });
    }
    checks['publicationsExactlyOnce'] = true;
    const blockedState = await database.selectFrom('release_distribution.outbox_delivery_state')
      .select('delivery_status').where('consumer_subscription_id', '=', blocked.subscriptionId)
      .where('event_id', '=', masterEvent.eventId).orderBy('state_sequence', 'desc').limit(1).executeTakeFirstOrThrow();
    assert.equal(blockedState.delivery_status, 'BLOCKED_INCOMPATIBLE');
    assert.deepEqual(data(await serviceA.GET(eventsPath, { params: { path: blocked } })).events, []);
    await rejected(serviceA.GET(snapshotPath, { params: { path: { ...blocked, snapshotId: masterEvent.snapshotId } }, parseAs: 'arrayBuffer' }), 404);
    checks['incompatibleContractBlocked'] = true;

    for (const [subscription, event, service, accessToken, statePath, kind] of [
      [master, masterEvent, serviceA, masterToken, statePaths[0]!, 'departmentMaster'],
      [hierarchy, hierarchyEvent, serviceB, hierarchyToken, statePaths[1]!, 'departmentHierarchy'],
    ] as const) {
      const downloaded = await service.GET(snapshotPath, { params: { path: { ...subscription, snapshotId: event.snapshotId } }, parseAs: 'arrayBuffer' });
      const bytes = Buffer.from(data(downloaded));
      assert.equal(sha256Bytes(bytes).toString('hex'), event.snapshotArtifactDigest);
      assert.equal(downloaded.response.headers.get('digest'), `sha-256=:${sha256Bytes(bytes).toString('base64')}:`);
      assert.equal(downloaded.response.headers.get('content-type'), 'application/vnd.hdi.canonical-snapshot+json');
      const envelope = JSON.parse(bytes.toString('utf8'));
      assert.equal(envelope.envelopeContractVersion, 'phase-01.v1');
      assert.deepEqual(envelope.release, { aggregateType: kind === 'departmentMaster' ? 'DEPARTMENT_MASTER' : 'DEPARTMENT_HIERARCHY',
        governanceObjectId: event.governanceObjectId, releaseId: event.releaseId, releaseNo: event.aggregateVersion,
        releaseKind: 'NORMAL', businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null });
      assert.equal(envelope.serializationProfileVersion, 'canonical-json.v1');
      const canonical = kind === 'departmentMaster' ? DepartmentMasterProjectionSchema : DepartmentHierarchyProjectionSchema;
      assert.deepEqual(envelope.projectionContract, { projectionType: event.projectionType, schemaVersion: '1',
        schemaDigestAlgorithm: 'SHA-256', schemaDigest: canonicalSha256(canonical).toString('hex') });
      assert.equal(event.projectionSchemaDigest, envelope.projectionContract.schemaDigest);
      assert.equal(event.projectionPayloadDigest, canonicalSha256(envelope.payload).toString('hex'));
      assert.ok(Check(canonical, envelope.payload));
      if (kind === 'departmentMaster') {
        assert.equal(envelope.payload.departmentId, draft.departmentId);
        assert.equal(envelope.payload.departmentVersionId, draft.departmentVersionId);
        assert.equal(envelope.payload.departmentCode, `PV005B02B-${suffix}`);
        assert.equal(envelope.payload.contentHash, draft.contentHash);
      } else {
        assert.equal(envelope.payload.hierarchyViewId, hierarchyView);
        assert.equal(envelope.payload.hierarchyViewVersionId, hierarchyDraft.version.id);
        assert.equal(envelope.payload.viewType, 'ADMINISTRATIVE');
        assert.deepEqual(envelope.payload.nodes, hierarchyDraft.nodes.map(({ id, ...node }) => ({ nodeId: id, ...node })));
      }
      checks[`${kind}SnapshotValidated`] = true;
      checks[`${kind}PayloadSchemaValid`] = true;
      const receiptBody = { eventId: event.eventId, receiveResult: 'ACCEPTED' as const, validationResult: 'VALID' as const,
        applyResult: 'APPLIED' as const, processingDigest: '0'.repeat(64), processedAt: now() };
      await rejected(service.POST(receiptPath, { params: { path: subscription }, body: receiptBody }), 400, 'CONSUMER_PROCESSING_DIGEST_MISMATCH');
      const checkpoints = await database.selectFrom('release_distribution.consumer_checkpoint').select('applied_aggregate_version')
        .where('consumer_subscription_id', '=', subscription.subscriptionId).execute();
      assert.deepEqual(checkpoints, []);
      await rejected(person.GET(eventsPath, { params: { path: subscription } }), 403, 'PRINCIPAL_KIND_FORBIDDEN');
      await rejected(person.GET(snapshotPath, { params: { path: { ...subscription, snapshotId: event.snapshotId } } }), 403, 'PRINCIPAL_KIND_FORBIDDEN');
      await rejected(person.POST(receiptPath, { params: { path: subscription }, body: receiptBody }), 403, 'PRINCIPAL_KIND_FORBIDDEN');
      const otherService = kind === 'departmentMaster' ? serviceB : serviceA;
      await rejected(otherService.GET(eventsPath, { params: { path: subscription } }), 403, 'CONSUMER_SUBSCRIPTION_FORBIDDEN');
      await rejected(otherService.GET(snapshotPath, { params: { path: { ...subscription, snapshotId: event.snapshotId } }, parseAs: 'arrayBuffer' }), 403);
      await rejected(otherService.POST(receiptPath, { params: { path: subscription }, body: receiptBody }), 403, 'CONSUMER_SUBSCRIPTION_FORBIDDEN');
      const result = await runSimulatedConsumerOnce({ baseUrl, accessToken, subscriptionId: subscription.subscriptionId,
        statePath, expectedProjectionType: event.projectionType, expectedProjectionSchemaVersion: '1', now });
      assert.deepEqual(result, { applied: 1, receiptsClosed: 1 });
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      assert.equal(state.appliedAggregateVersion, event.aggregateVersion);
      assert.equal(state.appliedEvents[event.eventId].closure, 'CLOSED');
      assert.deepEqual(state.lastAppliedPayload, envelope.payload);
      assert.equal(await runner.run(context(), (modules) => modules.releaseDistribution.hasAppliedReceipt(event.releaseId)), true);
      assert.deepEqual(data(await service.GET(eventsPath, { params: { path: subscription, query: { afterAggregateVersion: event.aggregateVersion } } })).events, []);
      assert.deepEqual(await runSimulatedConsumerOnce({ baseUrl, accessToken, subscriptionId: subscription.subscriptionId,
        statePath, expectedProjectionType: event.projectionType, expectedProjectionSchemaVersion: '1', now }), { applied: 0, receiptsClosed: 0 });
      checks[`${kind}ReceiptApplied`] = true;
      consumed.push({ subscriptionId: subscription.subscriptionId, event });
    }
    checks['snapshotDigestVerified'] = true;
    checks['schemaDigestVerified'] = true;
    checks['crossSubscriptionAccessRejected'] = true;
    checks['browserServiceAudienceSeparated'] = true;
    checks['wrongProcessingDigestDoesNotAdvanceCheckpoint'] = true;
    // Even the same principal cannot fetch a snapshot through its other subscription.
    await rejected(serviceA.GET(snapshotPath, { params: { path: { ...master, snapshotId: hierarchyEvent.snapshotId } }, parseAs: 'arrayBuffer' }), 404);
    data(await owner.POST(versionPath, { params: { path: blocked, header: csrf },
      body: { governanceObjectId: masterObject, projectionType: 'hdi.department-master', projectionSchemaVersion: '1' } }));
    assert.deepEqual((await supportHistory(blocked.subscriptionId)).slice(0, 2), blockedHistory);
    data(await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/replays', { params: { path: blocked, header: csrf },
      body: { governanceObjectId: masterObject, eventId: masterEvent.eventId } }));
    assert.deepEqual(await onlyEvent(serviceA, blocked.subscriptionId), masterEvent);
    data(await serviceA.POST(receiptPath, { params: { path: blocked }, body: { eventId: masterEvent.eventId,
      receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED', processingDigest: masterEvent.snapshotArtifactDigest, processedAt: now() } }));
    checks['compatibilityReplayPreservesOriginalArtifact'] = true;
    if (options.verifyLifecycle) {
      const lifecycle = await checkConsumerLifecycleFlow({ database, runner, context, owner, reviewer,
        service: serviceA, otherService: serviceB, baseUrl, subscriptionId: master.subscriptionId, event: masterEvent });
      lifecycleHistories = lifecycle.histories;
      Object.assign(checks, lifecycle.checks);
    }
    if (options.verifySla) {
      slaResult = await checkConsumerSlaFlow({ database, runner, context, owner, reviewer, person,
        service: serviceA, otherService: serviceB, baseUrl, subscriptionId: master.subscriptionId, event: masterEvent });
      Object.assign(checks, slaResult.checks);
    }
    migrationCount = Number((await database.selectFrom('platform.schema_migration')
      .select(({ fn }) => fn.countAll<string>().as('count')).executeTakeFirstOrThrow()).count);
    const forbidden = await sql<{ count: string }>`select count(*)::text as count
      from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace join pg_catalog.pg_type t on t.oid = a.atttypid
      where n.nspname not in ('pg_catalog', 'information_schema') and a.attnum > 0 and not a.attisdropped
        and t.typname in ('timestamptz', 'timetz', 'tstzrange', 'tstzmultirange')`.execute(database);
    forbiddenTimezoneTypeCount = Number(forbidden.rows[0]?.count);
    const migrationFiles = (await readdir(resolve(import.meta.dirname, '../../db/migrations')))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name));
    assert.equal(migrationCount, migrationFiles.length);
    assert.equal(forbiddenTimezoneTypeCount, 0);
  } finally {
    await application.close();
    await handle.close();
    for (const path of statePaths) {
      await rm(path, { force: true });
      await rm(`${path}.tmp`, { force: true });
    }
    await rmdir(stateDirectory);
  }
  assert.equal(application.server.listening, false);
  const verification = createDatabase({ connectionString, max: 1, application_name: 'hdi-department-consumer-persistence' });
  try {
    const reopenedRunner = createTransactionRunner<ScopedModules>(verification.database, createScopedModules);
    if (slaResult) {
      for (const expected of slaResult.views) {
        assert.deepEqual(await reopenedRunner.run(slaResult.context, (m) => m.releaseDistribution.getConsumerOperationalStatus({
          subscriptionId: expected.subscriptionId, subscriptionVersionId: expected.subscriptionVersionId,
        })), expected);
      }
      checks['slaPersistenceObserved'] = true;
    }
    for (const expected of lifecycleHistories) {
      const actual = await reopenedRunner.run(context(), (m) => m.releaseDistribution.getSubscriptionHistory({
        subscriptionId: expected.subscriptionId, governanceObjectId: masterObject,
      }));
      assert.deepEqual(actual, expected);
    }
    if (options.verifyLifecycle) checks['lifecyclePersistenceObserved'] = true;
    for (const { subscriptionId, event } of consumed) {
      const checkpoint = await verification.database.selectFrom('release_distribution.consumer_checkpoint')
        .select('applied_aggregate_version').where('consumer_subscription_id', '=', subscriptionId).executeTakeFirstOrThrow();
      assert.equal(checkpoint.applied_aggregate_version, event.aggregateVersion);
      const receipt = await verification.database.selectFrom('release_distribution.consumer_receipt').selectAll()
        .where('consumer_subscription_id', '=', subscriptionId).where('event_id', '=', event.eventId).executeTakeFirstOrThrow();
      assert.equal(receipt.apply_result, 'APPLIED');
      assert.equal(receipt.validation_result, 'VALID');
      assert.equal(receipt.processing_digest.toString('hex'), event.snapshotArtifactDigest);
    }
    const sessions = await sql<{ count: string }>`select count(*)::text as count from pg_stat_activity
      where application_name = ${applicationName}`.execute(verification.database);
    assert.equal(sessions.rows[0]?.count, '0');
  } finally { await verification.close(); }
  checks['checkpointAdvanced'] = true;
  checks['persistenceObserved'] = true;
  checks['databasePoolClosed'] = true;
  checks['portReleased'] = true;
  assert.ok(Object.values(checks).every(Boolean));
  return { status: 'PASSED', scenario: options.verifySla ? 'PV-005-B-03B' : options.verifyLifecycle ? 'PV-005-B-03A' : 'PV-005-B-02B', synthetic: true, production: false, timezone: 'Asia/Shanghai',
    ...checks, migrationCount, forbiddenTimezoneTypeCount };
}

function data<T>(result: { data?: T; error?: unknown; response: Response }): T {
  assert.ok(result.response.ok && result.data !== undefined, `CONSUMER_HTTP_${result.response.status}`);
  return result.data;
}
async function rejected(resultPromise: Promise<{ response: Response; error?: unknown }>, status: number, code?: string) {
  const result = await resultPromise;
  assert.equal(result.response.status, status);
  if (code) assert.equal((result.error as { code: string }).code, code);
}
async function onlyEvent(client: Client, subscriptionId: string): Promise<Event> {
  const result = data(await client.GET(eventsPath, { params: { path: { subscriptionId } } }));
  assert.equal(result.events.length, 1);
  return result.events[0]!;
}
function now(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
}
