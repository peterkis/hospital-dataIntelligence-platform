export type AdminMode = 'formal' | 'prototype';

export function resolveAdminMode(value: string | undefined): AdminMode {
  if (value === undefined || value === '' || value === 'formal') return 'formal';
  if (value === 'prototype') return 'prototype';
  throw new Error('ADMIN_MODE_INVALID');
}
