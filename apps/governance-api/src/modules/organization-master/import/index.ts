import {openOrganization} from '../index.js';
import {openCampus} from '../campus/index.js';
import {openOperatingRelations} from '../operating/index.js';
import {OrganizationCommandSchema,type OrganizationCommand} from '../contracts.js';
import {CampusCommandSchema,type CampusCommand} from '../campus/contracts.js';
import {OperatingCommandSchema,type OperatingCommand} from '../operating/contracts.js';
import {compileOrganizationBundle,type BundleStep} from './compiler.js';
import type {CampusSnapshot} from '../campus/reader.js';
import {covered,subtract,localTime,type Span} from '../time.js';
import {recordOwnerFileValidation,type ValidationEvaluation} from '../../governance-catalog/index.js';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {Check} from 'typebox/value';
import {sql} from 'kysely';
import {applyCoordinator,type ApplyOwnerPort,type OwnerFact,receiveFileInTransaction,protectedArtifacts,parseOrganizationWorkbookBounded,authenticateRegistrationEvidence,planBinding,canonicalPlan,type KeyProviderPort,type ImportContractItem,type ParserField,type OrganizationSheet} from '../../governance-catalog/index.js';
import {campusInput,check,type Scope} from '../campus/input.js';
import {createRegistrationReader} from '../registration.js';
import {BundlePlanSchema,BundlePreauthorizeSchema,BundleLegalSchema,type BundlePreauthorizeInput,type BundleLegalInput,ReceiveOrganizationBundleSchema,BundleRevisionSchema,BundleManifest,type ReceiveOrganizationBundleInput,type BundleRevisionInput,type BundleManifestValue} from './contracts.js';
export * from './contracts.js';
interface Revision {revision_id:string;job_id:string;raw_id:string;manifest_id:string;campus:'NORTH'|'SOUTH';bindings:ReceiveOrganizationBundleInput['contracts'];scopes:string[];dimensions:Array<{dataset:string;scope:string}>;manifest_digest:string;contracts_digest:string;currentRevisionId:string;makerIdentity:string;makerActor:string;status:string;sourceVersionId:string;transportContractVersionId:string;transportRuleVersion:string}
function requestPart(id:string,part:string){const bytes=createHash('sha256').update('ORG_BUNDLE_REQUEST_V1\0'+id+'\0'+part).digest().subarray(0,16);bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const dimensions=(manifest:BundleManifestValue)=>[...new Set(manifest.rows.map(row=>JSON.stringify([row.dataset,row.governanceScope])))].sort().map(key=>{const [dataset,scope]=JSON.parse(key) as [string,string];return {dataset,scope};});
export function openOrganizationImport(connection:string,provider?:KeyProviderPort){
 const {db,root}=campusInput(connection,provider);
 const subjectOwner=openOrganization(connection,provider),campusOwner=openCampus(connection,provider),operatingOwner=openOperatingRelations(connection,provider);
 const record=async(scope:Scope,actor:string,input:BundleRevisionInput)=>(await sql<{r:Revision}>`select organization_master.bundle_read(${actor},${input.jobId}::uuid,${input.revisionId}::uuid) r`.execute(scope)).rows[0]!.r;
 const contracts=async(scope:Scope,actor:string,bindings:ReceiveOrganizationBundleInput['contracts'])=>{
  const result:ImportContractItem[]=[];
  if(bindings.length!==3||new Set(bindings.map(b=>b.dataset)).size!==3)throw new Error('BLOCKED_DEPENDENCY');
  for(const binding of bindings){
   const rows=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'HISTORY',target:binding.contractId,versionId:binding.contractVersionId})}::jsonb) r`.execute(scope)).rows[0]!.r;
   const item=rows.filter(c=>c.status==='PUBLISHED').at(-1);if(!item||item.dataset!==binding.dataset||item.profile!=='CORE'||item.definition.templateVersion!==binding.dataset+'_BUNDLE_CORE_V1')throw new Error('BLOCKED_DEPENDENCY');result.push(item);
  }
  return result;
 };
 const artifact=async(scope:Scope,actor:string,id:string,r:Revision)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.bundle_artifact(${actor},${r.job_id}::uuid,${r.revision_id}::uuid,${id}::uuid) r`.execute(scope)).rows[0]!.r;
  return authenticateRegistrationEvidence(proof,provider);
 };
 const readInTransaction=async(scope:Scope,actor:string,input:BundleRevisionInput)=>{
  const r=await record(scope,actor,input),bytes=await artifact(scope,actor,r.manifest_id,r);
  try{const manifest:BundleManifestValue=JSON.parse(bytes.toString());check(BundleManifest,manifest);
   if(dimensions(manifest).some(d=>!r.dimensions.some(stored=>stored.dataset===d.dataset&&stored.scope===d.scope))||canonicalPlan(r.scopes)!==canonicalPlan([...new Set(manifest.rows.map(row=>row.governanceScope))].sort()))throw new Error('ACCESS_DENIED');
   if(planBinding(provider,'ORG_BUNDLE_MANIFEST_V1',manifest)!==r.manifest_digest||planBinding(provider,'ORG_BUNDLE_CONTRACTS_V1',r.bindings)!==r.contracts_digest)throw new Error('PAYLOAD_UNAVAILABLE');
   return {record:r,manifest,contracts:await contracts(scope,actor,r.bindings)};
  }finally{bytes.fill(0);}
 };
 const parseRevision=async(scope:Scope,actor:string,input:BundleRevisionInput)=>{
  const result=await readInTransaction(scope,actor,input);if(result.record.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
  if(result.record.status==='REJECTED')throw new Error('BATCH_REJECTED');
  const bytes=await artifact(scope,actor,result.record.raw_id,result.record);
  try{const fields=Object.fromEntries(result.contracts.map(c=>[c.dataset,c.definition.fields.map(f=>({code:f.code,type:f.type}))])) as Record<OrganizationSheet,ParserField[]>;return {...result,fileDigest:planBinding(provider,'ORG_BUNDLE_FILE_V1',bytes.toString('base64')),parsed:await parseOrganizationWorkbookBounded(bytes,fields)};}finally{bytes.fill(0);}
 };
 interface ControlEvent {id:string;sequence:number;actor:string;identity_code:string;digest:string;details:{resource:string;grantee:string;permission:string;allowed:boolean}}
 interface State {grants:ControlEvent[];verification:ControlEvent|null}
 const state=async(scope:Scope,actor:string,input:BundleRevisionInput)=>(await sql<{r:State}>`select organization_master.bundle_control_state(${actor},${input.jobId}::uuid,${input.revisionId}::uuid) r`.execute(scope)).rows[0]!.r;
 const resource=(input:BundleRevisionInput,row:Extract<BundleManifestValue['rows'][number],{dataset:'ORG03'}>)=>planBinding(provider,'ORG_BUNDLE_PAIR_V1',[input.jobId,input.revisionId,row.subject,row.campus]);
 const authorizePairs=(actor:string,input:BundleRevisionInput,manifest:BundleManifestValue,grants:ControlEvent[],permission:'READ'|'REVIEW'|'WRITE')=>{
  for(const row of manifest.rows){if(row.dataset!=='ORG03')continue;const digest=resource(input,row);const permissions=permission==='WRITE'?['READ',row.intent]:['READ',permission];
   for(const p of permissions)if(!grants.some(g=>g.details.resource===digest&&g.details.grantee===actor&&g.details.permission===p&&g.details.allowed))throw new Error('PAIR_PREAUTHORIZATION_REQUIRED');
  }
 };
 const authorizeRows=async(scope:Scope,actor:string,manifest:BundleManifestValue,permission:'READ'|'REVIEW'|'WRITE')=>{
  for(const row of manifest.rows){
   if(row.dataset!=='ORG03')await sql`select organization_master.authorize(${actor},${row.target?.id??null}::uuid,${row.governanceScope},${permission})`.execute(scope);
   else if(row.subject.kind==='PLATFORM_REF'&&row.campus.kind==='PLATFORM_REF'){
    await sql`select organization_master.operating_authorize(${actor},${row.subject.id}::uuid,${row.campus.id}::uuid,${permission==='WRITE'?(row.intent==='CREATE'?'ESTABLISH':'REVISE'):permission})`.execute(scope);
    if(permission==='REVIEW')await sql`select organization_master.operating_authorize(${actor},${row.subject.id}::uuid,${row.campus.id}::uuid,'READ_RESTRICTED')`.execute(scope);
   }
  }
 };
 const control=async(scope:Scope,actor:string,value:Record<string,unknown>)=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(scope)).rows[0]!.id;
  const ticket=canonicalPlan({...value,actor,domain:'ORG_BUNDLE_CONTROL_V1',transaction}),key=Buffer.from(planBinding(provider,'ORG_BUNDLE_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:{eventId:string;status:'READ'|'VERIFIED'|'AUTHORIZED'}}>`select organization_master.bundle_control(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(scope)).rows[0]!.r;}finally{key.fill(0);}
 };
 const observe=async(scope:Scope,actor:string,input:BundleRevisionInput,permission:'READ'|'REVIEW'|'WRITE',includeMaterials=false)=>{
  await sql`select organization_master.bundle_authorize(${actor},${input.jobId}::uuid,${input.revisionId}::uuid,${permission==='WRITE'?'WRITE':permission})`.execute(scope);
  const data=await parseRevision(scope,actor,input),program=compileOrganizationBundle(data.parsed,data.manifest,data.contracts),access=await state(scope,actor,input);
  authorizePairs(actor,input,data.manifest,access.grants,permission);
  await authorizeRows(scope,actor,data.manifest,permission);
  if(program.issues.length)throw new Error('BLOCKED_DEPENDENCY');
  const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
  for(const binding of data.record.bindings){const current=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:binding.contractId,businessAt:now})}::jsonb) r`.execute(scope)).rows[0]!.r[0];if(current?.versionId!==binding.contractVersionId)throw new Error('STALE_VALIDATION');}
  const materialBindings:Array<{step:string;id:string;digest:string}>=[],materials=new Map<string,{id:string;contentBase64:string}>();const observations:unknown[]=[];
  const knownCommand=(value:unknown):unknown=>{
   if(Array.isArray(value))return value.map(knownCommand);if(value===null||typeof value!=='object')return value;
   if('bundleReference' in value){const ref=value.bundleReference as {step:string;field:string};const step=program.steps.find(s=>s.key===ref.step),row=step&&data.manifest.rows.find(r=>r.dataset===step.dataset&&r.row===step.row);return ref.field==='id'&&row?.target?row.target.id:value;}
   return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,knownCommand(v)]));
  };
  const plannedParent=(ref:Extract<BundleManifestValue['rows'][number],{dataset:'ORG03'}>['subject'])=>{if(ref.kind!=='JOB_ALIAS')return null;const alias=program.aliases.find(a=>a.dataset===ref.dataset&&a.alias===ref.alias);return alias?program.steps.find(s=>s.key===alias.step)??null:null;};
  const stepSpan=(step:BundleStep):Span=>({from:step.command['validFrom'] as string,to:step.command['validTo'] as string|null});
  const parentId=(ref:Extract<BundleManifestValue['rows'][number],{dataset:'ORG03'}>['subject'])=>{if(ref.kind==='PLATFORM_REF')return ref.id;const step=plannedParent(ref),target=step?.command['target'] as {id:string}|undefined;return target?.id??null;};
  const claimed=new Map<string,number>();
  for(const step of program.steps){const c=step.command,source=c['source'] as {systemId:string;versionId:string};const facts=c['facts'] as Record<string,unknown>|undefined,license=c['license'] as Record<string,unknown>|undefined;const id=c['evidence']??facts?.['registrationEvidence']??license?.['evidence'];
   const known=knownCommand(c);
   try{
   if(step.dataset==='ORG01'){
    const row=data.manifest.rows.find(r=>r.dataset==='ORG01'&&r.row===step.row)!;
    const claims=(c['identifiers']??(license?[{kind:'LICENSE',namespace:license['namespace'],value:license['number']}]:[])) as Parameters<typeof subjectOwner.inspectClaimsInTransaction>[2]['claims'];
    const keys=await subjectOwner.inspectClaimsInTransaction(scope,actor,{subjectId:row.target?.id??null,campus:step.governanceScope,claims});
    for(const key of keys){const k=canonicalPlan(key),other=claimed.get(k);if(other!==undefined&&other!==step.row)throw new Error('IDENTIFIER_CONFLICT');claimed.set(k,step.row);}observations.push({step:step.key,claims:keys});
   }
   if(step.dataset==='ORG02'&&Check(CampusCommandSchema,known))observations.push({step:step.key,admission:await campusOwner.inspectCommandInTransaction(scope,actor,known)});
   if(step.dataset==='ORG03'&&Check(OperatingCommandSchema,known))observations.push({step:step.key,admission:await operatingOwner.inspectCommandInTransaction(scope,actor,known)});
   }catch(error){if(error instanceof Error)Object.assign(error,{dataset:step.dataset,row:step.row});throw error;}
   if(typeof id!=='string')throw new Error('BLOCKED_DEPENDENCY');
   const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.evidence(${actor},${id}::uuid,${source.systemId}::uuid,${source.versionId}::uuid,${step.governanceScope},${c['validFrom'] as string}::timestamp,${c['validTo'] as string|null}::timestamp) r`.execute(scope)).rows[0]!.r;
   const bytes=authenticateRegistrationEvidence(proof,provider);try{materialBindings.push({step:step.key,id,digest:planBinding(provider,'ORG_BUNDLE_MATERIAL_V1',bytes.toString('base64'))});if(includeMaterials&&!materials.has(id))materials.set(id,{id,contentBase64:bytes.toString('base64')});}finally{bytes.fill(0);}
  }
  const seen=new Map<string,string>(),registration=createRegistrationReader(root).inTransaction(scope);
  const parent=async(dataset:string,id:string,expectedVersion:string)=>{const k=dataset+'/'+id;if(seen.has(k)){if(seen.get(k)!==expectedVersion)throw new Error('STALE_VALIDATION');return;}seen.set(k,expectedVersion);
   if(dataset==='ORG01'){const facts=await registration.read(actor,{id});if(String(Math.max(...facts.profiles.map(v=>Number(v.version))))!==expectedVersion)throw new Error('STALE_VALIDATION');observations.push({dataset,id,facts});}
   else if(dataset==='ORG02'){const facts=(await sql<{r:CampusSnapshot}>`select organization_master.campus_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;if(String(facts.events.at(-1)?.number)!==expectedVersion)throw new Error('STALE_VALIDATION');observations.push({dataset,id,facts});}
   else {const facts=(await sql<{r:{versions:Array<{number:number;action:string}>}}>`select organization_master.operating_snapshot(${actor},${id}::uuid,'RELATION') r`.execute(scope)).rows[0]!.r;if(String(facts.versions.at(-1)?.number)!==expectedVersion)throw new Error('STALE_VALIDATION');if(facts.versions.some(v=>v.action==='CLOSE'))throw new Error('OPERATING_CLOSED');observations.push({dataset,id,facts});}
  };
  for(const row of data.manifest.rows){try{if(row.target)await parent(row.dataset,row.target.id,row.target.expectedVersion);if(row.dataset==='ORG03'){
   for(const ref of [row.subject,row.campus])if(ref.kind==='PLATFORM_REF')await parent(ref.dataset,ref.id,ref.expectedVersion);
   const catalog=(await sql<{r:unknown}>`select governance_catalog.operating_catalog(${actor},${JSON.stringify(row.catalog)}::jsonb,${program.steps.find(s=>s.key===`ORG03/${row.row}/main`)!.command['validFrom'] as string}::timestamp,${program.steps.find(s=>s.key===`ORG03/${row.row}/main`)!.command['validTo'] as string|null}::timestamp,NULL) r`.execute(scope)).rows[0]!.r;if(catalog===null)throw new Error('BLOCKED_DEPENDENCY');observations.push({row:row.row,catalog});
   for(const proof of row.scopes)if(proof.kind==='EXISTING_SCOPE')observations.push({scope:proof.reference,facts:(await sql<{r:unknown}>`select organization_master.operating_snapshot(${actor},${proof.reference.id}::uuid,'SCOPE') r`.execute(scope)).rows[0]!.r});
   const main=program.steps.find(s=>s.key===`ORG03/${row.row}/main`)!,period=stepSpan(main),subjectId=parentId(row.subject),campusId=parentId(row.campus),subjectPlan=plannedParent(row.subject),campusPlan=plannedParent(row.campus);
   const cuts=subjectPlan?.command['action']==='REVISE'?[stepSpan(subjectPlan)]:[];
   if(subjectId){const reg=await registration.read(actor,{id:subjectId});if(!covered([...reg.profiles,...(subjectPlan?[stepSpan(subjectPlan)]:[])],period.from,period.to))throw new Error('PARENT_PERIOD_NOT_COVERED');}
   if(campusId){
    const profiles=await campusOwner.references.inTransaction(scope).readCampusReferenceCoverage(actor,{references:[{owner:'organization-master/campus',id:campusId}],validFrom:period.from,validTo:period.to});
    if(!covered([...profiles.items[0]!.segments,...(campusPlan?[stepSpan(campusPlan)]:[])],period.from,period.to))throw new Error('PARENT_PERIOD_NOT_COVERED');
    if((main.command['facts'] as {primary:string}).primary==='Y'&&(await sql<{r:boolean}>`select organization_master.operating_primary_conflict(${actor},${campusId}::uuid,${row.target?.id??null}::uuid,${period.from}::timestamp,${period.to}::timestamp) r`.execute(scope)).rows[0]!.r)throw new Error('PRIMARY_OPERATOR_CONFLICT');
   }
   const byService:Record<string,Span[]>={};for(const service of row.services)byService[service]=[];
   const existing=row.scopes.flatMap(s=>s.kind==='EXISTING_SCOPE'?[s.reference]:[]);
   if(existing.length){
    if(!subjectId||!campusId)throw new Error('BLOCKED_DEPENDENCY');
    const proof=await operatingOwner.scopeCoverageInTransaction(scope,actor,{subjectId,campusId,references:existing,catalog:row.catalog,services:row.services,period,subjectRevisionCuts:cuts});observations.push({row:row.row,coverage:proof});
    for(const service of row.services)byService[service]!.push(...(proof.spans[service]??[]));
   }
   for(const proof of row.scopes){if(proof.kind!=='VERIFY_SCOPE')continue;const span={from:localTime(proof.validFrom),to:proof.validTo===null?null:localTime(proof.validTo)};
    const accepted=(await sql<{r:unknown}>`select governance_catalog.operating_catalog(${actor},${JSON.stringify(row.catalog)}::jsonb,${span.from}::timestamp,${span.to}::timestamp,NULL) r`.execute(scope)).rows[0]!.r;if(accepted===null)throw new Error('BLOCKED_DEPENDENCY');
    if(!('kind' in proof.license)){if(!subjectId)throw new Error('LICENSE_ID_MISMATCH');const qualified=await operatingOwner.licenseCoverageInTransaction(scope,actor,{subjectId,license:proof.license,catalog:row.catalog,period:span});if(!covered(qualified.flatMap(part=>subtract(part,cuts)),span.from,span.to))throw new Error('LICENSE_PERIOD_NOT_COVERED');}
    for(const service of proof.services)byService[service]?.push(span);
   }
   if(row.role==='OPERATOR'&&row.services.some(service=>!covered(byService[service]??[],period.from,period.to)))throw new Error('LICENSE_PERIOD_NOT_COVERED');
  }else if(row.dataset==='ORG02'&&row.target){
   const step=program.steps.find(s=>s.key===`ORG02/${row.row}/main`)!;
   const state=await campusOwner.references.inTransaction(scope).resolveCampusReference(actor,{references:[{owner:'organization-master/campus',id:row.target.id}],businessAt:step.command['validFrom'] as string});
   if(state.items[0]?.operationStatus!==step.command['sourceOperationStatus'])throw new Error('UNSUPPORTED_STATE_TRANSITION');
  }else if(row.dataset==='ORG01'&&row.license?.target&&row.target){
   const facts=await registration.read(actor,{id:row.target.id}),target=row.license.target;
   const current=facts.licenses.filter(l=>l.license_id===target.id).at(-1);if(!current||current.id!==target.versionId||String(current.number)!==target.version)throw new Error('STALE_VALIDATION');
  }}catch(error){if(error instanceof Error)Object.assign(error,{dataset:row.dataset,row:row.row});throw error;}}
  const basis={fileDigest:data.fileDigest,manifestDigest:data.record.manifest_digest,contractsDigest:data.record.contracts_digest,program,materialBindings,observations,grants:access.grants};
  return {...data,program,access,materialBindings,materials:[...materials.values()],basis,digest:planBinding(provider,'ORG_BUNDLE_REVIEW_V1',basis)};
 };
 const requireLegal=async(scope:Scope,actor:string,input:BundleRevisionInput,permission:'READ'|'REVIEW'|'WRITE')=>{
  const previous=(await state(scope,actor,input)).verification;
  const data=await observe(scope,actor,input,permission).catch(error=>{
   if(previous&&error instanceof Error&&['BLOCKED_DEPENDENCY','LICENSE_PERIOD_NOT_COVERED','LICENSE_ID_MISMATCH','LICENSE_END_UNKNOWN','PARENT_PERIOD_NOT_COVERED','PRIMARY_OPERATOR_CONFLICT','OPERATING_CLOSED','UNSUPPORTED_STATE_TRANSITION'].includes(error.message))throw Object.assign(new Error('STALE_VALIDATION'),{cause:error});throw error;
  }),legal=data.access.verification;
  if(!legal)throw new Error('LEGAL_REVIEW_REQUIRED');if(legal.digest!==data.digest)throw new Error('STALE_VALIDATION');
  const verified=await observe(scope,legal.actor,input,'REVIEW');if(verified.digest!==legal.digest)throw new Error('STALE_VALIDATION');
  const identity=(await sql<{r:string}>`select organization_master.bundle_authorize(${legal.actor},${input.jobId}::uuid,${input.revisionId}::uuid,'REVIEW') r`.execute(scope)).rows[0]!.r;
  if(identity!==legal.identity_code||identity===data.record.makerIdentity)throw new Error('MAKER_CHECKER_REQUIRED');return {...data,legal};
 };
 const setContext=async(scope:Scope,actor:string,value:Record<string,unknown>)=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(scope)).rows[0]!.id;
  const ticket=canonicalPlan({...value,actor,domain:'ORG_BUNDLE_COMMAND_V1',transaction}),key=Buffer.from(planBinding(provider,'ORG_BUNDLE_SQL_AUTHORITY_V1',{}),'hex');
  try{await sql`select set_config('hdi.org_bundle',${JSON.stringify({ticket,signature:createHmac('sha256',key).update(ticket).digest('hex')})},true)`.execute(scope);}finally{key.fill(0);}
 };
 const resolveCommand=async(scope:Scope,actor:string,value:unknown,resolved:ReadonlyMap<number,OwnerFact>):Promise<unknown>=>{
  if(Array.isArray(value))return Promise.all(value.map(v=>resolveCommand(scope,actor,v,resolved)));
  if(value===null||typeof value!=='object')return value;
  if('bundleReference' in value){
   const ref=value.bundleReference as {step:string;field:'id'|'version'|'versionId'},fact=[...resolved.values()].find(f=>f.source?.step===ref.step);if(!fact)throw new Error('BLOCKED_DEPENDENCY');if(ref.field!=='versionId')return fact[ref.field];
   if(fact.owner==='organization-master/license'){
    const parent=[...resolved.values()].find(f=>f.owner==='organization-master'&&f.source?.row===fact.source?.row)!;
    const snapshot=await createRegistrationReader(root).inTransaction(scope).read(actor,{id:parent.id});const v=snapshot.licenses.find(l=>l.license_id===fact.id&&String(l.number)===fact.version);if(!v)throw new Error('BLOCKED_DEPENDENCY');return v.id;
   }
   if(fact.owner==='organization-master/license-scope'){
    const snapshot=(await sql<{r:{versions:Array<{id:string;number:number}>}}>`select organization_master.operating_snapshot(${actor},${fact.id}::uuid,'SCOPE') r`.execute(scope)).rows[0]!.r;const v=snapshot.versions.find(v=>String(v.number)===fact.version);if(!v)throw new Error('BLOCKED_DEPENDENCY');return v.id;
   }
   throw new Error('BLOCKED_DEPENDENCY');
  }
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await resolveCommand(scope,actor,v,resolved)])));
 };
 const ownerPort:ApplyOwnerPort={
  async authorize(scope,actor,input,permission){
   const r=await record(scope,actor,{jobId:input.jobId,revisionId:input.revisionId});if(input.campus!==r.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');
   const committed=(await sql<{r:OwnerFact[]|null}>`select organization_master.bundle_committed_facts(${actor},${input.jobId}::uuid,${input.revisionId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r;
   if(permission==='READ'&&committed)return;
   if(r.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
   await sql`select organization_master.bundle_authorize(${actor},${input.jobId}::uuid,${input.revisionId}::uuid,${permission})`.execute(scope);
   const data=await readInTransaction(scope,actor,input),access=await state(scope,actor,input);authorizePairs(actor,input,data.manifest,access.grants,permission);await authorizeRows(scope,actor,data.manifest,permission);
  },
  async observe(scope,actor,input){
   const data=await requireLegal(scope,actor,input,'READ'),positions=new Map(data.program.steps.map((step,i)=>[step.key,i+1]));
   const objectGrants=(step:BundleStep)=>{
    const grants=new Map<string,{actor:string;permission:string}>(),add=(person:string,permissions:string[])=>{for(const permission of permissions)grants.set(person+'\0'+permission,{actor:person,permission});};
    add(data.record.makerActor,['READ','WRITE']);add(data.legal.actor,['READ','REVIEW','READ_RESTRICTED']);
    const alias=data.program.aliases.find(a=>a.step===`${step.dataset}/${step.row}/main`);
    if(alias)for(const row of data.manifest.rows){if(row.dataset!=='ORG03'||![row.subject,row.campus].some(ref=>ref.kind==='JOB_ALIAS'&&ref.dataset===alias.dataset&&ref.alias===alias.alias))continue;
     const digest=resource(input,row);for(const grant of data.access.grants){if(!grant.details.allowed||grant.details.resource!==digest)continue;add(grant.details.grantee,grant.details.permission==='READ'?['READ']:grant.details.permission==='REVIEW'?['READ','REVIEW','READ_RESTRICTED']:['READ','WRITE']);}
    }
    return [...grants.values()].sort((a,b)=>(a.actor+'\0'+a.permission).localeCompare(b.actor+'\0'+b.permission));
   };
   const isNew=(ref:Extract<BundleManifestValue['rows'][number],{dataset:'ORG03'}>['subject'])=>ref.kind==='JOB_ALIAS'&&data.program.aliases.some(a=>a.dataset===ref.dataset&&a.alias===ref.alias&&data.program.steps.find(s=>s.key===a.step)?.command['action']==='CREATE');
   return {input,atomicRule:'ORG_BUNDLE_V1',basis:{...data.basis,legalReviewId:data.legal.id,legalReviewer:data.legal.actor},commands:data.program.steps.map((step,i)=>{
    const row=data.manifest.rows.find(r=>r.dataset===step.dataset&&r.row===step.row)!;
    const pair=row.dataset==='ORG03'?{resource:resource(input,row),newSubject:isNew(row.subject),newCampus:isNew(row.campus)}:null;
    return {owner:step.dataset==='ORG01'?'organization-master':step.dataset==='ORG02'?'organization-master/campus':step.command['action']==='VERIFY_SCOPE'?'organization-master/license-scope':'organization-master/operating-relation',row:i+1,intent:step.command['action']==='REVISE'||step.command['action']==='REVISE_LICENSE'||step.command['action']==='REVISE_RELATION'?'REVISE' as const:'CREATE' as const,target:null,aliases:step.dependencies.map(k=>positions.get(k)!),value:{step:canonicalPlan(step),pair:canonicalPlan(pair),jobId:input.jobId,revisionId:input.revisionId,requestId:input.requestId,legalReviewId:data.legal.id,legalReviewer:data.legal.actor,objectGrants:canonicalPlan(objectGrants(step))}};
   }),diff:data.program.aliases};
  },
  async validate(_scope,_actor,unit){if(unit.atomicRule!=='ORG_BUNDLE_V1'||!unit.commands.length||unit.commands.length>100)throw new Error('BLOCKED_DEPENDENCY');},
  async apply(scope,actor,command,resolved,approval){
   const v=command.value,step=JSON.parse(v['step']!) as BundleStep,body=await resolveCommand(scope,actor,step.command,resolved),pair=JSON.parse(v['pair']!) as {resource:string;newSubject:boolean;newCampus:boolean}|null;
   const candidate=(await sql<{r:{approvedBy:string}}> `select governance_catalog.apply_record(${actor},'READ_CANDIDATE',${JSON.stringify({candidateId:approval.candidateId})}::jsonb) r`.execute(scope)).rows[0]!.r;
   const objectGrants=[...(JSON.parse(v['objectGrants']!) as Array<{actor:string;permission:string}>),...['READ','WRITE'].map(permission=>({actor,permission})),...['READ','REVIEW','READ_RESTRICTED'].map(permission=>({actor:candidate.approvedBy,permission}))];
   const frame={...approval,jobId:v['jobId'],revisionId:v['revisionId'],legalReviewId:v['legalReviewId'],objectGrants,step:step.key,dataset:step.dataset};
   if(pair){await setContext(scope,actor,{...frame,...pair,phase:'PAIR',command:body});await sql`select organization_master.bundle_materialize_pair(${actor})`.execute(scope);}
   const common={requestId:requestPart(v['requestId']!,step.key),jobId:v['jobId']!,revisionId:v['revisionId']!,campus:step.governanceScope,purpose:'IDENTITY_VERIFY' as const};
   let staged:{inputId:string;revisionId:string};let port:ApplyOwnerPort;
   {
    if(step.dataset==='ORG01'){
     check(OrganizationCommandSchema,body);const input={...common,command:body as OrganizationCommand};await setContext(scope,actor,{...frame,phase:'STAGE',stageRequestId:input.requestId,inputDigest:planBinding(provider,'ORGANIZATION_INPUT_V1',input)});const commands=subjectOwner.commandsInTransaction(scope);staged=await commands.stage(actor,input);port=commands.port;
    }else if(step.dataset==='ORG02'){
     check(CampusCommandSchema,body);const input={...common,command:body as CampusCommand};await setContext(scope,actor,{...frame,phase:'STAGE',stageRequestId:input.requestId,inputDigest:planBinding(provider,'CAMPUS_INPUT_V1',input)});const commands=campusOwner.commandsInTransaction(scope);staged=await commands.stage(actor,input);port=commands.port;
    }else{
     check(OperatingCommandSchema,body);const input={requestId:common.requestId,jobId:common.jobId,revisionId:common.revisionId,profile:'CORE' as const,command:body as OperatingCommand};await setContext(scope,actor,{...frame,phase:'STAGE',stageRequestId:input.requestId,inputDigest:planBinding(provider,'OPERATING_INPUT_V1',input)});const commands=operatingOwner.commandsInTransaction(scope);staged=await commands.stage(actor,input);port=commands.port;
    }
    const input={scope:'SYNTHETIC' as const,requestId:v['requestId']!,jobId:staged.inputId,revisionId:staged.revisionId,campus:step.governanceScope,purpose:'IDENTITY_VERIFY' as const};
    await port.authorize(scope,actor,input,'WRITE');await port.authorize(scope,candidate.approvedBy,input,'REVIEW');
    const unit=await port.observe(scope,actor,input);await port.validate(scope,actor,unit);const child=unit.commands[0]!;
    await setContext(scope,actor,{...frame,phase:'COMMAND',inputId:staged.inputId,command:JSON.parse(child.value['command']!),identifierKeys:unit.basis['keys']??[],commandDigest:planBinding(provider,'ORG_BUNDLE_CHILD_V1',child)});
    await sql`select organization_master.bundle_bind_child(${actor})`.execute(scope);const applied=await port.apply(scope,actor,child,new Map(),approval);if(!applied.ok)return applied;
    await sql`select set_config('hdi.org_bundle','',true)`.execute(scope);
    return {ok:true,fact:{...applied.fact,source:{dataset:step.dataset,row:step.row,step:step.key}}};
   }
  },
  async beforeCommit(scope,actor,unit,approval,facts){await setContext(scope,actor,{...approval,jobId:unit.input.jobId,revisionId:unit.input.revisionId,legalReviewId:unit.basis['legalReviewId'],phase:'COMMIT',facts});},
  async exactRead(scope,actor,input,fact){const facts=(await sql<{r:OwnerFact[]|null}>`select organization_master.bundle_committed_facts(${actor},${input.jobId}::uuid,${input.revisionId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r;return facts?.find(f=>f.owner===fact.owner&&f.id===fact.id&&f.version===fact.version)??null;},
 };
 const receive=async(actor:string,input:ReceiveOrganizationBundleInput,bytes:Uint8Array,execute:typeof root)=>{
   check(ReceiveOrganizationBundleSchema,input);input=structuredClone(input);bytes=Uint8Array.from(bytes);if(!provider)throw new Error('KEY_UNAVAILABLE');
   const bindings=[...input.contracts].sort((a,b)=>a.dataset.localeCompare(b.dataset)),manifestDigest=planBinding(provider,'ORG_BUNDLE_MANIFEST_V1',input.manifest),contractsDigest=planBinding(provider,'ORG_BUNDLE_CONTRACTS_V1',bindings);
   return execute(async scope=>{
    const definitions=await contracts(scope,actor,bindings);
    const fields=Object.fromEntries(definitions.map(c=>[c.dataset,c.definition.fields.map(f=>({code:f.code,type:f.type}))])) as Record<OrganizationSheet,ParserField[]>;
    const parsed=await parseOrganizationWorkbookBounded(bytes,fields);
    const complete=parsed.structuralStatus==='PARSED'&&Object.entries(parsed.sheets).every(([dataset,sheet])=>sheet.cells.every(cell=>input.manifest.rows.some(row=>row.dataset===dataset&&row.row===cell.sourceRow)));
    // Unmapped or unparseable originals retain evidence, but cannot inherit a narrower manifest-only read boundary.
    const protection=complete?dimensions(input.manifest):(['ORG01','ORG02','ORG03'] as const).flatMap(dataset=>[...new Set([input.campus,...input.manifest.rows.map(row=>row.governanceScope)])].sort().map(scope=>({dataset,scope})));
    const anchor=bindings.find(c=>c.dataset==='ORG01')!;
    const jobInput={scope:'SYNTHETIC' as const,requestId:input.requestId,reason:'ORG_BUNDLE_RECEIVE',input:{kind:'FILE' as const,format:'XLSX' as const,parserPolicy:'STRICT_ORG_BUNDLE_V1' as const,manifestDigest,contractsDigest}};
    const job=input.job.action==='CREATE'?{...jobInput,action:'CREATE' as const,contractId:anchor.contractId,contractVersionId:anchor.contractVersionId,profile:'CORE' as const}:{...jobInput,...input.job};
    const received=await receiveFileInTransaction(scope,provider,actor,{job,fileRequestId:requestPart(input.requestId,'file'),extension:'.xlsx',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
    const content=Buffer.from(canonicalPlan(input.manifest));try{
     const saved=await protectedArtifacts(scope,provider).storeProtectedArtifact(actor,{scope:'SYNTHETIC',campus:input.campus,purpose:'IDENTITY_VERIFY',requestId:requestPart(input.requestId,'manifest'),jobId:received.job.id,revisionId:received.job.revisionId,kind:'RAW_CELL',retentionSeconds:input.retentionSeconds},content);
     const registration={jobId:received.job.id,revisionId:received.job.revisionId,rawId:received.artifact.artifactId,manifestId:saved.artifactId,campus:input.campus,contracts:bindings,scopes:[...new Set(input.manifest.rows.map(row=>row.governanceScope))].sort(),dimensions:protection,manifestDigest,contractsDigest};
     return (await sql<{r:{jobId:string;revisionId:string;rawArtifactId:string;manifestArtifactId:string}}>`select organization_master.bundle_register(${actor},${JSON.stringify(registration)}::jsonb) r`.execute(scope)).rows[0]!.r;
    }finally{content.fill(0);}
   });
 };
 const coordinator=applyCoordinator(db,provider,ownerPort);
 return {
  receive:(actor:string,input:ReceiveOrganizationBundleInput,bytes:Uint8Array)=>receive(actor,input,bytes,root),
  receiveInTransaction:(scope:Scope,actor:string,input:ReceiveOrganizationBundleInput,bytes:Uint8Array)=>receive(actor,input,bytes,work=>work(scope)),
  async readRevision(actor:string,input:BundleRevisionInput){check(BundleRevisionSchema,input);input=structuredClone(input);return root(async scope=>{const result=await readInTransaction(scope,actor,input);return {jobId:input.jobId,revisionId:input.revisionId,currentRevisionId:result.record.currentRevisionId,manifest:result.manifest,contracts:result.record.bindings};});},
  async preauthorize(actor:string,input:BundlePreauthorizeInput){check(BundlePreauthorizeSchema,input);input=structuredClone(input);return root(async scope=>{
   const data=await readInTransaction(scope,actor,input),grants=input.grants.flatMap(g=>{const row=data.manifest.rows.find(r=>r.dataset==='ORG03'&&r.row===g.row);if(!row||row.dataset!=='ORG03')throw new Error('ROW_REFERENCE_INVALID');return g.permissions.map(permission=>({resource:resource(input,row),grantee:g.actor,permission,allowed:g.allowed??true}));});
   return control(scope,actor,{jobId:input.jobId,revisionId:input.revisionId,requestId:input.requestId,action:'GRANT',grants});
  });},
  async readLegalReview(actor:string,input:BundleRevisionInput){check(BundleRevisionSchema,input);input=structuredClone(input);return root(async scope=>{const data=await observe(scope,actor,input,'REVIEW',true);await control(scope,actor,{...input,requestId:randomUUID(),action:'LEGAL_READ',basisDigest:data.digest,materialBindings:data.materialBindings});return {jobId:input.jobId,revisionId:input.revisionId,digest:data.digest,manifest:data.manifest,parsed:data.parsed,materialBindings:data.materialBindings,materials:data.materials};});},
  async verifyLegalReview(actor:string,input:BundleLegalInput){check(BundleLegalSchema,input);input=structuredClone(input);return root(async scope=>{const data=await observe(scope,actor,input,'REVIEW');if(input.digest!==data.digest)throw new Error('STALE_VALIDATION');return control(scope,actor,{jobId:input.jobId,revisionId:input.revisionId,requestId:input.requestId,action:'LEGAL_VERIFY',basisDigest:data.digest,materialBindings:data.materialBindings});});},
  async plan(actor:string,input:BundleRevisionInput&{requestId:string}){check(BundlePlanSchema,input);input=structuredClone(input);const r=await root(async scope=>{await requireLegal(scope,actor,input,'WRITE');await sql`select organization_master.bundle_plan_request(${actor},${input.jobId}::uuid,${input.revisionId}::uuid,${input.requestId}::uuid)`.execute(scope);return record(scope,actor,input);});return coordinator.planOwnerUnit(actor,{...input,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async inspectWorkbook(actor:string,input:BundleRevisionInput){check(BundleRevisionSchema,input);input=structuredClone(input);return root(async scope=>(await parseRevision(scope,actor,input)).parsed);},
  async validate(actor:string,input:BundleRevisionInput&{requestId:string}){check(BundlePlanSchema,input);input=structuredClone(input);return root(async scope=>{
   const data=await parseRevision(scope,actor,input),program=compileOrganizationBundle(data.parsed,data.manifest,data.contracts);
   const issues=[...program.issues];
   if(!issues.length){try{await requireLegal(scope,actor,input,'WRITE');}catch(error){
    const code=error instanceof Error?error.message:'';
    if(!['LEGAL_REVIEW_REQUIRED','BLOCKED_DEPENDENCY','STALE_VALIDATION','PAIR_PREAUTHORIZATION_REQUIRED','PRIMARY_OPERATOR_CONFLICT','LICENSE_PERIOD_NOT_COVERED','LICENSE_ID_MISMATCH','LICENSE_END_UNKNOWN','PARENT_PERIOD_NOT_COVERED','OPERATING_CLOSED','UNSUPPORTED_STATE_TRANSITION','APPROVAL_REQUIRED','IDENTIFIER_CONFLICT'].includes(code))throw error;
    const location=error as {dataset?:OrganizationSheet;row?:number};issues.push({dataset:location.dataset??null,row:location.row??0,field:'',code,status:'BLOCKED'});
   }}
   if(!(await state(scope,actor,input)).verification&&!issues.some(i=>i.code==='LEGAL_REVIEW_REQUIRED'))issues.push({dataset:null,row:0,field:'',code:'LEGAL_REVIEW_REQUIRED',status:'BLOCKED'});
   const decision=issues.some(i=>i.status==='FAIL')?'FAIL' as const:issues.length?'BLOCKED' as const:'PASS' as const;
   const evaluation:ValidationEvaluation={decision,interpretationPolicy:'EXACT_TEXT_V1',issues:issues.map(i=>({rule:i.dataset??'ORG_BUNDLE',layer:data.parsed.structuralStatus==='REJECTED'?1:i.status==='FAIL'?2:6,row:i.row,field:i.dataset?`${i.dataset}.${i.field}`:i.field,status:i.status==='FAIL'?'FAIL':'NOT_EVALUATED',code:i.code})),layers:[{layer:1,status:data.parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:decision==='FAIL'?'FAIL':'PASS'},{layer:6,status:decision==='PASS'?'PASS':decision==='FAIL'?'NOT_RUN':'UNKNOWN'}],evidenceRequirements:[],dependencies:data.contracts.map(c=>({target:c.dataset+'.contract',scope:'SYNTHETIC',status:'OBSERVED',identity:c.id,version:c.versionId,periods:[{from:c.validFrom,to:c.validTo}]}))};
   const saved=await recordOwnerFileValidation(scope,provider,actor,{...input,parseRequestId:requestPart(input.requestId,'parse'),outputRequestId:requestPart(input.requestId,'validation'),campus:data.record.campus,sourceArtifactId:data.record.raw_id,contractVersionId:data.record.transportContractVersionId,ruleVersion:data.record.transportRuleVersion,parserPolicy:'STRICT_ORG_BUNDLE_V1',structuralStatus:data.parsed.structuralStatus,parsed:{sourceArtifactId:data.record.raw_id,manifestDigest:data.record.manifest_digest,contractsDigest:data.record.contracts_digest,contracts:data.record.bindings,result:data.parsed},evaluation});
   return {jobId:input.jobId,revisionId:input.revisionId,commandCount:program.steps.length,decision:saved.evaluation.decision,issues:saved.evaluation.issues.map(i=>({dataset:(['ORG01','ORG02','ORG03'].includes(i.rule)?i.rule:null) as OrganizationSheet|null,row:i.row,field:i.field.replace(/^ORG0[123]\./,''),code:i.code,status:i.status==='FAIL'?'FAIL' as const:'BLOCKED' as const})),run:saved.run};
  });},
  close:async()=>{await Promise.all([db.destroy(),subjectOwner.close(),campusOwner.close(),operatingOwner.close()]);},
 };
}
