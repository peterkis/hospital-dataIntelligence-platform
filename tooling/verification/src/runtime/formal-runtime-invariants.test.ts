import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFormalRunSeed } from './formal-runtime-contract.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

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
    expect(runtime.match(/--network host/gu)).toHaveLength(2);
    expect(runtime).toContain('listen_addresses=127.0.0.1');
    expect(runtime).toContain('--http-host=127.0.0.1');
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
    expect(integration).toContain('const POSTGRES_HOST_PORT = 55_433');
    expect(integration).toContain(".withNetworkMode('host')");
    expect(integration).not.toContain('.withExposedPorts(');
    expect(integration).toContain("'hdi.managed-by': runId === undefined ? 'integration-test' : 'formal-abg'");
    expect(integration).toContain("writeTestcontainerRuntimeEvent('STARTED'");
    expect(integration).toContain("writeTestcontainerRuntimeEvent('STOPPED'");
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
