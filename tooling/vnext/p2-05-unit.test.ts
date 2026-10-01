import {test,expect} from 'vitest';
import {validateSuccessionGraph} from '../../apps/governance-api/src/modules/department-master/index.js';
import {parseEvolutionWorkbook,unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {selectImportAdapter,requireImportExecution} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';

test.each([['ORG26','ORG_EVOLUTION_CORE_V1'],['ORG27','ORG_SUCCESSION_CORE_V1']])('the %s CORE adapter is executable only as a complete Owner event', (dataset,templateVersion)=>{
 const request={dataset,templateVersion,profile:'CORE' as const,contractVersion:1,parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'};
 expect(selectImportAdapter(request)).toMatchObject({owner:'department-master',capability:'READY',allowedIntents:['RENAME','SPLIT','MERGE']});
 expect(()=>requireImportExecution(request,'apply')).toThrow('BUNDLE_CONTEXT_REQUIRED');expect(selectImportAdapter({...request,profile:'FULL'}).capability).toBe('NOT_READY');expect(selectImportAdapter({...request,parserPolicy:'STRICT_V2'}).capability).toBe('NOT_READY');
});

test('the evolution workbook accepts exactly ORG26, ORG27 and ORG04 including an empty rename successor sheet',()=>{
 const fields={ORG26:[{code:'org_event_id',type:'ID'}],ORG27:[{code:'succession_id',type:'ID'}],ORG04:[{code:'org_id',type:'ID'}]};
 const parsed=parseEvolutionWorkbook(organizationWorkbook({ORG04:[['org_id']],ORG27:[['succession_id'],['REL-A']],ORG26:[['org_event_id'],['EVENT-A']]}),fields);
 expect(parsed).toMatchObject({policy:'STRICT_ORGANIZATION_EVOLUTION_V1',structuralStatus:'PARSED',issues:[],sheets:{ORG26:{rows:[{org_event_id:'EVENT-A'}]},ORG27:{rows:[{succession_id:'REL-A'}]},ORG04:{rows:[]}}});
 expect(parsed.sheets.ORG26.cells[0]).toMatchObject({row:1,sourceRow:2,sheet:'ORG26'});
});

test('a rename records the same Department without introducing a succession cycle',()=>{
 const result=validateSuccessionGraph({changeType:'RENAME',predecessors:['A'],successors:['A'],edges:[{from:'A',to:'A',scope:'LABEL',context:''}]});
 expect(result).toEqual({edges:[],issues:[]});
});

test('a split retains each explicitly assigned successor and its business context',()=>{
 const edges=[{from:'A',to:'B',scope:'OUTPATIENT',context:'Outpatient work to B'},{from:'A',to:'C',scope:'INPATIENT',context:'Inpatient work to C'}];
 expect(validateSuccessionGraph({changeType:'SPLIT',predecessors:['A'],successors:['B','C'],edges})).toEqual({edges,issues:[]});
});

test('a merge keeps both predecessor links rather than selecting one source',()=>{
 const edges=[{from:'A',to:'C',scope:'BUSINESS',context:''},{from:'B',to:'C',scope:'BUSINESS',context:''}];
 expect(validateSuccessionGraph({changeType:'MERGE',predecessors:['A','B'],successors:['C'],edges})).toEqual({edges,issues:[]});
});

test.each([
 ['duplicate edge',[{from:'A',to:'B',scope:'BUSINESS',context:'B'},{from:'A',to:'B',scope:'BUSINESS',context:'B'}],'BATCH_CONFLICT'],
 ['unbound target',[{from:'A',to:'B',scope:'BUSINESS',context:'B'},{from:'A',to:'D',scope:'BUSINESS',context:'D'}],'BLOCKED_DEPENDENCY'],
 ['missing split destination rule',[{from:'A',to:'B',scope:'BUSINESS',context:''},{from:'A',to:'C',scope:'BUSINESS',context:'C'}],'CONTEXT_REQUIRED'],
] as const)('the succession graph rejects %s',(_label,edges,code)=>{
 expect(validateSuccessionGraph({changeType:'SPLIT',predecessors:['A'],successors:['B','C'],edges:[...edges]}).issues).toEqual(expect.arrayContaining([expect.objectContaining({code,status:'FAIL'})]));
});

test('accepted ancestry participates in cycle validation',()=>{
 const result=validateSuccessionGraph({changeType:'SPLIT',predecessors:['A'],successors:['B','C'],edges:[{from:'A',to:'B',scope:'BUSINESS',context:'B'},{from:'A',to:'C',scope:'BUSINESS',context:'C'}],acceptedEdges:[{from:'B',to:'D'},{from:'D',to:'A'}]});
 expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SUCCESSION_CYCLE'})]));expect(result.edges).toEqual([]);
});

test.each([
 ['numeric identity',(xml:string)=>xml.replace('<c r="A2" t="inlineStr"><is><t xml:space="preserve">EVENT-A</t></is></c>','<c r="A2"><v>123</v></c>'),'TEXT_CELL_REQUIRED'],
 ['formula',(xml:string)=>xml.replace('<is><t xml:space="preserve">EVENT-A</t></is>','<f>1+1</f><v>2</v>'),'ACTIVE_CONTENT'],
 ['hidden row',(xml:string)=>xml.replace('<row r="2">','<row r="2" hidden="1">'),'HIDDEN_UNDECLARED'],
 ['default hidden rows',(xml:string)=>xml.replace('<sheetData>','<sheetFormatPr zeroHeight="1"/><sheetData>'),'HIDDEN_UNDECLARED'],
 ['unknown column',(xml:string)=>xml.replace('org_event_id','unapproved_field'),'FIELD_CONTRACT'],
] as const)('evolution parsing retains the original %s rejection',(_label,mutate,code)=>{
 const bytes=organizationWorkbook({ORG26:[['org_event_id'],['EVENT-A']],ORG27:[['succession_id'],['REL-A']],ORG04:[['org_id']]});
 const parts=Object.fromEntries(unzip(bytes,true));parts['xl/worksheets/sheet9.xml']=mutate(parts['xl/worksheets/sheet9.xml']!);
 const result=parseEvolutionWorkbook(zipText(parts),{ORG26:[{code:'org_event_id',type:'id'}],ORG27:[{code:'succession_id',type:'id'}],ORG04:[{code:'org_id',type:'id'}]});
 expect(result).toMatchObject({structuralStatus:'REJECTED',issues:[{code,sheet:'ORG26'}]});expect(Object.values(result.sheets).every(sheet=>sheet.rows.length===0)).toBe(true);
});
