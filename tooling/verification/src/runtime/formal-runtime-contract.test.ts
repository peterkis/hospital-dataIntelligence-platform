import { afterEach, describe, expect, it, vi } from 'vitest';

describe('formal runtime contract authority loading', () => {
  afterEach(() => {
    vi.doUnmock('./podman-runtime-authority.js');
    vi.resetModules();
  });

  it('does not read the runtime authority while the contract module is imported', async () => {
    let loadCount = 0;
    vi.doMock('./podman-runtime-authority.js', () => ({
      loadPodmanRuntimeAuthority() {
        loadCount += 1;
        throw new Error('RUNTIME_AUTHORITY_MISSING');
      },
    }));

    const contract = await import('./formal-runtime-contract.js');

    expect(loadCount).toBe(0);
    expect(() => contract.createFormalRunSeed(
      1,
      () => '12345678-1234-1234-1234-123456789abc',
    )).not.toThrow();
    const frozenAuthority = {
      network: {
        ports: {
          postgresRuntime: 61_001,
          postgresIntegration: 61_002,
          keycloakHttp: 61_003,
          keycloakManagement: 61_004,
          governanceApi: 61_005,
          consumerA: 61_006,
          consumerB: 61_007,
        },
      },
      labels: {
        static: {
          'hdi.repository': 'hospital-data-intelligence-platform',
          'hdi.phase': '01',
          'hdi.managed-by': 'formal-abg',
        },
      },
    } as never;
    expect(contract.formalRuntimePorts(frozenAuthority)).toEqual([
      61_001, 61_002, 61_003, 61_004, 61_005, 61_006, 61_007,
    ]);
    expect(contract.formalRuntimeLabels({
      runId: '12345678-1234-1234-1234-123456789abc',
      runSequence: 1,
      runtimeNamespace: 'hdi_phase01_abg_1_123456781234',
    }, frozenAuthority)).toMatchObject({
      'hdi.run-id': '12345678-1234-1234-1234-123456789abc',
      'hdi.run-sequence': '1',
    });
    expect(loadCount).toBe(0);
    expect(() => contract.formalRuntimeAuthority()).toThrowError('RUNTIME_AUTHORITY_MISSING');
    expect(loadCount).toBe(1);
  });
});
