import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import {
  PROTOTYPE_ROLE_CODES,
  type PrototypeRoleCode,
} from './prototype-state.js';

export interface PrototypeContext {
  readonly mode: 'PROTOTYPE_SYNTHETIC';
  readonly timeZone: 'Asia/Shanghai';
  readonly localDateTimeFormat: 'YYYY-MM-DDTHH:mm:ss[.ffffff]';
  readonly currentLocalDateTime: string;
  readonly csrfPurpose: 'NON_SECURITY_MISUSE_GUARD';
  readonly csrfToken: string;
  readonly roles: readonly {
    readonly code: PrototypeRoleCode;
    readonly label: string;
  }[];
  readonly fixture: {
    readonly chargeCatalogObjectId: string;
    readonly priceListObjectId: string;
    readonly campusId: string;
  };
}

export interface PrototypeApi {
  readonly client: ReturnType<typeof createGovernanceApiClient>;
  readonly fetch: typeof globalThis.fetch;
  getRole(): PrototypeRoleCode | null;
  setRole(role: PrototypeRoleCode | null): void;
}

export interface PrototypeDemoDashboard {
  readonly status: 'READY';
  readonly environment: 'Synthetic Prototype';
  readonly identity: 'Prototype Synthetic';
  readonly timeZone: 'Asia/Shanghai';
  readonly currentLocalDateTime: string;
  readonly organization: { readonly organizationId: string; readonly displayName: string };
  readonly campuses: readonly { readonly campusId: string; readonly campusCode: string; readonly displayName: string }[];
  readonly counts: {
    readonly organizationCount: number;
    readonly campusCount: number;
    readonly chargeItemCount: number;
    readonly priceListCount: number;
    readonly publishedVersionCount: number;
    readonly publishedChargeVersionCount: number;
    readonly approvalEventCount: number;
    readonly auditEventCount: number;
  };
  readonly chargeItems: readonly {
    readonly objectId: string;
    readonly code: string;
    readonly displayName: string;
    readonly publishedVersion: null | { readonly versionId: string; readonly digest: string; readonly recordedFrom: string };
    readonly draftVersion: null | { readonly versionId: string; readonly digest: string; readonly recordedFrom: string };
  }[];
  readonly priceLists: readonly {
    readonly objectId: string;
    readonly versionId: string;
    readonly code: string;
    readonly displayName: string;
    readonly governanceStatus: string;
    readonly digest: string;
    readonly businessValidFrom: string;
    readonly scopeLabel: string;
    readonly fixedUnitPrice: string;
  }[];
  readonly auditTimeline: readonly {
    readonly auditEventId: string;
    readonly auditSequence: string;
    readonly action: string;
    readonly actor: string;
    readonly role: string;
    readonly timestamp: string;
  }[];
  readonly resolution: {
    readonly objectId: string;
    readonly digest: string | null;
    readonly status: string;
    readonly unitPrice: string | null;
    readonly quantity: string | null;
    readonly finalAmount: string | null;
    readonly currencyCode: string | null;
    readonly steps: readonly {
      readonly stepNo: string;
      readonly label: string;
      readonly decision: string;
    }[];
  };
}

export class PrototypeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export function createPrototypeApi(
  context: PrototypeContext,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  baseUrl = '',
): PrototypeApi {
  let role: PrototypeRoleCode | null = null;
  const prototypeFetch: typeof globalThis.fetch = async (input, init) => {
    if (!role) throw new PrototypeRequestError(401, 'PROTOTYPE_PRINCIPAL_UNAUTHENTICATED');
    const method = (input instanceof Request ? input.method : init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    headers.set('x-prototype-principal-code', role);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('x-csrf-token', context.csrfToken);
    }
    return fetchImplementation(input, { ...init, headers });
  };
  return {
    client: createGovernanceApiClient({ baseUrl, fetch: prototypeFetch }),
    fetch: prototypeFetch,
    getRole: () => role,
    setRole(nextRole) {
      if (nextRole !== null && !PROTOTYPE_ROLE_CODES.includes(nextRole)) {
        throw new Error('PROTOTYPE_ROLE_INVALID');
      }
      role = nextRole;
    },
  };
}

export async function loadPrototypeContext(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<PrototypeContext> {
  const response = await fetchImplementation('/prototype/context', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('PROTOTYPE_CONTEXT_LOAD_FAILED');
  const candidate = await response.json() as unknown;
  if (!isPrototypeContext(candidate)) throw new Error('PROTOTYPE_CONTEXT_INVALID');
  return candidate;
}

export async function loadPrototypeDemoDashboard(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<PrototypeDemoDashboard> {
  const response = await fetchImplementation('/prototype/demo/dashboard', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('PROTOTYPE_DEMO_DASHBOARD_LOAD_FAILED');
  const candidate = await response.json() as unknown;
  if (!isPrototypeDemoDashboard(candidate)) throw new Error('PROTOTYPE_DEMO_DASHBOARD_INVALID');
  return candidate;
}

export function requireApiData<Data>(
  result: { readonly data?: Data; readonly error?: unknown; readonly response: Response },
): Data {
  if (result.response.ok && result.data !== undefined) return result.data;
  const errorCode = isRecord(result.error) && typeof result.error['code'] === 'string'
    ? result.error['code']
    : 'PROTOTYPE_REQUEST_FAILED';
  throw new PrototypeRequestError(result.response.status, errorCode);
}

export function prototypeErrorPresentation(error: unknown): {
  readonly title: string;
  readonly detail: string;
} {
  if (error instanceof PrototypeRequestError) {
    const title = error.status === 401
      ? '请选择原型身份'
      : error.status === 403
        ? '当前角色无权执行此步骤'
        : error.status === 409
          ? '数据状态已变化，请重新读取'
          : error.status >= 500
            ? '服务暂时无法完成操作，请稍后重试'
            : '输入或当前状态不满足操作要求';
    return { title, detail: error.code };
  }
  return {
    title: '服务暂时无法完成操作，请稍后重试',
    detail: error instanceof Error ? error.message : 'PROTOTYPE_REQUEST_FAILED',
  };
}

function isPrototypeContext(value: unknown): value is PrototypeContext {
  if (!isRecord(value) || !isRecord(value['fixture']) || !Array.isArray(value['roles'])) return false;
  return value['mode'] === 'PROTOTYPE_SYNTHETIC' &&
    value['timeZone'] === 'Asia/Shanghai' &&
    value['localDateTimeFormat'] === 'YYYY-MM-DDTHH:mm:ss[.ffffff]' &&
    typeof value['currentLocalDateTime'] === 'string' &&
    !/[Zz]|[+-]\d{2}:\d{2}$/u.test(value['currentLocalDateTime']) &&
    value['csrfPurpose'] === 'NON_SECURITY_MISUSE_GUARD' &&
    typeof value['csrfToken'] === 'string' &&
    typeof value['fixture']['chargeCatalogObjectId'] === 'string' &&
    typeof value['fixture']['priceListObjectId'] === 'string' &&
    typeof value['fixture']['campusId'] === 'string' &&
    value['roles'].every((role) =>
      isRecord(role) &&
      typeof role['label'] === 'string' &&
      PROTOTYPE_ROLE_CODES.includes(role['code'] as PrototypeRoleCode));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrototypeDemoDashboard(value: unknown): value is PrototypeDemoDashboard {
  if (!isRecord(value) || !isRecord(value['counts']) || !isRecord(value['organization'])) return false;
  const timestamp = value['currentLocalDateTime'];
  return value['status'] === 'READY' &&
    value['environment'] === 'Synthetic Prototype' &&
    value['identity'] === 'Prototype Synthetic' &&
    value['timeZone'] === 'Asia/Shanghai' &&
    typeof timestamp === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(timestamp) &&
    !/[Zz]|[+-]\d{2}:\d{2}$/u.test(timestamp) &&
    value['organization']['displayName'] === 'HDI Demo Hospital' &&
    Array.isArray(value['campuses']) &&
    Array.isArray(value['chargeItems']) &&
    Array.isArray(value['priceLists']) &&
    Array.isArray(value['auditTimeline']) &&
    isRecord(value['resolution']) &&
    value['counts']['chargeItemCount'] === 5 &&
    value['counts']['priceListCount'] === 3;
}
