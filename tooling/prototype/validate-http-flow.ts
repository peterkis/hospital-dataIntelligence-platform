import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const host = process.env['HOST'] ?? '127.0.0.1';
const port = parsePort(process.env['PORT'] ?? '3000');
const baseUrl = `http://${host}:${port}`;
let apiProcess: ChildProcess | undefined;
let apiProcessExited = false;
let apiProcessGracefullyStopped = false;
let portReleased = false;
let persistenceBefore: PrototypePersistenceTotals | undefined;
let persistenceObserved = false;
let httpSmokePassed = false;

try {
  if (await isPortAcceptingConnections(host, port)) {
    throw new Error('PROTOTYPE_PORT_ALREADY_IN_USE');
  }

  await runNode('DATABASE_CHECK', ['tooling/prototype/check-database.mjs']);
  await runNode('DATABASE_MIGRATION', [
    'tooling/runtime/apply-migrations.mjs',
    'db/migrations',
  ]);
  await runNode('SYNTHETIC_SEED', [
    '--import',
    'tsx',
    'tooling/prototype/seed-prototype.ts',
  ]);
  persistenceBefore = await readPrototypePersistenceTotals();

  apiProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/governance-api/src/prototype-main.ts'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
        PROTOTYPE_MODE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  apiProcess.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  apiProcess.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  await waitForHealth(apiProcess, `${baseUrl}/health`, 20_000);

  await runNode('HTTP_SMOKE', [
    '--import',
    'tsx',
    'tooling/prototype/run-http-flow.ts',
  ], {
    PROTOTYPE_API_BASE_URL: baseUrl,
  });
  httpSmokePassed = true;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_HTTP_VALIDATION_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  const stopResult = apiProcess
    ? await stopChild(apiProcess)
    : { exited: true, graceful: true };
  apiProcessExited = stopResult.exited;
  apiProcessGracefullyStopped = stopResult.graceful;
  portReleased = !(await waitForPortState(host, port, false, 10_000));
  if (httpSmokePassed && persistenceBefore) {
    try {
      const persistenceAfter = await readPrototypePersistenceTotals();
      persistenceObserved =
        persistenceAfter.publishedChargeItemVersions >
          persistenceBefore.publishedChargeItemVersions &&
        persistenceAfter.publishedPriceListReleases >
          persistenceBefore.publishedPriceListReleases &&
        persistenceAfter.priceResolutions > persistenceBefore.priceResolutions;
      if (!persistenceObserved) {
        process.stderr.write(`${JSON.stringify({
          status: 'FAILED',
          errorCode: 'PROTOTYPE_HTTP_PERSISTENCE_NOT_OBSERVED',
        })}\n`);
        process.exitCode = 1;
      }
    } catch {
      process.stderr.write(`${JSON.stringify({
        status: 'FAILED',
        errorCode: 'PROTOTYPE_HTTP_PERSISTENCE_CHECK_FAILED',
      })}\n`);
      process.exitCode = 1;
    }
  }
  if (!apiProcessExited || !apiProcessGracefullyStopped || !portReleased) {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      errorCode: !apiProcessExited
        ? 'PROTOTYPE_API_PROCESS_DID_NOT_EXIT'
        : !apiProcessGracefullyStopped
          ? 'PROTOTYPE_API_DID_NOT_STOP_GRACEFULLY'
          : 'PROTOTYPE_PORT_NOT_RELEASED',
      apiProcessExited,
      apiProcessGracefullyStopped,
      portReleased,
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.exitCode !== 1) {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    apiProcessExited,
    apiProcessGracefullyStopped,
    portReleased,
    databasePoolClosed: true,
    consumerProcessStarted: false,
    persistenceObserved,
  })}\n`);
}

interface PrototypePersistenceTotals {
  readonly publishedChargeItemVersions: bigint;
  readonly publishedPriceListReleases: bigint;
  readonly priceResolutions: bigint;
}

async function readPrototypePersistenceTotals(): Promise<PrototypePersistenceTotals> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-http-persistence-check',
    max: 1,
  });
  try {
    const [chargeItems, priceLists, resolutions] = await Promise.all([
      databaseHandle.database
        .selectFrom('charge_catalog.charge_item as item')
        .innerJoin(
          'charge_catalog.charge_item_version as version',
          'version.charge_item_id',
          'item.charge_item_id',
        )
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('item.internal_code', 'like', 'PROTOTYPE-SYNTHETIC-HTTP-FEE-%')
        .where('version.governance_status', '=', 'PUBLISHED')
        .executeTakeFirstOrThrow(),
      databaseHandle.database
        .selectFrom('price_list.price_list as list')
        .innerJoin(
          'price_list.price_list_release as release',
          'release.price_list_id',
          'list.price_list_id',
        )
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('list.price_list_code', '=', 'PROTOTYPE-SYNTHETIC-PRICE-LIST')
        .where('release.display_name', 'like', 'PROTOTYPE SYNTHETIC HTTP PRICE LIST %')
        .where('release.governance_status', '=', 'PUBLISHED')
        .executeTakeFirstOrThrow(),
      databaseHandle.database
        .selectFrom('price_resolution.price_resolution')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('request_id', 'like', 'PROTOTYPE-SYNTHETIC-HTTP-PRICE-RESOLUTION-%')
        .executeTakeFirstOrThrow(),
    ]);
    return {
      publishedChargeItemVersions: BigInt(chargeItems.count),
      publishedPriceListReleases: BigInt(priceLists.count),
      priceResolutions: BigInt(resolutions.count),
    };
  } finally {
    await databaseHandle.close();
  }
}

async function runNode(
  step: string,
  arguments_: readonly string[],
  environment?: Readonly<Record<string, string>>,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.once('error', () => reject(new Error(`PROTOTYPE_STEP_SPAWN_FAILED:${step}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`PROTOTYPE_STEP_FAILED:${step}:${code ?? signal ?? 'UNKNOWN'}`));
    });
  });
}

async function waitForHealth(
  child: ChildProcess,
  healthUrl: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('PROTOTYPE_API_EXITED_BEFORE_HEALTHY');
    }
    try {
      const response = await fetch(healthUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok && (await response.json() as { status?: unknown }).status === 'ok') return;
    } catch {
      // The bounded readiness loop continues until the process listens or the deadline expires.
    }
    await delay(200);
  }
  throw new Error('PROTOTYPE_API_HEALTH_TIMEOUT');
}

async function stopChild(child: ChildProcess): Promise<{
  readonly exited: boolean;
  readonly graceful: boolean;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exited: true, graceful: child.exitCode === 0 };
  }
  const exited = new Promise<{ readonly code: number | null }>((resolvePromise) => {
    child.once('exit', (code) => resolvePromise({ code }));
  });
  if (child.connected) child.send('PROTOTYPE_SHUTDOWN');
  else child.kill('SIGTERM');
  const gracefulResult = await Promise.race([
    exited,
    delay(10_000).then(() => undefined),
  ]);
  if (gracefulResult) {
    return { exited: true, graceful: gracefulResult.code === 0 };
  }
  child.kill('SIGKILL');
  const forcedResult = await Promise.race([
    exited,
    delay(5_000).then(() => undefined),
  ]);
  return { exited: forcedResult !== undefined, graceful: false };
}

async function waitForPortState(
  targetHost: string,
  targetPort: number,
  accepting: boolean,
  timeoutMilliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const current = await isPortAcceptingConnections(targetHost, targetPort);
    if (current === accepting) return current;
    await delay(200);
  }
  return isPortAcceptingConnections(targetHost, targetPort);
}

function isPortAcceptingConnections(targetHost: string, targetPort: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: targetHost, port: targetPort });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once('error', () => resolvePromise(false));
  });
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT_INVALID');
  }
  return parsed;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}
