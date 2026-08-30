import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormalRunSeed } from './formal-runtime-contract.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

const GOVERNED_RUNTIME_CONSUMERS = [
  'tooling/verification/src/runtime/formal-runtime-contract.ts',
  'tooling/verification/src/runtime/formal-preflight.ts',
  'tooling/verification/src/runtime/formal-teardown.ts',
  'tooling/verification/src/runtime/formal-wsl-envelope.ts',
  'tooling/verification/src/frozen-inputs.ts',
  'tooling/verification/src/authoritative-abg-plan.ts',
  'tooling/verification/src/run-formal-abg.ts',
  'tooling/verification/src/run-shared-abg-verification.ts',
  'tooling/verification/src/verify-phase-01-live.ts',
  'apps/governance-api/src/composition/phase-01-vertical-slice.integration.test.ts',
  'phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh',
  'phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh',
  'phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh',
  'phase-plan/environment/anolis-8.9-wsl2/configure-podman-proxy.sh',
  'phase-plan/environment/anolis-8.9-wsl2/verify-phase-01-runtime.sh',
] as const;

const COPIED_RUNTIME_TARGETS = [
  ['Podman version', /4\.9\.4-rhel/u],
  ['rootful Podman socket', /\/run\/podman\/podman\.sock/u],
  ['PostgreSQL image digest', /882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382/u],
  ['Keycloak image digest', /0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13/u],
  ['runtime port', /(?<![\w])(?:55432|55433|18080|19000|3000|4101|4102)(?![\w])/u],
  ['literal host-network argument', /(?:--network(?:=|\s+)["']?host["']?|\.withNetworkMode\(["']host["']\))/u],
  ['literal k8s-file log argument', /--log-driver(?:=|\s+)["']?k8s-file["']?/u],
  ['literal restart argument', /--restart(?:=|\s+)["']?(?:no|always|unless-stopped|on-failure(?::\d+)?)["']?/u],
] as const;

describe('formal runtime source invariants', () => {
  it('includes both sequence and a safe run-id fragment in the runtime namespace', () => {
    const first = createFormalRunSeed(12, () => 'aaaaaaaa-1234-1234-1234-123456789abc');
    const second = createFormalRunSeed(12, () => 'bbbbbbbb-1234-1234-1234-123456789abc');
    expect(first.runtimeNamespace).toBe('hdi_phase01_abg_12_aaaaaaaa1234');
    expect(second.runtimeNamespace).toBe('hdi_phase01_abg_12_bbbbbbbb1234');
    expect(first.runtimeNamespace).not.toBe(second.runtimeNamespace);
  });

  it('labels Podman containers and volumes, uses loopback host networking, and forbids pulls', async () => {
    const runtime = await readFile(resolve(
      repositoryRoot,
      'phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh',
    ), 'utf8');
    for (const label of [
      'hdi.repository',
      'hdi.phase',
      'hdi.run-id',
      'hdi.run-sequence',
      'hdi.managed-by',
    ]) expect(runtime).toContain(label);
    expect(runtime.match(/--pull=never/gu)).toHaveLength(2);
    expect(runtime).toContain('podman volume create');
    expect(runtime.match(/--network "\$\{MANAGED_CONTAINER_MODE\}"/gu)).toHaveLength(2);
    expect(runtime).toContain('listen_addresses=${LOOPBACK_BIND_ADDRESS}');
    expect(runtime).toContain('--http-host="${LOOPBACK_BIND_ADDRESS}"');
    expect(runtime.match(/--restart="\$\{PODMAN_RESTART_POLICY\}"/gu)).toHaveLength(2);
    expect(runtime).not.toContain('podman network create');
    expect(runtime).not.toContain('--publish');
    expect(runtime).not.toContain('podman compose');
  });

  it('labels the Testcontainers PostgreSQL and records its lifecycle', async () => {
    const integration = await readFile(resolve(
      repositoryRoot,
      'apps/governance-api/src/composition/phase-01-vertical-slice.integration.test.ts',
    ), 'utf8');
    expect(integration).toContain('.withLabels(TESTCONTAINER_LABELS)');
    expect(integration).toContain(
      'const POSTGRES_HOST_PORT = RUNTIME_AUTHORITY.network.ports.postgresIntegration',
    );
    expect(integration).toContain(
      '.withNetworkMode(RUNTIME_AUTHORITY.network.managedContainerMode)',
    );
    expect(integration).toContain('this.hostConfig.RestartPolicy = {');
    expect(integration).toContain('RUNTIME_AUTHORITY.podman.restartPolicy');
    expect(integration).not.toContain('.withExposedPorts(');
    expect(integration).toContain("RUNTIME_AUTHORITY.labels.static['hdi.managed-by']");
    expect(integration).toContain("writeTestcontainerRuntimeEvent('STARTED'");
    expect(integration).toContain("writeTestcontainerRuntimeEvent('STOPPED'");
  });

  it('forbids persistent restart policies in controlled runtime sources', async () => {
    const controlledSources = await Promise.all([
      'phase-plan/environment/anolis-8.9-wsl2/podman-phase-01-runtime.sh',
      'apps/governance-api/src/composition/phase-01-vertical-slice.integration.test.ts',
      'tooling/verification/src/runtime/formal-teardown.ts',
    ].map((path) => readFile(resolve(repositoryRoot, path), 'utf8')));
    for (const source of controlledSources) {
      for (const forbidden of [
        '--restart=unless-stopped',
        '--restart=always',
        '--restart=on-failure',
        'podman generate systemd',
        '.container\n[Container]',
      ]) expect(source).not.toContain(forbidden);
    }
  });

  it('keeps governed runtime consumers free of copied authority target identities', async () => {
    const sources = await Promise.all(GOVERNED_RUNTIME_CONSUMERS.map(async (path) => ({
      path,
      source: await readFile(resolve(repositoryRoot, path), 'utf8'),
    })));
    const violations = sources.flatMap(({ path, source }) =>
      COPIED_RUNTIME_TARGETS
        .filter(([, pattern]) => pattern.test(source))
        .map(([target]) => `${path}: ${target}`),
    );

    expect(violations).toEqual([]);
    expect(COPIED_RUNTIME_TARGETS.some(([, pattern]) =>
      pattern.test('docker.io/library/postgres'),
    )).toBe(false);
  });

  it('derives a collision-resistant runtime namespace and never invokes prune', async () => {
    const [bootstrap, teardown] = await Promise.all([
      readFile(resolve(
        repositoryRoot,
        'phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01-runtime.sh',
      ), 'utf8'),
      readFile(resolve(repositoryRoot, 'tooling/verification/src/runtime/formal-teardown.ts'), 'utf8'),
    ]);
    expect(bootstrap).toContain('hdi_phase01_abg_${RUN_SEQUENCE}_${SAFE_RUN_ID}');
    expect(bootstrap).toContain('podman-phase-01-runtime.sh" up');
    for (const forbidden of [
      'podman system prune',
      'podman container prune',
      'podman volume prune',
      'podman network prune',
    ]) expect(teardown).not.toContain(forbidden);
  });

  it('preserves browser attachments on both passing and failing browser runs', async () => {
    const sharedRunner = await readFile(resolve(
      repositoryRoot,
      'tooling/verification/src/run-shared-abg-verification.ts',
    ), 'utf8');
    expect(sharedRunner).toContain("if (command.id === 'browser') {");
    expect(sharedRunner).not.toContain("command.id === 'browser' && result.exitCode === 0");
  });
});
