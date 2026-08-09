import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const runId = process.env['PHASE01_E2E_RUN_ID'] ?? `browser-${randomUUID()}`;
if (!RUN_ID_PATTERN.test(runId)) throw new Error('PHASE01_E2E_RUN_ID_INVALID');

const outputRoot = resolve(import.meta.dirname, '../../.runtime/e2e', runId);
mkdirSync(dirname(outputRoot), { recursive: true });
mkdirSync(outputRoot, { recursive: false });

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const result = spawnSync(
  process.execPath,
  [
    playwrightCli,
    'test',
    '--config',
    resolve(import.meta.dirname, 'playwright.config.ts'),
    ...process.argv.slice(2),
  ],
  {
    env: { ...process.env, PHASE01_E2E_RUN_ID: runId },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
if (result.signal) throw new Error(`PLAYWRIGHT_TERMINATED_BY_SIGNAL:${result.signal}`);
process.exitCode = result.status ?? 1;
