import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseLocalDateTime } from './platform/local-datetime/local-datetime.js';
import { PROTOTYPE_CSRF_TOKEN } from './platform/authentication/prototype-authentication.js';
import { PROTOTYPE_FIXTURE, PROTOTYPE_PRINCIPALS } from './prototype-fixture.js';

const ROLE_LABELS = {
  'prototype-owner': '数据维护员',
  'prototype-reviewer': '专业审核员',
  'prototype-final-owner': '终审负责人',
} as const;

export function createPrototypeContext(currentLocalDateTime: string) {
  parseLocalDateTime(currentLocalDateTime);
  return {
    mode: 'PROTOTYPE_SYNTHETIC' as const,
    timeZone: 'Asia/Shanghai' as const,
    localDateTimeFormat: 'YYYY-MM-DDTHH:mm:ss[.ffffff]' as const,
    currentLocalDateTime,
    csrfPurpose: 'NON_SECURITY_MISUSE_GUARD' as const,
    csrfToken: PROTOTYPE_CSRF_TOKEN,
    roles: PROTOTYPE_PRINCIPALS.map((principal) => ({
      code: principal.headerCode,
      label: ROLE_LABELS[principal.headerCode],
    })),
    fixture: {
      chargeCatalogObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      priceListObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
      campusId: PROTOTYPE_FIXTURE.campusId,
    },
  };
}

export function resolvePrototypeAdminStaticRoot(
  prototypeUi: string | undefined,
  candidateRoot: string,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (prototypeUi !== 'true') return undefined;
  if (!pathExists(candidateRoot) || !pathExists(join(candidateRoot, 'index.html'))) {
    throw new Error('PROTOTYPE_UI_BUILD_MISSING');
  }
  return candidateRoot;
}
