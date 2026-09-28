import {test,expect} from 'vitest';
import {draftMetadata,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/workspace/contracts.js';

const ids={
 contract1:'11111111-1111-4111-8111-111111111111',contract2:'22222222-2222-4222-8222-222222222222',contract3:'33333333-3333-4333-8333-333333333333',
 version1:'44444444-4444-4444-8444-444444444444',version2:'55555555-5555-4555-8555-555555555555',version3:'66666666-6666-4666-8666-666666666666',
 subject:'77777777-7777-4777-8777-777777777777',campus:'88888888-8888-4888-8888-888888888888',relation:'99999999-9999-4999-8999-999999999999',
};
const contracts=[
 {dataset:'ORG01' as const,contractId:ids.contract1,contractVersionId:ids.version1},
 {dataset:'ORG02' as const,contractId:ids.contract2,contractVersionId:ids.version2},
 {dataset:'ORG03' as const,contractId:ids.contract3,contractVersionId:ids.version3},
];
function content():Extract<DraftContent,{domain:'BUNDLE'}>{return {domain:'BUNDLE',campus:'NORTH',metadata:{contracts,manifest:{policy:'ORG_BUNDLE_V1',rows:[
 {dataset:'ORG01',row:2,intent:'REVISE',governanceScope:'NORTH',sourceVersionId:ids.version1,target:{owner:'organization-master',id:ids.subject,expectedVersion:'7'}},
 {dataset:'ORG03',row:3,intent:'REVISE',governanceScope:'NORTH',sourceVersionId:ids.version3,target:{owner:'organization-master/operating-relation',id:ids.relation,expectedVersion:'4'},subject:{kind:'PLATFORM_REF',dataset:'ORG01',id:ids.subject,expectedVersion:'7'},campus:{kind:'PLATFORM_REF',dataset:'ORG02',id:ids.campus,expectedVersion:'9'}},
 ]}}};}

test('current V3 authenticates exact workbook targets and ORG03 platform endpoints',()=>{
 const metadata=draftMetadata(content());
 expect(metadata.manifestProtected).toBe(true);
 expect(metadata.manifestReferences).toEqual([
  {row:2,dataset:'ORG01',scope:'NORTH',intent:'REVISE',target:{owner:'organization-master',id:ids.subject,version:'7'},subject:null,campus:null},
  {row:3,dataset:'ORG03',scope:'NORTH',intent:'REVISE',target:{owner:'organization-master/operating-relation',id:ids.relation,version:'4'},subject:{id:ids.subject,version:'7'},campus:{id:ids.campus,version:'9'}},
 ]);
});

test('historical V2 projection does not invent exact manifest references',()=>{
 const metadata=draftMetadata(content(),'V2');
 expect(metadata).not.toHaveProperty('manifestProtected');
 expect(metadata).not.toHaveProperty('manifestReferences');
});

test('alias-only create rows produce an authenticated empty reference set',()=>{
 const value=content();
 const manifest=value.metadata['manifest'] as {rows:Array<Record<string,unknown>>};
 manifest.rows=[{dataset:'ORG03',row:2,intent:'CREATE',governanceScope:'NORTH',sourceVersionId:ids.version3,subject:{kind:'JOB_ALIAS',dataset:'ORG01',alias:'SUBJECT'},campus:{kind:'JOB_ALIAS',dataset:'ORG02',alias:'CAMPUS'}}];
 expect(draftMetadata(value).manifestReferences).toEqual([]);
});

test('changing an exact target or endpoint changes the authenticated projection',()=>{
 const first=draftMetadata(content()).manifestReferences;
 const changed=content();
 const manifest=changed.metadata['manifest'] as {rows:Array<Record<string,unknown>>},row=manifest.rows[1]!,subject=row['subject'] as Record<string,unknown>;if(row['dataset']!=='ORG03'||subject['kind']!=='PLATFORM_REF')throw new Error('FIXTURE_SHAPE');
 subject['id']='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 expect(draftMetadata(changed).manifestReferences).not.toEqual(first);
});

test('an incomplete ORG03 platform endpoint id is protected before kind is selected',()=>{
 const value=content();
 const manifest=value.metadata['manifest'] as {rows:Array<Record<string,unknown>>};
 manifest.rows=[{dataset:'ORG03',row:2,intent:null,governanceScope:'NORTH',sourceVersionId:ids.version3,subject:{dataset:'ORG01',id:ids.subject,expectedVersion:'7'},campus:{kind:'JOB_ALIAS',dataset:'ORG02',alias:'CAMPUS'}}];
 expect(draftMetadata(value).manifestReferences).toEqual([
  {row:2,dataset:'ORG03',scope:'NORTH',intent:null,target:null,subject:{id:ids.subject,version:'7'},campus:null},
 ]);
});
