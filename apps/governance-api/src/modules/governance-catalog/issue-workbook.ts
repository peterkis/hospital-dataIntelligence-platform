import { crc32 } from 'node:zlib';
import type { ParserResult } from './file-parser.js';

/** ZIP32 stored members: no formulas, macros, URLs or executable workbook parts. */
export function zipText(files:Record<string,string>):Buffer {
  const local:Buffer[]=[];const central:Buffer[]=[];let offset=0;
  for(const [name,text] of Object.entries(files)) {
    const n=Buffer.from(name),raw=Buffer.from(text),crc=crc32(raw),h=Buffer.alloc(30),c=Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(raw.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(raw.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(h,n,raw);central.push(c,n);offset+=h.length+n.length+raw.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  const result=Buffer.concat([...local,directory,end]);if(result.length>1048576)throw new Error('REPORT_LIMIT');return result;
}
const escape=(text:string)=>text.replace(/_x[0-9a-f]{4}_/gi,match=>'_x005F_'+match.slice(1))
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,c=>`_x${c.charCodeAt(0).toString(16).padStart(4,'0')}_`)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/\r/g,'&#13;');
export function textWorkbook(rows:string[][]):Buffer {
  const sheet=rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>{let n=c+1,name='';while(n){n--;name=String.fromCharCode(65+n%26)+name;n=Math.floor(n/26);}return `<c r="${name}${r+1}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;}).join('')}</row>`).join('');
  return zipText({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}
export function issueWorkbook(result:ParserResult):Buffer {
  if(!['STRICT_V1','STRICT_V2'].includes(result.policy)||!Array.isArray(result.issues)||!Array.isArray(result.cells)||result.issues.length>1000||result.cells.length>100000)throw new Error('PARSER_RESULT_REQUIRED');
  return textWorkbook([['issue','row','column','originalValue'],...result.issues.map(issue=>[issue.code,String(issue.row),String(issue.column),result.cells.find(c=>c.row===issue.row&&c.column===issue.column)?.value??''])]);
}
