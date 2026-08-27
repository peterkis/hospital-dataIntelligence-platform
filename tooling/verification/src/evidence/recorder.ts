import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  countProducerAssertions,
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  type JsonObject,
  type JsonValue,
  type ProducerEvidence,
  type ProducerEvidenceIndex,
  type ProducerEvidenceIndexEntry,
  type ProducerEvidenceItem,
} from './protocol.js';
import {
  assertJsonSafe,
  assertEvidenceStatus,
  assertKnownProducerId,
  assertNoSensitiveData,
  assertSafeRelativePath,
  assertSha256,
  assertStrictJsonPointer,
  isSensitiveEnvironmentName,
} from './schema.js';
import { FORMAL_REQUIRED_SECRET_NAMES } from '../runtime/formal-runtime-contract.js';
import { validateProducerEvidence } from './validate-producer-evidence.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_VALUE_PATTERNS = [
  /(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password)\s*[=:]\s*)[^\s,;]+/giu,
  /\bBearer\s+[A-Za-z0-9._~+/-]+/giu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
] as const;

export async function createEvidenceOutputDirectory(directory: string): Promise<void> {
  const absoluteDirectory = resolve(directory);
  try {
    await lstat(absoluteDirectory);
  } catch (error) {
    if (isMissing(error)) {
      await mkdir(dirname(absoluteDirectory), { recursive: true });
      await mkdir(absoluteDirectory, { recursive: false, mode: 0o700 });
      return;
    }
    throw error;
  }
  throw new Error('PRODUCER_EVIDENCE_OUTPUT_ALREADY_EXISTS:' + absoluteDirectory);
}

export async function createEvidenceSubdirectory(
  rootDirectory: string,
  relativeDirectory: string,
): Promise<string> {
  assertSafeRelativePath(relativeDirectory, 'PRODUCER_EVIDENCE_DIRECTORY_PATH_INVALID');
  const root = await assertSafeEvidenceRoot(rootDirectory);
  const output = resolveInside(root, relativeDirectory);
  const parts = relativeDirectory.split('/');
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('PRODUCER_EVIDENCE_DIRECTORY_UNSAFE:' + relativeDirectory);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(current, { recursive: false, mode: 0o700 });
    }
  }
  return output;
}

export async function writeProducerEvidence(
  rootDirectory: string,
  relativePath: string,
  evidence: ProducerEvidence,
): Promise<ProducerEvidenceIndexEntry> {
  validateProducerEvidence(evidence);
  const result = await writeJsonExclusive(rootDirectory, relativePath, evidence);
  return {
    producerId: evidence.producerId,
    relativePath: result.relativePath,
    sha256: result.sha256,
    status: evidence.status,
    scenarioCount: Object.keys(evidence.scenarios).length,
    assertionCount: countProducerAssertions(evidence),
  };
}

export async function writeProducerEvidenceIndex(
  rootDirectory: string,
  relativePath: string,
  index: ProducerEvidenceIndex,
): Promise<void> {
  if (index.schemaVersion !== PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION) {
    throw new Error('PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION_INVALID');
  }
  if (!Number.isSafeInteger(index.runSequence) || index.runSequence <= 0) {
    throw new Error('PRODUCER_EVIDENCE_INDEX_RUN_SEQUENCE_INVALID');
  }
  const producerIds = new Set<string>();
  for (const producer of index.producers) {
    assertKnownProducerId(producer.producerId);
    if (producerIds.has(producer.producerId)) {
      throw new Error('PRODUCER_EVIDENCE_INDEX_PRODUCER_DUPLICATE:' + producer.producerId);
    }
    producerIds.add(producer.producerId);
    assertSafeRelativePath(producer.relativePath, 'PRODUCER_EVIDENCE_INDEX_PATH_INVALID');
    assertSha256(producer.sha256, 'PRODUCER_EVIDENCE_INDEX_DIGEST_INVALID');
    assertEvidenceStatus(producer.status);
    if (!Number.isSafeInteger(producer.scenarioCount) || producer.scenarioCount < 0) {
      throw new Error('PRODUCER_EVIDENCE_INDEX_SCENARIO_COUNT_INVALID:' + producer.producerId);
    }
    if (!Number.isSafeInteger(producer.assertionCount) || producer.assertionCount < 0) {
      throw new Error('PRODUCER_EVIDENCE_INDEX_ASSERTION_COUNT_INVALID:' + producer.producerId);
    }
  }
  await writeJsonExclusive(rootDirectory, relativePath, index);
}

export async function createEvidenceItemFromFile(
  rootDirectory: string,
  input: {
    readonly artifactId: string;
    readonly relativePath: string;
    readonly mediaType: string;
    readonly jsonPointer: string;
    readonly claim: JsonValue;
  },
): Promise<ProducerEvidenceItem> {
  assertSafeRelativePath(input.relativePath, 'PRODUCER_EVIDENCE_ITEM_PATH_INVALID');
  assertStrictJsonPointer(input.jsonPointer, 'PRODUCER_EVIDENCE_ITEM_POINTER_INVALID');
  assertJsonSafe(input.claim, 'PRODUCER_EVIDENCE_ITEM_CLAIM_NOT_JSON_SAFE');
  assertNoSensitiveData(input.claim, 'PRODUCER_EVIDENCE_ITEM_CLAIM_SENSITIVE');
  const root = await assertSafeEvidenceRoot(rootDirectory);
  const artifactPath = await assertExistingSafeFile(root, input.relativePath);
  const bytes = await readFile(artifactPath);
  return {
    artifactId: input.artifactId,
    relativePath: input.relativePath,
    mediaType: input.mediaType,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    jsonPointer: input.jsonPointer,
    claimDigest: sha256(Buffer.from(canonicalJson(input.claim), 'utf8')),
  };
}

export async function writeRedactedTextArtifact(
  rootDirectory: string,
  relativePath: string,
  text: string,
): Promise<{ readonly relativePath: string; readonly sha256: string }> {
  return writeBytesExclusive(
    rootDirectory,
    relativePath,
    Buffer.from(redactSensitiveText(text), 'utf8'),
  );
}

export async function writeBinaryArtifact(
  rootDirectory: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<{ readonly relativePath: string; readonly sha256: string }> {
  return writeBytesExclusive(rootDirectory, relativePath, bytes);
}

export async function writeRedactedJsonArtifact(
  rootDirectory: string,
  relativePath: string,
  value: unknown,
): Promise<{ readonly relativePath: string; readonly sha256: string }> {
  const redacted = redactSensitiveValue(value);
  assertJsonSafe(redacted, 'PRODUCER_EVIDENCE_REDACTED_JSON_INVALID');
  return writeBytesExclusive(
    rootDirectory,
    relativePath,
    Buffer.from(JSON.stringify(redacted, null, 2) + '\n', 'utf8'),
  );
}

export function redactSensitiveText(value: string): string {
  let redacted = SENSITIVE_VALUE_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, REDACTED),
    value,
  );
  // 正式运行只记录变量是否存在。原值即使未带 password/secret 前缀，也不得进入日志。
  const configuredSecrets = FORMAL_REQUIRED_SECRET_NAMES
    .map((name) => process.env[name])
    .filter((secret): secret is string => secret !== undefined && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of configuredSecrets) redacted = redacted.replaceAll(secret, REDACTED);
  return redacted;
}

export function redactSensitiveValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveEnvironmentName(key) ? REDACTED : redactSensitiveValue(item),
    ]));
  }
  return String(value);
}

export function environmentReferenceDigest(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): Readonly<Record<string, string>> {
  const references: Record<string, string> = {};
  for (const name of names) {
    if (isSensitiveEnvironmentName(name)) continue;
    const value = environment[name];
    if (value === undefined || value.length === 0) continue;
    references[name] = sha256(Buffer.from(value, 'utf8'));
  }
  return references;
}

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: JsonValue): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const object = value as JsonObject;
  return '{' + Object.keys(object).sort().map((key) =>
    JSON.stringify(key) + ':' + canonicalJson(object[key]!),
  ).join(',') + '}';
}

async function writeJsonExclusive(
  rootDirectory: string,
  relativePath: string,
  value: unknown,
): Promise<{ readonly relativePath: string; readonly sha256: string }> {
  assertJsonSafe(value, 'PRODUCER_EVIDENCE_JSON_NOT_SAFE');
  return writeBytesExclusive(
    rootDirectory,
    relativePath,
    Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'),
  );
}

async function writeBytesExclusive(
  rootDirectory: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<{ readonly relativePath: string; readonly sha256: string }> {
  assertSafeRelativePath(relativePath, 'PRODUCER_EVIDENCE_WRITE_PATH_INVALID');
  const root = await assertSafeEvidenceRoot(rootDirectory);
  const output = resolveInside(root, relativePath);
  await ensureSafeParentDirectories(root, relativePath);
  try {
    await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error('PRODUCER_EVIDENCE_WRITE_ALREADY_EXISTS:' + relativePath);
    }
    throw error;
  }
  return { relativePath, sha256: sha256(bytes) };
}

async function assertSafeEvidenceRoot(rootDirectory: string): Promise<string> {
  const root = resolve(rootDirectory);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('PRODUCER_EVIDENCE_ROOT_UNSAFE:' + root);
  }
  return realpath(root);
}

async function ensureSafeParentDirectories(
  rootDirectory: string,
  relativePath: string,
): Promise<void> {
  const parts = relativePath.split('/');
  parts.pop();
  let current = rootDirectory;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('PRODUCER_EVIDENCE_PARENT_UNSAFE:' + relativePath);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(current, { recursive: false, mode: 0o700 });
    }
  }
}

async function assertExistingSafeFile(rootDirectory: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInside(rootDirectory, relativePath);
  const parts = relativePath.split('/');
  let current = rootDirectory;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error('PRODUCER_EVIDENCE_SYMLINK_ESCAPE:' + relativePath);
    }
  }
  const stat = await lstat(absolutePath);
  if (!stat.isFile()) throw new Error('PRODUCER_EVIDENCE_ARTIFACT_NOT_FILE:' + relativePath);
  return absolutePath;
}

function resolveInside(rootDirectory: string, relativePath: string): string {
  const output = resolve(rootDirectory, relativePath);
  const relativeOutput = relative(rootDirectory, output);
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith('..' + sep) ||
    isAbsolute(relativeOutput)
  ) {
    throw new Error('PRODUCER_EVIDENCE_PATH_ESCAPES_ROOT:' + relativePath);
  }
  return output;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
