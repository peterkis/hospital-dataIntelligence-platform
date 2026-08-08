import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { connect } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import pg from 'pg';

process.env.TZ = 'Asia/Shanghai';

const API_BASE_URL = requireEnvironment('GOVERNANCE_API_BASE_URL').replace(/\/$/u, '');
const KEYCLOAK_ISSUER_URL = requireEnvironment('KEYCLOAK_ISSUER_URL').replace(/\/$/u, '');
const REALM_IMPORT_PATH = resolve(requireEnvironment('KEYCLOAK_REALM_IMPORT_PATH'));
const REALM_IMPORT = JSON.parse(await readFile(REALM_IMPORT_PATH, 'utf8'));
const OWNER = requireRealmOwner(REALM_IMPORT);
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
const PRICE_LIST_CODE = process.env.PHASE01_PRICE_LIST_CODE ?? 'HOSPITAL-DEFAULT-PRICE';
const CONSUMER_MAIN = resolve('apps/sim-consumer/dist/main.js');
const OPENAPI_PATH = resolve('contracts/openapi/phase-01.openapi.json');
const runId = randomUUID();
const runSuffix = runId.slice(0, 8).toUpperCase();
const startedAt = nowInAsiaShanghai();

await assertDirectoryAbsent(OUTPUT_DIR);
await mkdir(dirname(OUTPUT_DIR), { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: false });

const consumerProcesses = [];
let verification;
let failure;
try {
  const browserIdentity = await establishOwnerSession();
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
  const negativeCsrf = await invalidCsrfClient.POST('/v1/phase-01/charge-item-publications', {
    params: { header: { 'x-csrf-token': 'invalid-csrf-token-that-is-long-enough' } },
    body: chargeBody(`CSRF-${runSuffix}`),
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
      port: 4101,
      clientId: 'hdi-sim-consumer-a',
      clientSecret: CONSUMER_A_SECRET,
      notificationAuthorization: requireNotificationAuthorization(CONSUMER_A_PRINCIPAL_ID),
      stateDirectory: consumerAStateDirectory,
    }),
    await startConsumer({
      label: 'consumer-b',
      port: 4102,
      clientId: 'hdi-sim-consumer-b',
      clientSecret: CONSUMER_B_SECRET,
      notificationAuthorization: requireNotificationAuthorization(CONSUMER_B_PRINCIPAL_ID),
      stateDirectory: consumerBStateDirectory,
    }),
  );

  const charge = unwrap(
    await ownerClient.POST('/v1/phase-01/charge-item-publications', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: chargeBody(`FEE-${runSuffix}`),
    }),
    201,
  );
  const price = unwrap(
    await ownerClient.POST('/v1/phase-01/price-list-publications', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: PRICE_OBJECT_ID,
        priceListCode: PRICE_LIST_CODE,
        displayName: `Phase 01实时价表 ${runSuffix}`,
        currencyCode: 'CNY',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
        changeReason: '真实Anolis运行环境纵向切片核验',
        entries: [
          {
            chargeItemId: charge.stableId,
            chargeItemVersionId: charge.versionId,
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

  const consumerAState = await waitForClosedState(consumerAStatePath, price.eventId);
  assert.equal(await fileExists(consumerBStatePath), false, 'Legacy consumer must remain blocked.');

  const resolutionRecordAsOf = nowInAsiaShanghai();
  const resolution = unwrap(
    await ownerClient.POST('/v1/phase-01/price-resolutions', {
      params: { header: { 'x-csrf-token': browserIdentity.session.csrfToken } },
      body: {
        governanceObjectId: PRICE_OBJECT_ID,
        requestId: `LIVE-${runSuffix}`,
        chargeItemId: charge.stableId,
        chargeItemVersionId: charge.versionId,
        priceListId: price.stableId,
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
      body: { governanceObjectId: PRICE_OBJECT_ID, eventId: price.eventId },
    }),
    201,
  );
  const consumerBState = await waitForClosedState(consumerBStatePath, price.eventId);
  assert.deepEqual(consumerBState.lastAppliedPayload, consumerAState.lastAppliedPayload);
  assert.equal(
    consumerBState.appliedEvents[price.eventId].snapshotDigest,
    consumerAState.appliedEvents[price.eventId].snapshotDigest,
  );

  const serviceAClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    accessToken: await obtainServiceToken('hdi-sim-consumer-a', CONSUMER_A_SECRET),
  });
  const serviceBClient = createGovernanceApiClient({
    baseUrl: API_BASE_URL,
    accessToken: await obtainServiceToken('hdi-sim-consumer-b', CONSUMER_B_SECRET),
  });
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
    priceEventId: price.eventId,
    priceReleaseId: price.versionId,
    subscriptionAId: subscriptionA.subscriptionId,
    subscriptionBId: subscriptionB.subscriptionId,
    aggregateVersion: consumerAState.appliedAggregateVersion,
  });

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
    consumption: {
      consumerA: summarizeConsumerState(consumerAState, price.eventId),
      consumerB: summarizeConsumerState(consumerBState, price.eventId),
      identicalCanonicalSnapshotDigest:
        consumerAState.appliedEvents[price.eventId].snapshotDigest ===
        consumerBState.appliedEvents[price.eventId].snapshotDigest,
      checkpointsClosed: true,
    },
    databaseVerification,
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
  await Promise.allSettled(consumerProcesses.map((consumer) => stopConsumer(consumer)));
}

await writeFile(join(OUTPUT_DIR, 'live-verification.json'), `${JSON.stringify(verification, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});
await writeManifest(OUTPUT_DIR);
process.stdout.write(
  `${JSON.stringify({ status: verification.status, runId, evidenceDirectory: OUTPUT_DIR })}\n`,
);
if (failure) throw failure;

function chargeBody(internalCode) {
  return {
    governanceObjectId: CHARGE_OBJECT_ID,
    catalogCode: 'HOSPITAL-CHARGE-CATALOG',
    internalCode,
    formalName: `POC诊查费 ${runSuffix}`,
    serviceDefinition: '真实Anolis运行环境合成POC收费项目，仅用于验证治理闭环。',
    billingUnitCode: 'TIMES',
    chargingMethodCode: 'COUNT',
    businessValidFrom: '2026-08-08T00:00:00',
    businessValidTo: null,
    changeReason: '真实Anolis运行环境纵向切片核验',
  };
}

async function establishOwnerSession() {
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
      username: OWNER.username,
      password: OWNER.password,
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
  const sessionResponse = await fetch(`${API_BASE_URL}/auth/session`, {
    headers: { cookie: opaqueCookie },
  });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.principalKind, 'PERSON');
  assert.equal(typeof session.csrfToken, 'string');
  return { cookieHeader: opaqueCookie, session };
}

function createCookieFetch(cookie) {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('cookie', cookie);
    return fetch(new Request(request, { headers }));
  };
}

async function startConsumer(options) {
  const stdoutPath = join(OUTPUT_DIR, `${options.label}.stdout.log`);
  const stderrPath = join(OUTPUT_DIR, `${options.label}.stderr.log`);
  const stdout = createWriteStream(stdoutPath, { flags: 'wx', mode: 0o600 });
  const stderr = createWriteStream(stderrPath, { flags: 'wx', mode: 0o600 });
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
      HOST: '127.0.0.1',
      PORT: String(options.port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const consumer = { child, stdout, stderr, label: options.label };
  await waitForPort(options.port, child);
  return consumer;
}

async function stopConsumer(consumer) {
  if (consumer.child.exitCode === null && consumer.child.signalCode === null) {
    consumer.child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveClose) => consumer.child.once('close', resolveClose)),
      delay(5_000).then(() => consumer.child.kill('SIGKILL')),
    ]);
  }
  consumer.stdout.end();
  consumer.stderr.end();
  await delay(50);
}

async function waitForPort(port, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`SIM_CONSUMER_${port}_EXITED_${child.exitCode}`);
    const connected = await new Promise((resolveConnected) => {
      const socket = connect({ host: '127.0.0.1', port });
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

async function waitForClosedState(path, eventId) {
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

async function obtainServiceToken(clientId, clientSecret) {
  const response = await fetch(`${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  assert.equal(response.status, 200);
  const tokenSet = await response.json();
  assert.equal(typeof tokenSet.access_token, 'string');
  return tokenSet.access_token;
}

async function verifyDatabaseClosure(options) {
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
      ],
    );
    const timezoneColumns = await client.query(`
      select count(*)::integer as count
      from information_schema.columns
      where table_schema in (
        'access_control', 'audit', 'charge_catalog', 'platform', 'price_list',
        'price_resolution', 'release_distribution', 'workflow'
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

async function loadConsumerClosure(client, subscriptionId, eventId) {
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

async function verifyAuditChain(client, auditStreamId) {
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

function unwrap(result, expectedStatus) {
  assert.equal(result.response.status, expectedStatus, JSON.stringify(result.error));
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.data;
}

function summarizeConsumerState(state, eventId) {
  return {
    subscriptionId: state.subscriptionId,
    appliedAggregateVersion: state.appliedAggregateVersion,
    eventId,
    snapshotId: state.appliedEvents[eventId].snapshotId,
    snapshotDigest: state.appliedEvents[eventId].snapshotDigest,
    closure: state.appliedEvents[eventId].closure,
  };
}

function mergeCookieJar(jar, setCookies) {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  assert.ok(jar.size > 0, 'Expected Keycloak authorization cookies.');
}

function serializeCookieJar(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function requireLocation(response) {
  const location = response.headers.get('location');
  assert.ok(location, `HTTP ${response.status} response did not contain Location.`);
  return location;
}

function decodeHtmlAttribute(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&#x3D;', '=').replaceAll('&#61;', '=');
}

async function assertDirectoryAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  throw new Error(`EVIDENCE_OUTPUT_ALREADY_EXISTS:${path}`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function writeManifest(directory) {
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

async function listEvidenceFiles(directory, relativeDirectory = '') {
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function nowInAsiaShanghai() {
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
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function isMissingFile(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function requireRealmOwner(realm) {
  const owner = realm.users?.find((candidate) => candidate.username === 'phase01-owner');
  const password = owner?.credentials?.find((candidate) => candidate.type === 'password')?.value;
  if (typeof owner?.username !== 'string' || typeof password !== 'string') {
    throw new Error('KEYCLOAK_REALM_OWNER_CREDENTIAL_MISSING');
  }
  return { username: owner.username, password };
}

function requireRealmClientSecret(realm, clientId) {
  const secret = realm.clients?.find((candidate) => candidate.clientId === clientId)?.secret;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(`KEYCLOAK_REALM_CLIENT_SECRET_MISSING:${clientId}`);
  }
  return secret;
}

function parseNotificationTargets(value) {
  const targets = JSON.parse(value);
  if (!Array.isArray(targets)) throw new Error('NOTIFICATION_TARGETS_INVALID');
  return targets;
}

function requireNotificationAuthorization(servicePrincipalId) {
  const authorization = NOTIFICATION_TARGETS.find(
    (candidate) => candidate.servicePrincipalId === servicePrincipalId,
  )?.authorizationHeader;
  if (typeof authorization !== 'string' || authorization.length === 0) {
    throw new Error(`NOTIFICATION_TARGET_AUTHORIZATION_MISSING:${servicePrincipalId}`);
  }
  return authorization;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
