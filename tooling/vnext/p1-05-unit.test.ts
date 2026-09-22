import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
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
