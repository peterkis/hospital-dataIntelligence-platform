import {randomUUID} from 'node:crypto';
import type {Catalog,KeyProviderPort,CatalogField} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {EvolutionStageInput,OrganizationIdentifierStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {EVOLUTION_IMPACT_DOMAINS} from '../../apps/governance-api/src/modules/department-master/index.js';
import {conditionMappings} from '../../apps/governance-api/src/modules/governance-catalog/validation-sources.generated.js';
import {organizationMappingFixture} from './p2-03-fixture.js';
import {peer,quote} from './lineage.mjs';
import {organizationIdentifierContractDefinition} from './p2-04-contract-fixture.js';

export function evolutionContractDefinition(dataset:string,fields:CatalogField['original'][],sourceVersionId:string){
 const enums:Record<string,string[]>={change_type:['RENAME','SPLIT','MERGE'],from_target_type:['ORG'],to_target_type:['ORG']};
 return {templateVersion:dataset==='ORG26'?'ORG_EVOLUTION_CORE_V1':'ORG_SUCCESSION_CORE_V1',ruleVersion:'ORG_EVOLUTION_CORE_V1',sourceVersionId,businessKey:[dataset==='ORG26'?'org_event_id':'succession_id'],
  fields:fields.map(f=>({code:f.code,type:f.type,required:f.required,privacy:f.privacy,condition:f.required==='C'?'EVALUATED':f.required==='R'?'ALWAYS':'OPTIONAL',enumValues:enums[f.code]??[]})),
  // MACHINE evaluates whether the independent evidence gate is complete; it
  // never claims the document proves the real-world impact without its reviewer.
  rules:conditionMappings.filter(r=>r.dataset===dataset).map(r=>({id:r.id,field:r.field,text:r.text,status:'MACHINE',version:r.version})),
  references:fields.filter(f=>f.ref).map(f=>({field:f.code,target:f.ref,status:'ORGANIZATION_EVOLUTION_CORE'})),
  codeSets:Object.entries(enums).filter(([field])=>fields.some(f=>f.code===field)).map(([field,codes])=>({field,codes,codeSystem:'SYNTHETIC_ORGANIZATION_PERSONNEL',version:'DEMO_1',status:'SYNTHETIC_ADOPTED',sourceVersionId,validFrom:'2026-01-01T00:00:00',validTo:null}))};
}
export async function evolutionFixture(receipt:{name:string},catalog:Catalog,provider:KeyProviderPort,connection:string,existingBase?:Awaited<ReturnType<typeof organizationMappingFixture>>){
 const base=existingBase??await organizationMappingFixture(receipt,catalog,provider,connection);
 peer(receipt.name,"INSERT INTO department_master.access VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;");
 peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH','READ' FROM unnest(ARRAY['maker','maker-alias','reviewer']) a ON CONFLICT DO NOTHING;");
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_EVOLUTION',...extra});
 const publish=async(code:string)=>{
  const draft=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code,values:{name:'DEMO '+code},validFrom:'2026-01-01T00:00:00'}));
  const submitted=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
  const dataset=await catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
  const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!.payload.fields!.map(f=>f.original);
  const definition=code==='ORG23'?organizationIdentifierContractDefinition(fields,base.source.versionId):evolutionContractDefinition(code,fields,base.source.versionId);
  const cd=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition}));
  const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:cd.id,expectedHead:cd.head,reviewDigest:cd.reviewDigest}));
  const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:cd.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
  return {dataset,contract};
 };
 const event=await publish('ORG26'),succession=await publish('ORG27');
 const identifier=await publish('ORG23');
 peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_ALIAS','NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;INSERT INTO department_master.identifier_access SELECT 'reviewer','SYNTHETIC_ALIAS','NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;");
 const identifierJob=()=>catalog.importJobCommand('maker',cmd('CREATE',{contractId:identifier.contract.id,contractVersionId:identifier.contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
 const identifierProofJob=await identifierJob(),identifierProof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:identifierProofJob.id,revisionId:identifierProofJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('TEST POLICY ONLY independent organization alias material'));
 const identifierInput=async(id:string,from:string):Promise<OrganizationIdentifierStageInput>=>{
  const j=await identifierJob();return {requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',entries:[{action:'REGISTER',identifier:null,reason:'TEST POLICY ONLY explicit alias',evidenceId:identifierProof.artifactId,row:{org_identifier_id:randomUUID(),target_type:'ORG',target_id:id,identifier_kind:'ALIAS',identifier_system:'SYNTHETIC_ALIAS',identifier_value:'TEST_'+randomUUID(),language:'zh',is_preferred:'N',version_no:'1',valid_from:from,valid_to:'',record_status:'ACTIVE',source_system_id:base.source.id,source_record_id:'TEST/ORG23/2',approval_ref:'TEST_APPROVAL',recorded_at:'2026-01-02T00:00:00'}}]};
 };
 const newJob=()=>catalog.importJobCommand('maker',cmd('CREATE',{contractId:event.contract.id,contractVersionId:event.contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
 const proof=await newJob(),material=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proof.id,revisionId:proof.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('TEST POLICY ONLY: independent Department decision, impact declaration and migration/context evidence'));
 const input=async():Promise<EvolutionStageInput>=>{
  const j=await newJob(),alias=randomUUID();
  return {requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',
   event:{org_event_id:alias,change_type:'RENAME',effective_at:'2026-06-01T00:00:00',decision_ref:'DEMO_DECISION',reason:'DEMO explicit rename',historical_reporting_rule:'Preserve original assertions; restatement requires a separate snapshot',migration_plan_ref:'',recorded_at:'2026-05-01T00:00:00'},
   relations:[{succession_id:randomUUID(),org_event_id:alias,from_target_type:'ORG',from_target_id:base.targetId,to_target_type:'ORG',to_target_id:base.targetId,transfer_scope:'LABEL',context_rule:'',recorded_at:'2026-05-01T00:00:00'}],
   predecessors:[{owner:'department-master',id:base.targetId,expectedVersion:'1'}],successors:[],rename:{name:'DEMO renamed Department',shortName:'DEMO renamed'},
   contracts:{successionContractId:succession.contract.id,successionContractVersionId:succession.contract.versionId,departmentContractId:base.department.contract.id,departmentContractVersionId:base.department.contract.versionId},
   sourceSystemId:base.source.id,decisionEvidenceId:material.artifactId,migrationEvidenceId:null,contextEvidenceId:null,
   impacts:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,determination:'UNAFFECTED',ownerRole:'TEST_ONLY_'+domain,ownerSignatory:'TEST_ONLY_'+domain+'_OWNER',ownerDecisionRef:'TEST_ONLY_'+domain+'_DECISION',requiredAction:'',reason:'TEST POLICY ONLY independent no operational change evidence',evidenceId:material.artifactId}))};
 };
 const impactReviews=EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,ownerAttestationAccepted:true,dispositionAccepted:true,reason:'TEST POLICY ONLY independently verified external Owner attestation'}));
 return {...base,mappingInput:base.input,input,eventContract:event.contract,successionContract:succession.contract,eventDataset:event.dataset,material,newJob,impactReviews,identifierInput};
}
