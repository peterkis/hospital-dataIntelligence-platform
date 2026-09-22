import {provisionBundleAuthority} from './bundle-authority.mjs';
import {randomUUID} from 'node:crypto';
import type {Catalog,KeyProviderPort} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import type {ReceiveOrganizationBundleInput} from '../../apps/governance-api/src/modules/organization-master/import/contracts.js';
import {operatingScenario} from './operating-scenario.js';
import {organizationImportContracts} from './organization-import-contract-fixture.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {peer,quote} from './lineage.mjs';
export async function organizationBundleFixture(receipt:{name:string},connection:string,provider:KeyProviderPort,catalog:Catalog,reusePublishedServiceCatalog=false){
 const x=await operatingScenario(receipt,connection,provider,catalog,reusePublishedServiceCatalog),contracts=await organizationImportContracts(catalog,x.source.versionId);
 provisionBundleAuthority(receipt,provider);
 const datasets=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.filter(i=>['ORG01','ORG02','ORG03'].includes(i.code)&&i.kind==='DATASET');
 for(const dataset of datasets)peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING`);
 peer(receipt.name,`INSERT INTO vnext_control.actor VALUES('bundle-admin','SYNTHETIC_BUNDLE_ADMIN',true) ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.actor_grant SELECT 'bundle-admin','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;
 INSERT INTO organization_master.bundle_administrator VALUES('bundle-admin') ON CONFLICT DO NOTHING;
 INSERT INTO organization_master.access SELECT 'bundle-admin','00000000-0000-0000-0000-000000000000'::uuid,s,'READ' FROM unnest(ARRAY['NORTH','SOUTH']) s ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.object_grant SELECT 'bundle-admin',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND permission='READ' AND object_id IN (${[...datasets.map(d=>d.id),x.source.id].map(id=>quote(id)+'::uuid').join(',')}) ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.protected_grant SELECT 'bundle-admin',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND permission='READ' AND campus='NORTH' AND dataset_id IN (${datasets.map(d=>quote(d.id)+'::uuid').join(',')}) ON CONFLICT DO NOTHING;`);
 const values:Record<string,Record<string,string>[]>={ORG01:[],ORG02:[],ORG03:[]};
 const common={valid_from:'2026-01-01T00:00:00+08:00',valid_to:'',version_no:'1',record_status:'PUBLISHED',source_system_id:x.source.id,source_record_id:'DEMO_PROTECTED_SOURCE',recorded_at:'2026-01-01T00:00:00+08:00',approval_ref:'DEMO_SOURCE_APPROVAL'};
 values['ORG01']!.push({...common,legal_entity_id:'DEMO_SUBJECT',legal_name:'DEMO import hospital',entity_nature:'DEMO',authority:'DEMO office',legal_address:'DEMO address',unified_credit_code:'',institution_code:'DEMO_'+randomUUID(),license_number:'DEMO_'+randomUUID(),license_valid_from:'2026-01-01',license_valid_to:'',registration_evidence:x.artifact.artifactId});
 const rows:ReceiveOrganizationBundleInput['manifest']['rows']=[{dataset:'ORG01',row:2,intent:'CREATE',governanceScope:'NORTH',sourceVersionId:x.source.versionId,institutionNamespace:'DEMO_REGISTRY',license:{intent:'CREATE',namespace:'DEMO_LICENSE',authority:'DEMO office',evidence:x.artifact.artifactId,endKind:'VERIFIED_UNBOUNDED'},registration:{creditCodeStatus:'NOT_APPLICABLE',evidence:x.artifact.artifactId}}];
 for(let n=0;n<3;n++){
  const alias='DEMO_CAMPUS_'+n,subject={kind:'JOB_ALIAS' as const,dataset:'ORG01' as const,alias:'DEMO_SUBJECT'},campus={kind:'JOB_ALIAS' as const,dataset:'ORG02' as const,alias};
  values['ORG02']!.push({...common,campus_id:alias,campus_code:'DEMO_'+randomUUID(),campus_name:'DEMO campus '+n,node_role:['HEADQUARTERS','HIGH_TECH','CITY_CENTER'][n]!,campus_address:'',admin_division_code:'',operation_status:'PLANNING',opening_date:'',public_phone:''});
  rows.push({dataset:'ORG02',row:n+2,intent:'CREATE',governanceScope:'NORTH',sourceVersionId:x.source.versionId,nodeKind:'PHYSICAL',evidence:x.artifact.artifactId,adminDivision:null});
  values['ORG03']!.push({...common,legal_campus_rel_id:'DEMO_REL_'+n,legal_entity_id:'DEMO_SUBJECT',campus_id:alias,relation_type:'OPERATOR',license_scope:'DEMO scope',is_primary_operator:'Y',evidence_ref:x.artifact.artifactId});
  rows.push({dataset:'ORG03',row:n+2,intent:'CREATE',governanceScope:'NORTH',sourceVersionId:x.source.versionId,subject,campus,role:'OPERATOR',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopes:[{kind:'VERIFY_SCOPE',license:{kind:'ROW_LICENSE',subject},evidence:x.artifact.artifactId,validFrom:'2026-01-01T00:00:00',validTo:null,services:['DEMO_MEDICAL_A']}]});
 }
 const workbook=()=>organizationWorkbook(Object.fromEntries([...contracts].reverse().map(c=>[c.dataset,[c.fields.map(f=>f.code),...values[c.dataset]!.map(row=>c.fields.map(f=>row[f.code]??''))]])));
 const input:ReceiveOrganizationBundleInput={requestId:randomUUID(),job:{action:'CREATE'},campus:'NORTH',retentionSeconds:3600,contracts:contracts.map(({dataset,contractId,contractVersionId})=>({dataset,contractId,contractVersionId})),manifest:{policy:'ORG_BUNDLE_V1',rows}};
 return {x,values,workbook,input,close:x.close};
}
