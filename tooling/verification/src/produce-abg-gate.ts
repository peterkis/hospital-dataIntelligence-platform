import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { ABG_GATES } from './abg-catalog.js';

const gateId = requireEnvironment('ABG_GATE_ID');
const gate = ABG_GATES.find((candidate) => candidate.gateId === gateId);
if (!gate) throw new Error('ABG_GATE_ID_UNKNOWN');
const sharedDirectory = resolve(requireEnvironment('ABG_SHARED_EVIDENCE_DIR'));
const evidenceDirectory = resolve(requireEnvironment('ABG_GATE_EVIDENCE_DIR'));
const resultPath = resolve(requireEnvironment('ABG_GATE_RESULT_PATH'));
const shared = parseRecord(await readJson(join(sharedDirectory, 'shared-verification.json')));
if (shared['status'] !== 'PASSED') throw new Error('ABG_SHARED_VERIFICATION_NOT_PASSED');
const live = parseRecord(await readJson(join(sharedDirectory, 'live/live-verification.json')));
if (live['status'] !== 'PASSED') throw new Error('ABG_LIVE_VERIFICATION_NOT_PASSED');
const evidenceSources = [
  join(sharedDirectory, 'shared-verification.json'),
  join(sharedDirectory, 'live/live-verification.json'),
  join(sharedDirectory, 'integration/vitest-results.json'),
  join(sharedDirectory, 'browser/playwright-results.json'),
];
const evidenceRefs = [];
for (const source of evidenceSources) {
  const targetName = basename(source);
  const target = join(evidenceDirectory, targetName);
  await copyFile(source, target, 1);
  evidenceRefs.push({ path: targetName, sha256: sha256(await readFile(target)) });
}
const charge = parseRecord(live['charge']);
const price = parseRecord(live['price']);
const authentication = parseRecord(live['authentication']);
const resolution = parseRecord(live['resolution']);
const openapiSha256 = requireString(live, 'openapiSha256');
await writeFile(
  resultPath,
  `${JSON.stringify({
    gateId: gate.gateId,
    scenarioId: `PHASE01-${gate.gateId}`,
    requestIds: [requireString(live, 'runId'), requireString(resolution, 'priceResolutionId')],
    principalIds: [requireString(authentication, 'principalId')],
    governanceObjectIds: requireStringArray(live, 'governanceObjectIds'),
    versionIds: [
      requireString(charge, 'chargeItemVersionId'),
      requireString(price, 'priceListReleaseId'),
    ],
    ruleVersions: [openapiSha256, 'phase-01.abg-catalog.v1'],
    evidenceRefs,
  }, null, 2)}\n`,
  { encoding: 'utf8', flag: 'wx', mode: 0o400 },
);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function parseRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('ABG_EVIDENCE_RECORD_INVALID');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ABG_EVIDENCE_FIELD_MISSING:${key}`);
  }
  return value;
}

function requireStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`ABG_EVIDENCE_FIELD_MISSING:${key}`);
  }
  return value as readonly string[];
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
