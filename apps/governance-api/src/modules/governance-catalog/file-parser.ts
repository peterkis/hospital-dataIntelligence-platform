import { inflateRawSync, crc32 } from 'node:zlib';
import { parentPort, workerData, isMainThread } from 'node:worker_threads';
// Resolve the same platform primitive in native TS test workers and compiled JS workers.
const {parseLocalDateTime}:typeof import('../../platform/local-datetime/local-datetime.js') = await import(
  new URL(import.meta.url.endsWith('.ts')?'../../platform/local-datetime/local-datetime.ts':'../../platform/local-datetime/local-datetime.js',import.meta.url).href,
);

export type FileFormat = 'CSV' | 'JSON' | 'XLSX';
type XlsxCellType='inlineStr'|'s';
export interface ParserField { code: string; type: string }
export interface ParserIssue { code: string; row: number; column: number; sheet?: string }
export type CanonicalRow = Record<string,string>;
export interface RawCellProvenance {row:number;sourceRow:number;column:number;field:string;value:string;sourceType:'CSV'|'JSON'|XlsxCellType}
export interface ParserResult {
  policy: 'STRICT_V1' | 'STRICT_V2'; structuralStatus: 'PARSED' | 'REJECTED';
  manifest: { bomDetected: boolean; bomMembers:string[]; defaultRowsHidden:boolean; hiddenSheets: string[]; hiddenRows: number[]; hiddenColumns: string[] };
  rows: CanonicalRow[];
  cells: RawCellProvenance[];
  issues: ParserIssue[];
}
class ParseFailure extends Error {
  readonly code: string;
  readonly row: number;
  readonly column: number;
  readonly sheet: string | undefined;
  constructor(code: string, row = 0, column = 0, sheet?: string) { super(code); this.code=code; this.row=row; this.column=column; this.sheet=sheet; }
}
const fail = (code: string, row = 0, column = 0, sheet?: string): never => { throw new ParseFailure(code, row, column, sheet); };
function exceedsCellLimit(value:string):boolean {
  let count=0;for(const character of value){if(++count>8192)return true;}
  return false;
}
function utf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail('INVALID_UTF8'); }
}

// Fixed RFC 4180 dialect; no delimiter guessing or silent empty-row removal.
function csv(text: string): {rows:string[][];physicalRows:number[]} {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false; let closed = false;
  const physicalRows:number[]=[];let recordStart=1;
  let physicalRow=1,physicalColumn=1;
  const syntax=()=>fail('CSV_SYNTAX',physicalRow,physicalColumn);
  const cell = () => { const column=row.length+1; if(exceedsCellLimit(value))fail('CELL_LIMIT',recordStart,column); if(column>100)fail('COLUMN_LIMIT',recordStart,column); row.push(value); value = ''; closed = false; };
  const record=()=>{rows.push(row);physicalRows.push(recordStart);row=[];if(rows.length>1001)fail('ROW_LIMIT',recordStart);};
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    let finishedRecord=false;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; physicalColumn++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      cell();
      if (c !== ',') { if (c === '\r') { if (text[i+1] !== '\n') syntax(); i++; } record(); finishedRecord=true; }
    } else if (c === '"' && !value && !closed) quoted = true;
    else { if (closed || c === '"') syntax(); value += c; }
    // A code point occupies at most two UTF-16 units; exact counting happens once per cell.
    if (value.length > 16384) fail('CELL_LIMIT',recordStart,row.length+1);
    if(c==='\n'||c==='\r'&&(!quoted||text[i+1]!=='\n')){physicalRow++;physicalColumn=1;}else physicalColumn++;
    if(finishedRecord)recordStart=physicalRow;
  }
  if (quoted) syntax();
  if (value || row.length || closed) { cell(); record(); }
  return {rows,physicalRows};
}

// Only an array of flat objects is accepted. Tokenize keys before object construction,
// so escaped duplicate keys cannot disappear through JSON.parse's last-write behavior.
interface SourceObject { values:Record<string,string|{lexeme:string}>; columns:string[] }
function jsonRows(text: string): SourceObject[] {
  let i = 0; const rows: SourceObject[] = [];
  let currentRow=0,currentColumn=0;
  const jsonFailure=(code:string):never=>fail(code,currentRow,currentColumn);
  const ws = () => { while (/^[\x20\t\r\n]$/.test(text[i] ?? '')) i++; };
  const expect = (c: string) => { ws(); if (text[i++] !== c) jsonFailure('JSON_SYNTAX'); };
  const string = (): string => {
    ws(); const start = i; if (text[i++] !== '"') return jsonFailure('JSON_SYNTAX');
    while (i < text.length) { const c = text[i++]; if (c === '\\') i++; else if (c === '"') {
      try { const value: string = JSON.parse(text.slice(start, i)); if (exceedsCellLimit(value)) jsonFailure('CELL_LIMIT'); return value; } catch (e) { if (e instanceof ParseFailure) throw e; return jsonFailure('JSON_SYNTAX'); }
    } }
    return jsonFailure('JSON_SYNTAX');
  };
  expect('['); ws();
  while (text[i] !== ']') {
    currentRow=rows.length+1;currentColumn=0;
    expect('{'); const row: Record<string,string|{lexeme:string}> = Object.create(null); const columns:string[]=[]; ws();
    while (text[i] !== '}') {
      currentColumn=Object.keys(row).length+1;
      const key = string(); assertTextSafety(key,currentRow,currentColumn); if (Object.hasOwn(row, key)) jsonFailure('DUPLICATE_FIELD'); columns.push(key); expect(':'); ws();
      if (text[i] === '"') row[key] = string();
      else {
        const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
        if (!match) return jsonFailure('JSON_SCALAR_REQUIRED');
        // Preserve bounded rejected scalar evidence without numeric coercion.
        if(exceedsCellLimit(match[0]))jsonFailure('CELL_LIMIT');
        row[key] = {lexeme:match[0]}; i += match[0].length;
      }
      if (Object.keys(row).length > 100) jsonFailure('COLUMN_LIMIT'); ws();
      if (text[i] !== ',') break; i++; ws(); if (text[i] === '}') jsonFailure('JSON_SYNTAX');
    }
    expect('}'); rows.push({values:row,columns}); if (rows.length > 1000) jsonFailure('ROW_LIMIT'); currentRow=0;currentColumn=0;ws();
    if (text[i] !== ',') break; i++; ws(); if (text[i] === ']') jsonFailure('JSON_SYNTAX');
  }
  expect(']'); ws(); if (i !== text.length) jsonFailure('JSON_SYNTAX'); return rows;
}

export function unzip(bytes: Uint8Array, organization=false): Map<string, string> {
  const b = Buffer.from(bytes); const files = new Map<string, string>();
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return fail('ZIP_FORMAT');
  // Fixed ZIP32 package, no comments, multidisk, encryption or ZIP64.
  const end = b.length - 22;
  if (b.readUInt32LE(end) !== 0x06054b50 || b.readUInt32LE(end + 4) !== 0 || b.readUInt16LE(end + 20) !== 0) fail('ZIP_FORMAT');
  const count = b.readUInt16LE(end + 10); let p = b.readUInt32LE(end + 16); const central = p;
  if (!count || count > 16 || b.readUInt16LE(end + 8) !== count || p + b.readUInt32LE(end + 12) !== end) fail('ZIP_LIMIT');
  let total = 0; let nextLocal = 0;
  for (let entry = 0; entry < count; entry++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) fail('ZIP_FORMAT');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16);
    const compressed = b.readUInt32LE(p + 20), size = b.readUInt32LE(p + 24);
    const nameSize = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    if ((flags & ~0x800) || ![0, 8].includes(method) || extra || comment || b.readUInt16LE(p + 34)) fail('ZIP_UNSUPPORTED');
    const neededVersion=b.readUInt16LE(p+6);
    if(method===0?![10,20].includes(neededVersion):neededVersion!==20)fail('ZIP_UNSUPPORTED');
    if (p + 46 + nameSize > end) fail('ZIP_FORMAT');
    const nameBytes = b.subarray(p + 46, p + 46 + nameSize), name = utf8(nameBytes);
    if (!['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml','xl/sharedStrings.xml'].includes(name) && !(organization && /^xl\/worksheets\/sheet[1-9][0-9]{0,3}\.xml$/u.test(name)) || files.has(name)) fail('ZIP_MEMBER_REJECTED');
    total += size;
    if (size > 2097152 || total > 4194304 || size > Math.max(1, compressed) * 100) fail('ZIP_LIMIT');
    if (local !== nextLocal || local + 30 > central || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 4) !== b.readUInt16LE(p + 6) || b.readUInt16LE(local + 10) !== b.readUInt16LE(p + 12) || b.readUInt16LE(local + 12) !== b.readUInt16LE(p + 14) || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method || b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== compressed || b.readUInt32LE(local + 22) !== size || b.readUInt16LE(local + 26) !== nameSize || b.readUInt16LE(local + 28) !== 0) fail('ZIP_FORMAT');
    const start = local + 30 + nameSize; nextLocal = start + compressed;
    if (nextLocal > central || !b.subarray(local + 30, start).equals(nameBytes)) fail('ZIP_FORMAT');
    const payload = b.subarray(start, nextLocal);
    let raw: Buffer;let consumed=payload.length;
    try {
      if(method===0)raw=payload;
      else {
        // Node's info mode exposes actual consumed input; installed typings omit this overload.
        const decoded:unknown=inflateRawSync(payload,{maxOutputLength:Math.max(1,size),info:true});
        if(decoded===null||typeof decoded!=='object'||!('buffer' in decoded)||!Buffer.isBuffer(decoded.buffer)||!('engine' in decoded)||decoded.engine===null||typeof decoded.engine!=='object'||!('bytesWritten' in decoded.engine)||typeof decoded.engine.bytesWritten!=='number')return fail('ZIP_INTEGRITY');
        raw=decoded.buffer;consumed=decoded.engine.bytesWritten;
      }
    } catch { return fail('ZIP_LIMIT'); }
    if(consumed!==payload.length)fail('ZIP_INTEGRITY');
    if (raw.length !== size || crc32(raw) !== crc) fail('ZIP_INTEGRITY');
    files.set(name, utf8(raw)); p += 46 + nameSize;
  }
  if (p !== end || nextLocal !== central) fail('ZIP_FORMAT'); return files;
}

interface Xml { name: string; attrs: Record<string, string>; children: Xml[]; text: string }
// The fixed text-only package admits only attributes whose semantics it supports.
// Unimplemented view/calculation containers and settings reject.
const xmlAttributes:Record<string,readonly string[]>={
  Types:[],Default:['Extension','ContentType'],Override:['PartName','ContentType'],
  Relationships:[],Relationship:['Id','Type','Target','TargetMode'],
  workbook:[],sheets:[],sheet:['name','sheetId','state'],
  worksheet:[],sheetFormatPr:['zeroHeight'],
  cols:[],col:['min','max','hidden'],sheetData:[],row:['r','hidden'],c:['r','t'],v:[],is:[],t:[],sst:['count','uniqueCount'],si:[],
};
function entities(text: string): string {
  return text.replace(/&([^;]*);|&/g, (whole, name: string | undefined) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && Object.hasOwn(predefined, name)) return predefined[name]!;
    if (name && /^#(?:x[0-9a-fA-F]+|\d+)$/.test(name)) {
      const value = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if(value===0xfeff)fail('BOM_NOT_PREFIX');
      if (value === 9 || value === 10 || value === 13 || value>=0x20&&value<=0xd7ff || value>=0xe000&&value<=0xfffd || value>=0x10000&&value<=0x10ffff) return String.fromCodePoint(value);
    }
    return fail('XML_ENTITY');
  });
}
// Deliberately restricted XML grammar, with no DTD/entity resolver, recovery, or execution.
function xml(text: string): Xml {
  // XML 1.0 normalizes literal CR/CRLF before parsing, not character references.
  text=text.replace(/\r\n?/g,'\n');
  text = text.replace(/^\uFEFF/, '');
  if(text.includes('\uFEFF'))fail('BOM_NOT_PREFIX');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(text))fail('XML_SYNTAX');
  text=text.replace(/^<\?xml[ \t\r\n]+version="1\.0"(?:[ \t\r\n]+encoding="[Uu][Tt][Ff]-8")?(?:[ \t\r\n]+standalone="yes")?[ \t\r\n]*\?>/,'');
  const root: Xml = { name: '#root', attrs: {}, children: [], text: '' }; const stack = [root]; let i = 0; let nodes = 0;
  while (i < text.length) {
    const current = stack.at(-1)!;
    if (text[i] !== '<') { const end = text.indexOf('<', i); const stop = end < 0 ? text.length : end; const chunk=text.slice(i,stop);if(chunk.includes(']]>')||current===root&&!/^[ \t\r\n]*$/.test(chunk))fail('XML_SYNTAX');current.text += entities(chunk); i = stop; continue; }
    if (text.startsWith('</', i)) { const match = /^<\/([A-Za-z_][\w.:-]*)[ \t\r\n]*>/.exec(text.slice(i)); if (!match || stack.length === 1 || current.name !== match[1]) fail('XML_SYNTAX'); stack.pop(); i += match![0].length; continue; }
    const match = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i)); if (!match) fail('XML_UNSUPPORTED');
    i += match![0].length; const node: Xml = { name: match![1]!, attrs: Object.create(null), children: [], text: '' };
    while (true) {
      const tail = text.slice(i); const close = /^[ \t\r\n]*(\/?>)/.exec(tail);
      if (close) { i += close[0].length; current.children.push(node); if (++nodes > 120000) fail('XML_LIMIT'); if (close[1] === '>') { stack.push(node); if (stack.length > 16) fail('XML_LIMIT'); } break; }
      const attr = /^[ \t\r\n]+([A-Za-z_][\w.:-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/.exec(tail);
      if (!attr || Object.hasOwn(node.attrs, attr[1]!)) fail('XML_SYNTAX');
      node.attrs[attr![1]!] = entities(attr![2] ?? attr![3]!); i += attr![0].length;
      if (Object.keys(node.attrs).length > 32) fail('XML_LIMIT');
    }
  }
  if (stack.length !== 1 || root.children.length !== 1 || !/^[ \t\r\n]*$/.test(root.text)) fail('XML_SYNTAX');
  const document=root.children[0]!,xmlNamespace='http://www.w3.org/XML/1998/namespace';
  const relationshipNamespace='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const supportedNamespaces=new Set([xmlNamespace,relationshipNamespace,'http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://schemas.openxmlformats.org/package/2006/content-types','http://schemas.openxmlformats.org/package/2006/relationships']);
  const namespaces=new Map<string,string>([['xml',xmlNamespace]]);
  for(const [name,uri] of Object.entries(document.attrs)) {
    if(name!=='xmlns'&&!name.startsWith('xmlns:'))continue;
    const prefix=name==='xmlns'?'':name.slice(6);
    if(!supportedNamespaces.has(uri))fail('XML_NAMESPACE');
    if(name!=='xmlns'&&!/^[A-Za-z_][\w.-]*$/.test(prefix)||prefix==='xmlns'||prefix==='xml'&&uri!==xmlNamespace||prefix!=='xml'&&uri===xmlNamespace||uri==='http://www.w3.org/2000/xmlns/'||prefix&&!uri)fail('XML_NAMESPACE');
    namespaces.set(prefix,uri);
  }
  const expanded=(name:string,attribute:boolean):string=>{
    if(!/^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/.test(name))return fail('XML_NAMESPACE');
    const parts=name.split(':');
    if(parts.length===1)return (attribute?'':namespaces.get('')??'')+'\0'+name;
    if(!namespaces.has(parts[0]!))return fail('XML_NAMESPACE');
    return namespaces.get(parts[0]!)+'\0'+parts[1];
  };
  const validateNames=(node:Xml)=>{
    expanded(node.name,false);const attributes=new Set<string>();
    for(const name of Object.keys(node.attrs)){
      if(name==='xmlns'||name.startsWith('xmlns:')){if(node!==document)fail('XML_NAMESPACE');continue;}
      const identity=expanded(name,true);if(attributes.has(identity))fail('XML_NAMESPACE');attributes.add(identity);
      if(name.includes(':')){
        const [prefix,local]=name.split(':'),uri=namespaces.get(prefix!);
        if(!(uri===xmlNamespace&&local==='space'&&['default','preserve'].includes(node.attrs[name]!))&&!(uri===relationshipNamespace&&local==='id'&&node.name==='sheet'))fail('XML_NAMESPACE');
      }else if(!Object.hasOwn(xmlAttributes,node.name)||!xmlAttributes[node.name]!.includes(name))fail('XML_ATTRIBUTE_UNSUPPORTED');
    }
    for(const child of node.children)validateNames(child);
  };
  validateNames(document);return document;
}
const children = (node: Xml, name: string) => node.children.filter(n => n.name === name);
function only(node: Xml, allowed: string[]) { if (!/^[ \t\r\n]*$/.test(node.text) || node.children.some(n => !allowed.includes(n.name))) fail('XLSX_STRUCTURE'); }
function leaf(node:Xml):string {if(node.children.length)fail('XLSX_STRUCTURE');return node.text;}
function one(node: Xml, name: string): Xml { const list = children(node, name); if (list.length !== 1) return fail('XLSX_STRUCTURE'); return list[0]!; }
function unsignedAttribute(value:string|undefined,positive=false):number {
  if(value===undefined||!/^\d+$/.test(value))return fail('XML_ATTRIBUTE_INVALID');
  const n=Number(value);if(!Number.isSafeInteger(n)||n>(2**32-1)||n<(positive?1:0))return fail('XML_ATTRIBUTE_INVALID');return n;
}
function booleanAttribute(node:Xml,name:string):boolean|undefined {
  const value=node.attrs[name];if(value===undefined)return undefined;
  if(!['0','1','false','true'].includes(value))return fail('XML_ATTRIBUTE_INVALID');
  return value==='1'||value==='true';
}
function assertTextSafety(value:string,row=0,column=0):void {
  if(exceedsCellLimit(value))fail('CELL_LIMIT',row,column);
  if(value.includes('\uFEFF'))fail('BOM_NOT_PREFIX',row,column);
  if(!value.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value))fail('TEXT_CONTROL',row,column);
}
function decodeXlsxText(value:string,row=0,column=0):string {
  const decoded=value.replace(/_x([0-9a-f]{4})_/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
  assertTextSafety(decoded,row,column);return decoded;
}
interface XlsxTable {rows:string[][];sourceTypes:XlsxCellType[][]}
function xlsxTables(bytes: Uint8Array, manifest: ParserResult['manifest'], organization=false): Map<string,XlsxTable> {
  const files = unzip(bytes,organization);
  const worksheetParts=[...files.keys()].filter(name=>/^xl\/worksheets\//u.test(name));
  if(worksheetParts.length!==(organization?3:1))fail('SHEET_CONTRACT');
  manifest.bomMembers=[...files].filter(([,value])=>value.startsWith('\uFEFF')).map(([name])=>name);
  manifest.bomDetected=manifest.bomMembers.length>0;
  const docs = new Map([...files].map(([name, value]) => [name, xml(value)]));
  const get = (name: string, root: string): Xml => {
    const doc = docs.get(name);
    const namespace=root==='Types'?'http://schemas.openxmlformats.org/package/2006/content-types':root==='Relationships'?'http://schemas.openxmlformats.org/package/2006/relationships':'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    if (!doc || doc.name !== root || doc.attrs['xmlns']!==namespace) return fail('XLSX_STRUCTURE'); return doc;
  };
  for (const [name,doc] of docs) {
    const sheetRelations=docs.get('xl/_rels/workbook.xml.rels')?.children.filter(r=>r.name==='Relationship' && 'xl/'+r.attrs['Target']===name) ?? [];
    const declaredSheets=docs.get('xl/workbook.xml')?.children.find(n=>n.name==='sheets')?.children.filter(n=>n.name==='sheet' && sheetRelations.some(r=>r.attrs['Id']===n.attrs['r:id'])) ?? [];
    const location=worksheetParts.includes(name)?(declaredSheets.length===1?declaredSheets[0]!.attrs['name'] ?? 'workbook':'workbook'):name;
    const visit = (n: Xml, row=1, column=1) => {
      if(worksheetParts.includes(name) && n.name==='c') {
        const cell=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(n.attrs['r'] ?? '');
        if(cell) {
          const cellColumn=[...cell[1]!].reduce((value,letter)=>value*26+letter.charCodeAt(0)-64,0);
          const cellRow=Number(cell[2]);
          if(cellColumn<=16384 && cellRow<=1048576) {row=cellRow;column=cellColumn;}
        }
      }
      if(n.attrs['s']!==undefined||n.attrs['style']!==undefined)fail('XLSX_STYLE_UNSUPPORTED',row,column,location);
      if(n!==doc && Object.keys(n.attrs).some(a=>a==='xmlns'||a.startsWith('xmlns:')))fail('XML_NAMESPACE',row,column,location);
      if (['f','externalLink','oleObject','extLst','AlternateContent'].includes(n.name) || n.attrs['TargetMode'] === 'External') fail('ACTIVE_CONTENT',row,column,location);
      for (const child of n.children) visit(child,row,column);
    }; visit(doc);
  }
  const types = get('[Content_Types].xml', 'Types'); only(types, ['Default','Override']);
  for(const entry of types.children)only(entry,[]);
  if (types.children.some(n => /macro|vba|ole|external/i.test(n.attrs['ContentType'] ?? ''))) fail('ACTIVE_CONTENT',1,1,'workbook');
  const spreadsheetMime='application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const partTypes:Record<string,string>={
    '/xl/workbook.xml':spreadsheetMime+'sheet.main+xml',...Object.fromEntries(worksheetParts.map(part=>['/'+part,spreadsheetMime+'worksheet+xml'])),
    '/xl/sharedStrings.xml':spreadsheetMime+'sharedStrings+xml',
  };
  const defaults:Record<string,string>={xml:'application/xml',rels:'application/vnd.openxmlformats-package.relationships+xml'};
  const declarations=new Map<string,string>();
  for(const entry of types.children){
    const isDefault=entry.name==='Default',keyName=isDefault?'Extension':'PartName',key=entry.attrs[keyName]??'',mime=entry.attrs['ContentType']??'',mapping=isDefault?defaults:partTypes;
    const identity=entry.name+':'+key;
    if(Object.keys(entry.attrs).some(k=>k!==keyName&&k!=='ContentType')||!Object.hasOwn(mapping,key)||mapping[key]!==mime||declarations.has(identity)||!isDefault&&!files.has(key.slice(1)))fail('CONTENT_TYPE_REJECTED');
    declarations.set(identity,mime);
  }
  for(const part of ['/xl/workbook.xml',...Object.keys(partTypes).filter(p=>files.has(p.slice(1)))]){
    if(declarations.get('Override:'+part)!==partTypes[part])fail('CONTENT_TYPE_REJECTED');
  }
  if(declarations.get('Default:rels')!==defaults['rels'])fail('CONTENT_TYPE_REJECTED');
  const rels = get('_rels/.rels','Relationships'); only(rels,['Relationship']);
  const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const relationships=(node:Xml,mapping:Record<string,string>,prefix:string,required:string)=>{
    const ids=new Set<string>(),targets=new Set<string>();
    for(const rel of node.children){
      only(rel,[]);const id=rel.attrs['Id']??'',target=rel.attrs['Target']??'';
      if(!/^[A-Za-z_][\w.-]*$/.test(id)||ids.has(id)||targets.has(target)||!Object.hasOwn(mapping,target)||rel.attrs['Type']!==mapping[target]||!files.has(prefix+target)||rel.attrs['TargetMode']!==undefined&&rel.attrs['TargetMode']!=='Internal')fail('RELATIONSHIP_REJECTED');
      ids.add(id);targets.add(target);
    }
    if(!targets.has(required))fail('RELATIONSHIP_REJECTED');
    return targets;
  };
  relationships(rels,{'xl/workbook.xml':office+'officeDocument'},'','xl/workbook.xml');
  const workbook = get('xl/workbook.xml','workbook'); only(workbook,['sheets']);
  if(new Set(workbook.children.map(n=>n.name)).size!==workbook.children.length)fail('XLSX_STRUCTURE');
  if(workbook.attrs['xmlns:r']!=='http://schemas.openxmlformats.org/officeDocument/2006/relationships')fail('XML_NAMESPACE');
  const sheets = one(workbook,'sheets'); only(sheets,['sheet']);
  for(const entry of sheets.children)only(entry,[]);
  for(const s of sheets.children)if(s.attrs['state']!==undefined&&!['visible','hidden','veryHidden'].includes(s.attrs['state']))fail('XML_ATTRIBUTE_INVALID');
  manifest.hiddenSheets = sheets.children.filter(s => s.attrs['state']!==undefined && s.attrs['state'] !== 'visible').map(s => s.attrs['name'] ?? '');
  const expected=organization?['ORG01','ORG02','ORG03']:['Data'];
  if(sheets.children.length!==expected.length||new Set(sheets.children.map(s=>s.attrs['name'])).size!==expected.length||sheets.children.some(s=>!expected.includes(s.attrs['name']??'')))fail('SHEET_CONTRACT',1,1,sheets.children.find(s=>!expected.includes(s.attrs['name']??''))?.attrs['name']??'workbook');
  const ids=new Set<number>();for(const sheet of sheets.children){const id=unsignedAttribute(sheet.attrs['sheetId'],true);if(ids.has(id))fail('SHEET_CONTRACT');ids.add(id);}
  const wr = get('xl/_rels/workbook.xml.rels','Relationships'); only(wr,['Relationship']);
  const workbookTargets=relationships(wr,{...Object.fromEntries(worksheetParts.map(part=>[part.slice(3),office+'worksheet'])),'sharedStrings.xml':office+'sharedStrings'},'xl/',worksheetParts[0]!.slice(3));
  if(worksheetParts.some(part=>!workbookTargets.has(part.slice(3))))fail('RELATIONSHIP_REJECTED');
  const boundParts=new Set<string>();const targets=new Map<string,string>();
  for(const sheet of sheets.children){const target=wr.children.find(r=>r.attrs['Id']===sheet.attrs['r:id'])?.attrs['Target'];if(!target||!worksheetParts.includes('xl/'+target)||boundParts.has(target))fail('RELATIONSHIP_REJECTED');boundParts.add(target!);targets.set(sheet.attrs['name']!,target!);}
  const shared = docs.get('xl/sharedStrings.xml'); const strings: string[] = [];
  let declaredCount:number|undefined,sharedReferences=0;
  if (shared) { if(!workbookTargets.has('sharedStrings.xml'))fail('RELATIONSHIP_REJECTED');get('xl/sharedStrings.xml','sst'); only(shared,['si']); for (const si of shared.children) { only(si,['t']); strings.push(decodeXlsxText(leaf(one(si,'t')))); } }
  if(shared){
    if(shared.attrs['count']!==undefined)declaredCount=unsignedAttribute(shared.attrs['count']);
    if(shared.attrs['uniqueCount']!==undefined&&unsignedAttribute(shared.attrs['uniqueCount'])!==strings.length)fail('SHARED_STRING_COUNT');
  }
  const tables=new Map<string,XlsxTable>();
  for(const [sheetName,target] of targets){
  try{
  const worksheet = get('xl/'+target,'worksheet'); only(worksheet,['sheetFormatPr','cols','sheetData']);
  let previousWorksheetChild = -1;
  for(const child of worksheet.children){
    const position = ['sheetFormatPr','cols','sheetData'].indexOf(child.name);
    if(position<=previousWorksheetChild)fail('XLSX_STRUCTURE');
    previousWorksheetChild=position;
  }
  for(const metadata of children(worksheet,'sheetFormatPr')) {
    only(metadata,[]);
    const zeroHeight=booleanAttribute(metadata,'zeroHeight');
    if(zeroHeight===undefined)fail('XLSX_STRUCTURE');
    manifest.defaultRowsHidden=zeroHeight!;
  }
  for (const cols of children(worksheet,'cols')) { only(cols,['col']); if(!cols.children.length)fail('XLSX_STRUCTURE'); for (const col of cols.children) {
    only(col,[]);const min=unsignedAttribute(col.attrs['min'],true),max=unsignedAttribute(col.attrs['max'],true);
    if(min>max||max>16384)fail('COLUMN_RANGE');
    if (booleanAttribute(col,'hidden')) manifest.hiddenColumns.push(`${min}:${max}`);
  } }
  const data = one(worksheet,'sheetData'); only(data,['row']); const rows: string[][] = [];const sourceTypes:XlsxCellType[][]=[];
  if(manifest.defaultRowsHidden){
    manifest.hiddenRows=data.children.filter(r=>booleanAttribute(r,'hidden')!==false).map(r=>Number(r.attrs['r'])).filter(r=>Number.isInteger(r)&&r>0);
    fail('HIDDEN_UNDECLARED');
  }
  for (const r of data.children) {
    const rowNum = rows.length + 1; const declaredRow=r.attrs['r'];
    if (declaredRow !== String(rowNum)) fail('ROW_GAP',declaredRow&&/^[1-9][0-9]*$/.test(declaredRow)&&Number(declaredRow)<=1048576?Number(declaredRow):rowNum); only(r,['c']);
    if (booleanAttribute(r,'hidden')) manifest.hiddenRows.push(rowNum);
    const values: string[] = [];const rowTypes:XlsxCellType[]=[];
    for (const c of r.children) {
      const col = values.length + 1; let n = col, letters = ''; while (n) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
      if (c.attrs['r'] !== `${letters}${rowNum}`) fail('COLUMN_GAP',rowNum,col);
      only(c,['v','is']); let value: string;const cellType=c.attrs['t'];
      if (cellType === 'inlineStr') { only(c,['is']); const inline = one(c,'is'); only(inline,['t']); value = decodeXlsxText(leaf(one(inline,'t')),rowNum,col); }
      else if (cellType === 's') { only(c,['v']); const index = leaf(one(c,'v')); if (!/^(0|[1-9]\d*)$/.test(index) || strings[Number(index)] === undefined) fail('SHARED_STRING'); value = strings[Number(index)]!; sharedReferences++; }
      else return fail('TEXT_CELL_REQUIRED',rowNum,col);
      values.push(value);rowTypes.push(cellType); if (values.length > 100) fail('COLUMN_LIMIT',rowNum,col);
    }
    rows.push(values);sourceTypes.push(rowTypes); if (rows.length > 1001) fail('ROW_LIMIT',rowNum);
  }
  if (manifest.hiddenSheets.length || manifest.hiddenRows.length || manifest.hiddenColumns.length) fail('HIDDEN_UNDECLARED');
  tables.set(sheetName,{rows,sourceTypes});
  }catch(error){if(organization&&error instanceof ParseFailure&&!error.sheet)throw new ParseFailure(error.code,error.row,error.column,sheetName);throw error;}
  }
  if(declaredCount!==undefined&&declaredCount!==sharedReferences)fail('SHARED_STRING_COUNT');
  return tables;
}

function appendObjects(result:Pick<ParserResult,'rows'|'cells'>,objects:SourceObject[],fields:ParserField[],physicalRows:number[],sourceTypes:XlsxCellType[][],format:FileFormat,optionalTime:boolean,offset=false){
    for (const [index, source] of objects.entries()) {
      const obj=source.values;
      const row: Record<string,string> = Object.create(null); const rowNum = index + 1;
      if (Object.keys(obj).length !== fields.length || Object.keys(obj).some(key=>!fields.some(f=>f.code===key))) fail('FIELD_CONTRACT',rowNum);
      for (const f of fields) {
        const column=source.columns.indexOf(f.code)+1;
        const value = obj[f.code];
        const text = typeof value==='string'?value:value?.lexeme??'';
        result.cells.push({row:rowNum,sourceRow:physicalRows[index]??rowNum,column,field:f.code,value:text,sourceType:format === 'XLSX' ? sourceTypes[index]![column-1]! : format});
        if(typeof value!=='string')fail('TEXT_CELL_REQUIRED',rowNum,column);
        assertTextSafety(text,rowNum,column);
        if (text !== text.trim()) fail('WHITESPACE_REJECTED',rowNum,column);
        if (f.type === 'datetime' && !(optionalTime && text==='')) {try{parseLocalDateTime(offset?text.replace(/\+08:00$/u,''):text);}catch{fail('LOCAL_TIME_REQUIRED',rowNum,column);}}
        row[f.code] = text;
      }
      if (Object.values(row).every(v=>v==='')) fail('EMPTY_ROW',rowNum); result.rows.push(row);
    }
}

export function parseBytes(bytes: Uint8Array, format: FileFormat, fields: ParserField[], policy: ParserResult['policy']='STRICT_V1'): ParserResult {
  if(policy!=='STRICT_V1' && policy!=='STRICT_V2')throw new Error('PARSER_POLICY_REQUIRED');
  const result: ParserResult = { policy, structuralStatus:'REJECTED', manifest:{bomDetected:false,bomMembers:[],defaultRowsHidden:false,hiddenSheets:[],hiddenRows:[],hiddenColumns:[]},rows:[],cells:[],issues:[] };
  try {
    if (!bytes.length) fail('EMPTY_FILE'); if (bytes.length > 1048576) fail('FILE_LIMIT');
    if (!fields.length || fields.length > 100 || new Set(fields.map(f=>f.code)).size !== fields.length) fail('FIELD_CONTRACT');
    let objects: SourceObject[];
    let physicalRows:number[]=[];let sourceTypes:XlsxCellType[][]=[];
    if (format === 'XLSX') {
      const table = xlsxTables(bytes,result.manifest).get('Data')!; objects = tableObjects(table.rows,fields);physicalRows=table.rows.slice(1).map((_,i)=>i+2);sourceTypes=table.sourceTypes.slice(1);
    } else {
      let text = utf8(bytes); result.manifest.bomDetected = text.startsWith('\uFEFF'); if (result.manifest.bomDetected) text = text.slice(1);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('TEXT_CONTROL');
      if (format === 'CSV') {const table=csv(text);objects = tableObjects(table.rows,fields,table.physicalRows);physicalRows=table.physicalRows.slice(1);}
      else if (format === 'JSON') objects = jsonRows(text);
      else return fail('FORMAT_UNSUPPORTED');
    }
    if (!objects.length) fail('NO_DATA');
    appendObjects(result,objects,fields,physicalRows,sourceTypes,format,policy==='STRICT_V2');
    result.structuralStatus = 'PARSED';
  } catch (error) { result.rows = []; result.issues.push(error instanceof ParseFailure ? {code:error.code,row:error.row,column:error.column,...(error.sheet?{sheet:error.sheet}:{})} : {code:'PARSER_FAILED',row:0,column:0}); }
  if (Buffer.byteLength(JSON.stringify(result)) > 1048576) return {...result,structuralStatus:'REJECTED',rows:[],cells:[],issues:[{code:'RESULT_LIMIT',row:0,column:0}]};
  return result;
}
export const organizationSheets=['ORG01','ORG02','ORG03'] as const;
export type OrganizationSheet=typeof organizationSheets[number];
export interface OrganizationWorkbookResult {
 policy:'STRICT_ORG_BUNDLE_V1';structuralStatus:'PARSED'|'REJECTED';manifest:ParserResult['manifest'];
 sheets:Record<OrganizationSheet,{rows:CanonicalRow[];cells:Array<RawCellProvenance&{sheet:OrganizationSheet}>}>;issues:ParserIssue[];
}
export function parseOrganizationWorkbook(bytes:Uint8Array,fields:Record<OrganizationSheet,ParserField[]>):OrganizationWorkbookResult{
 const result:OrganizationWorkbookResult={policy:'STRICT_ORG_BUNDLE_V1',structuralStatus:'REJECTED',manifest:{bomDetected:false,bomMembers:[],defaultRowsHidden:false,hiddenSheets:[],hiddenRows:[],hiddenColumns:[]},sheets:{ORG01:{rows:[],cells:[]},ORG02:{rows:[],cells:[]},ORG03:{rows:[],cells:[]}},issues:[]};
 try{
  if(!bytes.length)fail('EMPTY_FILE');if(bytes.length>1048576)fail('FILE_LIMIT');
  const tables=xlsxTables(bytes,result.manifest,true);let count=0;
  for(const sheet of organizationSheets){try{
   const fs=fields[sheet];if(!fs?.length||fs.length>100||new Set(fs.map(f=>f.code)).size!==fs.length)fail('FIELD_CONTRACT');
   const table=tables.get(sheet)!;const objects=tableObjects(table.rows,fs);count+=objects.length;if(count>1000)fail('ROW_LIMIT');
   const parsed:Pick<ParserResult,'rows'|'cells'>={rows:[],cells:[]};appendObjects(parsed,objects,fs,table.rows.slice(1).map((_,i)=>i+2),table.sourceTypes.slice(1),'XLSX',true,true);
   result.sheets[sheet]={rows:parsed.rows,cells:parsed.cells.map(cell=>({...cell,sheet}))};
  }catch(error){if(error instanceof ParseFailure&&!error.sheet)throw new ParseFailure(error.code,error.row,error.column,sheet);throw error;}}
  if(!count)fail('NO_DATA');result.structuralStatus='PARSED';
 }catch(error){for(const sheet of organizationSheets)result.sheets[sheet].rows=[];result.issues.push(error instanceof ParseFailure?{code:error.code,row:error.row,column:error.column,...(error.sheet?{sheet:error.sheet}:{})}:{code:'PARSER_FAILED',row:0,column:0});}
 if(Buffer.byteLength(JSON.stringify(result))>1048576){for(const sheet of organizationSheets)result.sheets[sheet]={rows:[],cells:[]};result.structuralStatus='REJECTED';result.issues=[{code:'RESULT_LIMIT',row:0,column:0}];}
 return result;
}

function tableObjects(table: string[][], fields: ParserField[], physicalRows?:number[]): SourceObject[] {
  const header = table[0]; if (!header) return fail('NO_DATA');
  header.forEach((key,column)=>assertTextSafety(key,1,column+1));
  const duplicateColumn=header.findIndex((key,index)=>header.indexOf(key)!==index);
  if (duplicateColumn>=0) fail('DUPLICATE_FIELD',1,duplicateColumn+1);
  const unknownColumn=header.findIndex(h=>!fields.some(f=>f.code===h));
  if (header.length !== fields.length || unknownColumn>=0) fail('FIELD_CONTRACT',1,unknownColumn>=0?unknownColumn+1:header.length+1);
  return table.slice(1).map((row,index)=> { if (row.length !== header.length) fail('FIELD_CONTRACT',physicalRows?.[index+1]??index+2); return {values:Object.fromEntries(header.map((key,col)=>[key,row[col]!])),columns:header}; });
}

if (!isMainThread && parentPort) {
  try { parentPort.postMessage(workerData.policy==='STRICT_ORG_BUNDLE_V1'?parseOrganizationWorkbook(workerData.bytes,workerData.organizationFields):parseBytes(workerData.bytes,workerData.format,workerData.fields,workerData.policy)); }
  catch { parentPort.postMessage(null); }
}
