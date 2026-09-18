import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { contractSources } from './contract-sources.mjs';
import { inspect, resolveTarget, root } from './lineage.mjs';
import { parseBytes, unzip } from '../../apps/governance-api/src/modules/governance-catalog/file-parser.ts';
import { textWorkbook, zipText } from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.ts';
import { evaluateRuleSet } from '../../apps/governance-api/src/modules/governance-catalog/validation-rules.ts';

export const PACKAGE_EXPECTATIONS = Object.freeze({
  datasets: 53,
  fields: 866,
  conditions: 196,
  inScopeConditions: 77,
  demos: Object.freeze({ ORG01: 19, ORG04: 18, PER01: 18 }),
});

export const P0_10_REVIEW_BASE = 'da8f6c092b7328ec28915d8dec5e1aea7dc80d5b';

export const SOURCE_ACCEPTANCE_MAPPING = Object.freeze({
  A001: Object.freeze({
    source: 'P0-04.prompt.md:47 and P0-10.prompt.md:45',
    sourceText: '来源质量门禁：Q42；来源验收：A001, A004。所有原条件/字段的责任映射保持，未覆盖部分按明确后票/范围处置，不伪报PASS。',
    checks: ['EMPTY_FILE', 'EMPTY_ROW', 'NO_DATA', 'ZERO_DOMAIN_WRITES'],
  }),
  A004: Object.freeze({
    source: 'P0-04.prompt.md:47 and P0-10.prompt.md:45',
    sourceText: '来源质量门禁：Q42；来源验收：A001, A004。所有原条件/字段的责任映射保持，未覆盖部分按明确后票/范围处置，不伪报PASS。',
    checks: ['UNKNOWN_OR_MISSING_FIELD', 'WRONG_SHEET', 'ACTIVE_CONTENT', 'LOCATION_EVIDENCE'],
  }),
});

const SOURCE_ROUTING_COLUMNS = Object.freeze([
  'dataset_id', 'field_code', 'source_field_label', 'source_type', 'source_required', 'source_ref',
  'source_definition', 'source_privacy', 'source_condition', 'source_trace', 'target_category',
  'proposed_logical_path', 'implementation_task', 'required_owner_tasks', 'conversion_and_authority',
  'mapping_status', 'source_json_pointer',
]);

const DEMO_FORMATS = Object.freeze({ ORG01: 'CSV', ORG04: 'JSON', PER01: 'XLSX' });
const packageMetadataPath = resolve(root, 'db/vnext/sources/catalog-metadata.json');
const qualityGatesPath = resolve(root, 'db/vnext/sources/package-v2/machine/quality-gates.json');
const fieldRoutingPath = resolve(root, 'db/vnext/sources/package-v2/maps/field-routing.csv');
const datasetDefinitionsPath = resolve(root, 'db/vnext/sources/package-v2/datasets');
const packageRoot = resolve(root, 'db/vnext/sources/package-v2');
const q42ManifestPath = resolve(packageRoot, 'inputs/dataset-v2/p0-10-demo-manifest.json');

function gitOutput(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

export function workingTreeDigest() {
  const diff = gitOutput(['diff', '--binary', P0_10_REVIEW_BASE]);
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all']);
  const untracked = status
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3))
    .sort()
    .map((path) => `${path}\n${readFileSync(resolve(root, path)).toString('base64')}\n`)
    .join('');
  return createHash('sha256').update(`${diff}\n${untracked}`).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseCsvRecords(text) {
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ',') {
      record.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(value);
      if (record.some((cell) => cell.length > 0)) records.push(record);
      record = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('SOURCE_ROUTING_CSV_UNCLOSED');
  if (value.length > 0 || record.length > 0) {
    record.push(value);
    records.push(record);
  }
  return records;
}

export function parseDatasetFieldTable(text) {
  return text.split(/\r?\n/u)
    .filter((line) => /^\|\s*`[^`]+`/u.test(line))
    .map((line) => {
      const cells = line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
      const source = /^`([^`]+)`\s+(.+)$/u.exec(cells[0] ?? '');
      const type = /^([^/]+)\/([RCO])$/u.exec(cells[1] ?? '');
      const definition = (cells[2] ?? '').replaceAll('<br>', '\n').trim();
      const target = /^`([^`]+)`/u.exec(cells[3] ?? '');
      return {
        code: source?.[1] ?? '',
        label: source?.[2] ?? '',
        type: type?.[1] ?? '',
        required: type?.[2] ?? '',
        definition,
        target: target?.[1] ?? '',
        owner: cells[4] ?? '',
        conversion: cells[5] ?? '',
      };
    });
}

function packageArtifactFiles(directory, relative = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return packageArtifactFiles(absolute, entryRelative);
    return /\.(?:csv|json|xlsx)$/iu.test(entry.name) ? [{ absolute, relative: entryRelative }] : [];
  });
}

function artifactText(bytes, extension) {
  if (extension.toLowerCase() !== '.xlsx') return bytes.toString('utf8');
  return Object.values(Object.fromEntries(unzip(bytes))).join('\n');
}

export function verifyQ42DeliveryArtifacts() {
  const manifest = readJson(q42ManifestPath);
  assert.equal(manifest.task, 'P0-10', 'Q42_MANIFEST_TASK');
  assert.equal(manifest.scope, 'SYNTHETIC', 'Q42_MANIFEST_SCOPE');
  assert.equal(manifest.synthetic_only, true, 'Q42_MANIFEST_SYNTHETIC');
  assert.equal(manifest.materialization, 'IN_MEMORY_RECEIPT', 'Q42_MANIFEST_MATERIALIZATION');
  assert.deepEqual(
    manifest.samples.map(({ dataset, format, sample_label, execution }) => ({ dataset, format, sample_label, execution })),
    [
      { dataset: 'ORG01', format: 'CSV', sample_label: 'DEMO_ORG01', execution: 'PARSER_REPORT_ONLY' },
      { dataset: 'ORG04', format: 'JSON', sample_label: 'DEMO_ORG04', execution: 'PARSER_REPORT_ONLY' },
      { dataset: 'PER01', format: 'XLSX', sample_label: 'DEMO_PER01', execution: 'PARSER_REPORT_ONLY' },
    ],
    'Q42_MANIFEST_SAMPLES',
  );
  const sensitivePatterns = [
    /(?:^|[^\d])1[3-9]\d{9}(?:$|[^\d])/u,
    /\b\d{17}[\dXx]\b/u,
  ];
  const artifacts = packageArtifactFiles(packageRoot);
  const scanned = [];
  for (const artifact of artifacts) {
    const bytes = readFileSync(artifact.absolute);
    const text = artifactText(bytes, artifact.absolute.slice(-5));
    for (const pattern of sensitivePatterns) assert.doesNotMatch(text, pattern, `Q42_SENSITIVE_VALUE:${artifact.relative}`);
    scanned.push(artifact.relative);
  }
  const generatedDemos = Object.entries(DEMO_FORMATS).map(([dataset, format]) => {
    const input = demoInput(dataset, format);
    const text = artifactText(input, `.${format.toLowerCase()}`);
    assert.match(text, new RegExp(`DEMO_${dataset}`, 'u'), `Q42_DEMO_LABEL:${dataset}`);
    for (const pattern of sensitivePatterns) assert.doesNotMatch(text, pattern, `Q42_DEMO_SENSITIVE_VALUE:${dataset}`);
    const parsed = parseBytes(input, format, sourceContractFields(dataset), 'STRICT_V2');
    for (const value of Object.values(parsed.rows[0] ?? {})) {
      assert.ok(
        value.startsWith('DEMO_') || /^2026-01-0[12](?:T00:00:00)?$/u.test(value) || value === '1',
        `Q42_NON_DEMO_SAMPLE_VALUE:${dataset}`,
      );
      assert.doesNotMatch(value, /[\u3400-\u9fff]/u, `Q42_HUMAN_TEXT_SAMPLE_VALUE:${dataset}`);
    }
    return { dataset, format, label: `DEMO_${dataset}` };
  });
  return {
    status: 'PASS',
    scope: 'SYNTHETIC_PACKAGE_ONLY',
    filesScanned: scanned.length,
    sensitivePatternHits: 0,
    generatedDemos,
    sampleValuePolicy: 'DEMO_PREFIX_OR_TYPED_SAFE_LITERAL',
    realDataExecution: 'NOT_RUN',
  };
}

export function sourceContract(dataset) {
  const source = contractSources().drafts.find((draft) => draft.dataset === dataset);
  assert.ok(source, `SOURCE_CONTRACT_MISSING:${dataset}`);
  return source;
}

export function sourceContractFields(dataset) {
  return sourceContract(dataset).definition.fields.map(({ code, type }) => ({ code, type }));
}

function demoValue(dataset, field, index) {
  if (field.type === 'date') return '2026-01-01';
  if (field.type === 'datetime') return '2026-01-01T00:00:00';
  if (field.type === 'integer') return '1';
  return `DEMO_${dataset}_${String(index + 1).padStart(2, '0')}`;
}

export function demoRow(dataset) {
  return Object.fromEntries(sourceContractFields(dataset).map((field, index) => [
    field.code,
    demoValue(dataset, field, index),
  ]));
}

export function demoInput(dataset, format = DEMO_FORMATS[dataset]) {
  const fields = sourceContractFields(dataset);
  const row = demoRow(dataset);
  if (format === 'CSV') {
    return Buffer.from([
      fields.map((field) => field.code).join(','),
      fields.map((field) => row[field.code]).join(','),
    ].join('\n'));
  }
  if (format === 'JSON') return Buffer.from(JSON.stringify([row]));
  if (format === 'XLSX') {
    return textWorkbook([
      fields.map((field) => field.code),
      fields.map((field) => row[field.code]),
    ]);
  }
  throw new Error('DEMO_FORMAT_REQUIRED');
}

export function verifyPackageCoverage() {
  const metadata = readJson(packageMetadataPath);
  const sources = contractSources();
  const qualityGates = readJson(qualityGatesPath);
  const records = metadata.records ?? [];
  const routedFields = sources.drafts.flatMap((draft) => draft.fieldRouting);
  const q42 = qualityGates.find((rule) => rule.rule_id === 'Q42');
  const q42Evidence = verifyQ42DeliveryArtifacts();
  const fieldRoutingText = readFileSync(fieldRoutingPath, 'utf8');
  const fieldRoutingRows = fieldRoutingText.trim().split(/\r?\n/u).filter(Boolean);
  const datasetDefinitionFiles = readdirSync(datasetDefinitionsPath).filter((name) => /^(?:ORG|PER)\d+\.md$/u.test(name));
  const routingRecords = parseCsvRecords(fieldRoutingText);
  if (routingRecords[0]?.[0]?.startsWith('\uFEFF')) routingRecords[0][0] = routingRecords[0][0].slice(1);
  assert.deepEqual(routingRecords[0], SOURCE_ROUTING_COLUMNS, 'SOURCE_FIELD_ROUTING_HEADER');
  const csvRoutingByKey = new Map(routingRecords.slice(1).map((row) => {
    assert.equal(row.length, SOURCE_ROUTING_COLUMNS.length, 'SOURCE_FIELD_ROUTING_COLUMN_COUNT');
    return [`${row[0]}:${row[1]}`, Object.fromEntries(SOURCE_ROUTING_COLUMNS.map((column, index) => [column, row[index] ?? '']))];
  }));

  assert.equal(records.length, PACKAGE_EXPECTATIONS.datasets, 'PACKAGE_DATASET_COUNT');
  assert.equal(
    records.reduce((count, record) => count + (record.fields?.length ?? 0), 0),
    PACKAGE_EXPECTATIONS.fields,
    'PACKAGE_FIELD_COUNT',
  );
  assert.equal(sources.drafts.length, PACKAGE_EXPECTATIONS.datasets, 'CONTRACT_DRAFT_COUNT');
  assert.equal(routedFields.length, PACKAGE_EXPECTATIONS.fields, 'FIELD_ROUTING_COUNT');
  assert.equal(fieldRoutingRows.length - 1, PACKAGE_EXPECTATIONS.fields, 'SOURCE_FIELD_ROUTING_COUNT');
  assert.equal(datasetDefinitionFiles.length, PACKAGE_EXPECTATIONS.datasets, 'SOURCE_DATASET_DEFINITION_COUNT');
  assert.equal(sources.conditions.length, PACKAGE_EXPECTATIONS.conditions, 'CONDITION_COUNT');
  assert.equal(
    sources.conditions.filter((condition) => condition.scope === 'IN_SCOPE_ORG_PER').length,
    PACKAGE_EXPECTATIONS.inScopeConditions,
    'IN_SCOPE_CONDITION_COUNT',
  );
  assert.equal(sources.drafts.filter((draft) => draft.profile === 'FULL').length, PACKAGE_EXPECTATIONS.datasets, 'FULL_PROFILE_COUNT');
  assert.equal(sources.drafts.filter((draft) => draft.approval === 'DRAFT_NOT_APPROVED').length, PACKAGE_EXPECTATIONS.datasets, 'DRAFT_APPROVAL_COUNT');
  assert.equal(sources.drafts.filter((draft) => draft.adapterReadiness === 'NOT_READY').length, PACKAGE_EXPECTATIONS.datasets, 'ADAPTER_READINESS_COUNT');
  assert.equal(routedFields.filter((field) => field.implementation_task === 'P0-10').length, 0, 'P0_10_FIELD_OWNER_COUNT');
  assert.doesNotMatch(fieldRoutingText, /P0-10/u, 'SOURCE_P0_10_FIELD_OWNER');
  assert.ok(q42, 'Q42_MISSING');
  assert.equal(q42.origin, 'ATTACHMENT_V2', 'Q42_ORIGIN');
  assert.equal(q42.execution_status, 'NOT_RUN', 'Q42_EXECUTION_STATUS');

  const recordsByDataset = new Map(records.map((record) => [record.code, record]));
  for (const draft of sources.drafts) {
    const record = recordsByDataset.get(draft.dataset);
    const datasetDefinition = readFileSync(resolve(datasetDefinitionsPath, `${draft.dataset}.md`), 'utf8');
    const markdownFields = parseDatasetFieldTable(datasetDefinition);
    assert.ok(record, `SOURCE_METADATA_MISSING:${draft.dataset}`);
    assert.match(datasetDefinition, new RegExp(`#\\s*${draft.dataset}\\b`, 'u'), `SOURCE_DATASET_TITLE:${draft.dataset}`);
    assert.equal(record.fields.length, draft.definition.fields.length, `SOURCE_FIELD_COUNT:${draft.dataset}`);
    assert.equal(draft.fieldRouting.length, draft.definition.fields.length, `SOURCE_ROUTING_COUNT:${draft.dataset}`);
    assert.equal(markdownFields.length, draft.definition.fields.length, `SOURCE_MARKDOWN_FIELD_COUNT:${draft.dataset}`);
    draft.definition.fields.forEach((field, index) => {
      const metadataField = record.fields[index];
      const routing = draft.fieldRouting[index];
      const markdownField = markdownFields[index];
      const csvRouting = csvRoutingByKey.get(`${draft.dataset}:${field.code}`);
      assert.ok(csvRouting, `SOURCE_CSV_ROUTING_MISSING:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.pointer, `/${draft.dataset}/fields/${index}`, `SOURCE_POINTER:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.code, field.code, `SOURCE_FIELD_CODE:${draft.dataset}:${index}`);
      assert.equal(metadataField.original.label, routing.source_field_label, `SOURCE_FIELD_LABEL:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.type, field.type, `SOURCE_FIELD_TYPE:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.required, field.required, `SOURCE_FIELD_REQUIRED:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.privacy, field.privacy, `SOURCE_FIELD_PRIVACY:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.definition, routing.source_definition, `SOURCE_FIELD_DEFINITION:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.conditional_requirement, routing.source_condition, `SOURCE_FIELD_CONDITION:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.source_trace, routing.source_trace, `SOURCE_FIELD_TRACE:${draft.dataset}:${field.code}`);
      assert.equal(metadataField.original.ref || '', routing.source_ref || '', `SOURCE_FIELD_REFERENCE:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.code, field.code, `SOURCE_MARKDOWN_FIELD_CODE:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.label, routing.source_field_label, `SOURCE_MARKDOWN_FIELD_LABEL:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.type, field.type, `SOURCE_MARKDOWN_FIELD_TYPE:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.required, field.required, `SOURCE_MARKDOWN_FIELD_REQUIRED:${draft.dataset}:${field.code}`);
      assert.ok(markdownField.definition.includes(routing.source_definition), `SOURCE_MARKDOWN_FIELD_DEFINITION:${draft.dataset}:${field.code}`);
      if (routing.source_condition) assert.ok(markdownField.definition.includes(routing.source_condition), `SOURCE_MARKDOWN_FIELD_CONDITION:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.target, routing.proposed_logical_path, `SOURCE_MARKDOWN_FIELD_TARGET:${draft.dataset}:${field.code}`);
      assert.equal(markdownField.owner, routing.implementation_task, `SOURCE_MARKDOWN_FIELD_OWNER:${draft.dataset}:${field.code}`);
      for (const ownerTask of routing.required_owner_tasks) assert.ok(datasetDefinition.includes(ownerTask), `SOURCE_MARKDOWN_OWNER_COVERAGE:${draft.dataset}:${field.code}:${ownerTask}`);
      assert.ok(markdownField.conversion.includes(routing.conversion_and_authority), `SOURCE_MARKDOWN_FIELD_CONVERSION:${draft.dataset}:${field.code}`);
      assert.equal(routing.dataset_id, draft.dataset, `SOURCE_ROUTING_DATASET:${draft.dataset}:${field.code}`);
      assert.equal(routing.field_code, field.code, `SOURCE_ROUTING_FIELD:${draft.dataset}:${field.code}`);
      assert.equal(routing.source_type, field.type, `SOURCE_ROUTING_TYPE:${draft.dataset}:${field.code}`);
      assert.equal(routing.source_required, field.required, `SOURCE_ROUTING_REQUIRED:${draft.dataset}:${field.code}`);
      assert.equal(routing.source_json_pointer, metadataField.pointer, `SOURCE_ROUTING_POINTER:${draft.dataset}:${field.code}`);
      assert.equal(datasetDefinition.includes(`\`${field.code}\``), true, `SOURCE_DATASET_FIELD:${draft.dataset}:${field.code}`);
      assert.equal(datasetDefinition.includes(routing.proposed_logical_path), true, `SOURCE_DATASET_TARGET:${draft.dataset}:${field.code}`);
      for (const column of SOURCE_ROUTING_COLUMNS) {
        if (column === 'required_owner_tasks') {
          assert.deepEqual(JSON.parse(csvRouting[column]), routing[column], `SOURCE_CSV_ROUTING:${draft.dataset}:${field.code}:${column}`);
        } else {
          assert.equal(csvRouting[column], String(routing[column] ?? ''), `SOURCE_CSV_ROUTING:${draft.dataset}:${field.code}:${column}`);
        }
      }
    });
    assert.deepEqual(
      record.fields.map((field) => field.original.code),
      draft.definition.fields.map((field) => field.code),
      `SOURCE_FIELD_ORDER:${draft.dataset}`,
    );
    assert.deepEqual(draft.sourcePolicies.format.formats, ['CSV', 'JSON', 'XLSX'], `SOURCE_FORMAT_POLICY:${draft.dataset}`);
    assert.equal(draft.sourcePolicies.format.normalization, 'NO_GLOBAL_TRIM_CASE_OR_LEADING_ZERO_LOSS', `SOURCE_NORMALIZATION_POLICY:${draft.dataset}`);
    assert.equal(draft.sourcePolicies.format.formulaMacroExternalLink, 'REJECT', `SOURCE_ACTIVE_CONTENT_POLICY:${draft.dataset}`);
    assert.equal(draft.sourcePolicies.format.hiddenContent, 'REJECT_UNLESS_CONTRACT_EXPLICIT', `SOURCE_HIDDEN_CONTENT_POLICY:${draft.dataset}`);
    assert.equal(draft.sourcePolicies.apply.default, 'VALIDATE_ALL_THEN_APPLY', `SOURCE_APPLY_POLICY:${draft.dataset}`);
  }

  const serializedPackage = JSON.stringify({ metadata, sources });
  assert.doesNotMatch(serializedPackage, /(?:^|[^\d])1[3-9]\d{9}(?:$|[^\d])/u, 'REAL_PHONE_PATTERN');
  assert.doesNotMatch(serializedPackage, /\b\d{17}[\dXx]\b/u, 'REAL_ID_PATTERN');
  assert.doesNotMatch(fieldRoutingText, /(?:^|[^\d])1[3-9]\d{9}(?:$|[^\d])/u, 'SOURCE_REAL_PHONE_PATTERN');
  assert.doesNotMatch(fieldRoutingText, /\b\d{17}[\dXx]\b/u, 'SOURCE_REAL_ID_PATTERN');

  const demos = Object.entries(PACKAGE_EXPECTATIONS.demos).map(([dataset, fieldCount]) => {
    const source = sourceContract(dataset);
    assert.equal(source.definition.fields.length, fieldCount, `${dataset}_FIELD_COUNT`);
    assert.equal(source.approval, 'DRAFT_NOT_APPROVED', `${dataset}_APPROVAL`);
    assert.equal(source.adapterReadiness, 'NOT_READY', `${dataset}_ADAPTER_READINESS`);
    assert.ok(source.definition.references.every((reference) => reference.status === 'BLOCKED_DEPENDENCY'), `${dataset}_REFERENCE_BLOCK`);
    return { dataset, fieldCount, format: DEMO_FORMATS[dataset], execution: 'PARSER_REPORT_ONLY' };
  });

  return {
    status: 'PASS',
    syntheticOnly: true,
    approvalNegative: true,
    sourceAcceptance: {
      mapping: SOURCE_ACCEPTANCE_MAPPING,
      A001: 'PARSER_AND_DB_EVIDENCE_REQUIRED',
      A004: 'PARSER_EVIDENCE_REQUIRED',
    },
    q42: q42.rule_id,
    q42Verified: true,
    q42Evidence,
    counts: {
      datasets: records.length,
      fields: routedFields.length,
      conditions: sources.conditions.length,
      inScopeConditions: sources.conditions.filter((condition) => condition.scope === 'IN_SCOPE_ORG_PER').length,
    },
    demos,
    domainImplementationOwners: 0,
    sourceFidelity: 'PASS',
    sourcePolicyFidelity: 'PASS',
  };
}

function rejected(result, code) {
  assert.equal(result.structuralStatus, 'REJECTED', `PARSER_STATUS_${code}`);
  assert.equal(result.issues[0]?.code, code, `PARSER_CODE_${code}`);
  return result;
}

export function verifyParserBoundaries() {
  const demoReports = Object.entries(DEMO_FORMATS).map(([dataset, format]) => {
    const result = parseBytes(demoInput(dataset, format), format, sourceContractFields(dataset), 'STRICT_V2');
    assert.equal(result.structuralStatus, 'PARSED', `${dataset}_${format}_PARSED`);
    assert.equal(result.rows.length, 1, `${dataset}_${format}_ONE_ROW`);
    assert.ok(Object.values(result.rows[0]).every((value) => value.startsWith('DEMO_') || /^2026-01-0[12]/u.test(value) || value === '1'), `${dataset}_${format}_SYNTHETIC_VALUES`);
    return { dataset, format, status: result.structuralStatus, rows: result.rows.length };
  });

  const fields = sourceContractFields('ORG01');
  const header = fields.map((field) => field.code).join(',');
  const a001EmptyFile = rejected(parseBytes(Buffer.alloc(0), 'CSV', fields, 'STRICT_V2'), 'EMPTY_FILE');
  const a001NoData = {
    CSV: rejected(parseBytes(Buffer.alloc(0), 'CSV', fields, 'STRICT_V2'), 'EMPTY_FILE'),
    JSON: rejected(parseBytes(Buffer.from('[]'), 'JSON', fields, 'STRICT_V2'), 'NO_DATA'),
    XLSX: rejected(parseBytes(textWorkbook([fields.map((field) => field.code)]), 'XLSX', fields, 'STRICT_V2'), 'NO_DATA'),
  };
  const a001EmptyRows = {
    CSV: rejected(parseBytes(Buffer.from(`${header}\n${fields.map(() => '').join(',')}`), 'CSV', fields, 'STRICT_V2'), 'EMPTY_ROW'),
    JSON: rejected(parseBytes(Buffer.from(JSON.stringify([Object.fromEntries(fields.map((field) => [field.code, '']))])), 'JSON', fields, 'STRICT_V2'), 'EMPTY_ROW'),
    XLSX: rejected(parseBytes(textWorkbook([fields.map((field) => field.code), fields.map(() => '')]), 'XLSX', fields, 'STRICT_V2'), 'EMPTY_ROW'),
  };
  const a004Unknown = rejected(parseBytes(Buffer.from(`${header.slice(0, -1)},unknown\n${fields.map(() => 'DEMO').join(',')}`), 'CSV', fields, 'STRICT_V2'), 'FIELD_CONTRACT');
  const a004Missing = rejected(parseBytes(Buffer.from(`${header.slice(0, -1)}\n${fields.slice(0, -1).map(() => 'DEMO').join(',')}`), 'CSV', fields, 'STRICT_V2'), 'FIELD_CONTRACT');
  rejected(parseBytes(Buffer.from(`${fields[0].code},${fields[0].code},${fields.slice(2).map((field) => field.code).join(',')}\n${fields.map(() => 'DEMO').join(',')}`), 'CSV', fields, 'STRICT_V2'), 'DUPLICATE_FIELD');

  const formulaNeedle = '<c r="A2" t="inlineStr"><is><t xml:space="preserve">DEMO</t></is></c>';
  const formulaFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  assert.ok(formulaFiles['xl/worksheets/sheet1.xml']?.includes(formulaNeedle), 'FORMULA_FIXTURE_SHAPE');
  formulaFiles['xl/worksheets/sheet1.xml'] = formulaFiles['xl/worksheets/sheet1.xml'].replace(formulaNeedle, '<c r="A2"><f>1+1</f><v>2</v></c>');
  const a004Formula = rejected(
    parseBytes(
      zipText(formulaFiles),
      'XLSX',
      [{ code: 'code', type: 'text' }],
      'STRICT_V2',
    ),
    'ACTIVE_CONTENT',
  );
  const wrongSheetFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  wrongSheetFiles['xl/workbook.xml'] = wrongSheetFiles['xl/workbook.xml'].replace('name="Data"', 'name="Wrong"');
  const a004WrongSheet = rejected(parseBytes(zipText(wrongSheetFiles), 'XLSX', [{ code: 'code', type: 'text' }], 'STRICT_V2'), 'SHEET_CONTRACT');
  const macroFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  macroFiles['[Content_Types].xml'] = macroFiles['[Content_Types].xml'].replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  const a004Macro = rejected(parseBytes(zipText(macroFiles), 'XLSX', [{ code: 'code', type: 'text' }], 'STRICT_V2'), 'ACTIVE_CONTENT');
  const hasLocation = (result) => Number.isInteger(result.issues[0]?.row)
    && result.issues[0].row >= 1
    && Number.isInteger(result.issues[0]?.column)
    && result.issues[0].column >= 1;
  const a001 = {
    status: 'PASS',
    emptyFile: a001EmptyFile.issues[0]?.code === 'EMPTY_FILE',
    noData: Object.values(a001NoData).every((result) => result.structuralStatus === 'REJECTED'),
    emptyRow: Object.values(a001EmptyRows).every((result) => result.issues[0]?.code === 'EMPTY_ROW'),
  };
  const a004 = {
    status: 'PASS',
    unknownAndMissingFields: a004Unknown.issues[0]?.code === 'FIELD_CONTRACT' && a004Missing.issues[0]?.code === 'FIELD_CONTRACT',
    wrongSheet: a004WrongSheet.issues[0]?.code === 'SHEET_CONTRACT',
    activeContent: a004Formula.issues[0]?.code === 'ACTIVE_CONTENT' && a004Macro.issues[0]?.code === 'ACTIVE_CONTENT',
    locationEvidence: [a004Unknown, a004Missing, a004Formula, a004WrongSheet, a004Macro].every(hasLocation)
      && a004WrongSheet.issues[0]?.sheet === 'Wrong',
  };
  assert.ok(Object.values(a001).slice(1).every(Boolean), 'A001_SOURCE_ACCEPTANCE');
  assert.ok(Object.values(a004).slice(1).every(Boolean), 'A004_SOURCE_ACCEPTANCE');

  const duplicateKey = evaluateRuleSet(
    'ORG01',
    {
      ruleVersion: 'P0_10_DUPLICATE_KEY_V1',
      templateVersion: 'P0_10_DUPLICATE_KEY_V1',
      sourceVersionId: null,
      fields: [
        { code: 'key', type: 'text', required: 'R', privacy: 'INTERNAL', condition: 'ALWAYS', enumValues: [] },
        { code: 'value', type: 'text', required: 'R', privacy: 'INTERNAL', condition: 'ALWAYS', enumValues: [] },
      ],
      rules: [],
      references: [],
      codeSets: [],
      businessKey: ['key'],
    },
    [
      { key: 'DEMO_KEY', value: 'DEMO_FIRST' },
      { key: 'DEMO_KEY', value: 'DEMO_SECOND' },
    ],
  );
  assert.ok(duplicateKey.issues.some((issue) => issue.code === 'CONFLICTING_SOURCE_ID'), 'DUPLICATE_KEY_NEGATIVE');

  const boundaryFields = [{ code: 'value', type: 'text' }];
  const boundaryRows = (count) => Array.from({ length: count }, () => ({ value: 'DEMO' }));
  const boundaryInput = (format, count) => {
    if (format === 'CSV') return Buffer.from(`value\n${Array.from({ length: count }, () => 'DEMO').join('\n')}`);
    if (format === 'JSON') return Buffer.from(JSON.stringify(boundaryRows(count)));
    return textWorkbook([['value'], ...Array.from({ length: count }, () => ['DEMO'])]);
  };
  for (const format of ['CSV', 'JSON', 'XLSX']) {
    const atLimit = parseBytes(boundaryInput(format, 1000), format, boundaryFields, 'STRICT_V2');
    assert.equal(atLimit.structuralStatus, 'PARSED', `${format}_ROW_BOUNDARY_1000`);
    rejected(parseBytes(boundaryInput(format, 1001), format, boundaryFields, 'STRICT_V2'), 'ROW_LIMIT');
    const empty = format === 'JSON' ? Buffer.from('[]') : format === 'XLSX' ? textWorkbook([['value']]) : Buffer.alloc(0);
    rejected(parseBytes(empty, format, boundaryFields, 'STRICT_V2'), format === 'CSV' ? 'EMPTY_FILE' : 'NO_DATA');
    const invalid = format === 'JSON'
      ? Buffer.from('[{"unknown":"DEMO"}]')
      : format === 'XLSX'
        ? textWorkbook([['unknown'], ['DEMO']])
        : Buffer.from('unknown\nDEMO');
    rejected(parseBytes(invalid, format, boundaryFields, 'STRICT_V2'), 'FIELD_CONTRACT');
  }

  return {
    status: 'PASS',
    positiveFormats: demoReports.length,
    negativeCases: 18,
    boundary: { rowsAtLimit: 1000, rowsOverLimit: 1001 },
    demoReports,
    syntheticOnly: true,
    a001,
    a004,
    q42: { status: 'PASS', demoFormats: demoReports.length, syntheticValuesOnly: true },
  };
}

export async function verifyNoDomainWrites(receipt) {
  const observation = await inspect(receipt);
  const pool = new pg.Pool({
    connectionString: resolveTarget(receipt),
    options: '-c default_transaction_read_only=on',
    max: 1,
  });
  try {
    const result = (await pool.query(`
      select
        (select count(*) from pg_namespace where nspname not in ('public','information_schema','vnext_control','governance_catalog') and left(nspname,3)<>'pg_')::int as business_schemas,
        (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('public','information_schema','vnext_control','governance_catalog') and left(n.nspname,3)<>'pg_' and c.relkind in ('r','p','v','m','f','S'))::int as business_objects
    `)).rows[0];
    assert.equal(result.business_schemas, 0, 'BUSINESS_SCHEMA_COUNT');
    assert.equal(result.business_objects, 0, 'BUSINESS_OBJECT_COUNT');
    return {
      status: 'PASS',
      namespaces: observation.namespaces,
      businessInstanceSchemas: 0,
      businessInstanceObjects: 0,
      domainCounts: { schemas: 0, objects: 0 },
    };
  } finally {
    await pool.end();
  }
}

function browserEvidenceComplete(browser) {
  const flow = browser?.requiredFlow;
  const p0_02 = browser?.p0_02_acceptance;
  return browser?.status === 'PASS'
    && browser?.task === 'P0-10'
    && browser?.scope === 'SYNTHETIC'
    && browser?.syntheticOnly === true
    && browser?.p0_02 === 'PASS'
    && browser?.p0_02_real_browser === 'PASS'
    && browser?.p0_02_transport === 'PASS'
    && browser?.p0_02_business_acceptance === 'PASS_SYNTHETIC_BROWSER_CONTROL_PLANE'
    && browser?.p0_02_real_data === 'NOT_RUN'
    && p0_02?.['AC-01'] === 'PASS_UNKNOWN_FIELD_AND_CODESET_AUTHORITY_INVALID_REJECTED'
    && p0_02?.['AC-02'] === 'PASS_UNRESOLVED_CONDITION_APPROVAL_AND_PUBLISH_BLOCKED'
    && p0_02?.['AC-03'] === 'PASS_RULE_VERSION_PUBLISH_REPLAY_NO_NEW_HISTORY_EVENT'
    && p0_02?.['AC-04'] === 'PASS_IMMUTABLE_RULE_VERSION_AND_HISTORY_RETAINED'
    && p0_02?.['AC-05'] === 'PASS_CANDIDATE_CODESET_APPROVAL_BLOCKED'
    && browser?.captureBaseCommit === P0_10_REVIEW_BASE
    && browser?.captureTreeDigest === workingTreeDigest()
    && browser?.method?.includes('Chrome')
    && flow && Object.values(flow).every((value) => value === true)
    && Array.isArray(browser.observations)
    && browser.observations.length >= 8
    && !browser.observations.some((value) => /待形成|不能作为.*凭证|PARTIAL|(?:^|[^A-Z0-9_])BLOCKED(?:$|[^A-Z0-9_])/u.test(value));
}

function reviewEvidenceComplete(review) {
  return review?.status === 'PASS'
    && review.baseCommit === P0_10_REVIEW_BASE
    && review.treeDigest === workingTreeDigest()
    && review.standards?.status === 'PASS'
    && review.spec?.status === 'PASS'
    && Array.isArray(review.findings)
    && review.findings.length === 0;
}

export function runGateM0({ packageCoverage, parser, integration, browser, review }) {
  const browserPass = browserEvidenceComplete(browser);
  const reviewPass = reviewEvidenceComplete(review);
  const checks = {
    'P0-10-AC-01': integration?.noDomainWrites === true && integration?.domainCountsStable === true && integration?.domainCounts?.fresh !== undefined && integration?.domainCounts?.legacy !== undefined,
    'P0-10-AC-02': packageCoverage?.approvalNegative === true && parser?.status === 'PASS' && parser.positiveFormats === 3 && parser?.a001?.status === 'PASS' && parser?.a004?.status === 'PASS' && integration?.sourceAcceptance?.A001?.status === 'PASS' && integration?.draftExecution?.status === 'PASS' && integration?.duplicateKey?.status === 'PASS' && integration?.orphan?.status === 'PASS',
    'P0-10-AC-03': integration?.restartRecovery === true && integration?.restartEvidence?.status === 'PASS' && integration?.restartEvidence?.receiptBound === true && integration?.restartEvidence?.recovered === true,
    'P0-10-AC-04': packageCoverage?.syntheticOnly === true && parser?.syntheticOnly === true,
    'P0-10-AC-05': packageCoverage?.status === 'PASS' && packageCoverage?.sourceFidelity === 'PASS' && packageCoverage?.sourcePolicyFidelity === 'PASS' && packageCoverage?.q42Verified === true && packageCoverage?.q42Evidence?.status === 'PASS' && parser?.q42?.status === 'PASS' && integration?.status === 'PASS' && browserPass && reviewPass,
  };
  const evidence = {
    packageCoverage: packageCoverage?.status === 'PASS',
    integration: integration?.status === 'PASS',
    browser: browserPass,
    review: reviewPass,
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([id]) => id);
  return {
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    checks,
    evidence,
    blockers,
    requiredEvidence: ['package-coverage', 'parser-boundaries', 'db-integration', 'browser', 'current-tree-review'],
  };
}

export function readEvidence(path, fallbackStatus = 'NOT_RUN') {
  if (!existsSync(path)) return { status: fallbackStatus };
  const value = readJson(path);
  assert.ok(['PASS', 'PARTIAL', 'BLOCKED', 'NOT_RUN'].includes(value.status), 'EVIDENCE_STATUS_INVALID');
  return value;
}
