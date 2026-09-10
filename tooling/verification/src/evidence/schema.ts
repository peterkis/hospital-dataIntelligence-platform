import { isAbsolute } from 'node:path';
import {
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  type AbgFrozenInputKind,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_STATUSES,
  type JsonValue,
  type ProducerEvidenceStatus,
} from './protocol.js';

const PLACEHOLDER_PATTERN = /(?:placeholder|todo|unknown|fake|n\/a)/iu;
const SENSITIVE_KEY_PATTERN =
  /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|client[_-]?secret|authorization|cookie)/iu;
const SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)bearer\s+[A-Za-z0-9._~+/-]+/iu,
  /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password)\s*[=:]/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
] as const;

export function assertKnownProducerId(value: string): asserts value is AbgProducerId {
  if (!ABG_PRODUCER_IDS.includes(value as AbgProducerId)) {
    throw new Error('PRODUCER_EVIDENCE_PRODUCER_ID_UNKNOWN:' + value);
  }
}

export function assertKnownFrozenInputKind(value: string): asserts value is AbgFrozenInputKind {
  if (!ABG_FROZEN_INPUT_KINDS.includes(value as AbgFrozenInputKind)) {
    throw new Error('PRODUCER_EVIDENCE_FROZEN_INPUT_KIND_UNKNOWN:' + value);
  }
}

export function assertEvidenceStatus(value: string): asserts value is ProducerEvidenceStatus {
  if (!PRODUCER_EVIDENCE_STATUSES.includes(value as ProducerEvidenceStatus)) {
    throw new Error('PRODUCER_EVIDENCE_STATUS_INVALID:' + value);
  }
}

export function assertMeaningful(value: string, code: string): void {
  if (value.trim().length === 0 || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(code);
  }
}

export function assertSha256(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(code);
}

export function parseJsonPointer(pointer: string): readonly string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error('PRODUCER_EVIDENCE_JSON_POINTER_INVALID:' + pointer);
  return pointer.slice(1).split('/').map((segment) => {
    let decoded = '';
    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index];
      if (character !== '~') {
        decoded += character;
        continue;
      }
      const escape = segment[index + 1];
      if (escape === '0') decoded += '~';
      else if (escape === '1') decoded += '/';
      else throw new Error('PRODUCER_EVIDENCE_JSON_POINTER_INVALID:' + pointer);
      index += 1;
    }
    return decoded;
  });
}

export function assertStrictJsonPointer(pointer: string, code: string): void {
  let segments: readonly string[];
  try {
    segments = parseJsonPointer(pointer);
  } catch {
    throw new Error(code);
  }
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(code);
  }
}

export function assertSafeRelativePath(value: string, code: string): void {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    value.split('/').some((segment) => segment.includes(':'))
  ) {
    throw new Error(code);
  }
}

export function assertJsonSafe(
  value: unknown,
  code: string,
  seen = new WeakSet<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error(code);
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item, code, seen);
    return;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(code);
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'undefined') throw new Error(code);
      assertJsonSafe(key, code, seen);
      assertJsonSafe(item, code, seen);
    }
    seen.delete(value);
    return;
  }
  throw new Error(code);
}

export function assertNoSensitiveData(value: unknown, code: string): void {
  assertNoSensitiveDataAt(value, code);
}

function assertNoSensitiveDataAt(value: unknown, code: string): void {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) throw new Error(code);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveDataAt(item, code);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error(code);
      assertNoSensitiveDataAt(item, code);
    }
  }
}

export function isSensitiveEnvironmentName(name: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(name);
}
