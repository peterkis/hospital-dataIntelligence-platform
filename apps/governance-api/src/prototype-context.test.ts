import { describe, expect, it } from 'vitest';
import {
  createPrototypeContext,
  resolvePrototypeAdminStaticRoot,
} from './prototype-context.js';

describe('prototype browser context', () => {
  it('contains only the synthetic roles, fixture identifiers and local time contract', () => {
    const context = createPrototypeContext('2026-09-03T14:15:16.123456');
    expect(context.timeZone).toBe('Asia/Shanghai');
    expect(context.currentLocalDateTime).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/u);
    expect(context.roles.map((role) => role.code)).toEqual([
      'prototype-owner',
      'prototype-reviewer',
      'prototype-final-owner',
    ]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/DATABASE_URL|password|connectionString/u);
  });

  it('fails closed when the prototype UI build is missing', () => {
    expect(() => resolvePrototypeAdminStaticRoot('true', 'missing', () => false))
      .toThrowError('PROTOTYPE_UI_BUILD_MISSING');
    expect(resolvePrototypeAdminStaticRoot(undefined, 'missing', () => false)).toBeUndefined();
  });
});
