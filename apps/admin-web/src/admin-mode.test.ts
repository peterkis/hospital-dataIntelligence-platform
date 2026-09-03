/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAdminMode } from './admin-mode.js';

describe('admin bootstrap modes', () => {
  it('keeps formal as the default and rejects unknown modes', () => {
    expect(resolveAdminMode(undefined)).toBe('formal');
    expect(resolveAdminMode('formal')).toBe('formal');
    expect(resolveAdminMode('prototype')).toBe('prototype');
    expect(() => resolveAdminMode('unexpected')).toThrowError('ADMIN_MODE_INVALID');
  });

  it('keeps browser session bootstrap only in the formal entry', () => {
    const formal = readFileSync(new URL('./bootstrap-formal.tsx', import.meta.url), 'utf8');
    const prototype = readFileSync(new URL('./bootstrap-prototype.tsx', import.meta.url), 'utf8');
    expect(formal).toContain('/auth/session');
    expect(prototype).not.toMatch(/\/auth\/(session|login|logout)/u);
  });
});
