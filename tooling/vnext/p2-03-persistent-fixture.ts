import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openDepartment} from '../../apps/governance-api/src/modules/department-master/index.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
import type {OrganizationMappingStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {peer,quote,identitySQL} from './lineage.mjs';

/** Uses the existing Department and Source Owners; no predecessor policy or fact is rewritten. */
export async function persistentOrganizationMappingFixture(receipt:{name:string;oid:string},catalog:Catalog,provider:KeyProviderPort,connection:string,requestId:(name:string)=>string,freeze:<T extends Record<string,unknown>>(name:string,value:T)=>T){
 const department=openDepartment(connection,provider);let targetId='';
 try{for(const id of await department.list('maker',{limit:100}))if((await department.coverage('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:null})).covered){targetId=id;break;}}finally{await department.close();}
 if(!targetId)throw new Error('P2_01_TARGET_REQUIRED');
 const items=(await catalog.read('maker',{scope:'SYNTHETIC'})).items,source=items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.validTo===null);if(!source)throw new Error('SOURCE_NOT_READY');
 const cmd=<A extends string>(action:A,name:string,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:requestId(name),reason:'SYNTHETIC_ORGANIZATION_MAPPING',...extra});
 const existing=items.find(i=>i.kind==='DATASET'&&i.code==='ORG22');let dataset:{id:string;versionId:string};
 if(existing?.status==='PUBLISHED')dataset=existing;
 else{
  const draft=await catalog.command('maker',freeze('dataset-draft',existing?cmd('REVISE','dataset-create',{target:existing.id,expectedHead:existing.head,values:{name:'DEMO organization source mappings'},validFrom:'2026-01-01T00:00:00'}):cmd('CREATE','dataset-create',{kind:'DATASET',code:'ORG22',values:{name:'DEMO organization source mappings'},validFrom:'2026-01-01T00:00:00'})));
  const submitted=await catalog.command('maker',freeze('dataset-submit',cmd('SUBMIT','dataset-submit',{target:draft.id,expectedHead:draft.head})));
  dataset=await catalog.command('reviewer',freeze('dataset-publish',cmd('PUBLISH','dataset-publish',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest})));
 }
 const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!.payload.fields!.map(f=>f.original);
 const enums:Record<string,string[]>={target_type:['LEGAL','CAMPUS','ORG','UNIT','WARD','NURSING','TEAM','LOCATION'],mapping_relation:['EXACT','BROADER','NARROWER','RELATED','UNRESOLVED'],record_status:['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']};
 const definition={templateVersion:'ORG22_CORE_V1',ruleVersion:'ORG22_CORE_V1',sourceVersionId:source.versionId,businessKey:['org_map_id'],fields:fields.map(f=>({code:f.code,type:f.type,required:f.required,privacy:f.privacy,condition:f.required==='C'?'EVALUATED':f.required==='R'?'ALWAYS':'OPTIONAL',enumValues:enums[f.code]??[]})),rules:[...conditionMappings.filter(r=>r.dataset==='ORG22').map(r=>({id:r.id,field:r.field,text:r.text,status:'MACHINE',version:r.version})),{id:'ORG_MAPPING_APPROVAL_V1',field:'approval_ref',text:'Source approval never replaces platform approval.',status:'MACHINE',version:'P2_03_V1'}],references:fields.filter(f=>f.ref).map(f=>({field:f.code,target:f.ref,status:'ORGANIZATION_MAPPING_CORE'})),codeSets:Object.entries(enums).map(([field,codes])=>({field,codes,codeSystem:'SYNTHETIC_'+field.toUpperCase(),version:'DEMO_1',status:'SYNTHETIC_ADOPTED',sourceVersionId:source.versionId,validFrom:'2026-01-01T00:00:00',validTo:null}))};
 const prior=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG22'&&c.profile==='CORE');
 const draft=await catalog.contractCommand('maker',freeze('contract-draft',prior?cmd('REVISE','contract-create',{target:prior.id,expectedHead:prior.head,datasetVersionId:dataset.versionId,validFrom:'2026-01-01T00:00:00',validTo:null,definition}):cmd('CREATE','contract-create',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition})));
 const approved=await catalog.contractCommand('reviewer',freeze('contract-approve',cmd('APPROVE','contract-approve',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest})));
 const impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 const contract=await catalog.contractCommand('reviewer',freeze('contract-publish',cmd('PUBLISH','contract-publish',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest})));
 peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);
 INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.mapping_access SELECT a,${quote(source.id)}::uuid,'DEPARTMENT','DEFAULT','NORTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.mapping_access SELECT 'reviewer',${quote(source.id)}::uuid,'DEPARTMENT','DEFAULT','NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.mapping_target_access SELECT a,'ORG',${quote(targetId)}::uuid,'NORTH' FROM unnest(ARRAY['maker','reviewer']) a ON CONFLICT DO NOTHING;COMMIT;`);
 const job=await catalog.importJobCommand('maker',freeze('mapping-job',cmd('CREATE','mapping-job',{profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},contractId:contract.id,contractVersionId:contract.versionId})));
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:requestId('mapping-evidence'),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('SYNTHETIC explicit source namespace, target and context approval evidence'));
 const input:OrganizationMappingStageInput={requestId:requestId('mapping-stage'),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',entries:[{action:'REGISTER',mapping:null,reason:'DEMO persistent registration',evidenceId:artifact.artifactId,row:{org_map_id:'PERSISTENT_DEMO_ROW',from_system_id:source.id,source_entity_type:'DEPARTMENT',source_code:'DEMO_PERSISTENT_SOURCE_CODE',source_name:'DEMO source name',source_context:'DEFAULT',target_type:'ORG',target_id:targetId,mapping_relation:'EXACT',resolution_rule:'',verified_by:'DEMO information management',version_no:'1',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:source.id,source_record_id:'DEMO/ORG22/2',approval_ref:'DEMO_APPROVAL',recorded_at:'2026-01-02T00:00:00'}}]};
 const frozen=freeze('mapping-stage-input',input);
 return {input:frozen,artifact,binding:{database:receipt.name,databaseOid:receipt.oid,sourceId:frozen.entries[0]!.row.from_system_id,entityType:'DEPARTMENT',context:'DEFAULT',campus:'NORTH',targetType:'ORG',targetId:frozen.entries[0]!.row.target_id}};
}
