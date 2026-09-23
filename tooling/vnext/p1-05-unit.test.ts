import {zipText,textWorkbook,issueWorkbook} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {test,expect} from 'vitest';
import * as parser from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';
test('three worksheet parsing follows declared relationships and preserves coordinates despite order',()=>{
 const fields={ORG01:[{code:'legal_entity_id',type:'id'}],ORG02:[{code:'campus_id',type:'id'}],ORG03:[{code:'legal_campus_rel_id',type:'id'}]};
 const bytes=organizationWorkbook({ORG03:[['legal_campus_rel_id'],['REL_A']],ORG01:[['legal_entity_id'],['001']],ORG02:[['campus_id'],['CAMP_A']]});
 expect(parser).toHaveProperty('parseOrganizationWorkbook');
 const result=parser.parseOrganizationWorkbook(bytes,fields);
 expect(result.structuralStatus).toBe('PARSED');expect(result.sheets.ORG01.rows).toEqual([{legal_entity_id:'001'}]);expect(result.sheets.ORG03.cells[0]).toMatchObject({sheet:'ORG03',sourceRow:2,column:1,value:'REL_A'});
});

test('multi-sheet policy rejects hidden or duplicate sheets without widening the old parser',()=>{
 const fields={ORG01:[{code:'id',type:'id'}],ORG02:[{code:'id',type:'id'}],ORG03:[{code:'id',type:'id'}]};
 const bytes=organizationWorkbook({ORG01:[['id'],['S']],ORG02:[['id']],ORG03:[['id']]});
 expect(parser.parseBytes(bytes,'XLSX',[{code:'id',type:'id'}],'STRICT_V2').structuralStatus).toBe('REJECTED');
 const parts=Object.fromEntries(parser.unzip(bytes,true));parts['xl/workbook.xml']=parts['xl/workbook.xml']!.replace('name="ORG02"','name="ORG02" state="hidden"');
 expect(parser.parseOrganizationWorkbook(zipText(parts),fields).structuralStatus).toBe('REJECTED');
 parts['xl/workbook.xml']=parts['xl/workbook.xml']!.replace('name="ORG02" state="hidden"','name="ORG01"');expect(parser.parseOrganizationWorkbook(zipText(parts),fields).issues[0]!.code).toBe('SHEET_CONTRACT');
});
test('business offset text and leading zeros survive; active content reports its actual worksheet',()=>{
 const fields={ORG01:[{code:'t',type:'datetime'}],ORG02:[{code:'id',type:'id'}],ORG03:[{code:'id',type:'id'}]},bytes=organizationWorkbook({ORG01:[['t'],['2026-01-01T00:00:00.123456+08:00']],ORG02:[['id'],['0001']],ORG03:[['id'],['R']]});
 const result=parser.parseOrganizationWorkbook(bytes,fields);expect(result.structuralStatus).toBe('PARSED');expect(result.sheets.ORG01.rows[0]!['t']).toBe('2026-01-01T00:00:00.123456+08:00');
 const files=Object.fromEntries(parser.unzip(bytes,true));files['xl/worksheets/sheet7.xml']=files['xl/worksheets/sheet7.xml']!.replace('<is><t xml:space="preserve">R</t></is>','<f>1+1</f><v>2</v>');expect(parser.parseOrganizationWorkbook(zipText(files),fields).issues[0]).toEqual({code:'ACTIVE_CONTENT',row:2,column:1,sheet:'ORG03'});
});

test('only declared organization workbook CORE capabilities are ready',()=>{
 const request={dataset:'ORG01',profile:'CORE' as const,contractVersion:1,templateVersion:'ORG01_BUNDLE_CORE_V1',parserPolicy:'STRICT_ORG_BUNDLE_V1'};
 expect(selectImportAdapter(request).capability).toBe('READY');
 for(const overrides of [{profile:'FULL' as const},{parserPolicy:'STRICT_V2'},{templateVersion:'ORG01_MANUAL_CORE_V1'},{dataset:'ORG04'}])expect(selectImportAdapter({...request,...overrides}).capability).toBe('NOT_READY');
});


test('organization parser errors retain physical worksheet rows, while header errors stay on row one',()=>{
 const fields={ORG01:[{code:'id',type:'id'},{code:'t',type:'datetime'}],ORG02:[{code:'id',type:'id'}],ORG03:[{code:'id',type:'id'}]};
 for(const [bad,code,column] of [
  [[' PAD','2026-01-01T00:00:00'],'WHITESPACE_REJECTED',1],
  [['ROW','not-a-date'],'LOCAL_TIME_REQUIRED',2],
  [['',''],'EMPTY_ROW',0],
 ] as const){
  for(const preceding of [[],[['OK','2026-01-01T00:00:00']]]){
   const result=parser.parseOrganizationWorkbook(organizationWorkbook({ORG01:[['id','t'],...preceding,[...bad]],ORG02:[['id']],ORG03:[['id']]}),fields);
   expect(result.structuralStatus).toBe('REJECTED');
   expect(result.issues[0]).toMatchObject({code,row:preceding.length+2,column,sheet:'ORG01'});
  }
 }
 const header=parser.parseOrganizationWorkbook(organizationWorkbook({ORG01:[['id','unknown']],ORG02:[['id']],ORG03:[['id']]}),fields);
 expect(header.issues[0]).toMatchObject({code:'FIELD_CONTRACT',row:1,sheet:'ORG01'});
});

test('single-sheet and multiline CSV field failures use source coordinates without shifting canonical rows',()=>{
 const fields=[{code:'id',type:'id'},{code:'t',type:'datetime'}];
 const csv=parser.parseBytes(Buffer.from('id,t\n"multi\nline",2026-01-01T00:00:00\nNEXT,bad-date'),'CSV',fields,'STRICT_V2');
 expect(csv.issues[0]).toMatchObject({code:'LOCAL_TIME_REQUIRED',row:4,column:2});
 expect(csv.cells.find(c=>c.field==='t'&&c.row===2)).toMatchObject({row:2,sourceRow:4,column:2});
 expect(parser.unzip(issueWorkbook(csv)).get('xl/worksheets/sheet1.xml')).toContain('bad-date');
 const xlsx=parser.parseBytes(textWorkbook([['id','t'],['ROW','bad-date']]),'XLSX',fields,'STRICT_V2');
 expect(xlsx.issues[0]).toMatchObject({code:'LOCAL_TIME_REQUIRED',row:2,column:2});
});
