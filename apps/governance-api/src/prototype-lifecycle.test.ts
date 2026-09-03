import { describe, expect, it, vi } from 'vitest';
import { closePrototypeResources } from './prototype-lifecycle.js';

describe('prototype resource shutdown', () => {
  it.each(['application', 'database'] as const)(
    'fails closed and does not signal success when %s close fails',
    async (failingResource) => {
      const applicationClose = vi.fn(async () => {
        if (failingResource === 'application') throw new Error('APPLICATION_CLOSE_FAILED');
      });
      const databaseClose = vi.fn(async () => {
        if (failingResource === 'database') throw new Error('DATABASE_CLOSE_FAILED');
      });
      const onResourcesClosed = vi.fn();

      await expect(closePrototypeResources({
        application: { close: applicationClose },
        database: { close: databaseClose },
        onResourcesClosed,
      })).rejects.toThrow('PROTOTYPE_RESOURCE_CLOSE_FAILED');

      expect(applicationClose).toHaveBeenCalledOnce();
      expect(databaseClose).toHaveBeenCalledOnce();
      expect(onResourcesClosed).not.toHaveBeenCalled();
    },
  );

  it('signals closure only after both resources close successfully', async () => {
    const onResourcesClosed = vi.fn();
    await closePrototypeResources({
      application: { close: vi.fn(async () => undefined) },
      database: { close: vi.fn(async () => undefined) },
      onResourcesClosed,
    });

    expect(onResourcesClosed).toHaveBeenCalledOnce();
  });
});
