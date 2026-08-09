import { createHash } from 'node:crypto';
import { expect, test, type Page, type Response } from '@playwright/test';

const OWNER_USERNAME = process.env['PHASE01_E2E_USERNAME'] ?? 'phase01-owner';
const CHARGE_GOVERNANCE_OBJECT_ID =
  process.env['PHASE01_E2E_CHARGE_GOVERNANCE_OBJECT_ID'] ??
  '60000000-0000-7000-8000-000000000001';
const PRICE_GOVERNANCE_OBJECT_ID =
  process.env['PHASE01_E2E_PRICE_GOVERNANCE_OBJECT_ID'] ??
  '60000000-0000-7000-8000-000000000002';
const CAMPUS_ID =
  process.env['PHASE01_E2E_CAMPUS_ID'] ??
  '50000000-0000-7000-8000-000000000001';

test('人员用户通过真实登录完成收费项目、价表和解析纵向切片', async ({
  page,
  context,
}, testInfo) => {
  const ownerPassword = requireEnvironment('PHASE01_E2E_PASSWORD');
  const authorizationRequests: string[] = [];
  const observedUrls: string[] = [];
  const successfulMutationResponses: Response[] = [];
  page.on('request', (request) => {
    observedUrls.push(request.url());
    const url = new URL(request.url());
    if (url.pathname.endsWith('/protocol/openid-connect/auth')) {
      authorizationRequests.push(url.toString());
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.method() === 'POST' &&
      request.url().includes('/v1/phase-01/') &&
      response.ok() &&
      request.headers()['x-csrf-token']
    ) {
      successfulMutationResponses.push(response);
    }
  });

  await loginThroughKeycloak(page, ownerPassword);

  expect(authorizationRequests).toHaveLength(1);
  const authorizationRequest = new URL(authorizationRequests[0]!);
  expect(authorizationRequest.searchParams.get('response_type')).toBe('code');
  expect(authorizationRequest.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorizationRequest.searchParams.get('code_challenge')).toMatch(
    /^[A-Za-z0-9_-]{43}$/u,
  );
  expect(observedUrls.some((url) =>
    new URL(url).pathname.endsWith('/protocol/openid-connect/token'))).toBe(false);

  const browserState = await page.evaluate(async () => ({
    cacheNames: 'caches' in window ? await window.caches.keys() : [],
    indexedDatabaseNames: 'databases' in window.indexedDB
      ? (await window.indexedDB.databases()).flatMap((database) =>
        database.name ? [database.name] : [])
      : [],
    localStorageKeys: Object.keys(window.localStorage),
    sessionStorageKeys: Object.keys(window.sessionStorage),
    href: window.location.href,
  }));
  expect(browserState.cacheNames).toEqual([]);
  expect(browserState.indexedDatabaseNames).toEqual([]);
  expect(browserState.localStorageKeys).toEqual([]);
  expect(browserState.sessionStorageKeys).toEqual([]);
  expect(browserState.href).not.toMatch(/access_token|refresh_token|id_token/iu);
  expect(observedUrls.join('\n')).not.toMatch(/access_token|refresh_token|id_token/iu);

  const frontendBundle = await readFrontendBundle(page);
  expect(frontendBundle).not.toMatch(/access_token|refresh_token/iu);

  const applicationCookies = await context.cookies(new URL(page.url()).origin);
  expect(applicationCookies.map((cookie) => cookie.name)).toEqual(['__Host-hdi-session']);
  const governanceSession = applicationCookies.find(
    (cookie) => cookie.name === '__Host-hdi-session',
  );
  expect(governanceSession).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  });
  expect(governanceSession?.value).not.toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-hdi-session');

  const suffix = fixtureSuffix(testInfo.project.name);
  await page.getByLabel('收费目录治理对象 ID').fill(CHARGE_GOVERNANCE_OBJECT_ID);
  await page.getByLabel('价表治理对象 ID').fill(PRICE_GOVERNANCE_OBJECT_ID);
  await page.getByLabel('当前院区 ID').fill(CAMPUS_ID);
  await page.getByLabel('收费项目代码').fill(`E2E-FEE-${suffix}`);

  await page.route(
    '**/v1/phase-01/charge-item-publications',
    async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['x-csrf-token'];
      await route.continue({ headers });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '执行发布收费项目' }).click();
  await expect(page.getByRole('alert')).toHaveText('BROWSER_CSRF_FORBIDDEN');

  await page.route(
    '**/v1/phase-01/charge-item-publications',
    async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-csrf-token': 'forged-browser-csrf-token',
        },
      });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: '执行发布收费项目' }).click();
  await expect(page.getByRole('alert')).toHaveText('BROWSER_CSRF_FORBIDDEN');

  await page.getByRole('button', { name: '执行发布收费项目' }).click();
  await expect(page.getByTestId('charge-release-id')).not.toBeEmpty();
  await expect(page.getByTestId('charge-snapshot-id')).not.toBeEmpty();

  await page.getByRole('button', { name: '执行发布完整价表' }).click();
  await expect(page.getByTestId('price-release-id')).not.toBeEmpty();
  await expect(page.getByTestId('price-snapshot-id')).not.toBeEmpty();
  await expect(page.getByLabel('记录时点')).toHaveValue(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u,
  );

  await page.getByRole('button', { name: '执行价格解析' }).click();
  await expect(page.getByTestId('resolution-amount')).toHaveText('CNY 24.6800');
  await expect(page.getByTestId('resolution-id')).not.toBeEmpty();
  await expect(page.getByTestId('resolution-digest')).toHaveText(/^[0-9a-f]{64}$/u);

  expect(successfulMutationResponses).toHaveLength(3);
  for (const response of successfulMutationResponses) {
    const request = response.request();
    expect(request.headers()['authorization']).toBeUndefined();
    expect(request.headers()['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  }
});

async function loginThroughKeycloak(page: Page, ownerPassword: string): Promise<void> {
  await page.goto('/admin/vertical-slice');
  await page.locator('#username').fill(OWNER_USERNAME);
  await page.locator('#password').fill(ownerPassword);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(/\/admin\/vertical-slice$/u);
  await expect(page.getByRole('heading', { name: '收费项目—价表—解析' })).toBeVisible();
}

async function readFrontendBundle(page: Page): Promise<string> {
  const scriptUrls = await page.locator('script[src]').evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).src),
  );
  const bodies = await Promise.all(scriptUrls.map(async (url) => {
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    return response.text();
  }));
  return bodies.join('\n');
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function fixtureSuffix(projectName: string): string {
  return createHash('sha256')
    .update(`${requireEnvironment('PHASE01_E2E_RUN_ID')}:${projectName}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}
