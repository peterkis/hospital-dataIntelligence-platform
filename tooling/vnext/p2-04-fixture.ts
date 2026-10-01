import {ORG23_SYNTHETIC_CODES,organizationIdentifierContractDefinition} from './p2-04-contract-fixture.js';
import {randomUUID} from 'node:crypto';
import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {OrganizationIdentifierStageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {organizationMappingFixture} from './p2-03-fixture.js';
import {peer,quote} from './lineage.mjs';
export async function organizationIdentifierFixture(receipt:{name:string},catalog:Catalog,provider:KeyProviderPort,connection:string){
 const base=await organizationMappingFixture(receipt,catalog,provider,connection);
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'SYNTHETIC_ORG_IDENTIFIER',...extra});
 const draft=await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG23',values:{name:'DEMO 组织标识别名'},validFrom:'2026-01-01T00:00:00'}));
 const submitted=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
 const dataset=await catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
 const fields=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===dataset.id)!.payload.fields!.map(f=>f.original);
 const enums=ORG23_SYNTHETIC_CODES;
 const definition=organizationIdentifierContractDefinition(fields,base.source.versionId);
 const cd=await catalog.contractCommand('maker',cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,definition}));
 const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:cd.id,expectedHead:cd.head,reviewDigest:cd.reviewDigest}));
 const contract=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:cd.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const grantScheme=(scheme:string)=>peer(receipt.name,`INSERT INTO department_master.identifier_access SELECT a,${quote(scheme)},'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING; INSERT INTO department_master.identifier_access SELECT 'reviewer',${quote(scheme)},'NORTH',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;`);
 for(const scheme of enums['identifier_system']!)grantScheme(scheme);
 const newJob=()=>catalog.importJobCommand('maker',cmd('CREATE',{contractId:contract.id,contractVersionId:contract.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
 const proof=await newJob(),artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proof.id,revisionId:proof.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('DEMO independent organization personnel identifier and alias evidence'));
 const entry=():OrganizationIdentifierStageInput['entries'][number]=>({action:'REGISTER',identifier:null,reason:'DEMO_REGISTER',evidenceId:artifact.artifactId,row:{org_identifier_id:randomUUID(),target_type:'ORG',target_id:base.targetId,identifier_kind:'ALIAS',identifier_system:'SYNTHETIC_ALIAS',identifier_value:'DEMO alias',language:'zh',is_preferred:'N',version_no:'9',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:base.source.id,source_record_id:'DEMO/ORG23/2',approval_ref:'DEMO_APPROVAL',recorded_at:'2026-01-02T00:00:00'}});
 const input=async(entries=[entry()]):Promise<OrganizationIdentifierStageInput>=>{const j=await newJob();return {requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',entries};};
 return {...base,entry,input,artifact,contract,dataset,grantScheme};
}
