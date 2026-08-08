import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function sha256Bytes(value: Buffer | string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function canonicalSha256(value: unknown): Buffer {
  return sha256Bytes(canonicalJson(value));
}

export function digestHex(value: Buffer): string {
  return value.toString('hex');
}
