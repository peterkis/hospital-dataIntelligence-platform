import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const FORMAL_REPOSITORY_LABEL = 'hospital-data-intelligence-platform';
export const FORMAL_PHASE_LABEL = '01';
export const FORMAL_MANAGED_BY_LABEL = 'formal-abg';

export const FORMAL_RUNTIME_PORTS = [55432, 18080, 19000, 3000, 4101, 4102] as const;

export const FORMAL_REQUIRED_SECRET_NAMES = [
  'HDI_POSTGRES_PASSWORD',
  'HDI_KEYCLOAK_ADMIN_USERNAME',
  'HDI_KEYCLOAK_ADMIN_PASSWORD',
  'HDI_OWNER_PASSWORD',
  'HDI_BROWSER_CLIENT_SECRET',
  'HDI_SIM_CONSUMER_A_CLIENT_SECRET',
  'HDI_SIM_CONSUMER_B_CLIENT_SECRET',
  'HDI_SIM_CONSUMER_NOTIFICATION_AUTHORIZATION',
  'SESSION_CSRF_SECRET',
] as const;

export type FormalRequiredSecretName = (typeof FORMAL_REQUIRED_SECRET_NAMES)[number];

export interface FormalRunSeed {
  readonly runId: string;
  readonly runSequence: number;
  readonly composeProjectName: string;
}

export interface FormalRunIdentity extends FormalRunSeed {
  readonly gitCommitSha: string | null;
}

export interface FormalRuntimeLabels {
  readonly 'hdi.repository': typeof FORMAL_REPOSITORY_LABEL;
  readonly 'hdi.phase': typeof FORMAL_PHASE_LABEL;
  readonly 'hdi.run-id': string;
  readonly 'hdi.run-sequence': string;
  readonly 'hdi.managed-by': typeof FORMAL_MANAGED_BY_LABEL;
}

export interface RuntimeCommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface RuntimeCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RuntimeCommandRunner {
  run(command: RuntimeCommandSpec): Promise<RuntimeCommandResult>;
}

export class SpawnRuntimeCommandRunner implements RuntimeCommandRunner {
  async run(command: RuntimeCommandSpec): Promise<RuntimeCommandResult> {
    return new Promise<RuntimeCommandResult>((resolveRun, rejectRun) => {
      const child = spawn(command.executable, [...command.args], {
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        env: { ...process.env, ...command.environment },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const abort = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      };
      command.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        command.signal?.removeEventListener('abort', abort);
        rejectRun(error);
      });
      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        command.signal?.removeEventListener('abort', abort);
        resolveRun({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
    });
  }
}

export function createFormalRunSeed(
  runSequence: number,
  createRunId: () => string = randomUUID,
): FormalRunSeed {
  if (!Number.isSafeInteger(runSequence) || runSequence <= 0) {
    throw new Error('ABG_RUN_SEQUENCE_INVALID');
  }
  const runId = createRunId();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/u.test(runId)) {
    throw new Error('ABG_RUN_ID_INVALID');
  }
  const safeShortId = runId.replaceAll(/[^A-Za-z0-9]/gu, '').toLowerCase().slice(0, 12);
  if (safeShortId.length < 8) throw new Error('ABG_RUN_ID_SHORT_ID_INVALID');
  return {
    runId,
    runSequence,
    composeProjectName: `hdi_phase01_abg_${runSequence}_${safeShortId}`,
  };
}

export function formalRuntimeLabels(identity: FormalRunSeed): FormalRuntimeLabels {
  return {
    'hdi.repository': FORMAL_REPOSITORY_LABEL,
    'hdi.phase': FORMAL_PHASE_LABEL,
    'hdi.run-id': identity.runId,
    'hdi.run-sequence': String(identity.runSequence),
    'hdi.managed-by': FORMAL_MANAGED_BY_LABEL,
  };
}

export function localNowInAsiaShanghai(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
