import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parseBytes, unzip } from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import { textWorkbook, zipText, issueWorkbook } from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
const fields=[{code:'code',type:'code'},{code:'label',type:'text'}];
const parse=(text:string)=>parseBytes(Buffer.from(text),'CSV',fields);
const workbook=textWorkbook([['code','label'],['0012','DEMO']]);
const edit=(part:string,from:string,to:string)=>{const files=Object.fromEntries(unzip(workbook));files[part]=files[part]!.replace(from,to);return zipText(files);};
function sharedFixture(unused:string){
 const files=Object.fromEntries(unzip(workbook));
 files['[Content_Types].xml']=files['[Content_Types].xml']!.replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
 files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels']!.replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
 files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml']!.replace('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0012</t></is></c>','<c r="A2" t="s"><v>0</v></c>');
 files['xl/sharedStrings.xml']=`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="2"><si><t>0012</t></si><si><t>${unused}</t></si></sst>`;
 return zipText(files);
}
test('PR6 round12: unused shared strings are decoded and bounded before admission',()=>{
 for(const unused of ['_x0000_','_xFEFF_','_xD800_','x'.repeat(8193)])assert.equal(parseBytes(sharedFixture(unused),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(sharedFixture('unused'),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round12: original XLSX representation survives canonical conversion',()=>{
 const result=parseBytes(sharedFixture('unused'),'XLSX',fields);
 assert.equal(result.cells.find(c=>c.field==='code')?.sourceType,'s');assert.equal(result.cells.find(c=>c.field==='label')?.sourceType,'inlineStr');
 assert.deepEqual(result.rows,parse('code,label\n0012,DEMO').rows);
 const files=Object.fromEntries(unzip(sharedFixture('unused')));
 files['xl/sharedStrings.xml']=files['xl/sharedStrings.xml']!.replace('<t>0012</t>','<t>_x005F_x0041_</t>');
 const literal=parseBytes(zipText(files),'XLSX',fields);assert.equal(literal.rows[0]?.['code'],'_x0041_','shared text is decoded once');
 files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml']!.replace('>code</t>','>temporary</t>').replace('>label</t>','>code</t>').replace('>temporary</t>','>label</t>');
 const reordered=parseBytes(zipText(files),'XLSX',fields);assert.equal(reordered.cells.find(c=>c.field==='label')?.sourceType,'s');assert.equal(reordered.cells.find(c=>c.field==='code')?.sourceType,'inlineStr');
});
test('PR6 round11: relationship TargetMode must be absent or exactly Internal',()=>{
 for(const part of ['_rels/.rels','xl/_rels/workbook.xml.rels'])for(const mode of ['', 'internal',' Internal','invalid'])assert.equal(parseBytes(edit(part,'<Relationship Id=',`<Relationship TargetMode="${mode}" Id=`),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('_rels/.rels','<Relationship Id=','<Relationship TargetMode="Internal" Id='),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round11: local datetime calendar and clock components are real',()=>{
 const field=[{code:'time',type:'datetime'}];
 for(const value of ['2026-13-40T25:61:61','2025-02-29T00:00:00','1900-02-29T00:00:00','2026-04-31T00:00:00','2026-01-01T24:00:00'])assert.equal(parseBytes(Buffer.from(`time\n${value}`),'CSV',field).structuralStatus,'REJECTED');
 const value='2000-02-29T23:59:59.123456';const parsed=parseBytes(Buffer.from(`time\n${value}`),'CSV',field);assert.equal(parsed.structuralStatus,'PARSED');assert.equal(parsed.rows[0]?.['time'],value);
});
test('PR6 round10: rejected JSON values retain their object and property ordinal',()=>{
 for(const value of ['true','[]','{}']){
  const result=parseBytes(Buffer.from(`[{"code":"0012","label":"ok"},{"code":"0013","label":${value}}]`),'JSON',fields);
  assert.equal(result.issues[0]?.code,'JSON_SCALAR_REQUIRED');assert.equal(result.issues[0]?.row,2);assert.equal(result.issues[0]?.column,2);
 }
});
test('PR6 round10: present visibility values require exact enums',()=>{
 for(const value of ['', 'invalid','FALSE',' 0'])for(const bytes of [
  edit('xl/workbook.xml','name="Data"',`name="Data" state="${value}"`),
  edit('xl/worksheets/sheet1.xml','<row r="2">',`<row r="2" hidden="${value}">`),
  edit('xl/worksheets/sheet1.xml','<sheetData>',`<cols><col min="1" max="1" hidden="${value}"/></cols><sheetData>`),
 ])assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
 for(const value of ['0','false'])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<row r="2">',`<row r="2" hidden="${value}">`),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round9: unsupported worksheet and workbook metadata nodes reject',()=>{
 for(const node of ['<dimension ref="nonsense"/>','<pageMargins/>','<sheetViews/>','<sheetFormatPr/>'])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',node+'<sheetData>'),'XLSX',fields).structuralStatus,'REJECTED');
 for(const node of ['<workbookPr/>','<bookViews/>','<calcPr/>'])assert.equal(parseBytes(edit('xl/workbook.xml','<sheets>',node+'<sheets>'),'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 round9 adjacent: relationship IDs must be valid XML names',()=>{
 assert.equal(parseBytes(edit('_rels/.rels','Id="rId1"','Id="bad id"'),'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 round8: accepted XLSX member BOMs are recorded without changing source bytes',()=>{
 const files=Object.fromEntries(unzip(workbook));const part='xl/worksheets/sheet1.xml';files[part]='\uFEFF'+files[part];
 const result=parseBytes(zipText(files),'XLSX',fields);assert.equal(result.structuralStatus,'PARSED');assert.equal(result.manifest.bomDetected,true);
 assert.deepEqual(result.manifest.bomMembers,[part]);
});
test('PR6 round8 adjacent: declaration whitespace cannot consume an interior BOM',()=>{
 for(const declaration of ['<?xml \uFEFFversion="1.0"?>','<?xml version="1.0"\uFEFF?>']){
  assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<worksheet ',declaration+'<worksheet '),'XLSX',fields).structuralStatus,'REJECTED');
 }
});
test('PR6 round8 adjacent: XML lexical whitespace and character data remain strict',()=>{
 for(const [from,to] of [['<worksheet ','\u00a0<worksheet '],['<worksheet ','&#32;<worksheet '],['<row r="2">','<row\u00a0r="2">'],['<sheetData>','<dimension ref="&#65534;"/><sheetData>'],['DEMO','DEMO]]>']]){
  assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml',from!,to!),'XLSX',fields).structuralStatus,'REJECTED');
 }
});
test('PR6 round8: worksheet column ranges are required, bounded and ordered',()=>{
 for(const attrs of ['min="999999" max="1"','min="2" max="1"','min="0" max="1"','min="1"','min="x" max="2"','min="1" max="16385"'])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',`<cols><col ${attrs} hidden="0"/></cols><sheetData>`),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>','<cols><col min="1" max="16384" hidden="0"/></cols><sheetData>'),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round7: sheetId is required and a positive unsigned integer',()=>{
 for(const replacement of ['', 'sheetId="0"','sheetId="-1"','sheetId="nonsense"','sheetId="4294967296"'])assert.equal(parseBytes(edit('xl/workbook.xml','sheetId="1"',replacement),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/workbook.xml','sheetId="1"','sheetId="17"'),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round7: optional shared-string counts match actual entries and references',()=>{
 const files=Object.fromEntries(unzip(workbook));
 files['[Content_Types].xml']=files['[Content_Types].xml']!.replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
 files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels']!.replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
 files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml']!.replace('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0012</t></is></c>','<c r="A2" t="s"><v>0</v></c>');
 for(const [attrs,expected] of [['count="nonsense" uniqueCount="999"','REJECTED'],['count="1" uniqueCount="2"','REJECTED'],['count="2" uniqueCount="1"','REJECTED'],['count="-1"','REJECTED'],['count="1" uniqueCount="1"','PARSED'],['','PARSED']]){
  files['xl/sharedStrings.xml']=`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${attrs}><si><t>0012</t></si></sst>`;
  assert.equal(parseBytes(zipText(files),'XLSX',fields).structuralStatus,expected);
 }
});
test('PR6 round6: unqualified attributes are closed for every supported XLSX element',()=>{
 for(const [part,from,to] of [
  ['xl/worksheets/sheet1.xml','<row r="2">','<row r="2" mystery="payload">'],
  ['xl/worksheets/sheet1.xml','<c r="A2"','<c mystery="payload" r="A2"'],
  ['xl/worksheets/sheet1.xml','<t xml:space','<t mystery="payload" xml:space'],
  ['xl/workbook.xml','<workbook ','<workbook mystery="payload" '],
  ['xl/worksheets/sheet1.xml','<sheetData>','<sheetFormatPr zeroHeight="0" mystery="payload"/><sheetData>'],
 ])assert.equal(parseBytes(edit(part!,from!,to!),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(workbook,'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round5: table-width errors after multiline CSV retain physical record start',()=>{
 const result=parse('code,label\n0012,"first\nsecond"\nBROKEN');assert.equal(result.issues[0]?.code,'FIELD_CONTRACT');assert.equal(result.issues[0]?.row,4);
});
test('PR6 round5: worksheet default hidden rows are manifested and rejected',()=>{
 for(const flag of ['1','true']){
  const result=parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',`<sheetFormatPr zeroHeight="${flag}"/><sheetData>`),'XLSX',fields);
  assert.equal(result.structuralStatus,'REJECTED');assert.deepEqual(result.manifest.hiddenRows,[1,2]);
 }
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>','<sheetFormatPr zeroHeight="0"/><sheetData>'),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round5 adjacent: repeated singleton metadata cannot override hidden defaults',()=>{
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>','<sheetFormatPr zeroHeight="1"/><sheetFormatPr zeroHeight="0"/><sheetData>'),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/workbook.xml','<sheets>','<workbookPr/><workbookPr/><sheets>'),'XLSX',fields).structuralStatus,'REJECTED');
 const result=parse('code,label\n0012,"first\nsecond"\n0013,DEMO');
 assert.equal(result.cells.find(c=>c.row===2)?.sourceRow,4);
});
test('PR6 round5: declared foreign namespaces and unsupported qualified attributes reject',()=>{
 for(const attributes of ['xmlns:evil="urn:evil" evil:attr="payload"','xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:unknown="payload"']){
  assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<worksheet ',`<worksheet ${attributes} `),'XLSX',fields).structuralStatus,'REJECTED');
 }
});
test('PR6 round4: unsupported optional XLSX parts reject even with matching declarations',()=>{
 for(const [part,mime] of [
  ['xl/styles.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
  ['docProps/core.xml','application/vnd.openxmlformats-package.core-properties+xml'],
  ['docProps/app.xml','application/vnd.openxmlformats-officedocument.extended-properties+xml'],
 ]){
  const files=Object.fromEntries(unzip(workbook));files[part!]='<evil xmlns="urn:not-spreadsheet">ignored</evil>';
  files['[Content_Types].xml']=files['[Content_Types].xml']!.replace('</Types>',`<Override PartName="/${part}" ContentType="${mime}"/></Types>`);
  assert.equal(parseBytes(zipText(files),'XLSX',fields).structuralStatus,'REJECTED');
 }
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<c r="A2"','<c s="1" r="A2"'),'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 round3: XML attribute and element prefixes must be declared and reserved bindings remain fixed',()=>{
 for(const bytes of [
  edit('xl/worksheets/sheet1.xml','<row r="2">','<row r="2" evil:attr="x">'),
  edit('xl/workbook.xml','<sheets>','<sheets evil:attr="x">'),
  edit('xl/worksheets/sheet1.xml','<worksheet ','<worksheet xmlns:xml="urn:wrong" '),
  edit('xl/worksheets/sheet1.xml','<row r="2">','<row r="2" evil:more:attr="x">'),
 ])assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(workbook,'XLSX',fields).structuralStatus,'PARSED','implicit xml:space and declared r:id remain legal');
});
test('PR6 round3 adjacent: empty namespace prefixes and duplicate expanded attribute names reject',()=>{
 for(const attributes of ['xmlns:="urn:invalid"','xmlns:a="urn:same" xmlns:b="urn:same" a:value="x" b:value="y"']){
  assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<worksheet ',`<worksheet ${attributes} `),'XLSX',fields).structuralStatus,'REJECTED');
 }
});
test('PR6 round2: BOM is allowed only at the file prefix, never inside decoded values',()=>{
 for(const result of [parse('code,label\n0012,a\uFEFFb'),parseBytes(Buffer.from('[{"code":"0012","label":"a\\ufeffb"}]'),'JSON',fields),parseBytes(textWorkbook([['code','label'],['0012','a\uFEFFb']]),'XLSX',fields)])assert.equal(result.structuralStatus,'REJECTED');
 assert.equal(parse('\uFEFFcode,label\n0012,DEMO').structuralStatus,'PARSED');
});
test('PR6 round2: XLSX required part MIME declarations cannot be missing, wrong or duplicated',()=>{
 const files=Object.fromEntries(unzip(workbook));files['[Content_Types].xml']='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="unrelated" ContentType="application/xml"/></Types>';
 for(const bytes of [zipText(files),edit('[Content_Types].xml','spreadsheetml.sheet.main+xml','spreadsheetml.styles+xml'),edit('[Content_Types].xml','/xl/worksheets/sheet1.xml','/xl/other.xml'),edit('[Content_Types].xml','</Types>','<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')])assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6: CSV EOF and newline forms share the 1000-row bound',()=>{
 for(const count of [1000,1001])for(const suffix of ['', '\n']){
  const result=parse('code,label\n'+Array(count).fill('0012,DEMO').join('\n')+suffix);
  assert.equal(result.structuralStatus,count===1000?'PARSED':'REJECTED');
  if(count===1001)assert.equal(result.issues[0]?.code,'ROW_LIMIT');
 }
});
test('PR6: CSV syntax failures preserve physical line and character column',()=>{
 for(const [text,row,column] of [
  ['code,label\n0012,"ok"oops',2,10],
  ['code,label\n0012,"ok\nmore"oops',3,6],
  ['code,label\n0012,"open',2,11],
  ['code,label\n0012,bad\rX',2,9],
 ] as const){const issue=parse(text).issues[0];assert.equal(issue?.code,'CSV_SYNTAX');assert.equal(issue.row,row);assert.equal(issue.column,column);}
});
test('PR6: root and workbook relationships must have unique typed targets',()=>{
 for(const bytes of [
  edit('_rels/.rels','Target="xl/workbook.xml"','Target="docProps/core.xml"'),
  edit('_rels/.rels','relationships/officeDocument','relationships/core-properties'),
  edit('_rels/.rels','</Relationships>','<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  edit('xl/_rels/workbook.xml.rels','relationships/worksheet','relationships/styles'),
 ])assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 adjacent: shared strings must be reached through their typed workbook relationship',()=>{
 const files=Object.fromEntries(unzip(workbook));
 files['xl/sharedStrings.xml']='<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>0012</t></si></sst>';
 files['[Content_Types].xml']=files['[Content_Types].xml']!.replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
 files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml']!.replace('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0012</t></is></c>','<c r="A2" t="s"><v>0</v></c>');
 assert.equal(parseBytes(zipText(files),'XLSX',fields).structuralStatus,'REJECTED');
 files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels']!.replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
 assert.equal(parseBytes(zipText(files),'XLSX',fields).structuralStatus,'PARSED');
});
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
