import { resolve } from 'node:path';
import { buildApplication } from './composition/build-application.js';
import { createScopedModules, type ScopedModules } from './composition/create-scoped-modules.js';
import { createPhase01VerticalSlice } from './composition/phase-01-vertical-slice.js';
import { createWorkflowApplication } from './modules/workflow/index.js';
import {
  PROTOTYPE_AUTHENTICATION_MODE,
  createPrototypeAuthentication,
} from './platform/authentication/prototype-authentication.js';
import { createDatabase } from './platform/database/create-database.js';
import { assertNoProductionFaultConfiguration } from './platform/fault-injection/controlled-faults.js';
import { createTransactionRunner } from './platform/transaction/transaction-runner.js';
import { assertPrototypeDatabaseReady } from './prototype-readiness.js';
import {
  PROTOTYPE_DATABASE_POOL_CLOSED_EVENT,
  closePrototypeResources,
} from './prototype-lifecycle.js';

process.env['TZ'] = 'Asia/Shanghai';

const host = process.env['HOST'] ?? '127.0.0.1';
const port = parsePort(process.env['PORT'] ?? '3000');
const authentication = createPrototypeAuthentication({
  host,
  nodeEnvironment: process.env['NODE_ENV'],
  prototypeMode: process.env['PROTOTYPE_MODE'],
});
assertNoProductionFaultConfiguration(process.env);

const databaseUrl = requireEnvironment('DATABASE_URL');
const databaseHandle = createDatabase({
  connectionString: databaseUrl,
  application_name: 'hdi-prototype-http-api',
});
let application: Awaited<ReturnType<typeof buildApplication>> | undefined;
let closing = false;

try {
  const readiness = await assertPrototypeDatabaseReady(
    databaseHandle.database,
    resolve(import.meta.dirname, '../../../db/migrations'),
  );
  const transactionRunner = createTransactionRunner<ScopedModules>(
    databaseHandle.database,
    (transaction, context) => createScopedModules(
      transaction,
      context,
      databaseHandle.database,
    ),
  );
  const notificationTransport = createPrototypeNoOpNotificationTransport();
  const verticalSlice = createPhase01VerticalSlice(transactionRunner);
  const workflowApplication = createWorkflowApplication(
    transactionRunner,
    () => notificationTransport.publicationCommitted(),
  );
  application = await buildApplication({
    phase01: {
      verticalSlice,
      transactionRunner,
      workflowApplication,
      resolvePrincipal: (request) => authentication.resolvePrincipal(request),
      now: nowInAsiaShanghai,
    },
  });
  await application.listen({ host, port });
  safeDevelopmentLog({
    event: 'PROTOTYPE_API_STARTED',
    authenticationMode: PROTOTYPE_AUTHENTICATION_MODE,
    databaseConnected: true,
    host,
    migrationCount: readiness.migrationCount,
    notificationMode: 'NOOP_NOT_STARTED',
    port,
    postgresqlVersion: readiness.postgresqlVersion,
    syntheticPrincipalCount: readiness.syntheticPrincipalCount,
  });
} catch (error) {
  let resourceCloseError: unknown;
  try {
    await closePrototypeResources({ application, database: databaseHandle });
  } catch (closeError) {
    resourceCloseError = closeError;
  }
  application = undefined;
  safeDevelopmentLog({
    event: 'PROTOTYPE_API_START_FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_API_START_FAILED'),
    resourceCloseErrorCode: resourceCloseError
      ? safeErrorCode(resourceCloseError, 'PROTOTYPE_RESOURCE_CLOSE_FAILED')
      : null,
  });
  process.exitCode = 1;
}

async function closeApplication(
  reason: NodeJS.Signals | 'PROTOTYPE_PARENT_REQUEST',
): Promise<void> {
  if (closing) return;
  closing = true;
  safeDevelopmentLog({ event: 'PROTOTYPE_API_STOPPING', reason });
  try {
    await closePrototypeResources({
      application,
      database: databaseHandle,
      onResourcesClosed() {
        if (typeof process.send === 'function') {
          process.send({ event: PROTOTYPE_DATABASE_POOL_CLOSED_EVENT });
        }
      },
    });
    safeDevelopmentLog({ event: 'PROTOTYPE_API_STOPPED' });
    process.exitCode = 0;
  } catch (error) {
    safeDevelopmentLog({
      event: 'PROTOTYPE_API_STOP_FAILED',
      errorCode: safeErrorCode(error, 'PROTOTYPE_RESOURCE_CLOSE_FAILED'),
    });
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}

if (application) {
  process.once('SIGINT', closeApplication);
  process.once('SIGTERM', closeApplication);
  if (typeof process.send === 'function') {
    process.once('message', (message) => {
      if (message === 'PROTOTYPE_SHUTDOWN') {
        void closeApplication('PROTOTYPE_PARENT_REQUEST');
      }
    });
  }
}

function createPrototypeNoOpNotificationTransport(): {
  publicationCommitted(): void;
} {
  return {
    publicationCommitted() {
      safeDevelopmentLog({
        event: 'PROTOTYPE_NOTIFICATION_SKIPPED',
        notificationMode: 'NOOP_NOT_STARTED',
      });
    },
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
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

function safeDevelopmentLog(value: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (/^[A-Z0-9_]+$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}
