import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ABG_GATES, type AbgGateDefinition } from './abg-catalog.js';
import {
  buildAuthoritativeRunPlan,
  readFrozenInputs,
} from './authoritative-abg-plan.js';

type GateStatus = 'PASSED' | 'FAILED';

interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

interface GateCommandSpec extends CommandSpec {
  readonly gateId: string;
}

interface EvidenceReference {
  readonly path: string;
  readonly sha256: string;
}

interface GateResult extends AbgGateDefinition {
  readonly ordinal: number;
  readonly runId: string;
  readonly status: GateStatus;
  readonly producerExitCode: number | null;
  readonly producerCommandDigest: string;
  readonly elapsedMilliseconds: number;
  readonly failureCode?: string;
  readonly error?: string;
  readonly scenarioId: string | null;
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly evidenceRefs: readonly EvidenceReference[];
}

interface ProducerResult {
  readonly gateId: string;
  readonly scenarioId: string;
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly evidenceRefs: readonly EvidenceReference[];
}

process.env['TZ'] = 'Asia/Shanghai';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const outputDirectory = resolve(requireEnvironment('EVIDENCE_OUTPUT_DIR'));
const plan = await buildAuthoritativeRunPlan(
  repositoryRoot,
  parsePositiveInteger(requireEnvironment('ABG_RUN_SEQUENCE'), 'ABG_RUN_SEQUENCE_INVALID'),
);
const runId = randomUUID();
const startedAt = localNow();
const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, 'utf8');
const planDigest = sha256(planBytes);
const frozenInputsDigest = sha256(Buffer.from(canonicalJson(plan.frozenInputs), 'utf8'));

await assertDirectoryAbsent(outputDirectory);
await mkdir(dirname(outputDirectory), { recursive: true });
await mkdir(outputDirectory, { recursive: false });
await writeExclusiveBytes(join(outputDirectory, 'run-plan.json'), planBytes);

const setupResults = [];
let setupFailure: string | null = null;
for (const [index, command] of plan.setupCommands.entries()) {
  const result = await executeCommand(command, join(outputDirectory, 'setup', String(index + 1).padStart(2, '0')), {
    ABG_RUN_ID: runId,
    ABG_RUN_SEQUENCE: String(plan.runSequence),
    ABG_FROZEN_INPUTS_DIGEST: frozenInputsDigest,
    ABG_SHARED_EVIDENCE_DIR: join(outputDirectory, 'shared'),
  });
  setupResults.push({
    ordinal: index + 1,
    commandDigest: commandDigest(command),
    exitCode: result.exitCode,
    elapsedMilliseconds: result.elapsedMilliseconds,
  });
  if (result.exitCode !== 0) {
    setupFailure = `SETUP_COMMAND_FAILED:${index + 1}`;
    break;
  }
}

if (!setupFailure) {
  try {
    assertFrozenInputsEqual(plan.frozenInputs, await readFrozenInputs(repositoryRoot));
  } catch (error) {
    setupFailure = error instanceof Error ? error.message : 'FROZEN_INPUT_DRIFT_AFTER_SETUP';
  }
}

const results: GateResult[] = [];
for (const [gateIndex, gate] of ABG_GATES.entries()) {
  const command = plan.gates[gateIndex];
  if (!command || command.gateId !== gate.gateId) {
    throw new Error(`ABG_PLAN_GATE_ORDER_INVALID:${gate.gateId}`);
  }
  const producerCommandDigest = commandDigest(command);
  if (setupFailure) {
    results.push(failedGate(gate, gateIndex + 1, runId, producerCommandDigest, setupFailure));
    continue;
  }
  const gateDirectory = join(outputDirectory, 'gates', gate.gateId);
  const producerDirectory = join(gateDirectory, 'producer');
  await mkdir(producerDirectory, { recursive: true });
  const resultPath = join(producerDirectory, 'result.json');
  const execution = await executeCommand(command, gateDirectory, {
    ABG_RUN_ID: runId,
    ABG_RUN_SEQUENCE: String(plan.runSequence),
    ABG_GATE_ID: gate.gateId,
    ABG_GATE_RESULT_PATH: resultPath,
    ABG_GATE_EVIDENCE_DIR: producerDirectory,
    ABG_FROZEN_INPUTS_DIGEST: frozenInputsDigest,
    ABG_SHARED_EVIDENCE_DIR: join(outputDirectory, 'shared'),
  });
  try {
    if (execution.exitCode !== 0) throw new Error(`PRODUCER_EXIT_${execution.exitCode ?? 'SIGNAL'}`);
    const producer = validateProducerResult(
      gate,
      JSON.parse(await readFile(resultPath, 'utf8')) as unknown,
    );
    const evidenceRefs = await validateEvidenceReferences(producer.evidenceRefs, producerDirectory);
    results.push({
      ...gate,
      ordinal: gateIndex + 1,
      runId,
      status: 'PASSED',
      producerExitCode: execution.exitCode,
      producerCommandDigest,
      elapsedMilliseconds: execution.elapsedMilliseconds,
      scenarioId: producer.scenarioId,
      requestIds: producer.requestIds,
      principalIds: producer.principalIds,
      governanceObjectIds: producer.governanceObjectIds,
      versionIds: producer.versionIds,
      ruleVersions: producer.ruleVersions,
      evidenceRefs,
    });
  } catch (error) {
    results.push(failedGate(
      gate,
      gateIndex + 1,
      runId,
      producerCommandDigest,
      'GATE_EXECUTION_FAILED',
      error,
      execution.exitCode,
      execution.elapsedMilliseconds,
    ));
  }
}

let frozenInputsStable = true;
try {
  assertFrozenInputsEqual(plan.frozenInputs, await readFrozenInputs(repositoryRoot));
} catch {
  frozenInputsStable = false;
}
const passed = frozenInputsStable && results.every((result) => result.status === 'PASSED');
const summary = {
  schemaVersion: 'phase-01.abg-run.v2',
  runId,
  runSequence: plan.runSequence,
  planDigest,
  frozenInputs: plan.frozenInputs,
  frozenInputsDigest,
  frozenInputsStable,
  status: passed ? 'PASSED' : 'FAILED',
  startedAt,
  completedAt: localNow(),
  timezone: 'Asia/Shanghai',
  setupResults,
  gateCount: results.length,
  passedCount: results.filter((result) => result.status === 'PASSED').length,
  failedCount: results.filter((result) => result.status === 'FAILED').length,
  conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
  results,
};
await writeExclusive(join(outputDirectory, 'abg-results.json'), summary);
await writeManifest(outputDirectory);
process.stdout.write(`${JSON.stringify({ runId, runSequence: plan.runSequence, status: summary.status, evidenceDirectory: outputDirectory })}\n`);
if (!passed) throw new Error('FORMAL_ABG_RUN_FAILED');

async function executeCommand(
  command: CommandSpec,
  evidenceDirectory: string,
  injectedEnvironment: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number | null; readonly elapsedMilliseconds: number }> {
  await mkdir(evidenceDirectory, { recursive: true });
  const started = performance.now();
  const workingDirectory = resolveInsideRepository(command.workingDirectory ?? '.');
  const child = spawn(command.executable, [...command.args], {
    cwd: workingDirectory,
    env: { ...process.env, ...command.environment, ...injectedEnvironment },
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
    writeExclusiveBytes(join(evidenceDirectory, 'stdout.log'), Buffer.concat(stdout)),
    writeExclusiveBytes(join(evidenceDirectory, 'stderr.log'), Buffer.concat(stderr)),
  ]);
  return { exitCode, elapsedMilliseconds: Math.round(performance.now() - started) };
}

function validateProducerResult(gate: AbgGateDefinition, value: unknown): ProducerResult {
  if (!isRecord(value) || value['gateId'] !== gate.gateId) throw new Error('GATE_RESULT_ID_MISMATCH');
  const requiredArrays = ['requestIds', 'principalIds', 'governanceObjectIds', 'versionIds', 'ruleVersions'];
  for (const key of requiredArrays) {
    const items = value[key];
    if (!Array.isArray(items) || items.length === 0 || items.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new Error(`GATE_RESULT_${key}_REQUIRED`);
    }
  }
  if (typeof value['scenarioId'] !== 'string' || value['scenarioId'].length === 0) {
    throw new Error('GATE_RESULT_SCENARIO_ID_REQUIRED');
  }
  if (!Array.isArray(value['evidenceRefs']) || value['evidenceRefs'].length === 0) {
    throw new Error('GATE_RESULT_EVIDENCE_REQUIRED');
  }
  return value as unknown as ProducerResult;
}

async function validateEvidenceReferences(
  references: readonly EvidenceReference[],
  producerDirectory: string,
): Promise<readonly EvidenceReference[]> {
  const validated: EvidenceReference[] = [];
  for (const reference of references) {
    if (
      !isRecord(reference) || typeof reference.path !== 'string' || isAbsolute(reference.path) ||
      typeof reference.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(reference.sha256)
    ) throw new Error('EVIDENCE_REFERENCE_INVALID');
    const absolutePath = resolve(producerDirectory, reference.path);
    const relativePath = relative(producerDirectory, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error('EVIDENCE_REFERENCE_OUTSIDE_GATE');
    const actualDigest = sha256(await readFile(absolutePath));
    if (actualDigest !== reference.sha256) throw new Error('EVIDENCE_REFERENCE_DIGEST_MISMATCH');
    validated.push({ path: relative(outputDirectory, absolutePath).replaceAll('\\', '/'), sha256: actualDigest });
  }
  return validated;
}

function failedGate(
  gate: AbgGateDefinition,
  ordinal: number,
  runId: string,
  producerCommandDigest: string,
  failureCode: string,
  error?: unknown,
  producerExitCode: number | null = null,
  elapsedMilliseconds = 0,
): GateResult {
  const errorMessage = error instanceof Error
    ? error.message
    : error === undefined
      ? undefined
      : String(error);
  return {
    ...gate, ordinal, runId, status: 'FAILED', producerExitCode, producerCommandDigest,
    elapsedMilliseconds, failureCode,
    ...(errorMessage === undefined ? {} : { error: errorMessage }),
    scenarioId: null, requestIds: [], principalIds: [], governanceObjectIds: [], versionIds: [],
    ruleVersions: [], evidenceRefs: [],
  };
}

async function writeManifest(directory: string): Promise<void> {
  const names = (await collectFiles(directory)).filter((name) => !['manifest.json', 'manifest.sha256'].includes(name)).sort();
  const files = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(directory, name));
    return { path: name.replaceAll('\\', '/'), mediaType: mediaType(name), byteLength: bytes.byteLength, sha256: sha256(bytes) };
  }));
  await writeExclusive(join(directory, 'manifest.json'), { schemaVersion: 'phase-01.evidence-manifest.v1', files });
  const digest = sha256(await readFile(join(directory, 'manifest.json')));
  await writeFile(join(directory, 'manifest.sha256'), `${digest}  manifest.json\n`, { encoding: 'utf8', flag: 'wx', mode: 0o400 });
}

async function collectFiles(directory: string, prefix = ''): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(join(directory, entry.name), relativePath));
    else files.push(relativePath);
  }
  return files;
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function writeExclusiveBytes(path: string, value: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: 'wx', mode: 0o400 });
}

async function assertDirectoryAbsent(path: string): Promise<void> {
  try { await access(path); } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('EVIDENCE_OUTPUT_ALREADY_EXISTS');
}

function commandDigest(command: CommandSpec): string {
  return sha256(Buffer.from(canonicalJson(command), 'utf8'));
}

function resolveInsideRepository(path: string): string {
  const resolved = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error('ABG_COMMAND_WORKDIR_OUTSIDE_REPOSITORY');
  return resolved;
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.xml': return 'application/xml';
    case '.html': return 'text/html; charset=utf-8';
    case '.png': return 'image/png';
    case '.zip': return 'application/zip';
    default: return 'text/plain; charset=utf-8';
  }
}

function localNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function requireEnvironment(name: string): string { const value = process.env[name]; if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`); return value; }

function parsePositiveInteger(value: string, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(errorCode);
  return parsed;
}

function assertFrozenInputsEqual(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error('ABG_FROZEN_INPUT_DRIFT');
  }
}
