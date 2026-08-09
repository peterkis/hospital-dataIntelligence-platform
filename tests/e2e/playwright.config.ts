import { resolve } from 'node:path';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const baseURL = process.env['PHASE01_E2E_BASE_URL'] ?? 'http://127.0.0.1:3000';
const runId = requireEnvironment('PHASE01_E2E_RUN_ID');
const outputRoot = resolve(import.meta.dirname, '../../.runtime/e2e', runId);

const browserSelection = process.env['PHASE01_E2E_BROWSER'] ?? 'all';
const availableProjects: NonNullable<PlaywrightTestConfig['projects']> = [
  {
    name: 'chrome',
    use: {
      ...devices['Desktop Chrome'],
      channel: 'chrome',
    },
  },
  {
    name: 'edge',
    use: {
      ...devices['Desktop Edge'],
      channel: 'msedge',
    },
  },
];
const projects = browserSelection === 'all'
  ? availableProjects
  : availableProjects.filter((project) => project.name === browserSelection);
if (projects.length === 0) throw new Error('PHASE01_E2E_BROWSER_INVALID');

export default defineConfig({
  testDir: './tests',
  outputDir: resolve(outputRoot, 'artifacts'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['line'],
    ['json', { outputFile: resolve(outputRoot, 'playwright-results.json') }],
    ['junit', { outputFile: resolve(outputRoot, 'playwright-junit.xml') }],
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects,
});

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
