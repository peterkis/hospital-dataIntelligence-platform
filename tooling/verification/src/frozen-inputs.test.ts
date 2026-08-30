import { describe, expect, it } from 'vitest';
import { readFrozenInputs } from './frozen-inputs.js';

describe('frozen inputs', () => {
  it('fails before repository access when the producer source manifest digest is invalid', async () => {
    await expect(readFrozenInputs('D:/repository-that-must-not-be-read', 'not-a-sha256'))
      .rejects.toThrow('PRODUCER_SOURCE_MANIFEST_SHA256_INVALID');
  });
});
