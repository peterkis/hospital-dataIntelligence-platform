import { inflateRawSync, crc32 } from 'node:zlib';
import { parentPort, workerData, isMainThread } from 'node:worker_threads';

export type FileFormat = 'CSV' | 'JSON' | 'XLSX';
export interface ParserField { code: string; type: string }
export interface ParserIssue { code: string; row: number; column: number }
export type CanonicalRow = Record<string,string>;
export interface RawCellProvenance {row:number;sourceRow:number;column:number;field:string;value:string;sourceType:string}
export interface ParserResult {
  policy: 'STRICT_V1'; structuralStatus: 'PARSED' | 'REJECTED';
  manifest: { bomDetected: boolean; defaultRowsHidden:boolean; hiddenSheets: string[]; hiddenRows: number[]; hiddenColumns: string[] };
  rows: CanonicalRow[];
  cells: RawCellProvenance[];
  issues: ParserIssue[];
}
class ParseFailure extends Error {
  readonly code: string;
  readonly row: number;
  readonly column: number;
  constructor(code: string, row = 0, column = 0) { super(code); this.code=code; this.row=row; this.column=column; }
}
const fail = (code: string, row = 0, column = 0): never => { throw new ParseFailure(code, row, column); };
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
  const cell = () => { row.push(value); value = ''; closed = false; if (row.length > 100) fail('COLUMN_LIMIT',physicalRow,physicalColumn); };
  const record=()=>{rows.push(row);physicalRows.push(recordStart);row=[];if(rows.length>1001)fail('ROW_LIMIT',physicalRow,physicalColumn);};
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
    if (value.length > 8192) fail('CELL_LIMIT',physicalRow,physicalColumn);
    if(c==='\n'||c==='\r'&&!quoted){physicalRow++;physicalColumn=1;}else physicalColumn++;
    if(finishedRecord)recordStart=physicalRow;
  }
  if (quoted) syntax();
  if (value || row.length || closed) { cell(); record(); }
  return {rows,physicalRows};
}

// Only an array of flat objects is accepted. Tokenize keys before object construction,
// so escaped duplicate keys cannot disappear through JSON.parse's last-write behavior.
function jsonRows(text: string): Array<Record<string, string | number | null>> {
  let i = 0; const rows: Array<Record<string, string | number | null>> = [];
  const ws = () => { while (/^[\x20\t\r\n]$/.test(text[i] ?? '')) i++; };
  const expect = (c: string) => { ws(); if (text[i++] !== c) fail('JSON_SYNTAX'); };
  const string = (): string => {
    ws(); const start = i; if (text[i++] !== '"') return fail('JSON_SYNTAX');
    while (i < text.length) { const c = text[i++]; if (c === '\\') i++; else if (c === '"') {
      try { const value: string = JSON.parse(text.slice(start, i)); if (value.length > 8192) fail('CELL_LIMIT'); return value; } catch (e) { if (e instanceof ParseFailure) throw e; return fail('JSON_SYNTAX'); }
    } }
    return fail('JSON_SYNTAX');
  };
  expect('['); ws();
  while (text[i] !== ']') {
    expect('{'); const row: Record<string, string | number | null> = Object.create(null); ws();
    while (text[i] !== '}') {
      const key = string(); if (Object.hasOwn(row, key)) fail('DUPLICATE_FIELD', rows.length + 1); expect(':'); ws();
      if (text[i] === '"') row[key] = string();
      else {
        const match = /^(?:null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
        if (!match) fail('JSON_SCALAR_REQUIRED');
        // Numeric lexemes are rejected below; do not coerce precision-sensitive input.
        row[key] = match![0] === 'null' ? null : Number.NaN; i += match![0].length;
      }
      if (Object.keys(row).length > 100) fail('COLUMN_LIMIT'); ws();
      if (text[i] !== ',') break; i++; ws(); if (text[i] === '}') fail('JSON_SYNTAX');
    }
    expect('}'); rows.push(row); if (rows.length > 1000) fail('ROW_LIMIT'); ws();
    if (text[i] !== ',') break; i++; ws(); if (text[i] === ']') fail('JSON_SYNTAX');
  }
  expect(']'); ws(); if (i !== text.length) fail('JSON_SYNTAX'); return rows;
}

export function unzip(bytes: Uint8Array): Map<string, string> {
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
    if (p + 46 + nameSize > end) fail('ZIP_FORMAT');
    const nameBytes = b.subarray(p + 46, p + 46 + nameSize), name = utf8(nameBytes);
    if (!['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml','xl/sharedStrings.xml'].includes(name) || files.has(name)) fail('ZIP_MEMBER_REJECTED');
    total += size;
    if (size > 2097152 || total > 4194304 || size > Math.max(1, compressed) * 100) fail('ZIP_LIMIT');
    if (local !== nextLocal || local + 30 > central || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method || b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== compressed || b.readUInt32LE(local + 22) !== size || b.readUInt16LE(local + 26) !== nameSize || b.readUInt16LE(local + 28) !== 0) fail('ZIP_FORMAT');
    const start = local + 30 + nameSize; nextLocal = start + compressed;
    if (nextLocal > central || !b.subarray(local + 30, start).equals(nameBytes)) fail('ZIP_FORMAT');
    const payload = b.subarray(start, nextLocal);
    let raw: Buffer;
    try { raw = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, size) }); } catch { return fail('ZIP_LIMIT'); }
    if (raw.length !== size || crc32(raw) !== crc) fail('ZIP_INTEGRITY');
    files.set(name, utf8(raw)); p += 46 + nameSize;
  }
  if (p !== end || nextLocal !== central) fail('ZIP_FORMAT'); return files;
}

interface Xml { name: string; attrs: Record<string, string>; children: Xml[]; text: string }
function entities(text: string): string {
  return text.replace(/&([^;]*);|&/g, (whole, name: string | undefined) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && Object.hasOwn(predefined, name)) return predefined[name]!;
    if (name && /^#(?:x[0-9a-fA-F]+|\d+)$/.test(name)) {
      const value = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (value === 9 || value === 10 || value === 13 || value >= 32 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)) return String.fromCodePoint(value);
    }
    return fail('XML_ENTITY');
  });
}
// Deliberately restricted XML grammar, with no DTD/entity resolver, recovery, or execution.
function xml(text: string): Xml {
  text = text.replace(/^\uFEFF/, '').replace(/^<\?xml\s+version="1\.0"(?:\s+encoding="UTF-8")?(?:\s+standalone="yes")?\s*\?>/i, '');
  const root: Xml = { name: '#root', attrs: {}, children: [], text: '' }; const stack = [root]; let i = 0; let nodes = 0;
  while (i < text.length) {
    const current = stack.at(-1)!;
    if (text[i] !== '<') { const end = text.indexOf('<', i); const stop = end < 0 ? text.length : end; current.text += entities(text.slice(i, stop)); i = stop; continue; }
    if (text.startsWith('</', i)) { const match = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(text.slice(i)); if (!match || stack.length === 1 || current.name !== match[1]) fail('XML_SYNTAX'); stack.pop(); i += match![0].length; continue; }
    const match = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i)); if (!match) fail('XML_UNSUPPORTED');
    i += match![0].length; const node: Xml = { name: match![1]!, attrs: Object.create(null), children: [], text: '' };
    while (true) {
      const tail = text.slice(i); const close = /^\s*(\/?>)/.exec(tail);
      if (close) { i += close[0].length; current.children.push(node); if (++nodes > 120000) fail('XML_LIMIT'); if (close[1] === '>') { stack.push(node); if (stack.length > 16) fail('XML_LIMIT'); } break; }
      const attr = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(tail);
      if (!attr || Object.hasOwn(node.attrs, attr[1]!)) fail('XML_SYNTAX');
      node.attrs[attr![1]!] = entities(attr![2] ?? attr![3]!); i += attr![0].length;
      if (Object.keys(node.attrs).length > 32) fail('XML_LIMIT');
    }
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail('XML_SYNTAX');
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
      }
    }
    for(const child of node.children)validateNames(child);
  };
  validateNames(document);return document;
}
const children = (node: Xml, name: string) => node.children.filter(n => n.name === name);
function only(node: Xml, allowed: string[]) { if (node.text.trim() || node.children.some(n => !allowed.includes(n.name))) fail('XLSX_STRUCTURE'); }
function leaf(node:Xml):string {if(node.children.length)fail('XLSX_STRUCTURE');return node.text;}
function one(node: Xml, name: string): Xml { const list = children(node, name); if (list.length !== 1) return fail('XLSX_STRUCTURE'); return list[0]!; }
function xlsx(bytes: Uint8Array, manifest: ParserResult['manifest']): string[][] {
  const files = unzip(bytes); const docs = new Map([...files].map(([name, value]) => [name, xml(value)]));
  const get = (name: string, root: string): Xml => {
    const doc = docs.get(name);
    const namespace=root==='Types'?'http://schemas.openxmlformats.org/package/2006/content-types':root==='Relationships'?'http://schemas.openxmlformats.org/package/2006/relationships':'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    if (!doc || doc.name !== root || doc.attrs['xmlns']!==namespace) return fail('XLSX_STRUCTURE'); return doc;
  };
  for (const doc of docs.values()) {
    const visit = (n: Xml) => { if(n.attrs['s']!==undefined||n.attrs['style']!==undefined)fail('XLSX_STYLE_UNSUPPORTED');if(n!==doc && Object.keys(n.attrs).some(a=>a==='xmlns'||a.startsWith('xmlns:')))fail('XML_NAMESPACE'); if (['f','externalLink','oleObject','extLst','AlternateContent'].includes(n.name) || n.attrs['TargetMode'] === 'External') fail('ACTIVE_CONTENT'); for (const child of n.children) visit(child); }; visit(doc);
  }
  const types = get('[Content_Types].xml', 'Types'); only(types, ['Default','Override']);
  for(const entry of types.children)only(entry,[]);
  if (types.children.some(n => /macro|vba|ole|external/i.test(n.attrs['ContentType'] ?? ''))) fail('ACTIVE_CONTENT');
  const spreadsheetMime='application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const partTypes:Record<string,string>={
    '/xl/workbook.xml':spreadsheetMime+'sheet.main+xml','/xl/worksheets/sheet1.xml':spreadsheetMime+'worksheet+xml',
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
  for(const part of ['/xl/workbook.xml','/xl/worksheets/sheet1.xml',...Object.keys(partTypes).filter(p=>files.has(p.slice(1)))]){
    if(declarations.get('Override:'+part)!==partTypes[part])fail('CONTENT_TYPE_REJECTED');
  }
  if(declarations.get('Default:rels')!==defaults['rels'])fail('CONTENT_TYPE_REJECTED');
  const rels = get('_rels/.rels','Relationships'); only(rels,['Relationship']);
  const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const relationships=(node:Xml,mapping:Record<string,string>,prefix:string,required:string)=>{
    const ids=new Set<string>(),targets=new Set<string>();
    for(const rel of node.children){
      only(rel,[]);const id=rel.attrs['Id']??'',target=rel.attrs['Target']??'';
      if(!id||ids.has(id)||targets.has(target)||!Object.hasOwn(mapping,target)||rel.attrs['Type']!==mapping[target]||!files.has(prefix+target)||rel.attrs['TargetMode']&&rel.attrs['TargetMode']!=='Internal')fail('RELATIONSHIP_REJECTED');
      ids.add(id);targets.add(target);
    }
    if(!targets.has(required))fail('RELATIONSHIP_REJECTED');
    return targets;
  };
  relationships(rels,{'xl/workbook.xml':office+'officeDocument'},'','xl/workbook.xml');
  const workbook = get('xl/workbook.xml','workbook'); only(workbook,['workbookPr','bookViews','sheets','calcPr']);
  if(new Set(workbook.children.map(n=>n.name)).size!==workbook.children.length)fail('XLSX_STRUCTURE');
  for(const metadata of workbook.children.filter(n=>n.name!=='sheets')) {
    if(metadata.name==='bookViews'){only(metadata,['workbookView']);for(const view of metadata.children)only(view,[]);}
    else only(metadata,[]);
  }
  if(workbook.attrs['xmlns:r']!=='http://schemas.openxmlformats.org/officeDocument/2006/relationships')fail('XML_NAMESPACE');
  const sheets = one(workbook,'sheets'); only(sheets,['sheet']);
  for(const entry of sheets.children)only(entry,[]);
  manifest.hiddenSheets = sheets.children.filter(s => s.attrs['state'] && s.attrs['state'] !== 'visible').map(s => s.attrs['name'] ?? '');
  const sheet = sheets.children[0]; if (sheets.children.length !== 1 || sheet?.attrs['name'] !== 'Data') fail('SHEET_CONTRACT');
  const wr = get('xl/_rels/workbook.xml.rels','Relationships'); only(wr,['Relationship']);
  const workbookTargets=relationships(wr,{'worksheets/sheet1.xml':office+'worksheet','sharedStrings.xml':office+'sharedStrings'},'xl/','worksheets/sheet1.xml');
  if (!wr.children.some(r => r.attrs['Id'] === sheet!.attrs['r:id'] && r.attrs['Target'] === 'worksheets/sheet1.xml')) fail('RELATIONSHIP_REJECTED');
  const shared = docs.get('xl/sharedStrings.xml'); const strings: string[] = [];
  if (shared) { if(!workbookTargets.has('sharedStrings.xml'))fail('RELATIONSHIP_REJECTED');get('xl/sharedStrings.xml','sst'); only(shared,['si']); for (const si of shared.children) { only(si,['t']); strings.push(leaf(one(si,'t'))); } }
  const worksheet = get('xl/worksheets/sheet1.xml','worksheet'); only(worksheet,['dimension','sheetViews','sheetFormatPr','cols','sheetData','pageMargins']);
  if(new Set(worksheet.children.map(n=>n.name)).size!==worksheet.children.length)fail('XLSX_STRUCTURE');
  for(const metadata of worksheet.children.filter(n=>!['cols','sheetData'].includes(n.name))) {
    if(metadata.name==='sheetFormatPr'&&metadata.attrs['zeroHeight']!==undefined){
      if(!['0','1','false','true'].includes(metadata.attrs['zeroHeight']))fail('XLSX_STRUCTURE');
      manifest.defaultRowsHidden=['1','true'].includes(metadata.attrs['zeroHeight']);
    }
    if(metadata.name==='sheetViews'){only(metadata,['sheetView']);for(const view of metadata.children){only(view,['pane','selection']);for(const item of view.children)only(item,[]);}}
    else only(metadata,[]);
  }
  for (const cols of children(worksheet,'cols')) { only(cols,['col']); for (const col of cols.children) {only(col,[]);if (col.attrs['hidden'] && col.attrs['hidden'] !== '0' && col.attrs['hidden'] !== 'false') manifest.hiddenColumns.push(`${col.attrs['min']}:${col.attrs['max']}`);} }
  const data = one(worksheet,'sheetData'); only(data,['row']); const rows: string[][] = [];
  if(manifest.defaultRowsHidden){
    manifest.hiddenRows=data.children.filter(r=>!['0','false'].includes(r.attrs['hidden']??'')).map(r=>Number(r.attrs['r'])).filter(r=>Number.isInteger(r)&&r>0);
    fail('HIDDEN_UNDECLARED');
  }
  for (const r of data.children) {
    const rowNum = rows.length + 1; if (r.attrs['r'] !== String(rowNum)) fail('ROW_GAP', rowNum); only(r,['c']);
    if (r.attrs['hidden'] && r.attrs['hidden'] !== '0' && r.attrs['hidden'] !== 'false') manifest.hiddenRows.push(rowNum);
    const values: string[] = [];
    for (const c of r.children) {
      const col = values.length + 1; let n = col, letters = ''; while (n) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
      if (c.attrs['r'] !== `${letters}${rowNum}`) fail('COLUMN_GAP',rowNum,col);
      only(c,['v','is']); let value: string;
      if (c.attrs['t'] === 'inlineStr') { only(c,['is']); const inline = one(c,'is'); only(inline,['t']); value = leaf(one(inline,'t')); }
      else if (c.attrs['t'] === 's') { only(c,['v']); const index = leaf(one(c,'v')); if (!/^(0|[1-9]\d*)$/.test(index) || strings[Number(index)] === undefined) fail('SHARED_STRING'); value = strings[Number(index)]!; }
      else return fail('TEXT_CELL_REQUIRED',rowNum,col);
      value=value.replace(/_x([0-9a-f]{4})_/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
      if (value.length > 8192) fail('CELL_LIMIT',rowNum,col); values.push(value); if (values.length > 100) fail('COLUMN_LIMIT');
    }
    rows.push(values); if (rows.length > 1001) fail('ROW_LIMIT');
  }
  if (manifest.hiddenSheets.length || manifest.hiddenRows.length || manifest.hiddenColumns.length) fail('HIDDEN_UNDECLARED');
  return rows;
}

export function parseBytes(bytes: Uint8Array, format: FileFormat, fields: ParserField[]): ParserResult {
  const result: ParserResult = { policy:'STRICT_V1', structuralStatus:'REJECTED', manifest:{bomDetected:false,defaultRowsHidden:false,hiddenSheets:[],hiddenRows:[],hiddenColumns:[]},rows:[],cells:[],issues:[] };
  try {
    if (!bytes.length) fail('EMPTY_FILE'); if (bytes.length > 1048576) fail('FILE_LIMIT');
    if (!fields.length || fields.length > 100 || new Set(fields.map(f=>f.code)).size !== fields.length) fail('FIELD_CONTRACT');
    let objects: Array<Record<string, string | number | null>>;
    let physicalRows:number[]=[];
    if (format === 'XLSX') {
      const table = xlsx(bytes,result.manifest); objects = tableObjects(table,fields);physicalRows=table.slice(1).map((_,i)=>i+2);
    } else {
      let text = utf8(bytes); result.manifest.bomDetected = text.startsWith('\uFEFF'); if (result.manifest.bomDetected) text = text.slice(1);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('TEXT_CONTROL');
      if (format === 'CSV') {const table=csv(text);objects = tableObjects(table.rows,fields,table.physicalRows);physicalRows=table.physicalRows.slice(1);}
      else if (format === 'JSON') objects = jsonRows(text);
      else return fail('FORMAT_UNSUPPORTED');
    }
    if (!objects.length) fail('NO_DATA');
    for (const [index, obj] of objects.entries()) {
      const row: Record<string,string> = Object.create(null); const rowNum = index + 1;
      if (Object.keys(obj).length !== fields.length || Object.keys(obj).some(key=>!fields.some(f=>f.code===key))) fail('FIELD_CONTRACT',rowNum);
      for (const f of fields) {
        const column=Object.keys(obj).indexOf(f.code)+1;
        const value = obj[f.code]; if (typeof value !== 'string') fail('TEXT_CELL_REQUIRED',rowNum,column);
        const text = value as string;
        result.cells.push({row:rowNum,sourceRow:physicalRows[index]??rowNum,column,field:f.code,value:text,sourceType:format === 'XLSX' ? 'TEXT' : format});
        if(text.includes('\uFEFF'))fail('BOM_NOT_PREFIX',rowNum,column);
        if(!text.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(text))fail('TEXT_CONTROL',rowNum,column);
        if (text !== text.trim()) fail('WHITESPACE_REJECTED',rowNum,column);
        if (f.type === 'datetime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)) fail('LOCAL_TIME_REQUIRED',rowNum,column);
        row[f.code] = text;
      }
      if (Object.values(row).every(v=>v==='')) fail('EMPTY_ROW',rowNum); result.rows.push(row);
    }
    result.structuralStatus = 'PARSED';
  } catch (error) { result.rows = []; result.issues.push(error instanceof ParseFailure ? {code:error.code,row:error.row,column:error.column} : {code:'PARSER_FAILED',row:0,column:0}); }
  if (Buffer.byteLength(JSON.stringify(result)) > 1048576) return {...result,structuralStatus:'REJECTED',rows:[],cells:[],issues:[{code:'RESULT_LIMIT',row:0,column:0}]};
  return result;
}
function tableObjects(table: string[][], fields: ParserField[], physicalRows?:number[]): Array<Record<string,string>> {
  const header = table[0]; if (!header) return fail('NO_DATA');
  if (new Set(header).size !== header.length) fail('DUPLICATE_FIELD',1);
  if (header.length !== fields.length || header.some(h=>!fields.some(f=>f.code===h))) fail('FIELD_CONTRACT',1);
  return table.slice(1).map((row,index)=> { if (row.length !== header.length) fail('FIELD_CONTRACT',physicalRows?.[index+1]??index+2); return Object.fromEntries(header.map((key,col)=>[key,row[col]!])); });
}

if (!isMainThread && parentPort) {
  try { parentPort.postMessage(parseBytes(workerData.bytes,workerData.format,workerData.fields)); }
  catch { parentPort.postMessage(null); }
}
