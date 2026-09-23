import {campusCodeSet} from './campus-fixture.js';
import {randomUUID} from 'node:crypto';
import {openOrganization,openCampus,openOperatingRelations,type OrganizationCommand,type CampusCommand,type OperatingCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import type {Catalog,KeyProviderPort,OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {fixture} from './protected-fixture.js';
import {peer,quote} from './lineage.mjs';
import {provisionCampusAuthority} from './campus-authority.mjs';
import {provisionOperatingAuthority} from './operating-authority.mjs';
import {operatingCodeSet} from './operating-fixture.js';
interface Governed<T> {stage(actor:string,input:T):Promise<{inputId:string;revisionId:string}>;plan(actor:string,input:{inputId:string;requestId:string}):Promise<{candidateId:string;digest:string}>;readApplyCandidate(actor:string,input:{candidateId:string}):Promise<unknown>;approveApplyUnit(actor:string,input:{candidateId:string;digest:string}):Promise<unknown>;applyUnit(actor:string,input:{candidateId:string;requestId:string}):Promise<{status:string;facts?:OwnerFact[]}>}
export async function prepare<T>(owner:Governed<T>,input:T){const staged=await owner.stage('maker',input),requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};}
export async function commit<T>(owner:Governed<T>,input:T){const result=await owner.applyUnit('maker',await prepare(owner,input));if(result.status!=='COMMITTED'||!result.facts?.[0])throw new Error('FIXTURE_NOT_COMMITTED');return result.facts[0];}
export async function operatingScenario(receipt:{name:string},connection:string,provider:KeyProviderPort,catalog:Catalog,reusePublishedServiceCatalog=false){
 provisionCampusAuthority(receipt,provider);provisionOperatingAuthority(receipt,provider);
 const org=openOrganization(connection,provider),campus=openCampus(connection,provider),operating=openOperatingRelations(connection,provider);
 try{
 const f=await fixture(catalog,{textField:true,ruleVersion:'ORG03_TRANSPORT_V1'}),job=await catalog.importJobCommand('maker',{...f.create,requestId:randomUUID()});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,s,'IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['NORTH','SOUTH']) s CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_ORG03_LEGAL_SCOPE_EVIDENCE'));
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(v=>v.kind==='SOURCE'&&v.status==='PUBLISHED'&&v.validTo===null)!;
 const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_ORG03',versionNo:1,recordLocator:'DEMO_ORG03_ROW',recordedAt:'2026-01-01T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_OFFICE_APPROVAL'}};
 const input={jobId:job.id,revisionId:job.revisionId,campus:'NORTH' as const,purpose:'IDENTITY_VERIFY' as const};
 const orgApply=(command:OrganizationCommand)=>commit(org,{...input,requestId:randomUUID(),command});
 const campusApply=(command:CampusCommand)=>commit(campus,{...input,requestId:randomUUID(),command});
 const operatingInput=(command:OperatingCommand)=>({jobId:job.id,revisionId:job.revisionId,requestId:randomUUID(),profile:'CORE' as const,command});
 const operatingApply=(command:OperatingCommand)=>commit(operating,operatingInput(command));
 const createSubject=()=>orgApply({...common,action:'CREATE',facts:{legalName:'DEMO_ORG03 hospital',entityNature:'DEMO',authority:'DEMO office',legalAddress:'DEMO address',registrationEvidence:artifact.artifactId},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_REGISTRY',value:randomUUID()}]});
 const createCampus=async(name='DEMO_ORG03 campus',role:'HEADQUARTERS'|'HIGH_TECH'|'CITY_CENTER'='HEADQUARTERS',governanceScope:'NORTH'|'SOUTH'='NORTH')=>{
  const proof=governanceScope==='NORTH'?artifact:await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:governanceScope,purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_ORG03_SOUTH_EVIDENCE'));
  return commit(campus,{...input,campus:governanceScope,requestId:randomUUID(),command:{...common,action:'CREATE',evidence:proof.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_ORG03_'+randomUUID(),campusName:name,nodeRole:role,nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}}});
 };

 const activateCampus=async(node:OwnerFact)=>{
  const division=await campusCodeSet(catalog,source.versionId),old=await campus.references.read('maker',{id:node.id});
  const revised=await campusApply({...common,action:'REVISE',target:{owner:'organization-master/campus',id:node.id,expectedVersion:old.head},evidence:artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{...old.facts!,campusAddress:'DEMO physical address',adminDivision:division.reference}});
  return campusApply({...common,action:'ACTIVATE',target:{owner:'organization-master/campus',id:node.id,expectedVersion:revised.version},evidence:artifact.artifactId,sourceOperationStatus:'RUNNING',state:'RUNNING'});
 };
 const grantPair=(subjectId:string,campusId:string)=>peer(receipt.name,`INSERT INTO organization_master.operating_access SELECT a,${quote(subjectId)}::uuid,${quote(campusId)}::uuid,p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','ESTABLISH','REVISE','REVIEW','CLOSE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;`);
 const addLicense=async(subject:OwnerFact,from='2026-01-01T00:00:00',to:string|null=null)=>{
  const l=await orgApply({...common,action:'ADD_LICENSE',target:{id:subject.id,version:subject.version},license:{namespace:'DEMO_LICENSE',number:'DEMO_'+randomUUID(),authority:'DEMO',evidence:artifact.artifactId,validFrom:from,validTo:to,endKind:to===null?'VERIFIED_UNBOUNDED':'FINITE'}});
  await orgApply({...common,validFrom:from,validTo:to,action:'VERIFY_REGISTRATION',target:{id:subject.id,version:subject.version},licenseTargets:[{id:l.id,version:l.version}],creditCodeStatus:'NOT_APPLICABLE',evidence:artifact.artifactId});
  const v=(await org.historyDetails('maker',subject.id)).licenses.find(v=>v.id===l.id&&v.version===l.version)!;return {owner:'organization-master/license' as const,id:l.id,version:l.version,versionId:v.versionId};
 };
 const codeSet=await (async()=>{
  if(!reusePublishedServiceCatalog)return operatingCodeSet(catalog,source.versionId);
  const published=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.status==='PUBLISHED'&&c.dataset==='ORG03'&&c.profile==='CORE'&&c.definition.templateVersion==='ORG03_MANUAL_CORE_V1');
  const service=published?.definition.codeSets.find(c=>c.field==='license_scope'&&c.codeSystem==='SYNTHETIC_OPERATING_SERVICE'&&c.status==='SYNTHETIC_ADOPTED');
  if(!published||!service)throw new Error('BLOCKED_DEPENDENCY');
  return {published,reference:{contractId:published.id,contractVersionId:published.versionId,codeSystem:'SYNTHETIC_OPERATING_SERVICE' as const,version:service.version,sourceVersionId:service.sourceVersionId}};
 })();
 const endpoints=(subject:OwnerFact,campus:OwnerFact)=>({subject:{owner:'organization-master' as const,id:subject.id},campus:{owner:'organization-master/campus' as const,id:campus.id}});
 const verifyScope=async(subject:OwnerFact,node:OwnerFact,license:Awaited<ReturnType<typeof addLicense>>,services=['DEMO_MEDICAL_A'],from='2026-01-01T00:00:00',to:string|null=null)=>{
  const s=await operatingApply({...common,...endpoints(subject,node),action:'VERIFY_SCOPE',evidence:artifact.artifactId,validFrom:from,validTo:to,facts:{license,catalog:codeSet.reference,services,licenseScopeText:'DEMO independently checked service scope'}});
  const v=(await operating.read('maker',{kind:'SCOPE',mode:'EXACT',id:s.id,version:s.version}))[0]!;return {owner:'organization-master/license-scope' as const,id:s.id,version:s.version,versionId:v.versionId};
 };

 return {org,campus,operating,common,artifact,source,codeSet,endpoints,verifyScope,activateCampus,createSubject,createCampus,addLicense,grantPair,orgApply,campusApply,operatingInput,operatingApply,close:async()=>{await org.close();await campus.close();await operating.close();}};
 }catch(error){await Promise.all([org.close(),campus.close(),operating.close()]);throw error;}
}
