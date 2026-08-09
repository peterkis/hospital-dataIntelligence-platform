export const PHASE_01_SYNTHETIC_SNAPSHOT_LIMIT_BYTES = 16_777_216;

export function buildExactCanonicalArtifactVector(
  baseEnvelope: Readonly<Record<string, unknown>>,
  targetByteLength: number,
): Buffer {
  if (!Number.isSafeInteger(targetByteLength) || targetByteLength <= 0) {
    throw new Error('CAPACITY_VECTOR_TARGET_INVALID');
  }
  const withPadding = { ...baseEnvelope, capacityPadding: '' };
  const baseBytes = Buffer.from(canonicalJson(withPadding), 'utf8');
  const paddingLength = targetByteLength - baseBytes.byteLength;
  if (paddingLength < 0) throw new Error('CAPACITY_VECTOR_BASE_TOO_LARGE');
  const artifact = Buffer.from(
    canonicalJson({ ...baseEnvelope, capacityPadding: 'x'.repeat(paddingLength) }),
    'utf8',
  );
  if (artifact.byteLength !== targetByteLength) {
    throw new Error('CAPACITY_VECTOR_EXACT_LENGTH_FAILED');
  }
  return artifact;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  throw new Error('CAPACITY_VECTOR_VALUE_UNSUPPORTED');
}

export function phase01CapacityBoundaryTargets(): readonly [number, number] {
  return [
    PHASE_01_SYNTHETIC_SNAPSHOT_LIMIT_BYTES,
    PHASE_01_SYNTHETIC_SNAPSHOT_LIMIT_BYTES + 1,
  ];
}
