import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApplication } from './composition/build-application.js';
import { createScopedModules, type ScopedModules } from './composition/create-scoped-modules.js';
import { createPhase01VerticalSlice } from './composition/phase-01-vertical-slice.js';
import { createKeycloakAuthentication } from './platform/authentication/keycloak-authentication.js';
import { createDatabase } from './platform/database/create-database.js';
import { createTransactionRunner } from './platform/transaction/transaction-runner.js';
import {
  createHttpReleaseNotificationTransport,
  createReleaseDistributionDispatcher,
} from './modules/release-distribution/index.js';
import { createWorkflowApplication } from './modules/workflow/index.js';
import {
  assertNoProductionFaultConfiguration,
  configureControlledPublicationFault,
} from './platform/fault-injection/controlled-faults.js';

process.env['TZ'] = 'Asia/Shanghai';
assertNoProductionFaultConfiguration(process.env);
if (process.env['NODE_ENV'] === 'test') {
  configureControlledPublicationFault(process.env['HDI_PUBLICATION_FAULT_POINT'] ?? null);
}

const databaseHandle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
});
const authentication = await createKeycloakAuthentication(databaseHandle.database, {
  issuerUrl: requireEnvironment('KEYCLOAK_ISSUER_URL'),
  browserClientId: requireEnvironment('KEYCLOAK_BROWSER_CLIENT_ID'),
  browserClientSecret: requireEnvironment('KEYCLOAK_BROWSER_CLIENT_SECRET'),
  serviceAudience: requireEnvironment('KEYCLOAK_SERVICE_AUDIENCE'),
  publicOrigin: requireEnvironment('PUBLIC_ORIGIN'),
  csrfSecret: requireEnvironment('SESSION_CSRF_SECRET'),
  loginLifetimeSeconds: 300,
  sessionLifetimeSeconds: 28_800,
});
const notificationTransport = createHttpReleaseNotificationTransport(
  parseNotificationTargets(requireEnvironment('SIM_CONSUMER_NOTIFICATION_TARGETS_JSON')),
);
const dispatcher = createReleaseDistributionDispatcher(
  databaseHandle.database,
  notificationTransport,
  {
    workerId: `governance-api-${randomUUID()}`,
    leaseSeconds: 30,
    retryDelaySeconds: 5,
    maxNotificationAttempts: 5,
    pollIntervalMilliseconds: 5_000,
    now: nowInAsiaShanghai,
  },
);
const transactionRunner = createTransactionRunner<ScopedModules>(
  databaseHandle.database,
  (transaction, context) => createScopedModules(transaction, context, databaseHandle.database),
);
const verticalSlice = createPhase01VerticalSlice(transactionRunner);
const workflowApplication = createWorkflowApplication(
  transactionRunner,
  () => dispatcher.wake(),
);
const adminStaticRoot =
  process.env['ADMIN_STATIC_ROOT'] ?? resolve(import.meta.dirname, '../../admin-web/dist');
const application = await buildApplication({
  adminStaticRoot,
  authentication,
  phase01: {
    verticalSlice,
    transactionRunner,
    workflowApplication,
    resolvePrincipal: (request) => authentication.resolvePrincipal(request),
    now: nowInAsiaShanghai,
  },
});
const port = parsePort(process.env['PORT'] ?? '3000');
const host = process.env['HOST'] ?? '127.0.0.1';

dispatcher.start();
try {
  await application.listen({ host, port });
} catch (error) {
  await dispatcher.stop();
  await databaseHandle.close();
  throw error;
}

let closing = false;
async function closeApplication(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  application.log.info({ signal }, 'Stopping governance API');
  await dispatcher.stop();
  await application.close();
  await databaseHandle.close();
  process.exitCode = 0;
}

process.once('SIGINT', closeApplication);
process.once('SIGTERM', closeApplication);

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function parseNotificationTargets(value: string): readonly {
  readonly servicePrincipalId: string;
  readonly url: string;
  readonly authorizationHeader: string;
}[] {
  const candidate = JSON.parse(value) as unknown;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error('SIM_CONSUMER_NOTIFICATION_TARGETS_INVALID');
  }
  return candidate.map((item) => {
    if (
      !isRecord(item) ||
      typeof item['servicePrincipalId'] !== 'string' ||
      typeof item['url'] !== 'string' ||
      typeof item['authorizationHeader'] !== 'string'
    ) {
      throw new Error('SIM_CONSUMER_NOTIFICATION_TARGET_INVALID');
    }
    return {
      servicePrincipalId: item['servicePrincipalId'],
      url: item['url'],
      authorizationHeader: item['authorizationHeader'],
    };
  });
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT_INVALID');
  }
  return port;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
