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
  contractInputSchemas,
} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { fixture } from './protected-fixture.ts';
import { createTemporary } from './fresh.mjs';
import { reconcileValidationCleanup } from './p0-10-cleanup.mjs';
import {
  createValidationOwnerSession,
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
import {verifyHttpRestart} from './p0-10-http-restart.mjs';
import { seed } from './catalog-seed.mjs';
import {contractSources} from './contract-sources.mjs';
import {
  readEvidence,
  runGateM0,
  verifyNoDomainWrites,
  verifyPackageCoverage,
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
    ...['CSV','JSON','XLSX'].map(format => ({ id: `EMPTY_FILE_${format}`, format, bytes: Buffer.alloc(0), receiveOnly: true })),
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
      evidence.push({ id: item.id, format: item.format, receive: 'REJECTED', errorCode:'CLOSED_FILE_REQUIRED', domainCountsStable: true });
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
      const payload=await catalog.authorizeSensitiveRead('maker',{...dimensions,requestId:randomUUID(),artifactId:parsed.artifact.artifactId});
      let errorCode;
      try {errorCode=JSON.parse(Buffer.from(payload).toString('utf8')).result.issues[0].code;} finally {payload.fill(0);}
      assert.equal(errorCode,item.id.replace(/_(CSV|JSON|XLSX)$/u,''),'A001_REJECTION_CATEGORY');
      evidence.push({ id: item.id, format: item.format, receive: 'QUARANTINED', parse: 'REJECTED', errorCode, domainCountsStable: true });
    }
    const after = await verifyNoDomainWrites(receipt);
    assert.deepEqual(after.domainCounts, before.domainCounts, `${item.id}_DOMAIN_COUNTS_CHANGED`);
  }
  return { status: 'PASS', evidence };
}

async function explainRegisteredContracts(catalog) {
  const contracts = await catalog.contractRead('maker',{scope:'BASELINE',mode:'CURRENT'});
  const sources = contractSources().drafts;
  assert.equal(contracts.length,53,'RUNTIME_CONTRACT_COUNT');
  const evidence = [];
  for (const source of sources) {
    const contract = contracts.find(item=>item.dataset===source.dataset);
    assert.ok(contract,'RUNTIME_CONTRACT_MISSING');
    assert.equal(contract.status,'DRAFT');
    assert.equal(contract.profile,'FULL');
    assert.deepEqual(contract.definition,source.definition);
    const explanation = contractInputSchemas(contract);
    assert.equal(explanation.adapterReadiness,'NOT_READY');
    assert.equal(explanation.contractVersionId,contract.versionId);
    assert.ok(Object.keys(contract.schemas).length>0,'CONTRACT_SCHEMA_MISSING');
    evidence.push({dataset:source.dataset,status:'PASS',profile:'FULL',approval:'DRAFT',adapterReadiness:'NOT_READY',fields:contract.definition.fields.length});
  }
  return {status:'PASS',evidence,otherContracts:evidence.filter(item=>!['ORG01','ORG04','PER01'].includes(item.dataset)).length};
}

async function oldApprovalNegative(catalog, finite, contract) {
  const cmd = finite.cmd;
  const revised = await catalog.contractCommand('maker',cmd('REVISE',{
    target:finite.contract.id,expectedHead:finite.contract.head,
    definition:{...contract.definition,ruleVersion:'P0_10_SYNTHETIC_V2',templateVersion:'P0_10_SYNTHETIC_V2'},
    validFrom:contract.validFrom,validTo:contract.validTo,
  }));
  const read = ()=>catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:finite.contract.id});
  const before = await read();
  await assert.rejects(catalog.contractCommand('reviewer',cmd('APPROVE',{target:revised.id,expectedHead:revised.head,reviewDigest:finite.contract.reviewDigest})),/REVIEW_DIGEST_MISMATCH/);
  await assert.rejects(catalog.contractCommand('reviewer',cmd('PUBLISH',{target:revised.id,expectedHead:revised.head,reviewDigest:finite.contract.reviewDigest})),/INVALID_TRANSITION/);
  assert.deepEqual(await read(),before,'OLD_APPROVAL_CHANGED_HISTORY');
  const approval=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:revised.id,expectedHead:revised.head,reviewDigest:revised.reviewDigest}));
  await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:revised.id,expectedHead:approval.head,reviewDigest:approval.reviewDigest}));
  await assert.rejects(catalog.importJobCommand('maker',{...finite.create,requestId:randomUUID()}),/EXACT_CONTRACT_UNAVAILABLE/);
  return {status:'PASS',oldDigestRejected:true,oldPublishRejected:true,historyUnchanged:true,oldExecutionRejected:true};
}

export async function runDbIntegration() {
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
    const contractExplanation = await explainRegisteredContracts(adminCatalog);
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
    const orphan = await runOrphanNegative(owned.receipt, finite.create);
    const oldApproval = await oldApprovalNegative(catalog, finite, finiteContract);
    await catalog.close();
    catalog = undefined;

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

    const recoveryLine = await verifyHttpRestart(legacyOwned.receiptPath, legacyOwner.connectionString, restartContract, restartField.code);
    const afterLegacy = await verifyNoDomainWrites(legacyOwned.receipt);
    assert.deepEqual(afterLegacy.domainCounts, beforeLegacy.domainCounts, 'LEGACY_DOMAIN_COUNTS_CHANGED');
    assert.equal(afterFresh.businessInstanceSchemas, 0, 'DOMAIN_SCHEMA_COUNT_CHANGED');
    assert.equal(afterFresh.businessInstanceObjects, 0, 'DOMAIN_OBJECT_COUNT_CHANGED');
    assert.equal(afterLegacy.businessInstanceSchemas, 0, 'LEGACY_DOMAIN_SCHEMA_COUNT_CHANGED');
    assert.equal(afterLegacy.businessInstanceObjects, 0, 'LEGACY_DOMAIN_OBJECT_COUNT_CHANGED');
    return {
      status: 'PASS',
      fresh: 'PASS',
      cleanupPassed: true,
      environment:{postgresql:peer(owned.receipt.name,'SHOW server_version;'),receipts:[owned.receipt,legacyOwned.receipt]},
      upgrade: 'PASS',
      codegen: 'PASS',
      registeredContracts,
      contractExplanation,
      oldApproval,
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
      restartEvidence: recoveryLine,
      problemState: 'PERSISTED_AFTER_HTTP_SERVICE_RESTART',
    };
  } catch (error) {
    if (legacyOwned && !legacyOwner) legacyOwner = error?.ownerSession;
    else validationOwner ??= error?.ownerSession;
    throw error;
  } finally {
    const closes=await Promise.allSettled([catalog?.close(),adminCatalog?.close(),legacyCatalog?.close(),legacyAdminCatalog?.close()]);
    const cleanup=[];
    for(const [database,owner] of [[owned,validationOwner],[legacyOwned,legacyOwner]]) {
      if(!database)continue;
      try {cleanup.push({receipt:database.receipt,...reconcileValidationCleanup(database.receipt,owner)});}
      catch {cleanup.push({receipt:database.receipt,status:'BLOCKED',errorCode:'TEMPORARY_CLEANUP_FAILED'});}
    }
    const cleanupPassed=closes.every(item=>item.status==='fulfilled') && cleanup.every(item=>item.status==='PASS');
    if(process.env.VNEXT_P0_10_LIFECYCLE_REPORT)writeJson(process.env.VNEXT_P0_10_LIFECYCLE_REPORT,{status:cleanupPassed?'PASS':'BLOCKED',cleanupPassed,databases:cleanup});
    if(!cleanupPassed)throw new Error('TEMPORARY_CLEANUP_FAILED');
  }
}
