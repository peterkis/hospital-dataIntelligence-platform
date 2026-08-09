import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256, sha256Bytes } from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

export const BATCH_IMPORT_MODULE_ID = 'batch-import' as const;
const IMPORT_RULE_VERSION = 'phase-01.import.v1';

export type ImportType = 'CHARGE_ITEM' | 'PRICE_ENTRY';
export type ImportSourceKind = 'CSV' | 'JSON';

export interface ImportRowView {
  readonly importRowId: string;
  readonly rowNo: string;
  readonly sourceRowId: string;
  readonly businessKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly rowStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  readonly retryable: boolean;
  readonly stableEntityId: string | null;
  readonly entityVersionId: string | null;
  readonly resultKind: string | null;
  readonly currentErrorCode: string | null;
}

export interface ImportJobView {
  readonly importJobId: string;
  readonly governanceObjectId: string;
  readonly importType: ImportType;
  readonly sourceKind: ImportSourceKind;
  readonly schemaVersion: string;
  readonly rawContentDigest: Buffer;
  readonly normalizedContentDigest: Buffer;
  readonly jobStatus: string;
  readonly rowCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly rows: readonly ImportRowView[];
}

export interface BatchImportModule {
  runRowApply<Result>(work: () => Promise<Result>): Promise<
    | { readonly succeeded: true; readonly result: Result }
    | { readonly succeeded: false; readonly error: Error }
  >;
  createJob(command: {
    readonly governanceObjectId: string;
    readonly importType: ImportType;
    readonly sourceKind: ImportSourceKind;
    readonly schemaVersion: 'phase-01.import.v1';
    readonly rawContent: string;
  }): Promise<ImportJobView>;
  getJob(importJobId: string): Promise<ImportJobView | null>;
  lockNextPendingRow(importJobId: string): Promise<ImportRowView | null>;
  recordRowSuccess(command: {
    readonly importJobId: string;
    readonly importRowId: string;
    readonly stableEntityId: string;
    readonly entityVersionId: string;
    readonly resultKind: 'NEW_DRAFT' | 'VERSION_CANDIDATE' | 'PRICE_ENTRY_APPENDED';
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<ImportJobView>;
  recordRowFailure(command: {
    readonly importJobId: string;
    readonly importRowId: string;
    readonly errorCode: string;
    readonly retryable: boolean;
    readonly evidence: Readonly<Record<string, unknown>>;
  }): Promise<ImportJobView>;
  retryJob(command: {
    readonly importJobId: string;
    readonly expectedRawContentDigest: Buffer;
  }): Promise<ImportJobView>;
}

export function createBatchImportModule(
  database: Kysely<DB>,
  context: RequestContext,
): BatchImportModule {
  return {
    async runRowApply(work) {
      await sql.raw('savepoint batch_import_row_apply').execute(database);
      try {
        const result = await work();
        await sql.raw('release savepoint batch_import_row_apply').execute(database);
        return { succeeded: true, result };
      } catch (error) {
        await sql.raw('rollback to savepoint batch_import_row_apply').execute(database);
        await sql.raw('release savepoint batch_import_row_apply').execute(database);
        return {
          succeeded: false,
          error: error instanceof Error ? error : new Error('IMPORT_ROW_APPLY_FAILED'),
        };
      }
    },

    async createJob(command) {
      if (command.schemaVersion !== IMPORT_RULE_VERSION) {
        throw new Error('IMPORT_SCHEMA_VERSION_UNSUPPORTED');
      }
      const rawBytes = Buffer.from(command.rawContent, 'utf8');
      if (rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf) {
        throw new Error('IMPORT_UTF8_BOM_NOT_ALLOWED');
      }
      const rows = parseAndNormalizeRows(command.importType, command.sourceKind, command.rawContent);
      if (rows.length === 0) throw new Error('IMPORT_ROWS_REQUIRED');
      const rawContentDigest = sha256Bytes(rawBytes);
      const normalizedContentDigest = canonicalSha256(rows.map((row) => row.payload));
      const conflictErrors = detectBatchConflicts(command.importType, rows);
      const created = await sql<{ readonly import_job_id: string }>`
        insert into batch_import.import_job (
          governance_object_id, import_type, source_kind, schema_version,
          raw_content_digest, normalized_content_digest, submitted_by, job_status,
          row_count, succeeded_count, failed_count, created_at, completed_at
        ) values (
          ${command.governanceObjectId}::uuid, ${command.importType}, ${command.sourceKind},
          ${command.schemaVersion}, ${rawContentDigest}, ${normalizedContentDigest},
          ${context.actorPrincipalId}::uuid,
          ${conflictErrors.size === rows.length ? 'FAILED' : 'READY'},
          ${rows.length}, 0, ${conflictErrors.size}, ${context.occurredAt}::timestamp,
          ${conflictErrors.size === rows.length ? context.occurredAt : null}::timestamp
        ) returning import_job_id
      `.execute(database);
      const importJobId = created.rows[0]?.import_job_id;
      if (!importJobId) throw new Error('IMPORT_JOB_CREATE_FAILED');
      for (const row of rows) {
        const errorCode = conflictErrors.get(row.rowNo) ?? null;
        const inserted = await sql<{ readonly import_row_id: string }>`
          insert into batch_import.import_row (
            import_job_id, row_no, source_row_id, business_key,
            normalized_payload, normalized_payload_digest, row_status, retryable,
            current_error_code
          ) values (
            ${importJobId}::uuid, ${row.rowNo}, ${row.sourceRowId}, ${row.businessKey},
            ${JSON.stringify(row.payload)}::jsonb, ${canonicalSha256(row.payload)},
            ${errorCode ? 'FAILED' : 'PENDING'}, ${!errorCode}, ${errorCode}
          ) returning import_row_id
        `.execute(database);
        const importRowId = inserted.rows[0]?.import_row_id;
        if (!importRowId) throw new Error('IMPORT_ROW_CREATE_FAILED');
        if (errorCode) {
          await appendAttempt(database, context, importRowId, 'FAILED', errorCode, {
            phase: 'BATCH_PRE_SCAN',
            businessKey: row.businessKey,
          });
        }
      }
      return getImportJobOrThrow(database, importJobId);
    },

    getJob(importJobId) {
      return getImportJob(database, importJobId);
    },

    async lockNextPendingRow(importJobId) {
      const result = await sql<ImportRowRecord>`
        select import_row_id, row_no::text, source_row_id, business_key,
               normalized_payload, row_status, retryable, stable_entity_id,
               entity_version_id, result_kind, current_error_code
        from batch_import.import_row
        where import_job_id = ${importJobId}::uuid and row_status = 'PENDING'
        order by row_no
        limit 1
        for update skip locked
      `.execute(database);
      return result.rows[0] ? mapImportRow(result.rows[0]) : null;
    },

    async recordRowSuccess(command) {
      const attemptSequence = await nextAttemptSequence(database, command.importRowId);
      await sql`
        update batch_import.import_row
        set row_status = 'SUCCEEDED', retryable = false,
            stable_entity_id = ${command.stableEntityId}::uuid,
            entity_version_id = ${command.entityVersionId}::uuid,
            result_kind = ${command.resultKind}, current_error_code = null
        where import_job_id = ${command.importJobId}::uuid
          and import_row_id = ${command.importRowId}::uuid
          and row_status = 'PENDING'
      `.execute(database);
      await appendAttempt(
        database,
        context,
        command.importRowId,
        'SUCCEEDED',
        null,
        command.evidence,
        attemptSequence,
      );
      await refreshJobSummary(database, command.importJobId, context.occurredAt);
      return getImportJobOrThrow(database, command.importJobId);
    },

    async recordRowFailure(command) {
      const attemptSequence = await nextAttemptSequence(database, command.importRowId);
      await sql`
        update batch_import.import_row
        set row_status = 'FAILED', retryable = ${command.retryable},
            current_error_code = ${command.errorCode}
        where import_job_id = ${command.importJobId}::uuid
          and import_row_id = ${command.importRowId}::uuid
          and row_status = 'PENDING'
      `.execute(database);
      await appendAttempt(
        database,
        context,
        command.importRowId,
        'FAILED',
        command.errorCode,
        command.evidence,
        attemptSequence,
      );
      await refreshJobSummary(database, command.importJobId, context.occurredAt);
      return getImportJobOrThrow(database, command.importJobId);
    },

    async retryJob(command) {
      const current = await getImportJobOrThrow(database, command.importJobId);
      if (!current.rawContentDigest.equals(command.expectedRawContentDigest)) {
        throw new Error('IMPORT_RETRY_INPUT_DIGEST_MISMATCH');
      }
      for (const row of current.rows) {
        if (row.rowStatus === 'SUCCEEDED') {
          await appendAttempt(
            database,
            context,
            row.importRowId,
            'SKIPPED_ALREADY_SUCCEEDED',
            null,
            { stableEntityId: row.stableEntityId, entityVersionId: row.entityVersionId },
          );
        }
      }
      await sql`
        update batch_import.import_row
        set row_status = 'PENDING', current_error_code = null
        where import_job_id = ${command.importJobId}::uuid
          and row_status = 'FAILED' and retryable = true
      `.execute(database);
      await refreshJobSummary(database, command.importJobId, null);
      return getImportJobOrThrow(database, command.importJobId);
    },
  };
}

interface NormalizedImportRow {
  readonly rowNo: number;
  readonly sourceRowId: string;
  readonly businessKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface ImportRowRecord {
  readonly import_row_id: string;
  readonly row_no: string;
  readonly source_row_id: string;
  readonly business_key: string;
  readonly normalized_payload: Readonly<Record<string, unknown>>;
  readonly row_status: ImportRowView['rowStatus'];
  readonly retryable: boolean;
  readonly stable_entity_id: string | null;
  readonly entity_version_id: string | null;
  readonly result_kind: string | null;
  readonly current_error_code: string | null;
}

const CHARGE_HEADERS = [
  'rowId', 'internalCode', 'formalName', 'serviceDefinition', 'billingUnitCode',
  'chargingMethodCode', 'businessValidFrom', 'businessValidTo',
] as const;
const PRICE_HEADERS = [
  'rowId', 'priceListCode', 'displayName', 'currencyCode', 'chargeItemId',
  'chargeItemVersionId', 'scopeLevel', 'campusId', 'encounterMode', 'encounterType',
  'fixedUnitPrice', 'billingUnitCode', 'businessValidFrom', 'businessValidTo',
  'zeroPriceReason',
] as const;

function parseAndNormalizeRows(
  importType: ImportType,
  sourceKind: ImportSourceKind,
  rawContent: string,
): readonly NormalizedImportRow[] {
  const records = sourceKind === 'CSV' ? parseCsv(importType, rawContent) : parseJson(rawContent);
  return records.map((record, index) => normalizeRecord(importType, record, index + 1));
}

function parseJson(rawContent: string): readonly Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(rawContent);
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new Error('IMPORT_JSON_ROWS_INVALID');
  return parsed;
}

function parseCsv(importType: ImportType, rawContent: string): readonly Record<string, unknown>[] {
  const matrix = parseCsvMatrix(rawContent);
  const expected = importType === 'CHARGE_ITEM' ? CHARGE_HEADERS : PRICE_HEADERS;
  const header = matrix[0];
  if (!header || header.length !== expected.length || header.some((value, i) => value !== expected[i])) {
    throw new Error('IMPORT_CSV_HEADER_INVALID');
  }
  return matrix.slice(1).filter((row) => row.some((value) => value.length > 0)).map((row) => {
    if (row.length !== expected.length) throw new Error('IMPORT_CSV_COLUMN_COUNT_INVALID');
    return Object.fromEntries(expected.map((key, index) => [key, row[index] ?? '']));
  });
}

function parseCsvMatrix(input: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('IMPORT_CSV_QUOTE_UNCLOSED');
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

function normalizeRecord(
  importType: ImportType,
  source: Record<string, unknown>,
  rowNo: number,
): NormalizedImportRow {
  const headers = importType === 'CHARGE_ITEM' ? CHARGE_HEADERS : PRICE_HEADERS;
  const unknownKeys = Object.keys(source).filter((key) => !headers.includes(key as never));
  if (unknownKeys.length > 0) throw new Error('IMPORT_ROW_UNKNOWN_FIELD');
  const payload = Object.fromEntries(headers.map((key) => [key, normalizeCell(source[key])])) as Record<string, string | null>;
  const sourceRowId = requireText(payload.rowId, 'IMPORT_ROW_ID_REQUIRED');
  const businessKey = importType === 'CHARGE_ITEM'
    ? requireText(payload.internalCode, 'IMPORT_BUSINESS_KEY_REQUIRED')
    : [
        payload.priceListCode, payload.chargeItemId, payload.chargeItemVersionId,
        payload.scopeLevel, payload.campusId, payload.encounterMode, payload.encounterType,
      ].map((value) => value ?? '').join('|');
  return { rowNo, sourceRowId, businessKey, payload };
}

function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('IMPORT_ROW_VALUE_TYPE_INVALID');
  }
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function requireText(value: string | null | undefined, code: string): string {
  if (!value) throw new Error(code);
  return value;
}

function detectBatchConflicts(
  importType: ImportType,
  rows: readonly NormalizedImportRow[],
): ReadonlyMap<number, string> {
  const errors = new Map<number, string>();
  const byKey = new Map<string, NormalizedImportRow[]>();
  for (const row of rows) {
    const siblings = byKey.get(row.businessKey) ?? [];
    siblings.push(row);
    byKey.set(row.businessKey, siblings);
  }
  for (const duplicates of byKey.values()) {
    if (duplicates.length > 1) {
      for (const row of duplicates) errors.set(row.rowNo, 'IMPORT_DUPLICATE_BUSINESS_KEY');
    }
  }
  if (importType === 'PRICE_ENTRY') {
    for (let left = 0; left < rows.length; left += 1) {
      for (let right = left + 1; right < rows.length; right += 1) {
        const a = rows[left];
        const b = rows[right];
        if (a && b && priceRowsConflict(a.payload, b.payload)) {
          errors.set(a.rowNo, 'PRICE_IMPORT_APPLICABILITY_CONFLICT');
          errors.set(b.rowNo, 'PRICE_IMPORT_APPLICABILITY_CONFLICT');
        }
      }
    }
  }
  return errors;
}

function priceRowsConflict(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const sameScope = ['priceListCode', 'chargeItemId', 'scopeLevel', 'campusId'].every(
    (key) => left[key] === right[key],
  );
  if (!sameScope || !periodsOverlap(left, right)) return false;
  if (left.encounterMode === 'GENERAL' || right.encounterMode === 'GENERAL') return true;
  return left.encounterType === right.encounterType;
}

function periodsOverlap(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftStart = String(left.businessValidFrom ?? '');
  const rightStart = String(right.businessValidFrom ?? '');
  const leftEnd = left.businessValidTo ? String(left.businessValidTo) : null;
  const rightEnd = right.businessValidTo ? String(right.businessValidTo) : null;
  return (!leftEnd || rightStart < leftEnd) && (!rightEnd || leftStart < rightEnd);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapImportRow(row: ImportRowRecord): ImportRowView {
  return {
    importRowId: row.import_row_id,
    rowNo: row.row_no,
    sourceRowId: row.source_row_id,
    businessKey: row.business_key,
    payload: row.normalized_payload,
    rowStatus: row.row_status,
    retryable: row.retryable,
    stableEntityId: row.stable_entity_id,
    entityVersionId: row.entity_version_id,
    resultKind: row.result_kind,
    currentErrorCode: row.current_error_code,
  };
}

async function getImportJob(
  database: Kysely<DB>,
  importJobId: string,
): Promise<ImportJobView | null> {
  const jobResult = await sql<{
    readonly import_job_id: string;
    readonly governance_object_id: string;
    readonly import_type: ImportType;
    readonly source_kind: ImportSourceKind;
    readonly schema_version: string;
    readonly raw_content_digest: Buffer;
    readonly normalized_content_digest: Buffer;
    readonly job_status: string;
    readonly row_count: number;
    readonly succeeded_count: number;
    readonly failed_count: number;
  }>`
    select import_job_id, governance_object_id, import_type, source_kind, schema_version,
           raw_content_digest, normalized_content_digest, job_status, row_count,
           succeeded_count, failed_count
    from batch_import.import_job where import_job_id = ${importJobId}::uuid
  `.execute(database);
  const job = jobResult.rows[0];
  if (!job) return null;
  const rowResult = await sql<ImportRowRecord>`
    select import_row_id, row_no::text, source_row_id, business_key,
           normalized_payload, row_status, retryable, stable_entity_id,
           entity_version_id, result_kind, current_error_code
    from batch_import.import_row
    where import_job_id = ${importJobId}::uuid order by row_no
  `.execute(database);
  return {
    importJobId: job.import_job_id,
    governanceObjectId: job.governance_object_id,
    importType: job.import_type,
    sourceKind: job.source_kind,
    schemaVersion: job.schema_version,
    rawContentDigest: job.raw_content_digest,
    normalizedContentDigest: job.normalized_content_digest,
    jobStatus: job.job_status,
    rowCount: job.row_count,
    succeededCount: job.succeeded_count,
    failedCount: job.failed_count,
    rows: rowResult.rows.map(mapImportRow),
  };
}

async function getImportJobOrThrow(database: Kysely<DB>, importJobId: string): Promise<ImportJobView> {
  const job = await getImportJob(database, importJobId);
  if (!job) throw new Error('IMPORT_JOB_NOT_FOUND');
  return job;
}

async function nextAttemptSequence(database: Kysely<DB>, importRowId: string): Promise<string> {
  const result = await sql<{ readonly next_sequence: string }>`
    select (coalesce(max(attempt_sequence), 0) + 1)::text as next_sequence
    from batch_import.import_row_attempt where import_row_id = ${importRowId}::uuid
  `.execute(database);
  return result.rows[0]?.next_sequence ?? '1';
}

async function appendAttempt(
  database: Kysely<DB>,
  context: RequestContext,
  importRowId: string,
  result: 'SUCCEEDED' | 'FAILED' | 'SKIPPED_ALREADY_SUCCEEDED',
  errorCode: string | null,
  evidence: Readonly<Record<string, unknown>>,
  sequence?: string,
): Promise<void> {
  const attemptSequence = sequence ?? await nextAttemptSequence(database, importRowId);
  await sql`
    insert into batch_import.import_row_attempt (
      import_row_id, attempt_sequence, attempt_result, error_code, rule_version,
      evidence, attempted_by, attempted_at
    ) values (
      ${importRowId}::uuid, ${attemptSequence}::bigint, ${result}, ${errorCode},
      ${IMPORT_RULE_VERSION}, ${JSON.stringify(evidence)}::jsonb,
      ${context.actorPrincipalId}::uuid, ${context.occurredAt}::timestamp
    )
  `.execute(database);
}

async function refreshJobSummary(
  database: Kysely<DB>,
  importJobId: string,
  completedAt: string | null,
): Promise<void> {
  await sql`
    with summary as (
      select count(*) filter (where row_status = 'SUCCEEDED')::integer as succeeded,
             count(*) filter (where row_status = 'FAILED')::integer as failed,
             count(*) filter (where row_status = 'PENDING')::integer as pending
      from batch_import.import_row where import_job_id = ${importJobId}::uuid
    )
    update batch_import.import_job job
    set succeeded_count = summary.succeeded,
        failed_count = summary.failed,
        job_status = case
          when summary.pending > 0 then 'PROCESSING'
          when summary.failed = 0 then 'COMPLETED'
          when summary.succeeded = 0 then 'FAILED'
          else 'PARTIAL_FAILED'
        end,
        completed_at = case when summary.pending = 0 then coalesce(${completedAt}::timestamp, job.completed_at)
                            else null end
    from summary where job.import_job_id = ${importJobId}::uuid
  `.execute(database);
}
