import {randomUUID} from 'node:crypto';
import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {planBinding} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
import {peer,quote} from './lineage.mjs';
import {fixture} from './protected-fixture.js';
import type {DepartmentStageInput as StageInput} from '../../apps/governance-api/src/modules/department-master/index.js';

export async function departmentFixture(receipt:{name:string},catalog:Catalog,provider:KeyProviderPort,options:{persistentSmoke?:boolean;reusePublishedContract?:boolean;requestId?:()=>string;freezeCommand?:(name:string,input:Record<string,unknown>)=>Record<string,unknown>}={}){
 const nextId=options.requestId??randomUUID;
 const freeze=options.freezeCommand??((_name:string,input:Record<string,unknown>)=>input);
 if(!options.persistentSmoke)await fixture(catalog,{textField:true});
 const prior=options.persistentSmoke?(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG04'&&c.profile==='CORE'):undefined;
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&(!options.reusePublishedContract||!prior||i.versionId===prior.definition.sourceVersionId));if(!source)throw new Error('SOURCE_NOT_READY');
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:nextId(),reason:'SYNTHETIC_DEPARTMENT',...extra});
 const create=cmd('CREATE',{kind:'DATASET',code:'ORG04',values:{name:'DEMO 科室'},validFrom:'2026-01-01T00:00:00'}),submitId=nextId(),publishId=nextId();
 const existing=options.persistentSmoke?(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='DATASET'&&i.code==='ORG04'):undefined;
 let dataset:{id:string;versionId:string};
 if(existing?.status==='PUBLISHED')dataset={id:existing.id,versionId:existing.versionId};
 else{
  const d=await catalog.command('maker',create);
  const submit=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:submitId,reason:'SYNTHETIC_DEPARTMENT',target:d.id,expectedHead:d.head});
  dataset=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:publishId,reason:'SYNTHETIC_DEPARTMENT',target:d.id,expectedHead:submit.head,reviewDigest:submit.reviewDigest});
 }
 const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!.payload.fields!.map(f=>f.original);
 const enums={org_type:['ADMIN','CLINICAL','MEDTECH','PHARMACY','NURSING','SUPPORT','MANAGEMENT_CENTER','OTHER'],is_virtual:['Y','N'],record_status:['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']};
 const definition={templateVersion:'ORG04_CORE_V1',ruleVersion:'ORG04_CORE_V1',sourceVersionId:source.versionId,businessKey:['org_id'],fields:fields.map(f=>({code:f.code,type:f.type,required:f.required,privacy:f.privacy,condition:f.required==='C'?'EVALUATED':f.required==='R'?'ALWAYS':'OPTIONAL',enumValues:enums[f.code as keyof typeof enums]??[]})),rules:[...conditionMappings.filter(r=>r.dataset==='ORG04').map(r=>({id:r.id,field:r.field,text:r.text,status:'MACHINE',version:r.version})),{id:'DEPARTMENT_APPROVAL_V1',field:'approval_ref',text:'Source approval never replaces platform approval.',status:'MACHINE',version:'P2_01_V1'}],references:fields.filter(f=>f.ref).map(f=>({field:f.code,target:f.ref,status:'DEPARTMENT_CORE'})),codeSets:Object.entries(enums).map(([field,codes])=>({field,codes,codeSystem:'SYNTHETIC_'+field.toUpperCase(),version:'DEMO_1',status:'SYNTHETIC_ADOPTED',sourceVersionId:source.versionId,validFrom:'2026-01-01T00:00:00',validTo:null}))};
 const contract=options.reusePublishedContract&&prior?.status==='PUBLISHED'?{id:prior.id,versionId:prior.versionId}:await(async()=>{
 const draft=await catalog.contractCommand('maker',freeze('contract-draft',prior?cmd('REVISE',{target:prior.id,expectedHead:prior.head,datasetVersionId:dataset.versionId,validFrom:'2026-01-01T00:00:00',validTo:null,definition}):cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition})));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
 const impact=options.persistentSmoke?await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH'):undefined;
 return catalog.contractCommand('reviewer',freeze('contract-publish',cmd('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,...(impact?{impactDigest:impact.impactDigest}:{})})));
 })();
 if(!options.persistentSmoke)peer(receipt.name,`INSERT INTO vnext_control.department_write_authority(key_hex) VALUES(${quote(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}))});`,{sensitive:true});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const newJob=()=>catalog.importJobCommand('maker',{action:'CREATE',scope:'SYNTHETIC',reason:'SYNTHETIC_DEPARTMENT',requestId:nextId(),profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},contractId:contract.id,contractVersionId:contract.versionId});
 const proofJob=await newJob();
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:nextId(),jobId:proofJob.id,revisionId:proofJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('DEMO identity and historical verification evidence'));
 const entry=():StageInput['entries'][number]=>({intent:'CREATE',target:null,origin:'NEW',evidenceId:artifact.artifactId,row:{org_id:nextId(),org_code:'DEMO_'+nextId(),org_name:'DEMO 同名科室',org_short_name:'',org_type:'CLINICAL',established_on:'2026-01-01',abolished_on:'',establishment_doc:'DEMO_DOC',description:'DEMO responsibilities',is_virtual:'N',version_no:'9',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:source.id,source_record_id:'DEMO_FILE/ORG04/2',approval_ref:'DEMO_APPROVAL',recorded_at:'2026-01-02T00:00:00'}});
 const input=async(entries=[entry()]):Promise<StageInput>=>{const j=await newJob();return {requestId:nextId(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries};};
 return {entry,input,newJob,artifact,contract,dataset,source};
}
