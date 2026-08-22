import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface SharedCommand {
  readonly id: 'static' | 'typecheck' | 'build' | 'integration' | 'live' | 'browser';
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const sharedDirectory = resolve(requireEnvironment('ABG_SHARED_EVIDENCE_DIR'));
const runId = requireEnvironment('ABG_RUN_ID');
await mkdir(sharedDirectory, { recursive: false });
await mkdir(join(sharedDirectory, 'integration'), { recursive: false });
const commands: readonly SharedCommand[] = [
  { id: 'static', executable: 'npm', args: ['run', 'check'] },
  { id: 'typecheck', executable: 'npm', args: ['run', 'typecheck'] },
  { id: 'build', executable: 'npm', args: ['run', 'build'] },
  {
    id: 'integration',
    executable: 'npm',
    args: [
      'exec', '--workspace', '@hospital-data-intelligence/governance-api', '--',
      'vitest', 'run', 'src/composition/phase-01-vertical-slice.integration.test.ts',
      '--reporter=json',
      `--outputFile=${join(sharedDirectory, 'integration', 'vitest-results.json')}`,
    ],
  },
  {
    id: 'live',
    executable: 'node',
    args: ['tooling/verification/src/verify-phase-01-live.ts'],
    environment: { EVIDENCE_OUTPUT_DIR: join(sharedDirectory, 'live') },
  },
  {
    id: 'browser',
    executable: 'node',
    args: ['tests/e2e/run-playwright.ts'],
    environment: { PHASE01_E2E_RUN_ID: `abg-${runId}`, PHASE01_E2E_BROWSER: 'chrome' },
  },
];

const results = [];
let application: RunningApplication | undefined;
try {
  for (const command of commands) {
    if (command.id === 'live') {
      application = await startApplication();
      results.push({ id: 'application', exitCode: 0, elapsedMilliseconds: application.startupMilliseconds });
    }
    const result = await execute(command);
    results.push(result);
    if (command.id === 'browser' && result.exitCode === 0) {
      const browserSource = resolve(
        repositoryRoot,
        '.runtime/e2e',
        `abg-${runId}`,
        'playwright-results.json',
      );
      await mkdir(join(sharedDirectory, 'browser'), { recursive: false });
      await copyFile(browserSource, join(sharedDirectory, 'browser/playwright-results.json'), 1);
    }
    if (result.exitCode !== 0) break;
  }
} finally {
  await stopApplication(application);
}
const status = results.length === commands.length + 1 && results.every((result) => result.exitCode === 0)
  ? 'PASSED'
  : 'FAILED';
await writeFile(
  join(sharedDirectory, 'shared-verification.json'),
  `${JSON.stringify({
    schemaVersion: 'phase-01.shared-abg-verification.v1',
    runId,
    status,
    commands: results,
  }, null, 2)}\n`,
  { encoding: 'utf8', flag: 'wx', mode: 0o400 },
);
if (status !== 'PASSED') throw new Error('SHARED_ABG_VERIFICATION_FAILED');

async function execute(command: SharedCommand) {
  const started = performance.now();
  const child = spawn(command.executable, [...command.args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...command.environment },
    shell: false,
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  await Promise.all([
    writeFile(join(sharedDirectory, `${command.id}.stdout.log`), Buffer.concat(stdout), {
      flag: 'wx', mode: 0o400,
    }),
    writeFile(join(sharedDirectory, `${command.id}.stderr.log`), Buffer.concat(stderr), {
      flag: 'wx', mode: 0o400,
    }),
  ]);
  return {
    id: command.id,
    exitCode,
    elapsedMilliseconds: Math.round(performance.now() - started),
  };
}

interface RunningApplication {
  readonly child: ChildProcess;
  readonly stdout: WriteStream;
  readonly stderr: WriteStream;
  readonly startupMilliseconds: number;
}

async function startApplication(): Promise<RunningApplication> {
  const started = performance.now();
  const stdout = createWriteStream(join(sharedDirectory, 'application.stdout.log'), {
    flags: 'wx', mode: 0o400,
  });
  const stderr = createWriteStream(join(sharedDirectory, 'application.stderr.log'), {
    flags: 'wx', mode: 0o400,
  });
  const notificationAuthorization = requireEnvironment(
    'HDI_SIM_CONSUMER_NOTIFICATION_AUTHORIZATION',
  );
  const postgresPassword = encodeURIComponent(requireEnvironment('HDI_POSTGRES_PASSWORD'));
  const realmImportPath = join(
    repositoryRoot,
    '.runtime/abg-runtime',
    runId,
    'keycloak-import/hdi-phase01-realm.json',
  );
  const notificationTargets = JSON.stringify([
    {
      servicePrincipalId: '40000000-0000-7000-8000-000000000002',
      url: 'http://127.0.0.1:4101/v1/release-notifications',
      authorizationHeader: notificationAuthorization,
    },
    {
      servicePrincipalId: '40000000-0000-7000-8000-000000000003',
      url: 'http://127.0.0.1:4102/v1/release-notifications',
      authorizationHeader: notificationAuthorization,
    },
  ]);
  const child = spawn(process.execPath, ['apps/governance-api/dist/main.js'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://hdi_phase01:${postgresPassword}@127.0.0.1:55432/hdi_phase01`,
      KEYCLOAK_ISSUER_URL: 'http://127.0.0.1:18080/realms/hdi-phase01',
      KEYCLOAK_BROWSER_CLIENT_ID: 'hdi-governance-browser',
      KEYCLOAK_BROWSER_CLIENT_SECRET: requireEnvironment('HDI_BROWSER_CLIENT_SECRET'),
      KEYCLOAK_SERVICE_AUDIENCE: 'hdi-governance-api',
      PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      SESSION_CSRF_SECRET: requireEnvironment('SESSION_CSRF_SECRET'),
      SIM_CONSUMER_NOTIFICATION_TARGETS_JSON: notificationTargets,
      ADMIN_STATIC_ROOT: join(repositoryRoot, 'apps/admin-web/dist'),
      HOST: '127.0.0.1',
      PORT: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  await waitForPort(3000, child);
  process.env['DATABASE_URL'] = `postgresql://hdi_phase01:${postgresPassword}@127.0.0.1:55432/hdi_phase01`;
  process.env['KEYCLOAK_ISSUER_URL'] = 'http://127.0.0.1:18080/realms/hdi-phase01';
  process.env['KEYCLOAK_REALM_IMPORT_PATH'] = realmImportPath;
  process.env['GOVERNANCE_API_BASE_URL'] = 'http://127.0.0.1:3000';
  process.env['PHASE01_E2E_BASE_URL'] = 'http://127.0.0.1:3000';
  process.env['PHASE01_E2E_PASSWORD'] = requireEnvironment('HDI_OWNER_PASSWORD');
  process.env['SIM_CONSUMER_NOTIFICATION_TARGETS_JSON'] = notificationTargets;
  return { child, stdout, stderr, startupMilliseconds: Math.round(performance.now() - started) };
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`GOVERNANCE_API_EXITED:${child.exitCode}`);
    const ready = await new Promise<boolean>((resolveReady) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolveReady(true); });
      socket.once('error', () => resolveReady(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error('GOVERNANCE_API_START_TIMEOUT');
}

async function stopApplication(application: RunningApplication | undefined): Promise<void> {
  if (!application) return;
  if (application.child.exitCode === null && application.child.signalCode === null) {
    application.child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolveClose) => application.child.once('close', () => resolveClose())),
      delay(5_000).then(() => { application.child.kill('SIGKILL'); }),
    ]);
  }
  application.stdout.end();
  application.stderr.end();
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
