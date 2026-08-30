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
    expect(loadCount).toBe(0);
    expect(() => contract.formalRuntimeAuthority()).toThrowError('RUNTIME_AUTHORITY_MISSING');
    expect(loadCount).toBe(1);
  });
});
