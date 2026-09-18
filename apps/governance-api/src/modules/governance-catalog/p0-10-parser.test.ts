import assert from 'node:assert/strict';
import {test,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {parseBytes,unzip} from './file-parser.js';
import type {ParserResult,FileFormat} from './file-parser.js';
import {textWorkbook,zipText} from './issue-workbook.js';
import {evaluateRuleSet} from './validation-rules.js';
import {demoInput,sourceContractFields} from '../../../../../tooling/vnext/p0-10-gate.mjs';
const DEMO_FORMATS={ORG01:'CSV',ORG04:'JSON',PER01:'XLSX'} as const;
test('an extra worksheet is identified instead of blaming the valid Data sheet',()=>{
  const files=Object.fromEntries(unzip(textWorkbook([['code'],['DEMO']])));
  files['xl/workbook.xml']=files['xl/workbook.xml']!.replace('</sheets>','<sheet name="Secret" sheetId="2" r:id="rId2"/></sheets>');
  const result=parseBytes(zipText(files),'XLSX',[{code:'code',type:'text'}],'STRICT_V2');
  expect(result.issues[0]).toEqual({code:'SHEET_CONTRACT',row:1,column:1,sheet:'Secret'});
});
function rejected(result:ParserResult, code:string) {
  assert.equal(result.structuralStatus, 'REJECTED', `PARSER_STATUS_${code}`);
  assert.equal(result.issues[0]?.code, code, `PARSER_CODE_${code}`);
  return result;
}

export function verifyParserBoundaries() {
  const demoReports = Object.entries(DEMO_FORMATS).map(([dataset, format]) => {
    const result = parseBytes(demoInput(dataset, format), format, sourceContractFields(dataset), 'STRICT_V2');
    assert.equal(result.structuralStatus, 'PARSED', `${dataset}_${format}_PARSED`);
    assert.equal(result.rows.length, 1, `${dataset}_${format}_ONE_ROW`);
    assert.ok(Object.values(result.rows[0] ?? {}).every((value) => value.startsWith('DEMO_') || /^2026-01-0[12]/u.test(value) || value === '1'), `${dataset}_${format}_SYNTHETIC_VALUES`);
    return { dataset, format, status: result.structuralStatus, rows: result.rows.length };
  });

  const fields = sourceContractFields('ORG01');
  const header = fields.map((field) => field.code).join(',');
  const a001EmptyFile = Object.fromEntries((['CSV','JSON','XLSX'] as const).map(format=>[format,rejected(parseBytes(Buffer.alloc(0),format,fields,'STRICT_V2'),'EMPTY_FILE')]));
  const a001NoData = {
    CSV: rejected(parseBytes(Buffer.from(header), 'CSV', fields, 'STRICT_V2'), 'NO_DATA'),
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
  rejected(parseBytes(Buffer.from(`${fields[0]!.code},${fields[0]!.code},${fields.slice(2).map((field) => field.code).join(',')}\n${fields.map(() => 'DEMO').join(',')}`), 'CSV', fields, 'STRICT_V2'), 'DUPLICATE_FIELD');

  const formulaNeedle = '<c r="A2" t="inlineStr"><is><t xml:space="preserve">DEMO</t></is></c>';
  const formulaFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  assert.ok(formulaFiles['xl/worksheets/sheet1.xml']?.includes(formulaNeedle), 'FORMULA_FIXTURE_SHAPE');
  formulaFiles['xl/worksheets/sheet1.xml'] = formulaFiles['xl/worksheets/sheet1.xml']!.replace(formulaNeedle, '<c r="A2"><f>1+1</f><v>2</v></c>');
  const a004Formula = rejected(
    parseBytes(
      zipText(formulaFiles),
      'XLSX',
      [{ code: 'code', type: 'text' }],
      'STRICT_V2',
    ),
    'ACTIVE_CONTENT',
  );
  expect(a004Formula.issues[0]).toEqual({code:'ACTIVE_CONTENT',row:2,column:1,sheet:'Data'});
  const wrongSheetFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  wrongSheetFiles['xl/workbook.xml'] = wrongSheetFiles['xl/workbook.xml']!.replace('name="Data"', 'name="Wrong"');
  const a004WrongSheet = rejected(parseBytes(zipText(wrongSheetFiles), 'XLSX', [{ code: 'code', type: 'text' }], 'STRICT_V2'), 'SHEET_CONTRACT');
  const macroFiles = Object.fromEntries(unzip(textWorkbook([['code'], ['DEMO']])));
  macroFiles['[Content_Types].xml'] = macroFiles['[Content_Types].xml']!.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  const a004Macro = rejected(parseBytes(zipText(macroFiles), 'XLSX', [{ code: 'code', type: 'text' }], 'STRICT_V2'), 'ACTIVE_CONTENT');
  const hasLocation = (result:ParserResult) => Number.isInteger(result.issues[0]?.row)
    && (result.issues[0]?.row ?? 0) >= 1
    && Number.isInteger(result.issues[0]?.column)
    && (result.issues[0]?.column ?? 0) >= 1;
  const a001 = {
    status: 'PASS',
    cases: Object.entries({EMPTY_FILE:a001EmptyFile,NO_DATA:a001NoData,EMPTY_ROW:a001EmptyRows}).flatMap(([kind,results])=>Object.entries(results).map(([format,result])=>({id:`${kind}_${format}`,format,errorCode:result.issues[0]?.code}))),
    emptyFile: Object.values(a001EmptyFile).every(result=>result.issues[0]?.code === 'EMPTY_FILE'),
    noData: Object.values(a001NoData).every((result) => result.issues[0]?.code === 'NO_DATA'),
    emptyRow: Object.values(a001EmptyRows).every((result) => result.issues[0]?.code === 'EMPTY_ROW'),
  };
  const a004 = {
    status: 'PASS',
    unknownAndMissingFields: a004Unknown.issues[0]?.code === 'FIELD_CONTRACT' && a004Missing.issues[0]?.code === 'FIELD_CONTRACT',
    wrongSheet: a004WrongSheet.issues[0]?.code === 'SHEET_CONTRACT',
    activeContent: a004Formula.issues[0]?.code === 'ACTIVE_CONTENT' && a004Macro.issues[0]?.code === 'ACTIVE_CONTENT',
    locationEvidence: [a004Unknown, a004Missing, a004Formula, a004WrongSheet, a004Macro].every(hasLocation)
      && a004WrongSheet.issues[0]?.sheet === 'Wrong'
      && a004Formula.issues[0]?.row === 2 && a004Formula.issues[0]?.column === 1 && a004Formula.issues[0]?.sheet === 'Data',
    formulaLocation: a004Formula.issues[0],
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
  const boundaryRows = (count:number) => Array.from({ length: count }, () => ({ value: 'DEMO' }));
  const boundaryInput = (format:FileFormat, count:number) => {
    if (format === 'CSV') return Buffer.from(`value\n${Array.from({ length: count }, () => 'DEMO').join('\n')}`);
    if (format === 'JSON') return Buffer.from(JSON.stringify(boundaryRows(count)));
    return textWorkbook([['value'], ...Array.from({ length: count }, () => ['DEMO'])]);
  };
  for (const format of ['CSV', 'JSON', 'XLSX'] as const) {
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


test('P0-10 module parser reports preserve three formats and rejection locations',()=>{
  const result=verifyParserBoundaries();
  expect(result.a001.cases).toHaveLength(9);
  expect(result.positiveFormats).toBe(3);
  expect(result.a004.locationEvidence).toBe(true);
  if(process.env['VNEXT_P0_10_PARSER_REPORT'])writeFileSync(process.env['VNEXT_P0_10_PARSER_REPORT'],JSON.stringify(result,null,2)+'\n',{flag:'wx'});
});
