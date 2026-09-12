import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// This formats a clock instant, never a database local datetime value.
export function localReceiptTime(instant = Date.now()) {
  if(typeof instant!=='number'||!Number.isFinite(instant))throw new Error('CLOCK_INSTANT_REQUIRED');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23' }).formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}

export function saveExclusiveReceipt(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
