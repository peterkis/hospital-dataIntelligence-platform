import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import {evidenceRunDirectory} from '../vnext/p0-10-run-directory.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DISTRIBUTION = 'Anolis-8.9-HDI-POC';
const SERVICE = 'postgresql-18';
const READY_TIMEOUT_MILLISECONDS = 30_000;
const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const environmentFile = resolve(repositoryRoot, '.env.prototype.local');

const [targetScript, ...targetArguments] = process.argv.slice(2);
const databaseCheckScript = resolve(repositoryRoot, 'tooling/vnext/readiness.mjs');

if (!targetScript || !/^[a-z0-9][a-z0-9:._-]*$/u.test(targetScript)) {
  fail('PROTOTYPE_DATABASE_TARGET_SCRIPT_REQUIRED');
}
if (targetScript === 'prototype:db:with') {
  fail('PROTOTYPE_DATABASE_RECURSIVE_TARGET');
}
const currentCompilerTargets = new Set(['typecheck','build','check:module-boundaries','check:runtime','check:repo:layout']);
if (!targetScript.startsWith('vnext:') && !targetScript.startsWith('test:vnext:') && !currentCompilerTargets.has(targetScript)) {
  fail('LEGACY_OUT_OF_CURRENT_EXECUTION');
}
if (process.platform !== 'win32') {
  fail('PROTOTYPE_DATABASE_WINDOWS_HOST_REQUIRED');
}
if (!existsSync(environmentFile)) {
  fail('PROTOTYPE_DATABASE_ENV_FILE_MISSING');
}
if (!process.env.npm_execpath) {
  fail('PROTOTYPE_DATABASE_NPM_ENTRYPOINT_REQUIRED');
}

const distributionOwnedByRunner = !isDistributionRunning();
const initialService = distributionOwnedByRunner
  ? { status: 1 }
  : runWsl(['systemctl', 'is-active', '--quiet', SERVICE]);
if (!distributionOwnedByRunner && initialService.status !== 0) {
  const serviceDefinition = runWsl(['systemctl', 'cat', SERVICE]);
  if (serviceDefinition.status !== 0) {
    fail('PROTOTYPE_DATABASE_SERVICE_STATE_UNKNOWN');
  }
}

const serviceOwnedByRunner = distributionOwnedByRunner || initialService.status !== 0;
const p0RunDirectory=targetScript==='vnext:p0-10:validate'?evidenceRunDirectory(resolve(repositoryRoot,'.runtime/vnext/p0-10',`${Date.now()}-${randomUUID()}`),{create:true,exclusive:true}):undefined;
let ready=false;
let keepalive;
let targetProcess;
let interruptedSignal;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptedSignal = signal;
    targetProcess?.kill(signal);
  });
}

let targetExitCode = 1;
let finalDatabaseCheck;
let serviceInactiveAfterCleanup;
let serviceStopCommandExitCode;
let distributionTerminateSucceeded = !distributionOwnedByRunner;

try {
  keepalive = spawn(
    'wsl.exe',
    [
      '--distribution',
      DISTRIBUTION,
      '--user',
      'root',
      '--',
      'bash',
      '-lc',
      `systemctl start ${SERVICE} && exec sleep infinity`,
    ],
    {
      cwd: repositoryRoot,
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  keepalive.once('error', () => {
    interruptedSignal ??= 'WSL_KEEPALIVE_ERROR';
  });

  const readyCheck = await waitForDatabase();
  ready=true;
  write({
    status: 'DATABASE_SESSION_READY',
    distribution: DISTRIBUTION,
    service: SERVICE,
    distributionOwnedByRunner,
    serviceOwnedByRunner,
    ...readyCheck.observation,
  });

  if (interruptedSignal) {
    throw new Error('PROTOTYPE_DATABASE_SESSION_INTERRUPTED');
  }

  const npmArguments = [
    '--env-file-if-exists=.env.prototype.local',
    process.env.npm_execpath,
    'run',
    targetScript,
  ];
  if (targetArguments.length > 0) {
    npmArguments.push('--', ...targetArguments);
  }

  targetProcess = spawn(process.execPath, npmArguments, {
    cwd: repositoryRoot,
    env: p0RunDirectory?{...process.env,VNEXT_P0_10_RUN_DIRECTORY:p0RunDirectory}:process.env,
    stdio: 'inherit',
    windowsHide: false,
  });
  const [code, signal] = await once(targetProcess, 'exit');
  targetExitCode = code ?? (signal ? 1 : 0);
} catch (error) {
  writeError(safeErrorCode(error));
  targetExitCode = 1;
} finally {
  if (serviceOwnedByRunner) {
    const serviceStop = runWsl(['systemctl', 'stop', SERVICE]);
    serviceStopCommandExitCode = serviceStop.status;
    serviceInactiveAfterCleanup = runWsl([
      'systemctl',
      'is-active',
      '--quiet',
      SERVICE,
    ]).status !== 0;
  }
  await stopKeepalive(keepalive);
  if (distributionOwnedByRunner) {
    const termination = spawnSync('wsl.exe', ['--terminate', DISTRIBUTION], {
      cwd: repositoryRoot,
      stdio: 'ignore',
      windowsHide: true,
    });
    distributionTerminateSucceeded = termination.status === 0;
  }
  finalDatabaseCheck = runDatabaseCheck();
  if (distributionOwnedByRunner && !finalDatabaseCheck.passed) {
    serviceInactiveAfterCleanup = true;
  }
  const cleanupPassed = (!serviceOwnedByRunner || serviceInactiveAfterCleanup === true)
    && distributionTerminateSucceeded
    && (!serviceOwnedByRunner || !finalDatabaseCheck.passed);
  if (!cleanupPassed) {
    targetExitCode = 1;
  }
  const terminal={
    status: 'DATABASE_SESSION_CLOSED',
    ready,
    distributionOwnedByRunner,
    distributionTerminateAttempted: distributionOwnedByRunner,
    distributionTerminateSucceeded,
    serviceOwnedByRunner,
    serviceStopAttempted: serviceOwnedByRunner,
    serviceStopCommandExitCode,
    serviceInactiveAfterCleanup,
    databaseReachableAfterCleanup: finalDatabaseCheck.passed,
    finalDatabaseErrorCode: finalDatabaseCheck.observation.errorCode,
    cleanupPassed,
    targetExitCode: interruptedSignal ? 130 : targetExitCode,
  };
  write(terminal);
  if(p0RunDirectory) {
    // P0-10 is terminal only after this outer session's cleanup, never in its child.
    evidenceRunDirectory(p0RunDirectory);
    writeFileSync(resolve(p0RunDirectory,'wrapper-cleanup.json'),JSON.stringify(terminal,null,2)+'\n',{flag:'wx'});
    const finalized=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p0-10-finalize.mjs',p0RunDirectory],{cwd:repositoryRoot,env:process.env,stdio:'inherit',windowsHide:true});
    if(finalized.status!==0)targetExitCode=finalized.status ?? 1;
  }
}

process.exitCode = interruptedSignal ? 130 : targetExitCode;

async function waitForDatabase() {
  const deadline = Date.now() + READY_TIMEOUT_MILLISECONDS;
  let check = runDatabaseCheck();
  while (!check.passed && Date.now() < deadline) {
    if (interruptedSignal || keepalive?.exitCode !== null) break;
    await delay(1_000);
    check = runDatabaseCheck();
  }
  if (!check.passed) {
    throw new Error(check.observation.errorCode ?? 'PROTOTYPE_DATABASE_NOT_READY');
  }
  return check;
}

function runDatabaseCheck() {
  const result = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env.prototype.local', databaseCheckScript],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    },
  );
  return {
    passed: result.status === 0,
    observation: parseSafeObservation(result.stdout, result.stderr),
  };
}

function parseSafeObservation(stdout, stderr) {
  const lines = `${stdout ?? ''}\n${stderr ?? ''}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') {
        return {
          databaseConnected: value.databaseConnected === true,
          postgresqlMajorVersion: value.postgresqlMajorVersion,
          migrationTableExists: value.migrationTableExists,
          forbiddenDatabaseTypeCount: value.forbiddenDatabaseTypeCount,
          errorCode: typeof value.errorCode === 'string' ? value.errorCode : undefined,
        };
      }
    } catch {
      // The database check owns its safe JSON contract; ignore unrelated npm output.
    }
  }
  return { errorCode: 'PROTOTYPE_DATABASE_CHECK_OUTPUT_INVALID' };
}

function runWsl(commandArguments) {
  return spawnSync(
    'wsl.exe',
    ['--distribution', DISTRIBUTION, '--user', 'root', '--', ...commandArguments],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}

function isDistributionRunning() {
  const result = spawnSync('wsl.exe', ['--list', '--running', '--quiet'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail('PROTOTYPE_DATABASE_WSL_UNAVAILABLE');
  }
  const names = Buffer.from(result.stdout ?? []).toString('utf16le').replaceAll('\0', '');
  return names
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .includes(DISTRIBUTION);
}

async function stopKeepalive(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(2_000)]);
  if (child.exitCode !== null) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
}

function safeErrorCode(error) {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return 'PROTOTYPE_DATABASE_SESSION_FAILED';
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeError(errorCode) {
  process.stderr.write(`${JSON.stringify({ status: 'DATABASE_SESSION_FAILED', errorCode })}\n`);
}

function fail(errorCode) {
  writeError(errorCode);
  process.exit(1);
}
