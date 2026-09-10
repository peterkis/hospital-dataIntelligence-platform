import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';

const OWNER_USERNAME = 'phase01-owner';
const REVIEWER_USERNAME = 'phase01-reviewer';
const FINAL_OWNER_USERNAME = 'phase01-final-owner';
const CHARGE_GOVERNANCE_OBJECT_ID =
  process.env['PHASE01_E2E_CHARGE_GOVERNANCE_OBJECT_ID'] ??
  '60000000-0000-7000-8000-000000000001';
const PRICE_GOVERNANCE_OBJECT_ID =
  process.env['PHASE01_E2E_PRICE_GOVERNANCE_OBJECT_ID'] ??
  '60000000-0000-7000-8000-000000000002';
const CAMPUS_ID =
  process.env['PHASE01_E2E_CAMPUS_ID'] ??
  '50000000-0000-7000-8000-000000000001';

test('三个人员身份通过版本化审批完成收费项目、价表和解析纵向切片', {
  annotation: [
    { type: 'phase01-scenario-id', description: 'BROWSER-CHARGE-DRAFT-CRUD-AND-CSRF' },
    { type: 'phase01-scenario-id', description: 'BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION' },
    {
      type: 'phase01-assertion-id',
      description: 'ABG-07:charge-item-draft-crud-and-csrf-rejection',
    },
    {
      type: 'phase01-assertion-id',
      description: 'ABG-10:price-list-draft-entry-change-complete-snapshot',
    },
    {
      type: 'phase01-assertion-id',
      description: 'ABG-21:high-risk-price-review-owner-final-approval',
    },
    { type: 'phase01-gate-id', description: 'ABG-07' },
    { type: 'phase01-gate-id', description: 'ABG-10' },
    { type: 'phase01-gate-id', description: 'ABG-21' },
  ],
}, async ({
  page,
  context,
}, testInfo) => {
  const password = requireEnvironment('PHASE01_E2E_PASSWORD');
  const authorizationRequests: string[] = [];
  const observedUrls: string[] = [];
  const successfulMutationResponses: Response[] = [];
  page.on('request', (request) => {
    observedUrls.push(request.url());
    if (new URL(request.url()).pathname.endsWith('/protocol/openid-connect/auth')) {
      authorizationRequests.push(request.url());
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'POST' && request.url().includes('/v1/phase-01/') && response.ok()) {
      successfulMutationResponses.push(response);
    }
  });

  await loginThroughKeycloak(page, OWNER_USERNAME, password, '/admin/charge-items');
  const ownerPrincipalId = await currentPrincipalId(page);
  expect(authorizationRequests).toHaveLength(1);
  const authorizationRequest = new URL(authorizationRequests[0]!);
  expect(authorizationRequest.searchParams.get('response_type')).toBe('code');
  expect(authorizationRequest.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorizationRequest.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(observedUrls.some((url) => new URL(url).pathname.endsWith('/protocol/openid-connect/token'))).toBe(false);

  const browserState = await page.evaluate(async () => ({
    cacheNames: 'caches' in window ? await window.caches.keys() : [],
    indexedDatabaseNames: 'databases' in window.indexedDB
      ? (await window.indexedDB.databases()).flatMap((database) => database.name ? [database.name] : [])
      : [],
    localStorageKeys: Object.keys(window.localStorage),
    href: window.location.href,
  }));
  expect(browserState.cacheNames).toEqual([]);
  expect(browserState.indexedDatabaseNames).toEqual([]);
  expect(browserState.localStorageKeys).toEqual([]);
  expect(browserState.href).not.toMatch(/access_token|refresh_token|id_token/iu);
  expect(observedUrls.join('\n')).not.toMatch(/access_token|refresh_token|id_token/iu);

  const applicationCookies = await context.cookies(new URL(page.url()).origin);
  expect(applicationCookies.map((cookie) => cookie.name)).toEqual(['__Host-hdi-session']);
  expect(applicationCookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(applicationCookies[0]?.value).not.toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-hdi-session');

  const suffix = fixtureSuffix(testInfo.project.name);
  await page.getByLabel('收费目录治理对象 ID').fill(CHARGE_GOVERNANCE_OBJECT_ID);
  await page.getByLabel('收费项目代码').fill(`E2E-FEE-${suffix}`);
  await page.route('**/v1/phase-01/charge-item-drafts', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-csrf-token'];
    await route.continue({ headers });
  }, { times: 1 });
  await page.getByRole('button', { name: '新增草稿' }).click();
  await expect(page.getByRole('alert')).toHaveText('BROWSER_CSRF_FORBIDDEN');
  await page.getByRole('button', { name: '新增草稿' }).click();
  const chargeItemId = await requiredText(page.getByTestId('draft-charge-item-id'));
  const chargeVersionId = await requiredText(page.getByTestId('draft-charge-item-version-id'));
  const chargeDigest = await requiredText(page.getByTestId('draft-content-digest'));

  await submitChange(page, {
    governanceObjectId: CHARGE_GOVERNANCE_OBJECT_ID,
    stableEntityId: chargeItemId,
    entityVersionId: chargeVersionId,
    contentDigest: chargeDigest,
    entityType: 'CHARGE_ITEM_VERSION',
    riskClassification: 'NORMAL',
  });
  await approveCurrentChangeAs(page, REVIEWER_USERNAME, password, 'PROFESSIONAL_REVIEW');
  await approveCurrentChangeAs(page, FINAL_OWNER_USERNAME, password, 'OWNER_FINAL_APPROVAL');

  await switchIdentity(page, OWNER_USERNAME, password);
  await page.getByRole('link', { name: '价表草稿' }).click();
  await page.getByLabel('价表治理对象 ID').fill(PRICE_GOVERNANCE_OBJECT_ID);
  await page.getByLabel('价表代码').fill(`E2E-PRICE-${suffix}`);
  await page.getByLabel('收费项目稳定 ID').fill(chargeItemId);
  await page.getByLabel('收费项目发布版本 ID').fill(chargeVersionId);
  await page.getByRole('button', { name: '新增草稿' }).click();
  const priceListId = await requiredText(page.getByTestId('draft-price-list-id'));
  const priceReleaseId = await requiredText(page.getByTestId('draft-price-list-release-id'));
  const priceDigest = await requiredText(page.getByTestId('draft-price-content-digest'));

  await submitChange(page, {
    governanceObjectId: PRICE_GOVERNANCE_OBJECT_ID,
    stableEntityId: priceListId,
    entityVersionId: priceReleaseId,
    contentDigest: priceDigest,
    entityType: 'PRICE_LIST_RELEASE',
    riskClassification: 'HIGH',
  });
  await approveCurrentChangeAs(page, REVIEWER_USERNAME, password, 'PROFESSIONAL_REVIEW');
  await approveCurrentChangeAs(page, FINAL_OWNER_USERNAME, password, 'OWNER_FINAL_APPROVAL');

  await switchIdentity(page, OWNER_USERNAME, password);
  await page.getByLabel('治理对象 ID').fill(PRICE_GOVERNANCE_OBJECT_ID);
  await page.getByLabel('院区 ID（可选）').fill(CAMPUS_ID);
  await page.getByLabel('价表 ID').fill(priceListId);
  await page.getByLabel('解析收费项目 ID').fill(chargeItemId);
  await page.getByLabel('解析收费项目版本 ID').fill(chargeVersionId);
  await page.getByRole('button', { name: '执行价格解析' }).click();
  await expect(page.getByTestId('resolution-amount')).toHaveText('CNY 20.0000');
  await expect(page.getByTestId('resolution-id')).not.toBeEmpty();
  await expect(page.getByTestId('resolution-digest')).toHaveText(/^[0-9a-f]{64}$/u);

  expect(successfulMutationResponses.length).toBeGreaterThanOrEqual(9);
  for (const response of successfulMutationResponses) {
    const request = response.request();
    expect(request.headers()['authorization']).toBeUndefined();
    expect(request.headers()['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  }
  await testInfo.attach('phase-01-browser-observation.json', {
    body: JSON.stringify({
      schemaVersion: 'phase-01.browser-observations.v1',
      scenarios: [
        'BROWSER-CHARGE-DRAFT-CRUD-AND-CSRF',
        'BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION',
      ],
      assertions: [
        'ABG-07:charge-item-draft-crud-and-csrf-rejection',
        'ABG-10:price-list-draft-entry-change-complete-snapshot',
        'ABG-21:high-risk-price-review-owner-final-approval',
      ],
      gateIds: ['ABG-07', 'ABG-10', 'ABG-21'],
      requestIds: successfulMutationResponses
        .map((response) => response.headers()['x-request-id'])
        .filter((requestId): requestId is string => typeof requestId === 'string' && requestId.length > 0),
      principalIds: [ownerPrincipalId],
      governanceObjectIds: [CHARGE_GOVERNANCE_OBJECT_ID, PRICE_GOVERNANCE_OBJECT_ID],
      versionIds: [chargeVersionId, priceReleaseId],
      ruleVersions: ['phase-01.generated-client-contract.v1'],
    }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('phase-01-browser-final-page.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

async function currentPrincipalId(page: Page): Promise<string> {
  const principalId = await page.evaluate(async () => {
    const response = await fetch('/auth/session');
    if (!response.ok) return null;
    const session: unknown = await response.json();
    if (
      typeof session !== 'object' ||
      session === null ||
      Array.isArray(session)
    ) return null;
    const record = session as Readonly<Record<string, unknown>>;
    if (typeof record['principalId'] !== 'string' || record['principalId'].length === 0) return null;
    return record['principalId'];
  });
  if (principalId === null) throw new Error('BROWSER_SESSION_PRINCIPAL_ID_MISSING');
  return principalId;
}

async function submitChange(page: Page, input: {
  readonly governanceObjectId: string;
  readonly stableEntityId: string;
  readonly entityVersionId: string;
  readonly contentDigest: string;
  readonly entityType: 'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE';
  readonly riskClassification: 'NORMAL' | 'HIGH';
}): Promise<void> {
  await page.getByRole('link', { name: '导入·审批·审计' }).click();
  await page.getByLabel('治理对象 ID').fill(input.governanceObjectId);
  await page.getByLabel('稳定实体 ID').fill(input.stableEntityId);
  await page.getByLabel('实体版本 ID').fill(input.entityVersionId);
  await page.getByLabel('内容 SHA-256').fill(input.contentDigest);
  await page.getByLabel('实体类型').selectOption(input.entityType);
  await page.getByLabel('变更类型').selectOption('INITIAL_PUBLICATION');
  await page.getByLabel('风险分类').selectOption(input.riskClassification);
  await page.getByRole('button', { name: '提交变更' }).click();
  await expect(page.getByText('IN_REVIEW', { exact: true })).toBeVisible();
}

async function approveCurrentChangeAs(
  page: Page,
  username: string,
  password: string,
  stageType: 'PROFESSIONAL_REVIEW' | 'OWNER_FINAL_APPROVAL',
): Promise<void> {
  await switchIdentity(page, username, password);
  await page.getByRole('button', { name: '载入请求' }).click();
  await page.getByLabel('下一动作').selectOption(stageType);
  await page.getByRole('button', { name: '执行当前阶段' }).click();
  await expect(page.getByText(stageType === 'OWNER_FINAL_APPROVAL' ? 'APPROVED' : 'IN_REVIEW', { exact: true })).toBeVisible();
}

async function switchIdentity(page: Page, username: string, password: string): Promise<void> {
  await page.getByRole('button', { name: '退出并切换治理身份' }).click();
  await completeKeycloakLogin(page, username, password);
  await expect(page).toHaveURL(/\/admin\/operations$/u);
}

async function loginThroughKeycloak(page: Page, username: string, password: string, target: string): Promise<void> {
  await page.goto(target);
  await completeKeycloakLogin(page, username, password);
  await expect(page).toHaveURL(new RegExp(`${target.replaceAll('/', '\\/')}$`, 'u'));
}

async function completeKeycloakLogin(page: Page, username: string, password: string): Promise<void> {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
}

async function requiredText(locator: Locator): Promise<string> {
  await expect(locator).not.toBeEmpty();
  const value = (await locator.textContent())?.trim();
  if (!value) throw new Error('E2E_REQUIRED_TEXT_MISSING');
  return value;
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
