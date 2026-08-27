import { relative, resolve } from 'node:path';
import { writeAbgGateProof } from './abg-gate-proof.js';
import { assertSafeRelativePath } from './evidence/schema.js';

const evidenceRoot = resolve(requireEnvironment('ABG_FORMAL_EVIDENCE_ROOT'));
const resultPath = resolve(requireEnvironment('ABG_GATE_RESULT_PATH'));
const resultRelativePath = relativePathInside(evidenceRoot, resultPath);
const result = await writeAbgGateProof({
  gateId: requireEnvironment('ABG_GATE_ID'),
  runId: requireEnvironment('ABG_RUN_ID'),
  runSequence: parsePositiveInteger(requireEnvironment('ABG_RUN_SEQUENCE')),
  evidenceRoot,
  producerEvidenceIndexRelativePath: requireEnvironment('ABG_PRODUCER_EVIDENCE_INDEX_PATH'),
  resultRelativePath,
});

process.stdout.write(JSON.stringify({
  gateId: result.gateId,
  runId: result.runId,
  runSequence: result.runSequence,
  status: result.status,
  assertionIds: result.assertionIds,
  evidenceRefCount: result.evidenceRefs.length,
}) + '\n');

function relativePathInside(root: string, output: string): string {
  const value = relative(root, output).replaceAll('\\', '/');
  assertSafeRelativePath(value, 'ABG_GATE_RESULT_PATH_INVALID');
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('REQUIRED_ENVIRONMENT_MISSING:' + name);
  return value;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('ABG_RUN_SEQUENCE_INVALID');
  return parsed;
}
