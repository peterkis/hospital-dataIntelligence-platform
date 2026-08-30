import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { connect } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import pg from 'pg';
import {
  buildLiveProducerEvidence,
  parseFrozenInputRefs,
} from './evidence/adapters.js';
import {
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  environmentReferenceDigest,
  writeProducerEvidence,
  writeRedactedJsonArtifact,
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import { writeFormalRuntimeEvent } from './runtime/formal-runtime-controller.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const runtimeAuthority = loadPodmanRuntimeAuthority(repositoryRoot).authority;
const runtimeBindAddress = runtimeAuthority.network.bindAddress;
const runtimePorts = runtimeAuthority.network.ports;
process.env['TZ'] = runtimeAuthority.host.timezone;

const API_BASE_URL = requireEnvironment('GOVERNANCE_API_BASE_URL').replace(/\/$/u, '');
const KEYCLOAK_ISSUER_URL = requireEnvironment('KEYCLOAK_ISSUER_URL').replace(/\/$/u, '');
if (API_BASE_URL !== `http://${runtimeBindAddress}:${runtimePorts.governanceApi}`) {
  throw new Error('FORMAL_LIVE_GOVERNANCE_ENDPOINT_AUTHORITY_DRIFT');
}
if (
  KEYCLOAK_ISSUER_URL !==
    `http://${runtimeBindAddress}:${runtimePorts.keycloakHttp}/realms/hdi-phase01`
) {
  throw new Error('FORMAL_LIVE_KEYCLOAK_ENDPOINT_AUTHORITY_DRIFT');
}
const REALM_IMPORT_PATH = resolve(requireEnvironment('KEYCLOAK_REALM_IMPORT_PATH'));
const REALM_IMPORT = JSON.parse(await readFile(REALM_IMPORT_PATH, 'utf8'));
const OWNER = requireRealmUser(REALM_IMPORT, 'phase01-owner');
const REVIEWER = requireRealmUser(REALM_IMPORT, 'phase01-reviewer');
const FINAL_OWNER = requireRealmUser(REALM_IMPORT, 'phase01-final-owner');
const CONSUMER_A_SECRET = requireRealmClientSecret(REALM_IMPORT, 'hdi-sim-consumer-a');
const CONSUMER_B_SECRET = requireRealmClientSecret(REALM_IMPORT, 'hdi-sim-consumer-b');
const NOTIFICATION_TARGETS = parseNotificationTargets(
  requireEnvironment('SIM_CONSUMER_NOTIFICATION_TARGETS_JSON'),
);
const OUTPUT_DIR = resolve(requireEnvironment('EVIDENCE_OUTPUT_DIR'));
const CHARGE_OBJECT_ID = '60000000-0000-7000-8000-000000000001';
const PRICE_OBJECT_ID = '60000000-0000-7000-8000-000000000002';
const CAMPUS_ID = '50000000-0000-7000-8000-000000000001';
const CONSUMER_A_PRINCIPAL_ID = '40000000-0000-7000-8000-000000000002';
const CONSUMER_B_PRINCIPAL_ID = '40000000-0000-7000-8000-000000000003';
const PRICE_LIST_CODE = process.env['PHASE01_PRICE_LIST_CODE'] ?? 'HOSPITAL-DEFAULT-PRICE';
const CONSUMER_MAIN = resolve('apps/sim-consumer/dist/main.js');
const OPENAPI_PATH = resolve('contracts/openapi/phase-01.openapi.json');
const runId = randomUUID();
const runSuffix = runId.slice(0, 8).toUpperCase();
const runSequence = parseRunSequence(process.env['ABG_RUN_SEQUENCE']);
const startedAt = nowInAsiaShanghai();

await createEvidenceOutputDirectory(OUTPUT_DIR);

const consumerProcesses = [];
let verification;
let failure;
try {
  const browserIdentity = await establishPersonSession(OWNER);
  const reviewerIdentity = await establishPersonSession(REVIEWER);
  const finalOwnerIdentity = await establishPersonSession(FINAL_OWNER);
  const ownerFetch = createCookieFetch(browserIdentity.cookieHeader);
  const ownerClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    csrfToken: browserIdentity.session.csrfToken,
    fetch: ownerFetch,
  });
  const invalidCsrfClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    csrfToken: 'invalid-csrf-token-that-is-long-enough',
    fetch: ownerFetch,
  });
  const reviewerClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    csrfToken: reviewerIdentity.session.csrfToken,
    fetch: createCookieFetch(reviewerIdentity.cookieHeader),
  });
  const finalOwnerClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    csrfToken: finalOwnerIdentity.session.csrfToken,
    fetch: createCookieFetch(finalOwnerIdentity.cookieHeader),
  });
  const negativeCsrf = await invalidCsrfClient.POST('/v1/phase-01/charge-item-drafts', {
    params: { header: { 'x-csrf-token': 'invalid-csrf-token-that-is-long-enough' } },
    body: chargeDraftBody(`CSRF-${runSuffix}`),
  });
  assert.equal(negativeCsrf.response.status, 403);
  assert.equal(negativeCsrf.error?.code, 'BROWSER_CSRF_FORBIDDEN');

  const subscriptionA = unwrap(
    await ownerClient.POST('/v1/phase-01/consumer-subscriptions', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        subscriptionCode: `SIM-A-${runSuffix}`,
        servicePrincipalId: CONSUMER_A_PRINCIPAL_ID,
        governanceObjectId: PRICE_OBJECT_ID,
        projectionType: 'hdi.price-list',
        projectionSchemaVersion: '1',
      },
    }),
    201,
  );
  const subscriptionB = unwrap(
    await ownerClient.POST('/v1/phase-01/consumer-subscriptions', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        subscriptionCode: `SIM-B-${runSuffix}`,
        servicePrincipalId: CONSUMER_B_PRINCIPAL_ID,
        governanceObjectId: PRICE_OBJECT_ID,
        projectionType: 'hdi.price-list',
        projectionSchemaVersion: '0',
      },
    }),
    201,
  );

  const consumerAStateDirectory = join(OUTPUT_DIR, 'consumer-a-states');
  const consumerBStateDirectory = join(OUTPUT_DIR, 'consumer-b-states');
  const consumerAStatePath = join(consumerAStateDirectory, `${subscriptionA.subscriptionId}.json`);
  const consumerBStatePath = join(consumerBStateDirectory, `${subscriptionB.subscriptionId}.json`);
  consumerProcesses.push(
    await startConsumer({
      label: 'consumer-a',
      port: runtimePorts.consumerA,
      clientId: 'hdi-sim-consumer-a',
      clientSecret: CONSUMER_A_SECRET,
      notificationAuthorization: requireNotificationAuthorization(CONSUMER_A_PRINCIPAL_ID),
      stateDirectory: consumerAStateDirectory,
    }),
    await startConsumer({
      label: 'consumer-b',
      port: runtimePorts.consumerB,
      clientId: 'hdi-sim-consumer-b',
      clientSecret: CONSUMER_B_SECRET,
      notificationAuthorization: requireNotificationAuthorization(CONSUMER_B_PRINCIPAL_ID),
      stateDirectory: consumerBStateDirectory,
    }),
  );

  const chargeDraft = unwrap(
    await ownerClient.POST('/v1/phase-01/charge-item-drafts', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: chargeDraftBody(`FEE-${runSuffix}`),
    }),
    201,
  );
  const chargeChange = unwrap(
    await ownerClient.POST('/v1/phase-01/change-requests', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: CHARGE_OBJECT_ID,
        entityType: 'CHARGE_ITEM_VERSION',
        stableEntityId: chargeDraft.chargeItemId,
        entityVersionId: chargeDraft.chargeItemVersionId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'NORMAL',
        submittedContentDigest: chargeDraft.contentDigest,
        changeReason: '真实Anolis运行环境收费项目初始发布审批',
        campusId: null,
        frozenEvidence: { scenarioId: `LIVE-${runSuffix}` },
      },
    }),
    201,
  );
  await approveChange(
    reviewerClient,
    reviewerIdentity.session.csrfToken,
    chargeChange.changeRequestId,
    chargeDraft.contentDigest,
    'PROFESSIONAL_REVIEW',
  );
  await approveChange(
    finalOwnerClient,
    finalOwnerIdentity.session.csrfToken,
    chargeChange.changeRequestId,
    chargeDraft.contentDigest,
    'OWNER_FINAL_APPROVAL',
  );
  const charge = unwrap(
    await ownerClient.GET('/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}', {
      params: {
        path: { chargeItemId: chargeDraft.chargeItemId, chargeItemVersionId: chargeDraft.chargeItemVersionId },
        query: { governanceObjectId: CHARGE_OBJECT_ID },
      },
    }),
    200,
  );
  assert.equal(charge.governanceStatus, 'PUBLISHED');

  const priceDraft = unwrap(
    await ownerClient.POST('/v1/phase-01/price-list-drafts', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: PRICE_OBJECT_ID,
        priceListCode: PRICE_LIST_CODE,
        displayName: `Phase 01实时价表 ${runSuffix}`,
        currencyCode: 'CNY',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
        entries: [
          {
            chargeItemId: charge.chargeItemId,
            chargeItemVersionId: charge.chargeItemVersionId,
            scopeLevel: 'HOSPITAL',
            campusId: null,
            encounterMode: 'GENERAL',
            encounterType: null,
            fixedUnitPrice: '12.34',
            billingUnitCode: 'TIMES',
            businessValidFrom: '2026-08-08T00:00:00',
            businessValidTo: null,
            zeroPriceReason: null,
          },
        ],
      },
    }),
    201,
  );
  const priceChange = unwrap(
    await ownerClient.POST('/v1/phase-01/change-requests', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: PRICE_OBJECT_ID,
        entityType: 'PRICE_LIST_RELEASE',
        stableEntityId: priceDraft.priceListId,
        entityVersionId: priceDraft.priceListReleaseId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'HIGH',
        submittedContentDigest: priceDraft.contentDigest,
        changeReason: '真实Anolis运行环境价表初始发布审批',
        campusId: null,
        frozenEvidence: { scenarioId: `LIVE-${runSuffix}` },
      },
    }),
    201,
  );
  await approveChange(
    reviewerClient,
    reviewerIdentity.session.csrfToken,
    priceChange.changeRequestId,
    priceDraft.contentDigest,
    'PROFESSIONAL_REVIEW',
  );
  await approveChange(
    finalOwnerClient,
    finalOwnerIdentity.session.csrfToken,
    priceChange.changeRequestId,
    priceDraft.contentDigest,
    'OWNER_FINAL_APPROVAL',
  );
  const price = unwrap(
    await ownerClient.GET('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}', {
      params: {
        path: { priceListId: priceDraft.priceListId, priceListReleaseId: priceDraft.priceListReleaseId },
        query: { governanceObjectId: PRICE_OBJECT_ID },
      },
    }),
    200,
  );
  assert.equal(price.governanceStatus, 'PUBLISHED');

  const serviceAClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    accessToken: await obtainServiceToken('hdi-sim-consumer-a', CONSUMER_A_SECRET),
  });
  const serviceBClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    accessToken: await obtainServiceToken('hdi-sim-consumer-b', CONSUMER_B_SECRET),
  });
  const priceEvent = await waitForSubscriptionEvent(serviceAClient, subscriptionA.subscriptionId);

  const consumerAState = await waitForClosedState(consumerAStatePath, priceEvent.eventId);
  const consumerBWasBlockedBeforeUpgrade = !(await fileExists(consumerBStatePath));
  assert.equal(consumerBWasBlockedBeforeUpgrade, true, 'Legacy consumer must remain blocked.');

  const resolutionRecordAsOf = nowInAsiaShanghai();
  const resolution = unwrap(
    await ownerClient.POST('/v1/phase-01/price-resolutions', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: PRICE_OBJECT_ID,
        requestId: `LIVE-${runSuffix}`,
        chargeItemId: charge.chargeItemId,
        chargeItemVersionId: charge.chargeItemVersionId,
        priceListId: price.priceListId,
        campusId: CAMPUS_ID,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: '2026-08-08T09:15:00',
        recordAsOf: resolutionRecordAsOf,
        quantity: '2',
      },
    }),
    200,
  );
  assert.equal(resolution.status, 'SUCCEEDED');
  assert.equal(resolution.finalAmount, '24.6800');

  const upgradedSubscription = unwrap(
    await ownerClient.POST(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions',
      {
        params: {
          header: { 'x-csrf-token': browserIdentity.session.csrfToken },
          path: { subscriptionId: subscriptionB.subscriptionId },
        },
        body: {
          governanceObjectId: PRICE_OBJECT_ID,
          projectionType: 'hdi.price-list',
          projectionSchemaVersion: '1',
        },
      },
    ),
    201,
  );
  const replay = unwrap(
    await ownerClient.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/replays', {
      params: {
        header: { 'x-csrf-token': browserIdentity.session.csrfToken },
        path: { subscriptionId: subscriptionB.subscriptionId },
      },
      body: { governanceObjectId: PRICE_OBJECT_ID, eventId: priceEvent.eventId },
    }),
    201,
  );
  const consumerBState = await waitForClosedState(consumerBStatePath, priceEvent.eventId);
  assert.deepEqual(consumerBState.lastAppliedPayload, consumerAState.lastAppliedPayload);
  const canonicalSnapshotDigestsMatch =
    consumerBState.appliedEvents[priceEvent.eventId].snapshotDigest ===
    consumerAState.appliedEvents[priceEvent.eventId].snapshotDigest;
  assert.equal(canonicalSnapshotDigestsMatch, true);
  const consumerAAfterCheckpoint = unwrap(
    await serviceAClient.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/events', {
      params: {
        path: { subscriptionId: subscriptionA.subscriptionId },
        query: { afterAggregateVersion: consumerAState.appliedAggregateVersion },
      },
    }),
    200,
  );
  const consumerBAfterCheckpoint = unwrap(
    await serviceBClient.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/events', {
      params: {
        path: { subscriptionId: subscriptionB.subscriptionId },
        query: { afterAggregateVersion: consumerBState.appliedAggregateVersion },
      },
    }),
    200,
  );
  assert.deepEqual(consumerAAfterCheckpoint.events, []);
  assert.deepEqual(consumerBAfterCheckpoint.events, []);
  const databaseVerification = await verifyDatabaseClosure({
    priceEventId: priceEvent.eventId,
    priceReleaseId: price.priceListReleaseId,
    subscriptionAId: subscriptionA.subscriptionId,
    subscriptionBId: subscriptionB.subscriptionId,
    aggregateVersion: consumerAState.appliedAggregateVersion,
  });
  const serviceIdentityBindingsVerified =
    subscriptionA.servicePrincipalId === CONSUMER_A_PRINCIPAL_ID &&
    subscriptionB.servicePrincipalId === CONSUMER_B_PRINCIPAL_ID;
  const priceResolutionPathVerified =
    resolution.status === 'SUCCEEDED' && resolution.finalAmount === '24.6800';
  const dualConsumerIsolationVerified =
    consumerBWasBlockedBeforeUpgrade &&
    consumerAAfterCheckpoint.events.length === 0 &&
    consumerBAfterCheckpoint.events.length === 0 &&
    databaseVerification.consumerA.deliveryStatus === 'DELIVERED' &&
    databaseVerification.consumerB.deliveryStatus === 'DELIVERED';
  const snapshotDownloadAndDigestVerified =
    typeof consumerAState.appliedEvents[priceEvent.eventId].snapshotId === 'string' &&
    typeof consumerBState.appliedEvents[priceEvent.eventId].snapshotId === 'string' &&
    canonicalSnapshotDigestsMatch;
  const receiptAndCheckpointVerified =
    databaseVerification.consumerA.receiptCount >= 1 &&
    databaseVerification.consumerB.receiptCount >= 1 &&
    databaseVerification.consumerA.checkpoint === consumerAState.appliedAggregateVersion &&
    databaseVerification.consumerB.checkpoint === consumerBState.appliedAggregateVersion;

  verification = {
    status: 'PASSED',
    runId,
    startedAt,
    completedAt: nowInAsiaShanghai(),
    runtime: {
      apiBaseUrl: API_BASE_URL,
      keycloakIssuerUrl: KEYCLOAK_ISSUER_URL,
      timezone: 'Asia/Shanghai',
    },
    authentication: {
      authorizationCodeCallbackCompleted: true,
      pkceMethod: 'S256',
      principalId: browserIdentity.session.principalId,
      principalKind: browserIdentity.session.principalKind,
      serviceIdentityBindingsVerified,
      csrfNegativeStatus: negativeCsrf.response.status,
      csrfNegativeCode: negativeCsrf.error.code,
    },
    subscriptionA,
    subscriptionB,
    upgradedSubscription,
    replay,
    charge,
    price,
    resolution,
    priceResolutionPathVerified,
    consumption: {
      consumerA: summarizeConsumerState(consumerAState, priceEvent.eventId),
      consumerB: summarizeConsumerState(consumerBState, priceEvent.eventId),
      consumerBWasBlockedBeforeUpgrade,
      dualConsumerIsolationVerified,
      snapshotDownloadAndDigestVerified,
      identicalCanonicalSnapshotDigest: canonicalSnapshotDigestsMatch,
      receiptAndCheckpointVerified,
      checkpointsClosed: receiptAndCheckpointVerified,
    },
    databaseVerification,
    governanceObjectIds: [CHARGE_OBJECT_ID, PRICE_OBJECT_ID],
    openapiSha256: sha256(await readFile(OPENAPI_PATH)),
  };
} catch (error) {
  failure = error;
  verification = {
    status: 'FAILED',
    runId,
    startedAt,
    completedAt: nowInAsiaShanghai(),
    error: error instanceof Error ? error.message : String(error),
  };
} finally {
  const stopResults = await Promise.allSettled(
    consumerProcesses.map((consumer) => stopConsumer(consumer)),
  );
  const rejected = stopResults.find((result) => result.status === 'rejected');
  if (rejected?.status === 'rejected') {
    failure ??= rejected.reason;
    verification = {
      ...verification,
      status: 'FAILED',
      completedAt: nowInAsiaShanghai(),
      error: rejected.reason instanceof Error
        ? rejected.reason.message
        : String(rejected.reason),
    };
  }
}

await writeRedactedJsonArtifact(OUTPUT_DIR, 'live-verification.json', verification);
const liveEvidenceItem = await createEvidenceItemFromFile(OUTPUT_DIR, {
  artifactId: 'phase-01-live-verification-summary',
  relativePath: 'live-verification.json',
  mediaType: 'application/json',
  jsonPointer: '/status',
  claim: { status: verification.status },
});
const producerEvidence = buildLiveProducerEvidence({
  producerId: 'live',
  runId,
  runSequence,
  startedAt,
  completedAt: verification.completedAt,
  processStatus: verification.status === 'PASSED' ? 'PASSED' : 'FAILED',
  commandIdentity: {
    executable: 'node',
    arguments: ['tooling/verification/src/verify-phase-01-live.ts'],
    workingDirectory: 'repository-root',
    commandDigest: sha256(Buffer.from('tooling/verification/src/verify-phase-01-live.ts', 'utf8')),
  },
  environmentRefs: environmentReferenceDigest(process.env, [
    'GOVERNANCE_API_BASE_URL',
    'KEYCLOAK_ISSUER_URL',
    'TZ',
  ]),
  frozenInputRefs: parseFrozenInputRefs(parseFrozenInputEnvironment()),
  defaultEvidenceItems: [liveEvidenceItem],
  verification,
});
await writeProducerEvidence(OUTPUT_DIR, 'producer-evidence.json', producerEvidence);
await writeManifest(OUTPUT_DIR);
process.stdout.write(
  JSON.stringify({
    status: verification.status,
    producerEvidenceStatus: producerEvidence.status,
    runId,
    evidenceDirectory: OUTPUT_DIR,
  }) + '\n',
);
if (failure) throw failure;

function chargeDraftBody(internalCode: string) {
  return {
    governanceObjectId: CHARGE_OBJECT_ID,
    internalCode,
    formalName: `POC诊查费 ${runSuffix}`,
    serviceDefinition: '真实Anolis运行环境合成POC收费项目，仅用于验证治理闭环。',
    billingUnitCode: 'TIMES',
    chargingMethodCode: 'COUNT',
    businessValidFrom: '2026-08-08T00:00:00',
    businessValidTo: null,
  };
}

interface PersonSession {
  readonly principalId: string;
  readonly principalKind: 'PERSON';
  readonly csrfToken: string;
}

interface PersonIdentity {
  readonly cookieHeader: string;
  readonly session: PersonSession;
}

async function establishPersonSession(
  identity: { readonly username: string; readonly password: string },
): Promise<PersonIdentity> {
  const login = await fetch(`${API_BASE_URL}/auth/login?returnTo=%2Fadmin%2F`, {
    redirect: 'manual',
  });
  assert.equal(login.status, 302);
  const authorizationUrl = requireLocation(login);
  const authorizationPage = await fetch(authorizationUrl, { redirect: 'manual' });
  assert.equal(authorizationPage.status, 200);
  const authorizationCookies = new Map();
  mergeCookieJar(authorizationCookies, authorizationPage.headers.getSetCookie());
  const loginHtml = await authorizationPage.text();
  const formAction = /<form[^>]+action="([^"]+)"/u.exec(loginHtml)?.[1];
  assert.ok(formAction, 'Keycloak login form action was not found.');
  const credentialResponse = await fetch(decodeHtmlAttribute(formAction), {
    method: 'POST',
    headers: {
      cookie: serializeCookieJar(authorizationCookies),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username: identity.username,
      password: identity.password,
      credentialId: '',
    }),
    redirect: 'manual',
  });
  assert.equal(credentialResponse.status, 302, 'Keycloak credential submission failed.');
  let redirectResponse = credentialResponse;
  let callbackUrl = requireLocation(redirectResponse);
  for (let redirectCount = 0; new URL(callbackUrl).origin !== new URL(API_BASE_URL).origin; redirectCount += 1) {
    if (redirectCount >= 5) throw new Error('KEYCLOAK_INTERMEDIATE_REDIRECT_LIMIT_EXCEEDED');
    mergeCookieJar(authorizationCookies, redirectResponse.headers.getSetCookie());
    redirectResponse = await fetch(callbackUrl, {
      headers: { cookie: serializeCookieJar(authorizationCookies) },
      redirect: 'manual',
    });
    if (redirectResponse.status !== 302) {
      throw new Error(
        `KEYCLOAK_INTERMEDIATE_ACTION_REQUIRED:${new URL(callbackUrl).pathname}:HTTP_${redirectResponse.status}`,
      );
    }
    callbackUrl = requireLocation(redirectResponse);
  }
  assert.equal(new URL(callbackUrl).origin, new URL(API_BASE_URL).origin);
  assert.equal(new URL(callbackUrl).pathname, '/auth/callback');
  const callback = await fetch(callbackUrl, { redirect: 'manual' });
  if (callback.status !== 302) {
    throw new Error(`GOVERNANCE_OIDC_CALLBACK_HTTP_${callback.status}:${await callback.text()}`);
  }
  const sessionCookie = callback.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith('__Host-hdi-session='));
  assert.ok(sessionCookie, 'Opaque governance session cookie was not issued.');
  const opaqueCookie = sessionCookie.split(';', 1)[0];
  assert.ok(opaqueCookie, 'Opaque governance session cookie value was empty.');
  const sessionResponse = await fetch(`${API_BASE_URL}/auth/session`, {
    headers: { cookie: opaqueCookie },
  });
  assert.equal(sessionResponse.status, 200);
  const sessionCandidate: unknown = await sessionResponse.json();
  if (
    !isRecord(sessionCandidate) ||
    typeof sessionCandidate['principalId'] !== 'string' ||
    sessionCandidate['principalKind'] !== 'PERSON' ||
    typeof sessionCandidate['csrfToken'] !== 'string'
  ) {
    throw new Error('GOVERNANCE_PERSON_SESSION_INVALID');
  }
  return {
    cookieHeader: opaqueCookie,
    session: {
      principalId: sessionCandidate['principalId'],
      principalKind: sessionCandidate['principalKind'],
      csrfToken: sessionCandidate['csrfToken'],
    },
  };
}

function createCookieFetch(cookie: string): typeof fetch {
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('cookie', cookie);
    return fetch(new Request(request, { headers }));
  };
}

async function startConsumer(options: {
  readonly label: string;
  readonly port: number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly notificationAuthorization: string;
  readonly stateDirectory: string;
}): Promise<RunningConsumer> {
  const child = spawn(process.execPath, [CONSUMER_MAIN], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOVERNANCE_API_BASE_URL: API_BASE_URL,
      SIM_CONSUMER_STATE_DIRECTORY: options.stateDirectory,
      KEYCLOAK_TOKEN_ENDPOINT: `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
      KEYCLOAK_CLIENT_ID: options.clientId,
      KEYCLOAK_CLIENT_SECRET: options.clientSecret,
      SIM_CONSUMER_MODE: 'server',
      SIM_CONSUMER_NOTIFICATION_AUTHORIZATION: options.notificationAuthorization,
      HOST: runtimeBindAddress,
      PORT: String(options.port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const consumer: RunningConsumer = { child, stdout, stderr, label: options.label };
  try {
    await recordConsumerRuntimeEvent('STARTED', consumer, options.port);
    await waitForPort(options.port, child);
  } catch (error) {
    await stopConsumer(consumer, options.port).catch(() => undefined);
    throw error;
  }
  return consumer;
}

interface RunningConsumer {
  readonly child: ReturnType<typeof spawn>;
  readonly stdout: readonly Buffer[];
  readonly stderr: readonly Buffer[];
  readonly label: string;
}

async function stopConsumer(consumer: RunningConsumer, port?: number): Promise<void> {
  const failures: unknown[] = [];
  try {
    await Promise.all([
      writeRedactedTextArtifact(
        OUTPUT_DIR,
        `${consumer.label}.stdout.log`,
        Buffer.concat(consumer.stdout).toString('utf8'),
      ),
      writeRedactedTextArtifact(
        OUTPUT_DIR,
        `${consumer.label}.stderr.log`,
        Buffer.concat(consumer.stderr).toString('utf8'),
      ),
    ]);
  } catch (error) {
    failures.push(error);
  }
  try {
    if (consumer.child.exitCode === null && consumer.child.signalCode === null) {
      consumer.child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveClose) => consumer.child.once('close', resolveClose)),
        delay(5_000).then(() => consumer.child.kill('SIGKILL')),
      ]);
    }
    await recordConsumerRuntimeEvent('STOPPED', consumer, port);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, 'SIM_CONSUMER_STOP_FAILED');
}

async function recordConsumerRuntimeEvent(
  event: 'STARTED' | 'STOPPED',
  consumer: RunningConsumer,
  port?: number,
): Promise<void> {
  const eventDirectory = process.env['ABG_RUNTIME_EVENT_DIR'];
  if (eventDirectory === undefined) return;
  const formalRunId = process.env['ABG_RUN_ID'];
  const formalRunSequence = process.env['ABG_RUN_SEQUENCE'];
  const runtimeNamespace = process.env['ABG_RUNTIME_NAMESPACE'];
  if (
    formalRunId === undefined ||
    formalRunSequence === undefined ||
    runtimeNamespace === undefined
  ) throw new Error('FORMAL_CONSUMER_RUN_IDENTITY_INCOMPLETE');
  if (consumer.child.pid === undefined) throw new Error('FORMAL_CONSUMER_PID_MISSING');
  await writeFormalRuntimeEvent(eventDirectory, {
    runtimeAuthority,
    identity: {
      runId: formalRunId,
      runSequence: parseRunSequence(formalRunSequence),
      runtimeNamespace,
    },
    event,
    resourceType: 'process',
    id: String(consumer.child.pid),
    name: consumer.label,
    role: 'sim-' + consumer.label,
    pid: consumer.child.pid,
    ports: port === undefined ? [] : [{
      containerPort: String(port),
      hostIp: runtimeBindAddress,
      hostPort: port,
    }],
    exitStatus: event === 'STOPPED'
      ? consumer.child.exitCode ?? consumer.child.signalCode
      : null,
  });
}

async function waitForPort(port: number, child: any): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`SIM_CONSUMER_${port}_EXITED_${child.exitCode}`);
    const connected = await new Promise((resolveConnected) => {
      const socket = connect({ host: runtimeBindAddress, port });
      socket.once('connect', () => {
        socket.destroy();
        resolveConnected(true);
      });
      socket.once('error', () => resolveConnected(false));
    });
    if (connected) return;
    await delay(100);
  }
  throw new Error(`SIM_CONSUMER_${port}_START_TIMEOUT`);
}

async function waitForClosedState(path: string, eventId: string): Promise<any> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (state.appliedEvents?.[eventId]?.closure === 'CLOSED') return state;
    } catch (error) {
      if (!isMissingFile(error) && !(error instanceof SyntaxError)) throw error;
    }
    await delay(200);
  }
  throw new Error(`SIM_CONSUMER_CLOSURE_TIMEOUT:${basename(path)}`);
}

async function obtainServiceToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  assert.equal(response.status, 200);
  const tokenSet: unknown = await response.json();
  if (!isRecord(tokenSet) || typeof tokenSet['access_token'] !== 'string') {
    throw new Error('KEYCLOAK_SERVICE_ACCESS_TOKEN_MISSING');
  }
  return tokenSet['access_token'];
}

async function verifyDatabaseClosure(options: {
  readonly priceEventId: string;
  readonly priceReleaseId: string;
  readonly subscriptionAId: string;
  readonly subscriptionBId: string;
  readonly aggregateVersion: string;
}) {
  const pool = new pg.Pool({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-phase01-live-verification',
    max: 1,
  });
  const client = await pool.connect();
  try {
    const migrations = await client.query(
      'select migration_id from platform.schema_migration order by migration_id',
    );
    assert.deepEqual(
      migrations.rows.map((row) => row.migration_id),
      [
        '0001_phase_01_vertical_slice',
        '0002_price_list_version_publication',
        '0003_price_list_recording_closure_guard',
        '0004_charge_item_draft_mutation_guards',
        '0005_charge_item_version_bitemporal_guards',
        '0006_price_list_draft_mutation_guards',
        '0007_object_and_campus_authorization',
        '0008_versioned_approval_workflow',
        '0009_batch_import_jobs',
        '0010_emergency_suspension_and_recovery',
        '0011_charge_item_governance_object_scope',
      ],
    );
    const timezoneColumns = await client.query(`
      select count(*)::integer as count
      from information_schema.columns
      where table_schema in (
        'access_control', 'audit', 'batch_import', 'charge_catalog', 'emergency_control',
        'platform', 'price_list', 'price_resolution', 'release_distribution', 'workflow'
      )
      and data_type in ('timestamp with time zone', 'time with time zone')
    `);
    assert.equal(timezoneColumns.rows[0].count, 0);

    const auditChains = {
      chargeCatalog: await verifyAuditChain(client, CHARGE_OBJECT_ID),
      priceList: await verifyAuditChain(client, PRICE_OBJECT_ID),
    };
    assert.equal(auditChains.chargeCatalog, true);
    assert.equal(auditChains.priceList, true);

    const event = await client.query(
      'select aggregate_version from release_distribution.outbox_event where event_id = $1',
      [options.priceEventId],
    );
    assert.equal(event.rows[0]?.aggregate_version, options.aggregateVersion);
    const release = await client.query(
      'select release_no from price_list.price_list_release where price_list_release_id = $1',
      [options.priceReleaseId],
    );
    const consumerA = await loadConsumerClosure(
      client,
      options.subscriptionAId,
      options.priceEventId,
    );
    const consumerB = await loadConsumerClosure(
      client,
      options.subscriptionBId,
      options.priceEventId,
    );
    for (const closure of [consumerA, consumerB]) {
      assert.equal(closure.deliveryStatus, 'DELIVERED');
      assert.equal(closure.checkpoint, options.aggregateVersion);
      assert.ok(closure.receiptCount >= 1);
    }
    const compatibilityIssue = await client.query(
      `
        select issue_event.issue_status
        from release_distribution.consumer_compatibility_issue as issue
        join release_distribution.consumer_compatibility_issue_event as issue_event
          on issue_event.consumer_compatibility_issue_id = issue.consumer_compatibility_issue_id
        where issue.consumer_subscription_id = $1 and issue.event_id = $2
        order by issue_event.issue_sequence desc
        limit 1
      `,
      [options.subscriptionBId, options.priceEventId],
    );
    assert.equal(compatibilityIssue.rows[0]?.issue_status, 'RESOLVED');
    return {
      schemaMigrations: migrations.rows.map((row) => row.migration_id),
      timezoneAwareColumnCount: timezoneColumns.rows[0].count,
      auditChains,
      priceReleaseNo: release.rows[0]?.release_no,
      consumerA,
      consumerB,
      consumerBCompatibilityIssueStatus: compatibilityIssue.rows[0].issue_status,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function loadConsumerClosure(client: any, subscriptionId: string, eventId: string) {
  const result = await client.query(
    `
      select
        checkpoint.applied_aggregate_version as checkpoint,
        latest_state.delivery_status,
        (select count(*)::integer
         from release_distribution.consumer_receipt as receipt
         where receipt.consumer_subscription_id = delivery.consumer_subscription_id
           and receipt.event_id = delivery.event_id) as receipt_count
      from release_distribution.outbox_delivery as delivery
      join lateral (
        select state.delivery_status
        from release_distribution.outbox_delivery_state as state
        where state.outbox_delivery_id = delivery.outbox_delivery_id
        order by state.state_sequence desc
        limit 1
      ) as latest_state on true
      join release_distribution.outbox_event as event on event.event_id = delivery.event_id
      join release_distribution.consumer_checkpoint as checkpoint
        on checkpoint.consumer_subscription_id = delivery.consumer_subscription_id
       and checkpoint.governance_object_id = event.aggregate_id
      where delivery.consumer_subscription_id = $1 and delivery.event_id = $2
    `,
    [subscriptionId, eventId],
  );
  assert.equal(result.rowCount, 1);
  return {
    checkpoint: result.rows[0].checkpoint,
    deliveryStatus: result.rows[0].delivery_status,
    receiptCount: result.rows[0].receipt_count,
  };
}

async function verifyAuditChain(client: any, auditStreamId: string): Promise<boolean> {
  const result = await client.query(
    `
      select audit_sequence, event_payload_hash, previous_hash, current_hash
      from audit.audit_event
      where audit_stream_id = $1
      order by audit_sequence
    `,
    [auditStreamId],
  );
  let previousHash = Buffer.alloc(32);
  let expectedSequence = 1n;
  for (const event of result.rows) {
    if (BigInt(event.audit_sequence) !== expectedSequence) return false;
    if (!event.previous_hash.equals(previousHash)) return false;
    const expectedHash = createHash('sha256')
      .update(
        JSON.stringify({
          eventPayloadHash: event.event_payload_hash.toString('hex'),
          previousHash: previousHash.toString('hex'),
          sequence: event.audit_sequence,
        }),
      )
      .digest();
    if (!event.current_hash.equals(expectedHash)) return false;
    previousHash = event.current_hash;
    expectedSequence += 1n;
  }
  return result.rowCount > 0;
}

function unwrap(result: any, expectedStatus: number): any {
  assert.equal(result.response.status, expectedStatus, JSON.stringify(result.error));
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.data;
}

async function approveChange(
  client: any,
  csrfToken: string,
  changeRequestId: string,
  contentDigest: string,
  stageType: 'PROFESSIONAL_REVIEW' | 'OWNER_FINAL_APPROVAL',
): Promise<any> {
  return unwrap(
    await client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': csrfToken },
        path: { changeRequestId },
      },
      body: {
        stageType,
        actionResult: 'APPROVED',
        reason: `Phase 01正式核验：${stageType}`,
        seenContentDigest: contentDigest,
        campusId: null,
      },
    }),
    200,
  );
}

async function waitForSubscriptionEvent(client: any, subscriptionId: string): Promise<any> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = unwrap(
      await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/events', {
        params: { path: { subscriptionId }, query: {} },
      }),
      200,
    );
    if (result.events.length > 0) return result.events[0];
    await delay(200);
  }
  throw new Error(`PUBLISHED_EVENT_DISCOVERY_TIMEOUT:${subscriptionId}`);
}

function summarizeConsumerState(state: any, eventId: string) {
  return {
    subscriptionId: state.subscriptionId,
    appliedAggregateVersion: state.appliedAggregateVersion,
    eventId,
    snapshotId: state.appliedEvents[eventId].snapshotId,
    snapshotDigest: state.appliedEvents[eventId].snapshotDigest,
    closure: state.appliedEvents[eventId].closure,
  };
}

function mergeCookieJar(jar: Map<string, string>, setCookies: readonly string[]): void {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0];
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  assert.ok(jar.size > 0, 'Expected Keycloak authorization cookies.');
}

function serializeCookieJar(jar: ReadonlyMap<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function requireLocation(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location, `HTTP ${response.status} response did not contain Location.`);
  return location;
}

function decodeHtmlAttribute(value: string): string {
  return value.replaceAll('&amp;', '&').replaceAll('&#x3D;', '=').replaceAll('&#61;', '=');
}

async function assertDirectoryAbsent(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  throw new Error(`EVIDENCE_OUTPUT_ALREADY_EXISTS:${path}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function writeManifest(directory: string): Promise<void> {
  const files = await listEvidenceFiles(directory);
  const lines = [];
  for (const relativePath of files) {
    const bytes = await readFile(join(directory, relativePath));
    lines.push(`${sha256(bytes)}  ${relativePath.replaceAll('\\', '/')}`);
  }
  await writeFile(join(directory, 'manifest.sha256'), `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

async function listEvidenceFiles(directory: string, relativeDirectory = ''): Promise<readonly string[]> {
  const entries = await readdir(join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = join(relativeDirectory, entry.name);
    if (relativePath === 'manifest.sha256') continue;
    if (entry.isDirectory()) files.push(...(await listEvidenceFiles(directory, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function nowInAsiaShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function requireRealmUser(realm: any, username: string): { readonly username: string; readonly password: string } {
  const user = realm.users?.find((candidate: any) => candidate.username === username);
  const password = user?.credentials?.find((candidate: any) => candidate.type === 'password')?.value;
  if (typeof user?.username !== 'string' || typeof password !== 'string') {
    throw new Error(`KEYCLOAK_REALM_USER_CREDENTIAL_MISSING:${username}`);
  }
  return { username: user.username, password };
}

function requireRealmClientSecret(realm: any, clientId: string): string {
  const secret = realm.clients?.find((candidate: any) => candidate.clientId === clientId)?.secret;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(`KEYCLOAK_REALM_CLIENT_SECRET_MISSING:${clientId}`);
  }
  return secret;
}

function parseNotificationTargets(value: string): readonly any[] {
  const targets = JSON.parse(value);
  if (!Array.isArray(targets)) throw new Error('NOTIFICATION_TARGETS_INVALID');
  return targets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNotificationAuthorization(servicePrincipalId: string): string {
  const authorization = NOTIFICATION_TARGETS.find(
    (candidate) => candidate.servicePrincipalId === servicePrincipalId,
  )?.authorizationHeader;
  if (typeof authorization !== 'string' || authorization.length === 0) {
    throw new Error(`NOTIFICATION_TARGET_AUTHORIZATION_MISSING:${servicePrincipalId}`);
  }
  return authorization;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function parseRunSequence(value: string | undefined): number {
  const parsed = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('ABG_RUN_SEQUENCE_INVALID');
  }
  return parsed;
}

function parseFrozenInputEnvironment(): unknown {
  const value = process.env['ABG_FROZEN_INPUTS_JSON'];
  if (value === undefined || value.length === 0) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('ABG_FROZEN_INPUTS_JSON_INVALID');
  }
}
