import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parseBytes, unzip } from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import { textWorkbook, zipText, issueWorkbook } from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
const fields=[{code:'code',type:'code'},{code:'label',type:'text'}];
const parse=(text:string)=>parseBytes(Buffer.from(text),'CSV',fields);
const workbook=textWorkbook([['code','label'],['0012','DEMO']]);
const edit=(part:string,from:string,to:string)=>{const files=Object.fromEntries(unzip(workbook));files[part]=files[part]!.replace(from,to);return zipText(files);};
test('PR6 round24: row gaps identify valid declared worksheet rows',()=>{
 assert.deepEqual(parseBytes(edit('xl/worksheets/sheet1.xml','<row r="1">','<row r="5">'),'XLSX',fields).issues[0],{code:'ROW_GAP',row:5,column:0});
});
test('PR6 round24: rejected JSON scalars retain source lexemes in protected reports',()=>{
 for(const lexeme of ['12','-12.30e+2','null','true','false']){
  const result=parseBytes(Buffer.from('[{"code":'+lexeme+',"label":"safe"}]'),'JSON',fields);
  assert.equal(result.issues[0]?.code,'TEXT_CELL_REQUIRED');assert.deepEqual(result.rows,[]);
  assert.equal(result.cells[0]?.value,lexeme);
  const report=parseBytes(issueWorkbook(result),'XLSX',['issue','row','column','originalValue'].map(code=>({code,type:'text'})));
  assert.equal(report.rows[0]?.['originalValue'],lexeme);
 }
});
test('PR6 round22: CSV row limit identifies multiline record start',()=>{
 for(const suffix of ['', '\n'])assert.equal(parse('code,label\n'+'0012,safe\n'.repeat(1000)+'0012,"start\nend"'+suffix).issues[0]?.row,1002);
});
test('PR6 round22: quoted CR and CRLF each advance one physical line',()=>{
 for(const newline of ['\r','\r\n','\n']){
  const prefix='code,label\n0012,"first'+newline+'second"\n';
  assert.deepEqual(parse(prefix+'BROKEN').issues[0],{code:'FIELD_CONTRACT',row:4,column:0});
  const result=parse(prefix+'0013,safe');assert.equal(result.structuralStatus,'PARSED');assert.equal(result.cells.find(c=>c.row===2)?.sourceRow,4);
 }
});
test('PR6 round22: XLSX limits retain worksheet coordinates',()=>{
 const columns=textWorkbook([Array.from({length:101},(_,i)=>'field'+i)]);
 assert.deepEqual(parseBytes(columns,'XLSX',fields).issues[0],{code:'COLUMN_LIMIT',row:1,column:101});
 const rows=textWorkbook([['code','label'],...Array.from({length:1001},()=>['0012','safe'])]);
 assert.deepEqual(parseBytes(rows,'XLSX',fields).issues[0],{code:'ROW_LIMIT',row:1002,column:0});
});
test('PR6 round21: decoded field names reject unsafe text before matching',()=>{
 for(const code of ['a\ufeffb','a\u0001b','a\ufffeb','a\uffffb','a\ud800b']){
  const contract=[{code,type:'text'}];
  for(const selected of [contract,[{code:'other',type:'text'}]]){
   const result=parseBytes(Buffer.from(JSON.stringify([{[code]:'safe'}])),'JSON',selected);
   assert.equal(result.structuralStatus,'REJECTED');assert.notEqual(result.issues[0]?.code,'FIELD_CONTRACT');
  }
  if(!code.includes('\ud800'))assert.equal(parseBytes(Buffer.from(code+'\nsafe'),'CSV',contract).structuralStatus,'REJECTED');
 }
});
test('PR6 round20: integer-like codes preserve lexical source columns and XLSX types',()=>{
 const numericFields=[{code:'2',type:'text'},{code:'10',type:'text'}];
 const csvResult=parseBytes(Buffer.from('10,2\nfirst,second'),'CSV',numericFields);
 const jsonResult=parseBytes(Buffer.from('[{"10":"first","2":"second"},{"2":"second","10":"first"}]'),'JSON',numericFields);
 const files=Object.fromEntries(unzip(sharedFixture('unused')));
 files['xl/worksheets/sheet1.xml']=files['xl/worksheets/sheet1.xml']!.replace('>code<','>10<').replace('>label<','>2<');
 const xlsxResult=parseBytes(zipText(files),'XLSX',numericFields);
 for(const result of [csvResult,jsonResult,xlsxResult]){assert.equal(result.structuralStatus,'PARSED');assert.equal(result.cells.find(c=>c.row===1&&c.field==='10')?.column,1);assert.equal(result.cells.find(c=>c.row===1&&c.field==='2')?.column,2);}
 assert.equal(jsonResult.cells.find(c=>c.row===2&&c.field==='2')?.column,1);
 assert.equal(jsonResult.cells.find(c=>c.row===2&&c.field==='10')?.column,2);
 assert.equal(xlsxResult.cells.find(c=>c.field==='10')?.sourceType,'s');assert.equal(xlsxResult.cells.find(c=>c.field==='2')?.sourceType,'inlineStr');
});
test('PR6 round18: multiline CSV limits identify the starting physical row',()=>{
 for(const value of ['a'.repeat(8192),'😀'.repeat(8192)])for(const suffix of ['',',next','\n'])assert.deepEqual(parse('code,label\n0012,"start\n'+value+'"'+suffix).issues[0],{code:'CELL_LIMIT',row:2,column:2});
 assert.deepEqual(parse('code,label\n"start\nend",'+Array.from({length:100},()=> 'value').join(',')).issues[0],{code:'COLUMN_LIMIT',row:2,column:101});
});
test('PR6 round17: protected issue workbook preserves CR and CRLF values',()=>{
 for(const value of ['left\rright','left\r\nright','literal&#13;_x000d_']){
  const result=parse('code,label\n0012,"'+value+'"');assert.equal(result.structuralStatus,'PARSED');
  result.issues.push({code:'TEST_ISSUE',row:1,column:2});
  const report=parseBytes(issueWorkbook(result),'XLSX',['issue','row','column','originalValue'].map(code=>({code,type:'text'})));
  assert.equal(report.structuralStatus,'PARSED');assert.equal(report.rows[0]?.['originalValue'],value);
 }
});
test('PR6 round17: CSV value and column limits identify field ordinals',()=>{
 for(const value of ['a'.repeat(8193),'😀'.repeat(8193)])for(const suffix of ['',',next','\n'])assert.deepEqual(parse('code,label\n0012,'+value+suffix).issues[0],{code:'CELL_LIMIT',row:2,column:2});
 assert.deepEqual(parse(Array.from({length:101},(_,i)=>'field'+i).join(',')).issues[0],{code:'COLUMN_LIMIT',row:1,column:101});
});
test('PR6 round17: XML literal CR normalizes before references are decoded',()=>{
 for(const [xmlValue,expected] of [['left\rright','left\nright'],['left\r\nright','left\nright'],['left&#13;right','left\rright']]){
  const inline=parseBytes(edit('xl/worksheets/sheet1.xml','DEMO',xmlValue!),'XLSX',fields);
  assert.equal(inline.structuralStatus,'PARSED');assert.equal(inline.rows[0]?.['label'],expected);
  const files=Object.fromEntries(unzip(sharedFixture('unused')));files['xl/sharedStrings.xml']=files['xl/sharedStrings.xml']!.replace('<t>0012</t>','<t>'+xmlValue+'</t>');
  const shared=parseBytes(zipText(files),'XLSX',fields);assert.equal(shared.structuralStatus,'PARSED');assert.equal(shared.rows[0]?.['code'],expected);
 }
});
test('PR6 round16: cols requires at least one col',()=>{
 for(const metadata of ['<cols/>','<cols></cols>'])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',metadata+'<sheetData>'),'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 round16: value limits count Unicode code points across formats',()=>{
 for(const value of ['😀'.repeat(8192),'a'.repeat(8191)+'😀','😀'.repeat(8193),'a'.repeat(8192)+'😀']){
  const expected=[...value].length<=8192?'PARSED':'REJECTED';
  const results=[parse('code,label\n0012,'+value),parseBytes(Buffer.from(JSON.stringify([{code:'0012',label:value}])),'JSON',fields),parseBytes(textWorkbook([['code','label'],['0012',value]]),'XLSX',fields),parseBytes(sharedFixture(value),'XLSX',fields)];
  for(const result of results){assert.equal(result.structuralStatus,expected);if(expected==='REJECTED')assert.equal(result.issues[0]?.code,'CELL_LIMIT');}
 }
});
test('PR6 round15: supported worksheet children retain their required sequence',()=>{
 const cols='<cols><col min="1" max="2" hidden="0"/></cols>',format='<sheetFormatPr zeroHeight="0"/>';
 for(const metadata of [cols,format])assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','</worksheet>',metadata+'</worksheet>'),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',cols+format+'<sheetData>'),'XLSX',fields).structuralStatus,'REJECTED');
 assert.equal(parseBytes(edit('xl/worksheets/sheet1.xml','<sheetData>',format+cols+'<sheetData>'),'XLSX',fields).structuralStatus,'PARSED');
});
test('PR6 round14: paired ZIP header time, date and needed version must agree',()=>{
 const central=workbook.readUInt32LE(workbook.length-22+16);
 for(const [localOffset,centralOffset,value] of [[10,12,1],[12,14,33],[4,6,10]] as const){
  const bytes=Buffer.from(workbook);bytes.writeUInt16LE(value,localOffset);
  assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'REJECTED');
  bytes.writeUInt16LE(value,central+centralOffset);assert.equal(parseBytes(bytes,'XLSX',fields).structuralStatus,'PARSED');
 }
});
function deflatedWorksheet(suffix:Buffer,padding=0):Buffer {
 const files=Object.fromEntries(unzip(workbook)),part='xl/worksheets/sheet1.xml';files[part]=files[part]!.replace('<sheetData>',' '.repeat(padding)+'<sheetData>');
 const bytes=zipText(files),end=bytes.length-22,central=bytes.readUInt32LE(end+16);let entry=central;
 while(bytes.subarray(entry+46,entry+46+bytes.readUInt16LE(entry+28)).toString()!==part)entry+=46+bytes.readUInt16LE(entry+28);
 const local=bytes.readUInt32LE(entry+42),start=local+30+bytes.readUInt16LE(local+26),size=bytes.readUInt32LE(local+22);
 assert.equal(start+size,central,'fixture worksheet is last local member');
 const packed=Buffer.concat([deflateRawSync(bytes.subarray(start,start+size)),suffix]);
 const prefix=Buffer.from(bytes.subarray(0,start)),directory=Buffer.from(bytes.subarray(central,end)),footer=Buffer.from(bytes.subarray(end));
 prefix.writeUInt16LE(8,local+8);prefix.writeUInt32LE(packed.length,local+18);directory.writeUInt16LE(8,entry-central+10);directory.writeUInt32LE(packed.length,entry-central+20);footer.writeUInt32LE(central+packed.length-size,16);
 return Buffer.concat([prefix,packed,directory,footer]);
}
test('PR6 round13: inflater consumes the entire declared compressed member',()=>{
 assert.equal(parseBytes(deflatedWorksheet(Buffer.alloc(0)),'XLSX',fields).structuralStatus,'PARSED');
 for(const suffix of [Buffer.from('HIDDEN_SUFFIX'),Buffer.from([0,1,2,3])])assert.equal(parseBytes(deflatedWorksheet(suffix),'XLSX',fields).structuralStatus,'REJECTED');
});
test('PR6 round13: trailing compressed padding cannot weaken ratio admission',()=>{
 assert.equal(parseBytes(deflatedWorksheet(Buffer.alloc(0),100000),'XLSX',fields).issues[0]?.code,'ZIP_LIMIT');
 assert.equal(parseBytes(deflatedWorksheet(Buffer.alloc(2048),100000),'XLSX',fields).structuralStatus,'REJECTED');
});
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
  assert.equal(result.issues[0]?.code,value==='true'?'TEXT_CELL_REQUIRED':'JSON_SCALAR_REQUIRED');assert.equal(result.issues[0]?.row,2);assert.equal(result.issues[0]?.column,2);
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
