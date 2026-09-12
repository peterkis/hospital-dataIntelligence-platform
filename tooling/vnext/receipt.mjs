import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function saveExclusiveReceipt(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
