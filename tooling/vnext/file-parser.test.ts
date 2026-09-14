import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parseBytes, unzip } from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import { textWorkbook, zipText, issueWorkbook } from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
const fields=[{code:'code',type:'code'},{code:'label',type:'text'}];
const parse=(text:string)=>parseBytes(Buffer.from(text),'CSV',fields);
const workbook=textWorkbook([['code','label'],['0012','DEMO']]);
const edit=(part:string,from:string,to:string)=>{const files=Object.fromEntries(unzip(workbook));files[part]=files[part]!.replace(from,to);return zipText(files);};
test('review: provenance retains source column when header order differs from contract',()=>{
 for(const result of [parse('label,code\nDEMO,0012'),parseBytes(textWorkbook([['label','code'],['DEMO','0012']]),'XLSX',fields)]){
  assert.equal(result.cells.find(c=>c.field==='code')?.column,2);
  assert.equal(result.cells.find(c=>c.field==='label')?.column,1);
 }
});
test('AC01/04/06: three formats agree, leading zero text preserved, empty/encoding/header errors reject',()=>{
 const c=parse('code,label\r\n0012,DEMO\r\n');const j=parseBytes(Buffer.from('[{"label":"DEMO","code":"0012"}]'),'JSON',fields);const x=parseBytes(workbook,'XLSX',fields);
 for(const r of [c,j,x]){assert.equal(r.structuralStatus,'PARSED');assert.equal(r.rows[0]?.['code'],'0012');}
 assert.deepEqual(c.rows,j.rows);assert.deepEqual(c.rows,x.rows);
 for(const text of ['', 'code,label\n', 'code,code\na,b','code,unknown\na,b','code,label\n,','code,label\n\n'])assert.equal(parse(text).structuralStatus,'REJECTED');
 assert.equal(parseBytes(new Uint8Array([0xff]),'CSV',fields).issues[0]?.code,'INVALID_UTF8');
 for(const text of ['[{"code":"a","code":"b","label":"x"}]','[{"code":"a","co\\u0064e":"b","label":"x"}]','[{"code":"a","label":"x",}]'])assert.equal(parseBytes(Buffer.from(text),'JSON',fields).structuralStatus,'REJECTED');
});
test('AC05 and BOM/time: transformations are explicit; no numeric guessing or silent whitespace change',()=>{
 const bom=parse('\uFEFFcode,label\n0012,DEMO');assert.equal(bom.manifest.bomDetected,true);assert.equal(bom.structuralStatus,'PARSED');
 assert.equal(parse('code,label\n 0012,DEMO').issues[0]?.code,'WHITESPACE_REJECTED');
 assert.equal(parse('code,label\n0012,DEMO ').issues[0]?.code,'WHITESPACE_REJECTED');
 assert.equal(parseBytes(Buffer.from('[{"code":12,"label":"DEMO"}]'),'JSON',fields).issues[0]?.code,'TEXT_CELL_REQUIRED');
 for(const value of ['2026-01-01T00:00:00Z','2026-01-01T00:00:00+08:00','2026-01-01T00:00:00-01:00'])assert.equal(parseBytes(Buffer.from(`time\n${value}`),'CSV',[{code:'time',type:'datetime'}]).issues[0]?.code,'LOCAL_TIME_REQUIRED');
});
test('AC03: formula/cache, macro, external, hidden, numeric, extra/duplicate members reject',()=>{
 const part='xl/worksheets/sheet1.xml';
 for(const bytes of [
  edit(part,'<is><t xml:space="preserve">0012</t></is>','<f>1+1</f><v>2</v>'),
  edit(part,'t="inlineStr"><is><t xml:space="preserve">0012</t></is>','t="n"><v>12</v>'),
  edit('[Content_Types].xml','spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml'),
  edit('xl/_rels/workbook.xml.rels','Target="worksheets/sheet1.xml"','Target="https://example.invalid" TargetMode="External"'),
  zipText({...Object.fromEntries(unzip(workbook)),'xl/vbaProject.bin':'blocked'}),
 ])assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
 const hidden=parseBytes(edit(part,'<row r="2">','<row r="2" hidden="1">'),'XLSX',fields);assert.equal(hidden.issues[0]?.code,'HIDDEN_UNDECLARED');assert.deepEqual(hidden.manifest.hiddenRows,[2]);
 assert.equal(parseBytes(edit('xl/workbook.xml','name="Data"','name="Data" state="hidden"'),'XLSX',fields).issues[0]?.code,'HIDDEN_UNDECLARED');
 assert.equal(parseBytes(edit(part,'<sheetData>','<cols><col min="1" max="1" hidden="true"/></cols><sheetData>'),'XLSX',fields).issues[0]?.code,'HIDDEN_UNDECLARED');
 assert.equal(parseBytes(edit(part,'<worksheet ','<!DOCTYPE worksheet [<!ENTITY x "evil">]><worksheet '),'XLSX',fields).structuralStatus,'REJECTED');
});
test('AC02: hostile ZIP declared and actual expansion are bounded before row creation',()=>{
 const bytes=Buffer.from(workbook);const p=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(0x7fffffff,p+24);
 assert.equal(parseBytes(bytes,'XLSX',fields).issues[0]?.code,'ZIP_LIMIT');
 const raw=Buffer.alloc(3*1024*1024,65),packed=deflateRawSync(raw),name=Buffer.from('xl/worksheets/sheet1.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 const offset=local.length+name.length+packed.length;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(offset,16);
 const bomb=Buffer.concat([local,name,packed,central,name,end]);assert.equal(parseBytes(bomb,'XLSX',fields).issues[0]?.code,'ZIP_LIMIT');
});
test('protected issue workbook always emits original dangerous text as inline strings without formulas',()=>{
 const result=parse('code,label\n0012," =HYPERLINK(""x"")"');const bytes=issueWorkbook(result),xml=unzip(bytes).get('xl/worksheets/sheet1.xml')!;
 assert.ok(xml.includes('=HYPERLINK'));assert.ok(!xml.includes('<f'));assert.ok(xml.includes('t="inlineStr"'));assert.equal(result.cells.at(-1)?.value,' =HYPERLINK("x")');
});
test('decoded JSON controls and wrong XML namespaces cannot become canonical values',()=>{
 assert.equal(parseBytes(Buffer.from('[{"code":"0012","label":"DEMO\\u0000"}]'),'JSON',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','http://schemas.openxmlformats.org/spreadsheetml/2006/main','urn:unrelated'),'XLSX',fields).structuralStatus,'REJECTED');
 const literal=parseBytes(textWorkbook([['code','label'],['0012','_x0041_']]),'XLSX',fields);assert.equal(literal.rows[0]?.['label'],'_x0041_','literal OOXML escape pattern survives Excel text encoding');
});
test('final review: XLSX text leaves and structural containers never discard nested/nonempty content',()=>{
 for(const [from,to] of [
  ['>0012</t>','>0012<r>UNDECLARED_NONEMPTY</r></t>'],
  ['<row r="2">','<row r="2">UNDECLARED_NONEMPTY'],
  ['<sheetData>','<sheetViews><sheetView><c>UNDECLARED_NONEMPTY</c></sheetView></sheetViews><sheetData>'],
 ])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml',from!,to!),'XLSX',fields).structuralStatus,'REJECTED');
});
