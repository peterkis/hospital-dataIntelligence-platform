import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  openCatalog,
  LocalSyntheticKeyProvider,
  textWorkbook,
} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { fixture } from './protected-fixture.ts';
import { createTemporary, dropTemporary } from './fresh.mjs';
import {
  createValidationOwnerSession,
  dropValidationOwnerRole,
} from './validation-owner-session.mjs';
import {
  inspect,
  migrationFiles,
  migrate,
  peer,
  quote,
  resolveTarget,
  root,
} from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import {
  readEvidence,
  runGateM0,
  verifyNoDomainWrites,
  verifyPackageCoverage,
  verifyParserBoundaries,
} from './p0-10-gate.mjs';

const dimensions = {
  scope: 'SYNTHETIC',
  campus: 'NORTH',
  purpose: 'IDENTITY_VERIFY',
};

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function safeErrorCode(error) {
  return error instanceof Error && /^[A-Z][A-Z0-9_:-]*$/u.test(error.message)
    ? error.message
    : 'P0_10_VALIDATION_FAILED';
}

function fileBytes(field, format, marker) {
  if (format === 'CSV') return Buffer.from(`${field.code}\n${marker}`);
  if (format === 'JSON') return Buffer.from(JSON.stringify([{ [field.code]: marker }]));
  if (format === 'XLSX') return textWorkbook([[field.code], [marker]]);
  throw new Error('FILE_FORMAT_REQUIRED');
}

function fileInput(create, format) {
  return {
    campus: dimensions.campus,
    purpose: dimensions.purpose,
    retentionSeconds: 3600,
    fileRequestId: randomUUID(),
    extension: `.${format.toLowerCase()}`,
    job: {
      ...create,
      requestId: randomUUID(),
      input: { kind: 'FILE', format, parserPolicy: 'STRICT_V2' },
    },
  };
}

async function grantFileAccess(receipt, datasetId) {
  for (const permission of ['STORE', 'READ']) {
    peer(
      receipt.name,
      `INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(datasetId)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`,
    );
  }
}

async function runFormatRoundTrip(catalog, create, field, format) {
  const input = fileInput(create, format);
  const bytes = fileBytes(field, format, `DEMO_P0_10_${format}`);
  const received = await catalog.receiveFile('maker', input, bytes);
  const replay = await catalog.receiveFile('maker', input, bytes);
  assert.deepEqual(replay, received, `${format}_REPLAY_CHANGED_RESULT`);

  const parseInput = {
    ...dimensions,
    requestId: randomUUID(),
    outputRequestId: randomUUID(),
    retentionSeconds: 3600,
    jobId: received.job.id,
    revisionId: received.job.revisionId,
    artifactId: received.artifact.artifactId,
  };
  const parsed = await catalog.parseFile('maker', parseInput);
  assert.equal(parsed.structuralStatus, 'PARSED', `${format}_PARSE_REJECTED`);
  assert.equal(parsed.adapterReadiness, 'NOT_READY', `${format}_ADAPTER_STATUS`);

  const original = Buffer.from(bytes);
  const tampered = Buffer.from(bytes);
  const tamperInput = fileInput(create, format);
  const pending = catalog.receiveFile('maker', tamperInput, tampered);
  tampered.fill(0);
  const tamperResult = await pending;
  const restored = await catalog.authorizeSensitiveRead(
    'maker',
    { ...dimensions, requestId: randomUUID(), artifactId: tamperResult.artifact.artifactId },
  );
  try {
    assert.deepEqual(Buffer.from(restored), original, `${format}_INPUT_SNAPSHOT_FAILED`);
  } finally {
    restored.fill(0);
  }

  const validation = await catalog.validateRevision('maker', {
    ...parseInput,
    requestId: randomUUID(),
    outputRequestId: randomUUID(),
    artifactId: parsed.artifact.artifactId,
  });
  assert.equal(validation.adapterReadiness, 'NOT_READY', `${format}_VALIDATION_ADAPTER_STATUS`);
  return {
    format,
    receive: 'QUARANTINED',
    parse: parsed.structuralStatus,
    validation: validation.decision,
    replay: 'SAME_RESULT',
    inputSnapshot: 'PRESERVED',
  };
}

async function runDuplicateKeyNegative(catalog, create, field) {
  const input = fileInput(create, 'CSV');
  const received = await catalog.receiveFile(
    'maker',
    input,
    Buffer.from(`${field.code}\nDEMO_DUPLICATE\nDEMO_DUPLICATE`),
  );
  const parseInput = {
    ...dimensions,
    requestId: randomUUID(),
    outputRequestId: randomUUID(),
    retentionSeconds: 3600,
    jobId: received.job.id,
    revisionId: received.job.revisionId,
    artifactId: received.artifact.artifactId,
  };
  const parsed = await catalog.parseFile('maker', parseInput);
  const run = await catalog.validateRevision('maker', {
    ...parseInput,
    requestId: randomUUID(),
    outputRequestId: randomUUID(),
    artifactId: parsed.artifact.artifactId,
  });
  const explained = await catalog.explainIssue('maker', {
    ...dimensions,
    runId: run.runId,
  });
  assert.ok(explained.evaluation.duplicates?.some((duplicate) => duplicate.row === 2 && duplicate.duplicateOf === 1), 'DUPLICATE_KEY_NOT_RECORDED');
  return { status: 'PASS', disposition: 'DUPLICATE_EXACT_ROW_RECORDED' };
}

async function runOrphanNegative(receipt, create) {
  const pool = new pg.Pool({ connectionString: resolveTarget(receipt), max: 1 });
  try {
    const before = Number((await pool.query('select count(*) as count from governance_catalog.import_input_revision')).rows[0].count);
    await assert.rejects(
      pool.query(
        'select governance_catalog.import_job_command($1,$2::jsonb)',
        ['maker', JSON.stringify(fileInput(create, 'CSV').job)],
      ),
      /FILE_ORIGINAL_REQUIRED/,
    );
    const after = Number((await pool.query('select count(*) as count from governance_catalog.import_input_revision')).rows[0].count);
    assert.equal(after, before, 'ORPHAN_REVISION_WAS_PERSISTED');
    return { status: 'PASS', disposition: 'ORPHAN_FILE_REJECTED_AND_ROLLED_BACK' };
  } finally {
    await pool.end();
  }
}

async function runConcurrencyAndPermissionChecks(catalog, receipt, create, datasetId, field) {
  const formats = [];
  for (const format of ['CSV', 'JSON', 'XLSX']) {
    const concurrentInput = fileInput(create, format);
    const concurrentBytes = fileBytes(field, format, `DEMO_CONCURRENT_${format}`);
    const concurrent = await Promise.all([
      catalog.receiveFile('maker', concurrentInput, concurrentBytes),
      catalog.receiveFile('maker', concurrentInput, concurrentBytes),
    ]);
    assert.deepEqual(concurrent[0], concurrent[1], `${format}_CONCURRENT_REPLAY_CHANGED_RESULT`);
    const ordinary = JSON.stringify(await catalog.importJobRead('maker', {
      scope: 'SYNTHETIC',
      jobId: concurrent[0].job.id,
    }));
    assert.equal(ordinary.includes(`DEMO_CONCURRENT_${format}`), false, `${format}_ORDINARY_PROJECTION_EXPOSED_RAW_VALUE`);
    formats.push(format);
  }

  peer(
    receipt.name,
    `DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(datasetId)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='STORE';`,
  );
  try {
    await assert.rejects(
      catalog.receiveFile(
        'maker',
        fileInput(create, 'CSV'),
        Buffer.from(`${field.code}\nDEMO_PERMISSION`),
      ),
      /ACCESS_DENIED/,
    );
  } finally {
    await grantFileAccess(receipt, datasetId);
  }
  return {
    concurrency: formats,
    permission: 'ACCESS_DENIED',
    ordinaryProjection: 'NO_RAW_VALUE',
  };
}

async function runA001DbBoundaries(catalog, receipt, create, fields) {
  const header = fields.map((field) => field.code).join(',');
  const emptyRow = fields.length === 1 ? '""' : fields.map(() => '').join(',');
  const cases = [
    { id: 'EMPTY_FILE', format: 'CSV', bytes: Buffer.alloc(0), receiveOnly: true },
    { id: 'NO_DATA_CSV', format: 'CSV', bytes: Buffer.from(header) },
    { id: 'NO_DATA_JSON', format: 'JSON', bytes: Buffer.from('[]') },
    { id: 'NO_DATA_XLSX', format: 'XLSX', bytes: textWorkbook([fields.map((field) => field.code)]) },
    { id: 'EMPTY_ROW_CSV', format: 'CSV', bytes: Buffer.from(`${header}\n${emptyRow}`) },
    { id: 'EMPTY_ROW_JSON', format: 'JSON', bytes: Buffer.from(JSON.stringify([Object.fromEntries(fields.map((field) => [field.code, '']))])) },
    { id: 'EMPTY_ROW_XLSX', format: 'XLSX', bytes: textWorkbook([fields.map((field) => field.code), fields.map(() => '')]) },
  ];
  const evidence = [];
  for (const item of cases) {
    const before = await verifyNoDomainWrites(receipt);
    const input = fileInput(create, item.format);
    if (item.receiveOnly) {
      await assert.rejects(catalog.receiveFile('maker', input, item.bytes), /CLOSED_FILE_REQUIRED/);
      evidence.push({ id: item.id, format: item.format, receive: 'REJECTED', domainCountsStable: true });
    } else {
      const received = await catalog.receiveFile('maker', input, item.bytes);
      const parsedInput = {
        ...dimensions,
        requestId: randomUUID(),
        outputRequestId: randomUUID(),
        retentionSeconds: 3600,
        jobId: received.job.id,
        revisionId: received.job.revisionId,
        artifactId: received.artifact.artifactId,
      };
      const parsed = await catalog.parseFile('maker', parsedInput);
      assert.equal(parsed.structuralStatus, 'REJECTED', `${item.id}_NOT_REJECTED`);
      evidence.push({ id: item.id, format: item.format, receive: 'QUARANTINED', parse: 'REJECTED', domainCountsStable: true });
    }
    const after = await verifyNoDomainWrites(receipt);
    assert.deepEqual(after.domainCounts, before.domainCounts, `${item.id}_DOMAIN_COUNTS_CHANGED`);
  }
  return { status: 'PASS', evidence };
}

async function runDbIntegration() {
  const owned = createTemporary('P0-10');
  let validationOwner;
  let adminCatalog;
  let catalog;
  let legacyOwned;
  let legacyOwner;
  let legacyAdminCatalog;
  let legacyCatalog;
  try {
    const files = migrationFiles();
    await migrate(owned.receipt, files);
    await seed(owned.receipt);
    const current = await inspect(owned.receipt);
    assert.equal(current.ledger.length, files.length, 'CURRENT_MIGRATION_PREFIX_INCOMPLETE');
    const registeredContracts = Number(peer(owned.receipt.name, 'SELECT count(*) FROM governance_catalog.import_contract;'));
    assert.equal(registeredContracts, 53, 'REGISTERED_CONTRACT_COUNT');
    const typecheck = spawnSync(
      process.execPath,
      ['tooling/vnext/managed.mjs', 'types-verify', owned.receiptPath],
      { cwd: root, env: process.env, stdio: 'ignore', windowsHide: true },
    );
    if (typecheck.status !== 0) throw new Error('P0_10_TYPES_FAILED');

    const before = await verifyNoDomainWrites(owned.receipt);
    const keys = new LocalSyntheticKeyProvider();
    adminCatalog = await openCatalog(resolveTarget(owned.receipt), keys);
    const finite = await fixture(adminCatalog, {
      businessKey: true,
      textField: true,
      ruleVersion: 'P0_10_SYNTHETIC_V1',
    });
    assert.equal(finite.draftExecution?.status, 'PASS', 'DRAFT_EXECUTION_NEGATIVE_MISSING');
    const finiteContract = (
      await adminCatalog.contractRead('maker', {
        scope: 'SYNTHETIC',
        mode: 'HISTORY',
        target: finite.contract.id,
        versionId: finite.contract.versionId,
      })
    )[0];
    const field = finiteContract.definition.fields[0];
    await grantFileAccess(owned.receipt, finite.dataset.id);
    await adminCatalog.close();
    adminCatalog = undefined;

    validationOwner = await createValidationOwnerSession(owned.receipt);
    catalog = await openCatalog(validationOwner.connectionString, keys);
    const sourceAcceptance = {
      A001: await runA001DbBoundaries(catalog, owned.receipt, finite.create, finiteContract.definition.fields),
    };
    const formats = [];
    for (const format of ['CSV', 'JSON', 'XLSX']) {
      formats.push(await runFormatRoundTrip(catalog, finite.create, field, format));
    }
    const duplicateKey = await runDuplicateKeyNegative(catalog, finite.create, field);
    const concurrencyAndPermission = await runConcurrencyAndPermissionChecks(
      catalog,
      owned.receipt,
      finite.create,
      finite.dataset.id,
      field,
    );
    await catalog.close();
    catalog = undefined;
    const orphan = await runOrphanNegative(owned.receipt, finite.create);

    const afterFresh = await verifyNoDomainWrites(owned.receipt);
    assert.deepEqual(afterFresh.domainCounts, before.domainCounts, 'DOMAIN_COUNTS_CHANGED');

    legacyOwned = createTemporary('P0-10');
    const legacyKeys = new LocalSyntheticKeyProvider();
    await migrate(legacyOwned.receipt, files.slice(0, 35));
    await seed(legacyOwned.receipt);
    const beforeLegacy = await verifyNoDomainWrites(legacyOwned.receipt);
    legacyAdminCatalog = await openCatalog(resolveTarget(legacyOwned.receipt), legacyKeys);
    const restartFixture = await fixture(legacyAdminCatalog, {
      businessKey: false,
      textField: true,
      ruleVersion: 'P0_10_RESTART_V1',
    });
    const restartContract = (
      await legacyAdminCatalog.contractRead('maker', {
        scope: 'SYNTHETIC',
        mode: 'HISTORY',
        target: restartFixture.contract.id,
        versionId: restartFixture.contract.versionId,
      })
    )[0];
    const restartField = restartContract.definition.fields[0];
    await grantFileAccess(legacyOwned.receipt, restartFixture.dataset.id);
    const restartFile = await legacyAdminCatalog.receiveFile(
      'maker',
      fileInput(restartFixture.create, 'CSV'),
      fileBytes(restartField, 'CSV', 'DEMO_P0_10_RESTART'),
    );
    await legacyAdminCatalog.close();
    legacyAdminCatalog = undefined;
    const legacyPrefix = await inspect(legacyOwned.receipt);
    await migrate(legacyOwned.receipt, files);
    await seed(legacyOwned.receipt);
    const legacyCurrent = await inspect(legacyOwned.receipt);
    assert.equal(legacyCurrent.ledger.length, files.length, 'LEGACY_CURRENT_MIGRATION_INCOMPLETE');
    assert.deepEqual(legacyCurrent.ledger.slice(0, 35), legacyPrefix.ledger, 'LEGACY_UPGRADE_PREFIX_CHANGED');

    legacyOwner = await createValidationOwnerSession(legacyOwned.receipt);
    legacyCatalog = await openCatalog(legacyOwner.connectionString, legacyKeys);
    const restartParsedInput = {
      ...dimensions,
      requestId: randomUUID(),
      outputRequestId: randomUUID(),
      retentionSeconds: 3600,
      jobId: restartFile.job.id,
      revisionId: restartFile.job.revisionId,
      artifactId: restartFile.artifact.artifactId,
    };
    const restartParsed = await legacyCatalog.parseFile('maker', restartParsedInput);
    const restartRun = await legacyCatalog.validateRevision('maker', {
      ...restartParsedInput,
      requestId: randomUUID(),
      outputRequestId: randomUUID(),
      artifactId: restartParsed.artifact.artifactId,
    });
    assert.ok(restartRun.issueCount > 0, 'RESTART_PROBLEM_NOT_CREATED');
    const beforeRestart = await legacyCatalog.workbenchSummary('maker', {
      scope: 'SYNTHETIC',
      jobId: restartFile.job.id,
    });
    assert.ok(beforeRestart.runs.length > 0, 'RESTART_RUN_NOT_VISIBLE');
    await legacyCatalog.close();
    legacyCatalog = undefined;

    const recovery = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tooling/vnext/p0-10-recovery.mjs'],
      {
        cwd: root,
        env: {
          ...process.env,
          VNEXT_P0_10_RECEIPT: legacyOwned.receiptPath,
          VNEXT_P0_10_JOB_ID: restartFile.job.id,
        },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    if (recovery.status !== 0) throw new Error('RESTART_RECOVERY_FAILED');
    const recoveryLine = recovery.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .find((value) => value?.status === 'PASS');
    assert.ok(recoveryLine?.recovered === true, 'RESTART_RECOVERY_EVIDENCE_MISSING');
    const afterLegacy = await verifyNoDomainWrites(legacyOwned.receipt);
    assert.deepEqual(afterLegacy.domainCounts, beforeLegacy.domainCounts, 'LEGACY_DOMAIN_COUNTS_CHANGED');
    assert.equal(afterFresh.businessInstanceSchemas, 0, 'DOMAIN_SCHEMA_COUNT_CHANGED');
    assert.equal(afterFresh.businessInstanceObjects, 0, 'DOMAIN_OBJECT_COUNT_CHANGED');
    assert.equal(afterLegacy.businessInstanceSchemas, 0, 'LEGACY_DOMAIN_SCHEMA_COUNT_CHANGED');
    assert.equal(afterLegacy.businessInstanceObjects, 0, 'LEGACY_DOMAIN_OBJECT_COUNT_CHANGED');
    return {
      status: 'PASS',
      fresh: 'PASS',
      upgrade: 'PASS',
      codegen: 'PASS',
      registeredContracts,
      formats,
      duplicateKey,
      orphan,
      concurrencyAndPermission,
      sourceAcceptance,
      draftExecution: finite.draftExecution,
      noDomainWrites: true,
      domainCountsStable: true,
      domainCounts: {
        fresh: { before: before.domainCounts, after: afterFresh.domainCounts },
        legacy: { before: beforeLegacy.domainCounts, after: afterLegacy.domainCounts },
      },
      businessInstanceSchemas: 0,
      businessInstanceObjects: 0,
      restartRecovery: true,
      restartEvidence: {
        status: 'PASS',
        receiptBound: true,
        problemState: 'PERSISTED_AFTER_PROCESS_RESTART',
        recovered: recoveryLine.recovered === true,
        runCount: recoveryLine.runCount,
        issueCount: recoveryLine.issueCount,
      },
      problemState: 'PERSISTED_AFTER_PROCESS_RESTART',
    };
  } catch (error) {
    if (legacyOwned && !legacyOwner) legacyOwner = error?.ownerSession;
    else validationOwner ??= error?.ownerSession;
    throw error;
  } finally {
    await catalog?.close();
    await adminCatalog?.close();
    await legacyCatalog?.close();
    await legacyAdminCatalog?.close();
    // Chosen disposal order: close pools, dispose the receipt-owned database,
    // then remove the validation owner role after its no-session checks.
    dropTemporary(owned.receipt);
    if (validationOwner) dropValidationOwnerRole(validationOwner);
    if (legacyOwned) {
      dropTemporary(legacyOwned.receipt);
      if (legacyOwner) dropValidationOwnerRole(legacyOwner);
    }
  }
}

async function main() {
  const runDirectory = resolve(root, '.runtime/vnext/p0-10', `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`);
  mkdirSync(runDirectory, { recursive: true });
  let packageCoverage;
  let parser;
  let integration;
  let failure;
  try {
    packageCoverage = verifyPackageCoverage();
    writeJson(resolve(runDirectory, 'package-coverage.json'), packageCoverage);
    parser = verifyParserBoundaries();
    writeJson(resolve(runDirectory, 'parser-boundaries.json'), parser);
    integration = await runDbIntegration();
    writeJson(resolve(runDirectory, 'db-integration.json'), integration);
  } catch (error) {
    failure = safeErrorCode(error);
    integration ??= { status: 'BLOCKED', noDomainWrites: false, restartRecovery: false, errorCode: failure };
    writeJson(resolve(runDirectory, 'failure.json'), { status: 'BLOCKED', errorCode: failure });
  }

  const browser = readEvidence(resolve(root, '.runtime/vnext/p0-10/browser-evidence.json'));
  const review = readEvidence(resolve(root, '.runtime/vnext/p0-10/review-evidence.json'));
  writeJson(resolve(runDirectory, 'browser.json'), browser);
  writeJson(resolve(runDirectory, 'review.json'), review);
  const gate = runGateM0({ packageCoverage, parser, integration, browser, review });
  writeJson(resolve(runDirectory, 'm0-result.json'), gate);
  console.log(JSON.stringify({
    gate: 'P0-10',
    status: gate.status,
    blockers: gate.blockers,
    browser: browser.status,
    review: review.status,
    implementationError: failure ?? null,
    evidence: 'p0-10/' + runDirectory.split(/[\\/]/u).at(-1),
  }));
  if (gate.status !== 'PASS') process.exitCode = 2;
}

await main();
