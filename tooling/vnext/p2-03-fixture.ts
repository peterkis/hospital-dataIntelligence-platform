import {randomUUID} from 'node:crypto';
import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openDepartment,type OrganizationMappingStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
import {departmentFixture} from './p2-01-fixture.js';
import {peer,quote} from './lineage.mjs';

export async function organizationMappingFixture(receipt:{name:string},catalog:Catalog,provider:KeyProviderPort,connection:string,departmentConstructor= openDepartment,existingDepartment?:Awaited<ReturnType<typeof departmentFixture>>){
 const department=existingDepartment??await departmentFixture(receipt,catalog,provider),owner=departmentConstructor(connection,provider);
 let targetId:string;
 try{
  const input=await department.input(),staged=await owner.stage('maker',input);
  await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO actual Department',evidenceId:department.artifact.artifactId}]});
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
  await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
  const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');targetId=result.facts[0]!.id;
 }finally{await owner.close();}
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_ORGANIZATION_MAPPING',...extra});
 const draft=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG22',values:{name:'DEMO 组织源映射'},validFrom:'2026-01-01T00:00:00'}));
 const submit=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
 const dataset=await catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:submit.head,reviewDigest:submit.reviewDigest}));
 const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!.payload.fields!.map(f=>f.original);
 const enums:Record<string,string[]>={target_type:['LEGAL','CAMPUS','ORG','UNIT','WARD','NURSING','TEAM','LOCATION'],mapping_relation:['EXACT','BROADER','NARROWER','RELATED','UNRESOLVED'],record_status:['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']};
 const definition={templateVersion:'ORG22_CORE_V1',ruleVersion:'ORG22_CORE_V1',sourceVersionId:department.source.versionId,businessKey:['org_map_id'],fields:fields.map(f=>({code:f.code,type:f.type,required:f.required,privacy:f.privacy,condition:f.required==='C'?'EVALUATED':f.required==='R'?'ALWAYS':'OPTIONAL',enumValues:enums[f.code]??[]})),rules:[...conditionMappings.filter(r=>r.dataset==='ORG22').map(r=>({id:r.id,field:r.field,text:r.text,status:'MACHINE',version:r.version})),{id:'ORG_MAPPING_APPROVAL_V1',field:'approval_ref',text:'Source approval never replaces platform approval.',status:'MACHINE',version:'P2_03_V1'}],references:fields.filter(f=>f.ref).map(f=>({field:f.code,target:f.ref,status:'ORGANIZATION_MAPPING_CORE'})),codeSets:Object.entries(enums).map(([field,codes])=>({field,codes,codeSystem:'SYNTHETIC_'+field.toUpperCase(),version:'DEMO_1',status:'SYNTHETIC_ADOPTED',sourceVersionId:department.source.versionId,validFrom:'2026-01-01T00:00:00',validTo:null}))};
 const contractDraft=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition}));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:contractDraft.id,expectedHead:contractDraft.head,reviewDigest:contractDraft.reviewDigest}));
 const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:contractDraft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const grantNamespace=(sourceId=department.source.id,context='DEFAULT')=>peer(receipt.name,`INSERT INTO department_master.mapping_access SELECT a,${quote(sourceId)}::uuid,'DEPARTMENT',${quote(context)},'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING; INSERT INTO department_master.mapping_access SELECT 'reviewer',${quote(sourceId)}::uuid,'DEPARTMENT',${quote(context)},'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;`);
 const grantTarget=(id=targetId,type='ORG')=>peer(receipt.name,`INSERT INTO department_master.mapping_target_access SELECT a,${quote(type)},${quote(id)}::uuid,'NORTH' FROM unnest(ARRAY['maker','maker-alias','reviewer']) a ON CONFLICT DO NOTHING;`);
 grantNamespace();grantTarget();
 const newJob=()=>catalog.importJobCommand('maker',cmd('CREATE',{contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
 const proof=await newJob();
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proof.id,revisionId:proof.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('DEMO explicit source namespace, approved context and target mapping evidence'));
 const entry=():OrganizationMappingStageInput['entries'][number]=>({action:'REGISTER',mapping:null,reason:'DEMO_REGISTER',evidenceId:artifact.artifactId,row:{org_map_id:randomUUID(),from_system_id:department.source.id,source_entity_type:'DEPARTMENT',source_code:'DEMO_'+randomUUID(),source_name:'DEMO name is never a key',source_context:'DEFAULT',target_type:'ORG',target_id:targetId,mapping_relation:'EXACT',resolution_rule:'',verified_by:'DEMO Information management',version_no:'9',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:department.source.id,source_record_id:'DEMO/ORG22/2',approval_ref:'DEMO_APPROVAL',recorded_at:'2026-01-02T00:00:00'}});
 const input=async(entries=[entry()]):Promise<OrganizationMappingStageInput>=>{const j=await newJob();return {requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',entries};};
 const newDepartment=async()=>{
  const owner=departmentConstructor(connection,provider);
  try{
   const staged=await owner.stage('maker',await department.input());await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO mapping correction target',evidenceId:department.artifact.artifactId}]});
   const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
   const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result.facts[0]!.id;
  }finally{await owner.close();}
 };
 const newSource=async()=>{
  const draft=await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'DEMO_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'DEMO other source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:department.source.id},validFrom:'2026-01-01T00:00:00'}));
  const submitted=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));return catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
 };
 return {entry,input,artifact,contract,dataset,source:department.source,targetId,grantNamespace,grantTarget,catalog,newDepartment,newSource,department};
}
