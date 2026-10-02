import {test,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {validateSuccessionGraph,evolutionExpandedWriteCount,type EvolutionStoredStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {normalizeEntry} from '../../apps/governance-api/src/modules/department-master/vnext/contracts.js';
import {assertEvolutionApplyBinding} from '../../apps/governance-api/src/modules/department-master/vnext/organization-evolution.js';
import {LocalSyntheticKeyProvider,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {parseEvolutionWorkbook,unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {selectImportAdapter,requireImportExecution} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';

test.each([['ORG26','ORG_EVOLUTION_CORE_V1'],['ORG27','ORG_SUCCESSION_CORE_V1']])('the %s CORE adapter is executable only as a complete Owner event', (dataset,templateVersion)=>{
 const request={dataset,templateVersion,profile:'CORE' as const,contractVersion:1,parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1'};
 expect(selectImportAdapter(request)).toMatchObject({owner:'department-master',capability:'READY',allowedIntents:['RENAME','SPLIT','MERGE']});
 expect(()=>requireImportExecution(request,'apply')).toThrow('BUNDLE_CONTEXT_REQUIRED');expect(selectImportAdapter({...request,profile:'FULL'}).capability).toBe('NOT_READY');expect(selectImportAdapter({...request,parserPolicy:'STRICT_V2'}).capability).toBe('NOT_READY');
});

test('the whole-event budget counts hidden successor writes rather than the single root command',()=>{
 const base={event:{change_type:'SPLIT'},successors:Array.from({length:20},()=>({})),relations:Array.from({length:20},()=>({})),predecessors:[{}]} as unknown as EvolutionStoredStageInput;
 expect(evolutionExpandedWriteCount(base)).toBe(102);
 expect(evolutionExpandedWriteCount({...base,event:{change_type:'RENAME'},successors:[],relations:[{}],predecessors:[{}]} as unknown as EvolutionStoredStageInput)).toBe(3);
});

test('the final apply payload binds each successor to its source pin, evidence digest and frozen budget',()=>{
 const provider=new LocalSyntheticKeyProvider(),source=randomUUID(),evidenceId=randomUUID(),policy=randomUUID(),verificationId=randomUUID();
 const entry={intent:'CREATE' as const,target:null,origin:'NEW' as const,evidenceId,row:{org_id:'SUCCESSOR-A',org_code:'D-A',org_name:'Successor A',org_short_name:'',org_type:'CLINICAL',established_on:'2026-06-01',abolished_on:'',establishment_doc:'DOC-A',description:'',is_virtual:'N' as const,version_no:'1',valid_from:'2026-06-01T00:00:00',valid_to:'',record_status:'ACTIVE' as const,source_system_id:source,source_record_id:'SRC/1',approval_ref:'APPROVED',recorded_at:'2026-05-01T00:00:00'}};
 const input={event:{change_type:'SPLIT'},successors:[entry],relations:[{}],predecessors:[{}],contracts:{departmentContractVersionId:policy}} as unknown as EvolutionStoredStageInput;
 const normalizedEntry=normalizeEntry(entry,'LOCAL'),{sourceRow:_,...normalized}=normalizedEntry,pin={sourceId:source,versionId:randomUUID()},material={id:evidenceId,digest:'a'.repeat(64)};
 const commandDigest=planBinding(provider,'EVOLUTION_DEPARTMENT_COMMAND_V1',{entry:normalized,policy,proof:{pin,material}});
 const successorFacts={name:entry.row.org_name,shortName:null,orgType:entry.row.org_type,establishedOn:entry.row.established_on,description:null,virtual:false,historicalException:false,sourceVersion:'1',sourceRecordedAt:normalizedEntry.recordedAt,sourceSystemId:source,policyVersionId:policy,verificationId,commandDigest,sourcePin:pin};
 const facts={verificationId,materials:[material],successorFacts:[{alias:entry.row.org_id,facts:successorFacts,contentDigest:planBinding(provider,'DEPARTMENT_FACTS_V1',successorFacts)}]},expandedCount=String(evolutionExpandedWriteCount(input));
 expect(()=>assertEvolutionApplyBinding(provider,input,facts,expandedCount)).not.toThrow();
 const wrongSource=structuredClone(facts);wrongSource.successorFacts[0]!.facts.sourceSystemId=randomUUID();expect(()=>assertEvolutionApplyBinding(provider,input,wrongSource,expandedCount)).toThrow('STALE_VALIDATION');
 const wrongEvidence=structuredClone(facts);wrongEvidence.materials[0]!.digest='b'.repeat(64);expect(()=>assertEvolutionApplyBinding(provider,input,wrongEvidence,expandedCount)).toThrow('STALE_VALIDATION');
 expect(()=>assertEvolutionApplyBinding(provider,input,facts,'1')).toThrow('STALE_VALIDATION');
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
