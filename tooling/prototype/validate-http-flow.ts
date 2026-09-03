import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { PROTOTYPE_DATABASE_POOL_CLOSED_EVENT } from '../../apps/governance-api/src/prototype-lifecycle.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const host = process.env['HOST'] ?? '127.0.0.1';
const port = parsePort(process.env['PORT'] ?? '3000');
const baseUrl = `http://${host}:${port}`;
const validateUi = process.env['PROTOTYPE_UI_VALIDATION'] === 'true';
let validationFlow: 'phase-01' | 'department' | undefined;
let apiProcess: ChildProcess | undefined;
let apiProcessExited = false;
let apiProcessGracefullyStopped = false;
let portReleased = false;
let persistenceBefore: PrototypePersistenceTotals | undefined;
let persistenceObserved = false;
let httpSmokePassed = false;
let databasePoolClosed = false;
let uiBuildPassed = false;
let uiResourcesPassed = false;
let departmentPersistenceBefore: DepartmentPrefixSnapshot | undefined;
let departmentSmokeResult: DepartmentHttpSmokeResult | undefined;
let departmentPersistenceResult: DepartmentPersistenceResult | undefined;

try {
  validationFlow = parseValidationFlow(process.argv.slice(2));
  if (await isPortAcceptingConnections(host, port)) {
    throw new Error('PROTOTYPE_PORT_ALREADY_IN_USE');
  }

  await runNode('DATABASE_CHECK', ['tooling/prototype/check-database.mjs']);
  await runNode('DATABASE_MIGRATION', [
    'tooling/runtime/apply-migrations.mjs',
    'db/migrations',
  ]);
  await runNode('SYNTHETIC_SEED', [
    '--import',
    'tsx',
    'tooling/prototype/seed-prototype.ts',
  ]);
  if (validationFlow === 'department') {
    await runNode('DEPARTMENT_SYNTHETIC_SEED', [
      '--import',
      'tsx',
      'tooling/prototype/seed-department-demo.ts',
    ]);
    departmentPersistenceBefore = await readDepartmentPrefixSnapshot();
  } else if (validateUi) {
    await runNode(
      'PROTOTYPE_UI_BUILD',
      [resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'prototype'],
      { VITE_ADMIN_MODE: 'prototype' },
      resolve(repositoryRoot, 'apps/admin-web'),
    );
    uiBuildPassed = true;
  }
  if (validationFlow === 'phase-01') {
    persistenceBefore = await readPrototypePersistenceTotals();
  }

  apiProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/governance-api/src/prototype-main.ts'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
        PROTOTYPE_MODE: 'true',
        ...(validateUi ? { PROTOTYPE_UI: 'true' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  apiProcess.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  apiProcess.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  apiProcess.on('message', (message) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'event' in message &&
      message.event === PROTOTYPE_DATABASE_POOL_CLOSED_EVENT
    ) {
      databasePoolClosed = true;
    }
  });
  await waitForHealth(apiProcess, `${baseUrl}/health`, 20_000);

  if (validationFlow === 'phase-01' && validateUi) {
    await validatePrototypeUiResources(baseUrl);
    uiResourcesPassed = true;
  }

  const smokeOutput = await runNode(
    validationFlow === 'department' ? 'DEPARTMENT_HTTP_SMOKE' : 'HTTP_SMOKE',
    [
      '--import',
      'tsx',
      validationFlow === 'department'
        ? 'tooling/prototype/run-department-http-flow.ts'
        : 'tooling/prototype/run-http-flow.ts',
    ],
    { PROTOTYPE_API_BASE_URL: baseUrl },
  );
  if (validationFlow === 'department') {
    departmentSmokeResult = parseDepartmentSmokeResult(smokeOutput);
  }
  httpSmokePassed = true;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_HTTP_VALIDATION_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  const stopResult = apiProcess
    ? await stopChild(apiProcess)
    : { exited: true, graceful: true };
  apiProcessExited = stopResult.exited;
  apiProcessGracefullyStopped = stopResult.graceful;
  portReleased = validationFlow
    ? !(await waitForPortState(host, port, false, 10_000))
    : true;
  if (validationFlow === 'phase-01' && httpSmokePassed && persistenceBefore) {
    try {
      const persistenceAfter = await readPrototypePersistenceTotals();
      persistenceObserved =
        persistenceAfter.publishedChargeItemVersions >
          persistenceBefore.publishedChargeItemVersions &&
        persistenceAfter.publishedPriceListReleases >
          persistenceBefore.publishedPriceListReleases &&
        persistenceAfter.priceResolutions > persistenceBefore.priceResolutions;
      if (!persistenceObserved) {
        process.stderr.write(`${JSON.stringify({
          status: 'FAILED',
          errorCode: 'PROTOTYPE_HTTP_PERSISTENCE_NOT_OBSERVED',
        })}\n`);
        process.exitCode = 1;
      }
    } catch {
      process.stderr.write(`${JSON.stringify({
        status: 'FAILED',
        errorCode: 'PROTOTYPE_HTTP_PERSISTENCE_CHECK_FAILED',
      })}\n`);
      process.exitCode = 1;
    }
  }
  if (
    validationFlow === 'department' &&
    httpSmokePassed &&
    departmentPersistenceBefore &&
    departmentSmokeResult &&
    apiProcessExited &&
    apiProcessGracefullyStopped &&
    databasePoolClosed &&
    portReleased
  ) {
    try {
      departmentPersistenceResult = await verifyDepartmentPersistence(
        departmentPersistenceBefore,
        departmentSmokeResult,
      );
      persistenceObserved = departmentPersistenceResult.persistenceObserved;
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        status: 'FAILED',
        errorCode: safeErrorCode(error, 'PROTOTYPE_DEPARTMENT_HTTP_PERSISTENCE_CHECK_FAILED'),
      })}\n`);
      process.exitCode = 1;
    }
  }
  if (apiProcess && (
    !apiProcessExited || !apiProcessGracefullyStopped || !databasePoolClosed || !portReleased
  )) {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      errorCode: !apiProcessExited
        ? 'PROTOTYPE_API_PROCESS_DID_NOT_EXIT'
        : !apiProcessGracefullyStopped
          ? 'PROTOTYPE_API_DID_NOT_STOP_GRACEFULLY'
          : !databasePoolClosed
            ? 'PROTOTYPE_DATABASE_POOL_CLOSE_NOT_CONFIRMED'
            : 'PROTOTYPE_PORT_NOT_RELEASED',
      apiProcessExited,
      apiProcessGracefullyStopped,
      databasePoolClosed,
      portReleased,
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.exitCode !== 1 && validationFlow === 'department' && departmentPersistenceResult) {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    departmentHttpSmokePassed: httpSmokePassed,
    departmentPublished: departmentPersistenceResult.departmentPublished,
    workflowApproved: departmentPersistenceResult.workflowApproved,
    releaseExactlyOnce: departmentPersistenceResult.releaseExactlyOnce,
    projectionExactlyOnce: departmentPersistenceResult.projectionExactlyOnce,
    auditSequenceObserved: departmentPersistenceResult.auditSequenceObserved,
    publicationConfirmationIdempotent:
      departmentPersistenceResult.publicationConfirmationIdempotent,
    sourceMappingConfirmed: departmentPersistenceResult.sourceMappingConfirmed,
    persistenceObserved: departmentPersistenceResult.persistenceObserved,
    databasePoolClosed,
    portReleased,
  })}\n`);
} else if (process.exitCode !== 1 && validationFlow === 'phase-01') {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    apiProcessExited,
    apiProcessGracefullyStopped,
    portReleased,
    databasePoolClosed,
    consumerProcessStarted: false,
    persistenceObserved,
    ...(validateUi ? { uiBuildPassed, uiResourcesPassed } : {}),
  })}\n`);
}

interface PrototypePersistenceTotals {
  readonly publishedChargeItemVersions: bigint;
  readonly publishedPriceListReleases: bigint;
  readonly priceResolutions: bigint;
}

interface DepartmentIdentity {
  readonly departmentCode: string;
  readonly departmentId: string;
}

interface DepartmentPrefixSnapshot {
  readonly count: bigint;
  readonly identities: readonly DepartmentIdentity[];
}

interface DepartmentHttpSmokeResult {
  readonly status: 'PASSED';
  readonly departmentHttpSmokePassed: true;
  readonly departmentPublished: true;
  readonly publicationArtifactsExactlyOnceBeforeConfirmation: true;
  readonly publicationArtifactsUnchangedAfterConfirmations: true;
  readonly publicationArtifactCounts: {
    readonly beforeConfirmation: PublicationArtifactCounts;
    readonly afterFirstConfirmation: PublicationArtifactCounts;
    readonly afterSecondConfirmation: PublicationArtifactCounts;
  };
  readonly publicationConfirmationIdempotent: true;
  readonly sourceMappingConfirmed: true;
  readonly departmentCode: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly governanceRequestId: string;
  readonly correlationId: string;
  readonly mappingId: string;
  readonly sourceCode: string;
}

interface PublicationArtifactCounts {
  readonly releaseMemberCount: 1;
  readonly projectionCount: 1;
  readonly publishedAuditCount: 1;
}

interface DepartmentPersistenceResult {
  readonly departmentPublished: boolean;
  readonly workflowApproved: boolean;
  readonly releaseExactlyOnce: boolean;
  readonly projectionExactlyOnce: boolean;
  readonly auditSequenceObserved: boolean;
  readonly publicationConfirmationIdempotent: boolean;
  readonly sourceMappingConfirmed: boolean;
  readonly persistenceObserved: boolean;
}

async function readPrototypePersistenceTotals(): Promise<PrototypePersistenceTotals> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-http-persistence-check',
    max: 1,
  });
  try {
    const [chargeItems, priceLists, resolutions] = await Promise.all([
      databaseHandle.database
        .selectFrom('charge_catalog.charge_item as item')
        .innerJoin(
          'charge_catalog.charge_item_version as version',
          'version.charge_item_id',
          'item.charge_item_id',
        )
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('item.internal_code', 'like', 'PROTOTYPE-SYNTHETIC-HTTP-FEE-%')
        .where('version.governance_status', '=', 'PUBLISHED')
        .executeTakeFirstOrThrow(),
      databaseHandle.database
        .selectFrom('price_list.price_list as list')
        .innerJoin(
          'price_list.price_list_release as release',
          'release.price_list_id',
          'list.price_list_id',
        )
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('list.price_list_code', '=', 'PROTOTYPE-SYNTHETIC-PRICE-LIST')
        .where('release.display_name', 'like', 'PROTOTYPE SYNTHETIC HTTP PRICE LIST %')
        .where('release.governance_status', '=', 'PUBLISHED')
        .executeTakeFirstOrThrow(),
      databaseHandle.database
        .selectFrom('price_resolution.price_resolution')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('request_id', 'like', 'PROTOTYPE-SYNTHETIC-HTTP-PRICE-RESOLUTION-%')
        .executeTakeFirstOrThrow(),
    ]);
    return {
      publishedChargeItemVersions: BigInt(chargeItems.count),
      publishedPriceListReleases: BigInt(priceLists.count),
      priceResolutions: BigInt(resolutions.count),
    };
  } finally {
    await databaseHandle.close();
  }
}

async function readDepartmentPrefixSnapshot(): Promise<DepartmentPrefixSnapshot> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-department-http-prefix-check',
    max: 1,
  });
  try {
    const identities = await databaseHandle.database
      .selectFrom('department_master.department')
      .select([
        'department_code as departmentCode',
        'department_id as departmentId',
      ])
      .where('department_code', 'like', 'PROTOTYPE-HTTP-DEPARTMENT-%')
      .orderBy('department_code')
      .execute();
    return {
      count: BigInt(identities.length),
      identities,
    };
  } finally {
    await databaseHandle.close();
  }
}

async function verifyDepartmentPersistence(
  before: DepartmentPrefixSnapshot,
  smoke: DepartmentHttpSmokeResult,
): Promise<DepartmentPersistenceResult> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-department-http-persistence-check',
    max: 1,
  });
  try {
    const database = databaseHandle.database;
    const identities = await database
      .selectFrom('department_master.department')
      .select([
        'department_code as departmentCode',
        'department_id as departmentId',
      ])
      .where('department_code', 'like', 'PROTOTYPE-HTTP-DEPARTMENT-%')
      .orderBy('department_code')
      .execute();
    const beforeCodes = new Set(before.identities.map((identity) => identity.departmentCode));
    const added = identities.filter((identity) => !beforeCodes.has(identity.departmentCode));
    if (
      BigInt(identities.length) !== before.count + 1n ||
      added.length !== 1 ||
      added[0]?.departmentCode !== smoke.departmentCode ||
      added[0]?.departmentId !== smoke.departmentId
    ) {
      throw new Error('PROTOTYPE_DEPARTMENT_HTTP_IDENTITY_DELTA_INVALID');
    }

    const version = await database
      .selectFrom('department_master.department_version')
      .select(['governance_status', 'content_hash', 'release_id'])
      .where('department_id', '=', smoke.departmentId)
      .where('department_version_id', '=', smoke.departmentVersionId)
      .executeTakeFirstOrThrow();
    const workflow = await database
      .selectFrom('workflow.change_request')
      .select(['request_status', 'submitted_content_hash'])
      .where('change_request_id', '=', smoke.governanceRequestId)
      .where('stable_entity_id', '=', smoke.departmentId)
      .where('entity_version_id', '=', smoke.departmentVersionId)
      .executeTakeFirstOrThrow();
    const releaseMembers = await database
      .selectFrom('release_distribution.release_member_department')
      .select(['release_id', 'department_id', 'department_version_id', 'member_hash'])
      .where('department_id', '=', smoke.departmentId)
      .where('department_version_id', '=', smoke.departmentVersionId)
      .execute();
    const release = version.release_id
      ? await database
        .selectFrom('release_distribution.governance_release')
        .select(['release_id', 'governance_object_id'])
        .where('release_id', '=', version.release_id)
        .executeTakeFirst()
      : undefined;
    const projections = await database
      .selectFrom('department_master.department_published_projection')
      .select([
        'department_id',
        'department_version_id',
        'published_release_id',
        'superseded_at',
        'content_hash',
      ])
      .where('department_id', '=', smoke.departmentId)
      .where('department_version_id', '=', smoke.departmentVersionId)
      .execute();
    const requiredAuditActions = [
      'DEPARTMENT_CREATED',
      'DEPARTMENT_VERSION_CREATED',
      'DEPARTMENT_SUBMITTED',
      'DEPARTMENT_REVIEWED',
      'DEPARTMENT_APPROVED',
      'DEPARTMENT_PUBLISHED',
    ] as const;
    const auditRows = await database
      .selectFrom('audit.audit_event')
      .select(['action', 'entity_type', 'stable_entity_id'])
      .where('governance_object_id', '=', PROTOTYPE_FIXTURE.departmentMasterObjectId)
      .where('correlation_id', '=', smoke.correlationId)
      .where('action', 'in', requiredAuditActions)
      .orderBy('audit_sequence')
      .execute();
    const mapping = await database
      .selectFrom('department_master.department_source_mapping')
      .select([
        'department_id',
        'source_department_code',
        'mapping_status',
      ])
      .where('department_mapping_id', '=', smoke.mappingId)
      .executeTakeFirstOrThrow();

    const departmentPublished = version.governance_status === 'PUBLISHED';
    const workflowApproved =
      workflow.request_status === 'APPROVED' &&
      workflow.submitted_content_hash.equals(version.content_hash);
    const releaseMember = releaseMembers[0];
    const releaseExactlyOnce =
      releaseMembers.length === 1 &&
      version.release_id !== null &&
      release?.release_id === version.release_id &&
      release.governance_object_id === PROTOTYPE_FIXTURE.departmentMasterObjectId &&
      releaseMember?.release_id === version.release_id &&
      releaseMember.department_id === smoke.departmentId &&
      releaseMember.department_version_id === smoke.departmentVersionId &&
      releaseMember.member_hash.equals(version.content_hash);
    const projection = projections[0];
    const projectionExactlyOnce =
      projections.length === 1 &&
      projection?.department_id === smoke.departmentId &&
      projection.department_version_id === smoke.departmentVersionId &&
      projection.published_release_id === version.release_id &&
      projection.superseded_at === null &&
      projection.content_hash.equals(version.content_hash);
    const auditSequenceObserved =
      auditRows.length === requiredAuditActions.length &&
      auditRows.every((row, index) =>
        row.action === requiredAuditActions[index] &&
        row.entity_type === (index === 0 ? 'DEPARTMENT' : 'DEPARTMENT_VERSION') &&
        row.stable_entity_id === (index === 0 ? smoke.departmentId : smoke.departmentVersionId)) &&
      auditRows.filter((row) => row.action === 'DEPARTMENT_PUBLISHED').length === 1;
    const sourceMappingConfirmed =
      mapping.department_id === smoke.departmentId &&
      mapping.source_department_code === smoke.sourceCode &&
      mapping.mapping_status === 'CONFIRMED';
    const publicationConfirmationIdempotent =
      smoke.publicationConfirmationIdempotent &&
      smoke.publicationArtifactsExactlyOnceBeforeConfirmation &&
      smoke.publicationArtifactsUnchangedAfterConfirmations &&
      releaseExactlyOnce &&
      projectionExactlyOnce &&
      auditRows.filter((row) => row.action === 'DEPARTMENT_PUBLISHED').length === 1;
    const persistenceObserved =
      departmentPublished &&
      workflowApproved &&
      releaseExactlyOnce &&
      projectionExactlyOnce &&
      auditSequenceObserved &&
      publicationConfirmationIdempotent &&
      sourceMappingConfirmed;
    if (!persistenceObserved) {
      throw new Error('PROTOTYPE_DEPARTMENT_HTTP_PERSISTENCE_NOT_OBSERVED');
    }
    return {
      departmentPublished,
      workflowApproved,
      releaseExactlyOnce,
      projectionExactlyOnce,
      auditSequenceObserved,
      publicationConfirmationIdempotent,
      sourceMappingConfirmed,
      persistenceObserved,
    };
  } finally {
    await databaseHandle.close();
  }
}

async function runNode(
  step: string,
  arguments_: readonly string[],
  environment?: Readonly<Record<string, string>>,
  workingDirectory = repositoryRoot,
): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    let standardOutput = '';
    const child = spawn(process.execPath, arguments_, {
      cwd: workingDirectory,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk: Buffer) => {
      standardOutput += chunk.toString('utf8');
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.once('error', () => reject(new Error(`PROTOTYPE_STEP_SPAWN_FAILED:${step}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(standardOutput);
      else reject(new Error(`PROTOTYPE_STEP_FAILED:${step}:${code ?? signal ?? 'UNKNOWN'}`));
    });
  });
}

async function validatePrototypeUiResources(targetBaseUrl: string): Promise<void> {
  const contextResponse = await fetch(`${targetBaseUrl}/prototype/context`, {
    headers: { accept: 'application/json' },
  });
  if (!contextResponse.ok) throw new Error('PROTOTYPE_CONTEXT_UNAVAILABLE');
  const contextText = await contextResponse.text();
  if (/DATABASE_URL|password|connectionString/u.test(contextText)) {
    throw new Error('PROTOTYPE_CONTEXT_CREDENTIAL_EXPOSURE');
  }
  const context = JSON.parse(contextText) as {
    readonly mode?: unknown;
    readonly timeZone?: unknown;
    readonly currentLocalDateTime?: unknown;
  };
  if (
    context.mode !== 'PROTOTYPE_SYNTHETIC' ||
    context.timeZone !== 'Asia/Shanghai' ||
    typeof context.currentLocalDateTime !== 'string' ||
    /[Zz]|[+-]\d{2}:\d{2}$/u.test(context.currentLocalDateTime)
  ) {
    throw new Error('PROTOTYPE_CONTEXT_TIME_CONTRACT_INVALID');
  }

  const adminResponse = await fetch(`${targetBaseUrl}/admin/`);
  if (!adminResponse.ok) throw new Error('PROTOTYPE_UI_INDEX_UNAVAILABLE');
  const html = await adminResponse.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^"]+)"/gu)]
    .map((match) => match[1])
    .filter((path): path is string => typeof path === 'string');
  if (assetPaths.length < 2) throw new Error('PROTOTYPE_UI_ASSET_MANIFEST_INVALID');
  const assetContents = await Promise.all(assetPaths.map(async (path) => {
    const response = await fetch(`${targetBaseUrl}${path}`);
    if (!response.ok) throw new Error('PROTOTYPE_UI_ASSET_UNAVAILABLE');
    return { path, content: await response.text() };
  }));
  const javascript = assetContents
    .filter((asset) => asset.path.endsWith('.js'))
    .map((asset) => asset.content)
    .join('\n');
  if (!javascript || javascript.includes('/auth/session')) {
    throw new Error('PROTOTYPE_UI_FORMAL_AUTH_REFERENCE_DETECTED');
  }
}

async function waitForHealth(
  child: ChildProcess,
  healthUrl: string,
  timeoutMilliseconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('PROTOTYPE_API_EXITED_BEFORE_HEALTHY');
    }
    try {
      const response = await fetch(healthUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok && (await response.json() as { status?: unknown }).status === 'ok') return;
    } catch {
      // The bounded readiness loop continues until the process listens or the deadline expires.
    }
    await delay(200);
  }
  throw new Error('PROTOTYPE_API_HEALTH_TIMEOUT');
}

async function stopChild(child: ChildProcess): Promise<{
  readonly exited: boolean;
  readonly graceful: boolean;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exited: true, graceful: child.exitCode === 0 };
  }
  const exited = new Promise<{ readonly code: number | null }>((resolvePromise) => {
    child.once('exit', (code) => resolvePromise({ code }));
  });
  if (child.connected) child.send('PROTOTYPE_SHUTDOWN');
  else child.kill('SIGTERM');
  const gracefulResult = await Promise.race([
    exited,
    delay(10_000).then(() => undefined),
  ]);
  if (gracefulResult) {
    return { exited: true, graceful: gracefulResult.code === 0 };
  }
  child.kill('SIGKILL');
  const forcedResult = await Promise.race([
    exited,
    delay(5_000).then(() => undefined),
  ]);
  return { exited: forcedResult !== undefined, graceful: false };
}

async function waitForPortState(
  targetHost: string,
  targetPort: number,
  accepting: boolean,
  timeoutMilliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const current = await isPortAcceptingConnections(targetHost, targetPort);
    if (current === accepting) return current;
    await delay(200);
  }
  return isPortAcceptingConnections(targetHost, targetPort);
}

function isPortAcceptingConnections(targetHost: string, targetPort: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: targetHost, port: targetPort });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once('error', () => resolvePromise(false));
  });
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT_INVALID');
  }
  return parsed;
}

function parseValidationFlow(arguments_: readonly string[]): 'phase-01' | 'department' {
  if (arguments_.length === 0) return 'phase-01';
  if (arguments_.length === 1 && arguments_[0] === 'phase-01') return 'phase-01';
  if (arguments_.length === 1 && arguments_[0] === 'department') return 'department';
  throw new Error(arguments_.length > 1
    ? 'PROTOTYPE_HTTP_VALIDATION_ARGUMENT_COUNT_INVALID'
    : 'PROTOTYPE_HTTP_VALIDATION_FLOW_INVALID');
}

function parseDepartmentSmokeResult(output: string): DepartmentHttpSmokeResult {
  for (const line of output.trim().split(/\r?\n/u).reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (
      !isRecord(parsed) ||
      parsed['status'] !== 'PASSED' ||
      parsed['departmentHttpSmokePassed'] !== true ||
      parsed['departmentPublished'] !== true ||
      parsed['publicationArtifactsExactlyOnceBeforeConfirmation'] !== true ||
      parsed['publicationArtifactsUnchangedAfterConfirmations'] !== true ||
      !hasExactlyOncePublicationArtifactSnapshots(parsed['publicationArtifactCounts']) ||
      parsed['publicationConfirmationIdempotent'] !== true ||
      parsed['sourceMappingConfirmed'] !== true ||
      !isDepartmentCode(parsed['departmentCode']) ||
      !isUuid(parsed['departmentId']) ||
      !isUuid(parsed['departmentVersionId']) ||
      !isUuid(parsed['governanceRequestId']) ||
      !isUuid(parsed['mappingId']) ||
      typeof parsed['correlationId'] !== 'string' ||
      !/^PROTOTYPE-HTTP-DEPARTMENT-[A-Z0-9]+$/u.test(parsed['correlationId']) ||
      typeof parsed['sourceCode'] !== 'string' ||
      !/^PROTOTYPE-HTTP-HIS-[A-Z0-9]+$/u.test(parsed['sourceCode'])
    ) {
      continue;
    }
    return parsed as unknown as DepartmentHttpSmokeResult;
  }
  throw new Error('PROTOTYPE_DEPARTMENT_HTTP_RESULT_INVALID');
}

function hasExactlyOncePublicationArtifactSnapshots(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isExactlyOncePublicationArtifactCounts(value['beforeConfirmation']) &&
    isExactlyOncePublicationArtifactCounts(value['afterFirstConfirmation']) &&
    isExactlyOncePublicationArtifactCounts(value['afterSecondConfirmation'])
  );
}

function isExactlyOncePublicationArtifactCounts(value: unknown): boolean {
  return (
    isRecord(value) &&
    value['releaseMemberCount'] === 1 &&
    value['projectionCount'] === 1 &&
    value['publishedAuditCount'] === 1
  );
}

function isDepartmentCode(value: unknown): value is string {
  return typeof value === 'string' && /^PROTOTYPE-HTTP-DEPARTMENT-[A-Z0-9]+$/u.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}
