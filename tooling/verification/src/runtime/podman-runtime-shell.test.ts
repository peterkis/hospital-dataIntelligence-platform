import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createShellHarness, type ShellRunResult } from './podman-runtime-shell-harness.js';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const environmentDirectory = resolve(
  repoRoot,
  'phase-plan/environment/anolis-8.9-wsl2',
);

describe('Podman runtime Shell authority', () => {
  it.each([
    'podman-phase-01-runtime.sh',
    'bootstrap-phase-01-runtime.sh',
    'verify-phase-01-runtime.sh',
    'bootstrap-phase-01.sh',
    'configure-podman-proxy.sh',
  ])('%s reads the checked-in runtime authority through jq', async (fileName) => {
    const source = await readFile(resolve(environmentDirectory, fileName), 'utf8');

    expect(source).toContain('runtime-baseline.lock.json');
    expect(source).toMatch(/\bjq\b/);
  });

  it('freezes managed containers to no restart and rejects persistent policies', async () => {
    const source = await readFile(
      resolve(environmentDirectory, 'podman-phase-01-runtime.sh'),
      'utf8',
    );

    expect(source).toContain('--restart="${PODMAN_RESTART_POLICY}"');
    expect(source).not.toMatch(/--restart=(?:unless-stopped|always|on-failure)/);
    expect(source).toContain('PODMAN_POSTGRES_RESTART_POLICY_INVALID');
    expect(source).toContain('PODMAN_KEYCLOAK_RESTART_POLICY_INVALID');
  });

  it('fails verification startup and cleanup closed on operational exists errors', async () => {
    const source = await readFile(
      resolve(environmentDirectory, 'verify-phase-01-runtime.sh'),
      'utf8',
    );

    expect(source).toContain('PODMAN_RUNTIME_VERIFICATION_EXISTENCE_CHECK_FAILED');
    expect(source).toContain('exists_status != 1');
  });

  it.each([
    'podman-phase-01-runtime.sh',
    'bootstrap-phase-01-runtime.sh',
    'verify-phase-01-runtime.sh',
    'bootstrap-phase-01.sh',
    'configure-podman-proxy.sh',
  ])('%s contains no copied runtime target identities', async (fileName) => {
    const source = await readFile(resolve(environmentDirectory, fileName), 'utf8');

    expect(source).not.toContain('4.9.4-rhel');
    expect(source).not.toContain('/run/podman/podman.sock');
    expect(source).not.toContain('882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382');
    expect(source).not.toContain('0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13');
    expect(source).not.toMatch(/\b(?:55432|55433|18080|19000)\b/u);
    expect(source).not.toMatch(/--restart=(?:unless-stopped|always|on-failure)/u);
  });
});

const partialStartupFailures = [
  ['POSTGRES_VOLUME_CREATE', 'PODMAN_POSTGRES_VOLUME_CREATE_FAILED', 'POSTGRES_VOLUME_CREATED'],
  ['KEYCLOAK_VOLUME_CREATE', 'PODMAN_KEYCLOAK_VOLUME_CREATE_FAILED', 'KEYCLOAK_VOLUME_CREATED'],
  ['POSTGRES_CONTAINER_CREATE', 'PODMAN_POSTGRES_CONTAINER_CREATE_FAILED', 'POSTGRES_CONTAINER_CREATED'],
  ['POSTGRES_CONTAINER_START', 'PODMAN_POSTGRES_CONTAINER_START_FAILED', 'POSTGRES_CONTAINER_STARTED'],
  ['POSTGRES_RESTART_INSPECT', 'PODMAN_POSTGRES_RESTART_POLICY_INVALID', 'POSTGRES_RESTART_POLICY_VERIFIED'],
  ['KEYCLOAK_CONTAINER_CREATE', 'PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED', 'KEYCLOAK_CONTAINER_CREATED'],
  ['KEYCLOAK_CONTAINER_START', 'PODMAN_KEYCLOAK_CONTAINER_START_FAILED', 'KEYCLOAK_CONTAINER_STARTED'],
  ['KEYCLOAK_RESTART_INSPECT', 'PODMAN_KEYCLOAK_RESTART_POLICY_INVALID', 'KEYCLOAK_RESTART_POLICY_VERIFIED'],
] as const;

const bootstrapFailures = [
  ['BOOTSTRAP_POSTGRES_READINESS', 'BOOTSTRAP_POSTGRES_READINESS_FAILED'],
  ['BOOTSTRAP_KEYCLOAK_READINESS', 'BOOTSTRAP_KEYCLOAK_READINESS_FAILED'],
  ['BOOTSTRAP_MIGRATION', 'BOOTSTRAP_MIGRATION_FAILED'],
  ['BOOTSTRAP_SEED', 'BOOTSTRAP_SEED_FAILED'],
  ['BOOTSTRAP_SCHEMA', 'BOOTSTRAP_SCHEMA_VERIFICATION_FAILED'],
] as const;

const secretValues = [
  'postgres-P@ss:/+value',
  'keycloak-P@ss:/+value',
  'owner-P@ss:/+value',
  'browser-P@ss:/+value',
  'consumer-a-P@ss:/+value',
  'consumer-b-P@ss:/+value',
];

function expectNoBroadOrUnrelatedCleanup(result: ShellRunResult): void {
  const operations = result.operations.join('\n');
  expect(operations).not.toMatch(/\b(?:prune|reset)\b/u);
  expect(operations).not.toContain('rm -a');
  expect(operations).not.toContain('unrelated');
  expect(result.containers).toContain('unrelated_container');
  expect(result.volumes).toContain('unrelated_volume');
}

function expectNoSecrets(result: ShellRunResult): void {
  const output = [result.stdout, result.stderr, result.eventEvidence, ...result.operations].join('\n');
  for (const secret of secretValues) {
    const derivedForms = [
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
      Buffer.from(secret, 'utf8').toString('base64'),
      Buffer.from(secret, 'utf8').toString('base64url'),
      `'${secret.replaceAll("'", `'"'"'`)}'`,
      `--env SECRET=${secret}`,
      `postgresql://hdi_phase01:${encodeURIComponent(secret)}@`,
    ];
    for (const derived of derivedForms) expect(output).not.toContain(derived);
  }
  expect(output).not.toContain('DATABASE_URL=');
  expect(output).not.toContain('FAKE_SECRET_ARG_DETECTED');
  expect(output).not.toContain('Authorization:');
  expect(output).not.toContain('Cookie:');
  expect(output).not.toContain('.Config.Env');
  expect(output).not.toContain('"Env"');
}

// WSL process startup can be delayed when the complete Vitest suite is launching
// other workers. Keep the production scripts synchronous and give only these
// isolated fake-CLI integration cases an explicit process-test ceiling.
const FAKE_CLI_TEST_TIMEOUT_MS = 60_000;

describe.sequential('Podman runtime Shell transaction (fake CLI)', () => {
  it('completes all stages with no-restart containers and transfers ownership to the lifecycle controller', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runRuntime('up');

      expect(result.status).toBe(0);
      expect(result.containers).toHaveLength(3);
      expect(result.volumes).toHaveLength(3);
      expect(result.operations.filter((operation) => operation.includes('container create')))
        .toHaveLength(2);
      expect(result.operations.filter((operation) => operation.includes('--restart=no')))
        .toHaveLength(2);
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: 'POSTGRES_RESTART_POLICY_VERIFIED', status: 'PASSED', restartPolicy: 'no' }),
        expect.objectContaining({ stage: 'KEYCLOAK_RESTART_POLICY_VERIFIED', status: 'PASSED', restartPolicy: 'no' }),
        expect.objectContaining({ stage: 'UP_COMPLETE', status: 'PASSED' }),
      ]));
      expect(result.operations.some((operation) => operation.includes('container rm'))).toBe(false);
      expectNoBroadOrUnrelatedCleanup(result);
      expectNoSecrets(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it('distinguishes an operational exists failure from an absent startup name', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runRuntime('up', { FAKE_EXISTS_ERROR_ALWAYS: '1' });

      expect(result.status).toBe(125);
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_RESOURCE_EXISTENCE_CHECK_FAILED');
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: 'RESOURCE_NAMES_CONFIRMED_ABSENT',
          status: 'FAILED',
          errorCode: 'PODMAN_RESOURCE_EXISTENCE_CHECK_FAILED',
        }),
      ]));
      expect(result.containers).toEqual(['unrelated_container']);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expect(result.operations.some((operation) => /^(?:container|volume) rm\b/u.test(operation)))
        .toBe(false);
      expectNoBroadOrUnrelatedCleanup(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it.each(partialStartupFailures)(
    'fails %s closed, records %s, and removes only exact current-run residues',
    async (failure, errorCode, stage) => {
      const harness = await createShellHarness();
      try {
        const result = await harness.runRuntime('up', { FAKE_FAIL: failure });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`ERROR_CODE=${errorCode}`);
        expect(result.containers).toEqual(['unrelated_container']);
        expect(result.volumes).toEqual(['unrelated_volume']);
        expect(result.events).toEqual(expect.arrayContaining([
          expect.objectContaining({ stage, status: 'FAILED', errorCode }),
        ]));
        if (failure === 'KEYCLOAK_RESTART_INSPECT') {
          expect(result.operations.filter((operation) => /^(?:container|volume) rm\b/u.test(operation)))
            .toEqual([
              'container rm --force hdi_phase01_abg_7_ar11test0000_keycloak',
              'container rm --force hdi_phase01_abg_7_ar11test0000_postgres',
              'volume rm hdi_phase01_abg_7_ar11test0000_keycloak_data',
              'volume rm hdi_phase01_abg_7_ar11test0000_postgres_data',
            ]);
        }
        expectNoBroadOrUnrelatedCleanup(result);
        expectNoSecrets(result);
      } finally {
        await harness.dispose();
      }
    },
    FAKE_CLI_TEST_TIMEOUT_MS,
  );

  it.each(['none', 'four', 'run-id', 'run-sequence', 'managed-by'])(
    'preserves a same-name PostgreSQL container with %s ownership while cleaning other owned resources',
    async (ownershipVariant) => {
      const harness = await createShellHarness();
      try {
        const result = await harness.runRuntime('up', {
          FAKE_FAIL: 'KEYCLOAK_CONTAINER_CREATE',
          FAKE_OWNERSHIP_VARIANT: ownershipVariant,
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('ERROR_CODE=PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED');
        expect(result.stderr).toContain('ERROR_CODE=PODMAN_PARTIAL_CLEANUP_OWNERSHIP_MISMATCH');
        expect(result.containers).toEqual([
          'hdi_phase01_abg_7_ar11test0000_postgres',
          'unrelated_container',
        ]);
        expect(result.volumes).toEqual(['unrelated_volume']);
        expect(result.events).toEqual(expect.arrayContaining([
          expect.objectContaining({
            stage: 'PARTIAL_CLEANUP_OWNERSHIP',
            status: 'FAILED',
            errorCode: 'PODMAN_PARTIAL_CLEANUP_OWNERSHIP_MISMATCH',
          }),
        ]));
        expectNoBroadOrUnrelatedCleanup(result);
      } finally {
        await harness.dispose();
      }
    },
    FAKE_CLI_TEST_TIMEOUT_MS,
  );

  it('retains the primary startup failure and separately records cleanup failure without recursion', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runRuntime('up', {
        FAKE_FAIL: 'KEYCLOAK_CONTAINER_CREATE',
        FAKE_CLEANUP_FAIL: '1',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED');
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_PARTIAL_CLEANUP_FAILED');
      expect(result.events.filter((event) => event.errorCode === 'PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED'))
        .toHaveLength(1);
      expectNoBroadOrUnrelatedCleanup(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it('retains the primary failure when cleanup cannot inspect resource existence', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runRuntime('up', {
        FAKE_FAIL: 'KEYCLOAK_CONTAINER_CREATE',
        FAKE_EXISTS_ERROR_ON_PRESENT: 'hdi_phase01_abg_7_ar11test0000_postgres',
      });

      expect(result.status).toBe(34);
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED');
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_PARTIAL_CLEANUP_EXISTENCE_CHECK_FAILED');
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: 'PARTIAL_CLEANUP_EXISTENCE_CHECK',
          status: 'FAILED',
          resourceName: 'hdi_phase01_abg_7_ar11test0000_postgres',
          errorCode: 'PODMAN_PARTIAL_CLEANUP_EXISTENCE_CHECK_FAILED',
        }),
      ]));
      expect(result.containers).toEqual([
        'hdi_phase01_abg_7_ar11test0000_postgres',
        'unrelated_container',
      ]);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expectNoBroadOrUnrelatedCleanup(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it('projects actualLabels to governed keys before serializing cleanup evidence', async () => {
    const harness = await createShellHarness();
    try {
      const sensitiveLabelValue = 'sensitive-label-P@ss:/+value';
      const result = await harness.runRuntime('up', {
        FAKE_FAIL: 'KEYCLOAK_CONTAINER_CREATE',
        FAKE_EXTRA_LABEL_VALUE: sensitiveLabelValue,
      });

      expect(result.status).toBe(34);
      expect(result.containers).toEqual(['unrelated_container']);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expect(result.eventEvidence).not.toContain('sensitive.extra');
      expect(result.eventEvidence).not.toContain(sensitiveLabelValue);
      expect(result.events.filter((event) => event.stage === 'PARTIAL_CLEANUP_REMOVE'))
        .not.toHaveLength(0);
      expectNoBroadOrUnrelatedCleanup(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it.each([
    ['INT', 130, 'PODMAN_RUNTIME_SIGNAL_SIGINT'],
    ['TERM', 143, 'PODMAN_RUNTIME_SIGNAL_SIGTERM'],
  ] as const)('routes SIG%s through the same exact partial cleanup', async (signal, status, errorCode) => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runRuntime('up', {
        FAKE_SIGNAL_STAGE: 'POSTGRES_CONTAINER_START',
        FAKE_SIGNAL_NAME: signal,
      });

      expect(result.status).toBe(status);
      expect(result.stderr).toContain(`ERROR_CODE=${errorCode}`);
      expect(result.containers).toEqual(['unrelated_container']);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expectNoBroadOrUnrelatedCleanup(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);
});

describe.sequential('Bootstrap Shell transaction (fake CLI)', () => {
  it('disarms failure cleanup after the final bootstrap closure', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runBootstrap();

      expect(result.status).toBe(0);
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: 'BOOTSTRAP_COMPLETE', status: 'PASSED' }),
      ]));
      expect(result.operations.some((operation) => /^(?:container|volume) rm\b/u.test(operation)))
        .toBe(false);
      expectNoBroadOrUnrelatedCleanup(result);
      expectNoSecrets(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it.each(bootstrapFailures)(
    'cleans the runtime after %s and retains %s',
    async (failure, errorCode) => {
      const harness = await createShellHarness();
      try {
        const result = await harness.runBootstrap({ FAKE_FAIL: failure });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`ERROR_CODE=${errorCode}`);
        expect(result.containers).toEqual(['unrelated_container']);
        expect(result.volumes).toEqual(['unrelated_volume']);
        expect(result.events).toEqual(expect.arrayContaining([
          expect.objectContaining({ status: 'FAILED', errorCode }),
          expect.objectContaining({ stage: 'BOOTSTRAP_FAILURE_CLEANUP', status: 'PASSED' }),
        ]));
        expectNoBroadOrUnrelatedCleanup(result);
        expectNoSecrets(result);
      } finally {
        await harness.dispose();
      }
    },
    FAKE_CLI_TEST_TIMEOUT_MS,
  );

  it('reports cleanup failure separately without replacing the migration failure', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runBootstrap({
        FAKE_FAIL: 'BOOTSTRAP_MIGRATION',
        FAKE_CLEANUP_FAIL: '1',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ERROR_CODE=BOOTSTRAP_MIGRATION_FAILED');
      expect(result.stderr).toContain('ERROR_CODE=BOOTSTRAP_FAILURE_CLEANUP_FAILED');
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', errorCode: 'BOOTSTRAP_MIGRATION_FAILED' }),
        expect.objectContaining({ status: 'FAILED', errorCode: 'BOOTSTRAP_FAILURE_CLEANUP_FAILED' }),
      ]));
      expectNoSecrets(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it('fails bootstrap cleanup closed when resource existence inspection is unavailable', async () => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runBootstrap({
        FAKE_FAIL: 'BOOTSTRAP_MIGRATION',
        FAKE_EXISTS_ERROR_ON_PRESENT: 'hdi_phase01_abg_7_ar11test0000_postgres',
        FAKE_EXISTS_ERROR_AFTER_LOG: 'node:migration',
      });

      expect(result.status).toBe(83);
      expect(result.stderr).toContain('ERROR_CODE=BOOTSTRAP_MIGRATION_FAILED');
      expect(result.stderr).toContain('ERROR_CODE=PODMAN_PARTIAL_CLEANUP_EXISTENCE_CHECK_FAILED');
      expect(result.stderr).toContain('ERROR_CODE=BOOTSTRAP_FAILURE_CLEANUP_FAILED');
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: 'PARTIAL_CLEANUP_EXISTENCE_CHECK',
          status: 'FAILED',
          errorCode: 'PODMAN_PARTIAL_CLEANUP_EXISTENCE_CHECK_FAILED',
        }),
        expect.objectContaining({
          stage: 'BOOTSTRAP_FAILURE_CLEANUP',
          status: 'FAILED',
          errorCode: 'BOOTSTRAP_FAILURE_CLEANUP_FAILED',
        }),
      ]));
      expect(result.containers).toEqual([
        'hdi_phase01_abg_7_ar11test0000_postgres',
        'unrelated_container',
      ]);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expectNoBroadOrUnrelatedCleanup(result);
      expectNoSecrets(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);

  it.each([
    ['INT', 130, 'BOOTSTRAP_SIGNAL_SIGINT'],
    ['TERM', 143, 'BOOTSTRAP_SIGNAL_SIGTERM'],
  ] as const)('routes SIG%s through bootstrap cleanup', async (signal, status, errorCode) => {
    const harness = await createShellHarness();
    try {
      const result = await harness.runBootstrap({ FAKE_BOOTSTRAP_SIGNAL: signal });

      expect(result.status).toBe(status);
      expect(result.stderr).toContain(`ERROR_CODE=${errorCode}`);
      expect(result.containers).toEqual(['unrelated_container']);
      expect(result.volumes).toEqual(['unrelated_volume']);
      expectNoSecrets(result);
    } finally {
      await harness.dispose();
    }
  }, FAKE_CLI_TEST_TIMEOUT_MS);
});
