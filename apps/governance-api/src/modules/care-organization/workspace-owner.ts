import {careBasisRequests} from './workspace-basis.js';
import {receiveWorkspaceFile} from './workspace-files.js';
import {CareFileReceiptSchema,type CareFileReceipt} from './workspace-file-contracts.js';
import {createHmac,createHash} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Check} from 'typebox/value';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,canonicalPlan,planBinding,sealProtectedPayload,authenticateRegistrationEvidence,protectedArtifacts,type KeyProviderPort} from '../governance-catalog/index.js';
import {UnitStageSchema,type UnitStage} from './contracts.js';
import {NursingStageSchema,type NursingStage} from './nursing-contracts.js';
import {WardStageSchema,type WardStage} from './ward-contracts.js';
import {UnitWardStageSchema,type UnitWardStage} from './unit-ward-contracts.js';
import {WardNursingDirectStageSchema,type WardNursingStage} from './ward-nursing-contracts.js';
import {CapabilityStageSchema,type CapabilityStage} from './capability-contracts.js';
import {SubjectStageSchema,type SubjectStage} from './subject-permission-contracts.js';
import {LifecycleStageSchema,type LifecycleStage} from './lifecycle-contracts.js';
import {LocationStageSchema,LocationUseDirectStageSchema,type LocationStage,type LocationUseStage} from '../location-master/index.js';
import {localTime} from '../organization-master/index.js';
import {CareWorkspaceExecutionsSchema,CareWorkspaceApplicationReferenceSchema,type CareWorkspaceExecutionsResultSchema,type CareWorkspaceApplicationReferenceResultSchema} from './workspace-contracts.js';
import type {Static} from 'typebox';
import {CareWorkspaceMaterialStoreSchema,CareWorkspaceMaterialReadSchema,CareWorkspaceMaterialCreateSchema} from './workspace-contracts.js';
import type {CareValidationPorts} from './validation-owner.js';
import {CareWorkspaceSaveSchema,CareWorkspaceContentSchema,CareWorkspaceActionSchema,CareWorkspaceIdSchema,CareWorkspaceListSchema,CareWorkspaceRecoverSchema,CareWorkspaceApplicationsSchema,CareWorkspacePermissionsSchema,type CareWorkspaceContent,type CareWorkspaceSave,type CareWorkspaceAction,type CareWorkspaceSubmission,type CareWorkspaceKind} from './workspace-contracts.js';
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Metadata {format:'CARE_WORKSPACE_METADATA_V1';kind:string;campus:string;profile:string;campusIds:string[];references:Array<{owner:string;id:string;versionId?:string;version?:string}>;materials:string[];subjectScopes:Array<{kind:string;scope:Record<string,unknown>}>;members:Array<{owner:string;inputId:string}>;contracts:Array<{contractId:string;contractVersionId:string}>;protected:Omit<Metadata,'protected'>[]}
interface Stored {id:string;version:string;maker:string;identity_code:string;digest:string;metadata:Metadata;envelope:Envelope;state:'EDITING'|'DISCARDED'|'SUBMITTED';recordedAt:string;submission:CareWorkspaceSubmission|null}
interface Saved {id:string;version:string;state:Stored['state'];recordedAt:string;submission?:CareWorkspaceSubmission}
const check=(schema:unknown,input:unknown)=>{if(!Check(schema as never,input))throw new Error('CLOSED_INPUT_REQUIRED');};
function filledTimes(value:unknown,path='payload'):void{if(Array.isArray(value)){value.forEach((v,i)=>filledTimes(v,path+'.'+i));return;}if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if(typeof v==='string'&&v&&['valid_from','valid_to','recorded_at','validFrom','validTo','sourceRecordedAt','cutover','recordAsOf','businessAt'].includes(key)){try{localTime(v.endsWith('+08:00')?v.slice(0,-6):v);}catch{throw Object.assign(new Error('CLOSED_INPUT_REQUIRED'),{field:path+'.'+key});}}filledTimes(v,path+'.'+key);}}
export function openCareWorkspace(connection:string,provider:KeyProviderPort,ports:CareValidationPorts){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:CatalogTransactionScope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 // Only read/audit actions use checkpoints. Saving, submitting and receipt
 // recording keep the ordinary atomic root and cannot commit partial writes.
 const readRoot=async<T>(work:(s:CatalogTransactionScope)=>Promise<T>)=>{
  const result=await db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);const checkpoint=async()=>{await sql`savepoint care_workspace_read_audit`.execute(trx);};await checkpoint();const scope=CatalogTransactionScope.from(trx,checkpoint);
   try{return {ok:true as const,value:await work(scope)};}catch(error){await sql`rollback to savepoint care_workspace_read_audit`.execute(trx);return {ok:false as const,error};}
  });if(!result.ok)throw result.error;return result.value;
 };
 const record=async<T>(s:CatalogTransactionScope,actor:string,operation:string,input:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...input,actor,operation,transaction}),key=Buffer.from(planBinding(provider,'UNIT_SQL_AUTHORITY_V1',{}),'hex');
  try{const result=(await sql<{r:T}>`select care_organization.workspace_record(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;await s.protectedReadCompleted();return result;}finally{key.fill(0);}
 };
 const metadata=(content:CareWorkspaceContent):Metadata=>{
  const fileJobValue=content.file?.body.input['job'],fileJob=fileJobValue&&typeof fileJobValue==='object'?fileJobValue as Record<string,unknown>:{};
  if('contractId' in fileJob&&typeof fileJob['contractVersionId']!=='string'||'contractVersionId' in fileJob&&typeof fileJob['contractId']!=='string')throw new Error('CLOSED_INPUT_REQUIRED');
  const campusIds=new Set<string>(),materials=new Set<string>(),references=new Map<string,Metadata['references'][number]>(),subjectScopes:Metadata['subjectScopes']=[],members:Metadata['members']=[];
  const add=(owner:string,id:unknown,versionId?:unknown,version?:unknown)=>{if(typeof id==='string'&&id){const ref={owner,id,...(typeof versionId==='string'?{versionId}:{}),...(typeof version==='string'?{version}: {})};references.set(canonicalPlan(ref),ref);if(owner==='organization-master/campus')campusIds.add(id);}};
  const defaultTarget={UNIT:'care-organization/unit',NURSING:'care-organization/nursing',WARD:'care-organization/ward',UNIT_WARD:'care-organization/unit-ward-relation',WARD_NURSING:content.payload['kind']==='SCOPE_REVISION'?'care-organization/ward-nursing-scope':'care-organization/ward-nursing-coverage',CAPABILITY:'care-organization/unit-capability',PERMISSION:'care-organization/subject-permission',LOCATION:'location-master',LOCATION_USE:'location-master/location-use',LIFECYCLE:''}[content.kind];
  const referenceFields:Record<string,string>={department:'department-master',campus:'organization-master/campus',subject:'organization-master',unit:'care-organization/unit',ward:'care-organization/ward',nursing:'care-organization/nursing',location:'location-master',usageType:'location-master/usage-type',relation:'department-master/campus-relation',departmentRelation:'department-master/campus-relation',license:'organization-master/license',reference:content.kind==='LOCATION'?'location-master':'',target:defaultTarget};
  const visit=(value:unknown,field?:string):void=>{if(Array.isArray(value)){value.forEach(v=>visit(v));return;}if(!value||typeof value!=='object')return;const v=value as Record<string,unknown>;
   if(typeof v['owner']!=='string'&&field&&referenceFields[field]){const owner=field==='target'&&v['type']==='ORG'?'department-master':field==='target'&&v['type']==='UNIT'?'care-organization/unit':field==='target'&&v['type']==='LEGAL'?'organization-master':referenceFields[field]!;add(owner,v['id'],v['versionId'],v['version']);}
   if(typeof v['owner']==='string')add(v['owner'],v['owner']==='governance-catalog/subject-code'?v['systemId']:v['owner']==='governance-catalog/parameter-value'?v['valueId']:v['id'],v['versionId'],v['version']);
   if(typeof v['owner']==='string'&&typeof v['inputId']==='string')members.push({owner:v['owner'],inputId:v['inputId']});
   if((v['kind']==='PERMISSION'||v['kind']==='MAPPING')&&v['scope']&&typeof v['scope']==='object')subjectScopes.push({kind:v['kind'],scope:v['scope'] as Record<string,unknown>});
   for(const field of ['evidenceId','evidence','sourceArtifactId'])if(typeof v[field]==='string')materials.add(v[field]);
   add('department-master',v['org_id']);add('department-master',v['managing_org_id']);add('care-organization/unit',v['managing_unit_id']);add('organization-master/campus',v['campus_id']);add('organization-master',v['legal_entity_id']);add('governance-catalog/source',v['source_system_id']);add('governance-catalog/source',v['sourceSystemId']);
   add('care-organization/ward-nursing-scope',v['scopeSetId'],undefined,v['version']);
   if(Array.isArray(v['participants'])&&(content.kind==='UNIT_WARD'||content.kind==='WARD_NURSING'))for(const participant of v['participants'])add(content.kind==='UNIT_WARD'?'care-organization/unit':'care-organization/nursing',participant);
   if(['UNIT_WARD','WARD_NURSING'].includes(content.kind)){add('care-organization/ward',v['ward_id']);add('care-organization/nursing',v['nursing_unit_id']);if(content.kind==='UNIT_WARD')add('care-organization/unit',v['unit_id']);}
   if(content.kind==='CAPABILITY')add('care-organization/unit',v['unit_id']);
   Object.entries(v).forEach(([key,value])=>visit(value,key));
  };visit(content.payload);if(content.file){visit(content.file.body.input);if(fileJob['action']==='REVISE')add('governance-catalog/import-job',fileJob['jobId'],fileJob['expectedCurrentRevision']);}add('organization-master/campus',content.payload['campusId']);
  return {format:'CARE_WORKSPACE_METADATA_V1',kind:content.kind,campus:content.campus,profile:content.profile,campusIds:[...campusIds].sort(),references:[...references.values()].sort((a,b)=>canonicalPlan(a).localeCompare(canonicalPlan(b))),materials:[...materials].sort(),subjectScopes,members,contracts:[...new Map([...(content.transport?[content.transport]:[]),...('contractId' in fileJob?[fileJob as {contractId:string;contractVersionId:string}]:[])].map(c=>[canonicalPlan({contractId:c.contractId,contractVersionId:c.contractVersionId}),{contractId:c.contractId,contractVersionId:c.contractVersionId}])).values()],protected:[]};
 };
 const seal=async(s:CatalogTransactionScope,actor:string,content:CareWorkspaceContent,previous?:Metadata)=>{const m=metadata(content);
  if(previous){const {protected:history,...old}=previous;m.protected=[...new Map([...history,old].map(value=>[canonicalPlan(value),value])).values()];if(m.protected.length>1000)throw new Error('PLAN_INPUT_LIMIT');}
  // A partial target still carries its original protected scopes. Removing the
  // editable campus field cannot turn an existing target into a generic draft.
  if(content.kind==='UNIT'||content.kind==='NURSING'||content.kind==='WARD'){const port=ports[content.kind];if(!port)throw new Error('BLOCKED_DEPENDENCY');for(const ref of m.references.filter(ref=>ref.owner==='care-organization/'+content.kind.toLowerCase())){const history=await port.inTransaction(s).history(actor,{id:ref.id});m.campusIds=[...new Set([...m.campusIds,...history.bindings.map(b=>b.campusId)])].sort();}}
  if(content.file&&content.file.body.input['campus']!==undefined&&content.file.body.input['campus']!==content.campus)throw new Error('CAMPUS_REFERENCE_CONFLICT');
  const digest=planBinding(provider,'CARE_WORKSPACE_CONTENT_V1',{content,metadata:m}),bytes=Buffer.from(canonicalPlan(content));try{return {metadata:m,digest,envelope:sealProtectedPayload(bytes,['CARE_WORKSPACE_CONTENT_V1',digest,canonicalPlan(m)],provider)};}finally{bytes.fill(0);}};
 const unseal=(r:Stored):CareWorkspaceContent=>{const bytes=authenticateRegistrationEvidence({binding:['CARE_WORKSPACE_CONTENT_V1',r.digest,canonicalPlan(r.metadata)],envelope:r.envelope},provider);try{const value:unknown=JSON.parse(bytes.toString());check(CareWorkspaceContentSchema,value);const content=value as CareWorkspaceContent,m=metadata(content);if(m.campusIds.some(id=>!r.metadata.campusIds.includes(id))||canonicalPlan(m)!==canonicalPlan({...r.metadata,campusIds:m.campusIds,protected:[]})||planBinding(provider,'CARE_WORKSPACE_CONTENT_V1',{content,metadata:r.metadata})!==r.digest)throw new Error('PAYLOAD_UNAVAILABLE');return content;}finally{bytes.fill(0);}};
 const read=(s:CatalogTransactionScope,actor:string,id:string)=>record<Stored>(s,actor,'READ',{id});
 const contentOf=(input:CareWorkspaceSave):CareWorkspaceContent=>{const {requestId:_,id:__,expectedVersion:___,...content}=input;return content;};
 const requestDigest=(action:string,input:unknown)=>planBinding(provider,'CARE_WORKSPACE_REQUEST_V1',{action,input});
 const stageNative=async(s:CatalogTransactionScope,actor:string,kind:Exclude<CareWorkspaceKind,'LIFECYCLE'>,native:Record<string,unknown>)=>{
  if(!ports[kind])throw new Error('BLOCKED_DEPENDENCY');
  switch(kind){
   case 'UNIT':check(UnitStageSchema,native);return ports.UNIT!.inTransaction(s).stage(actor,native as UnitStage);
   case 'NURSING':check(NursingStageSchema,native);return ports.NURSING!.inTransaction(s).stage(actor,native as NursingStage);
   case 'WARD':check(WardStageSchema,native);return ports.WARD!.inTransaction(s).stage(actor,native as WardStage);
   case 'UNIT_WARD':check(UnitWardStageSchema,native);return ports.UNIT_WARD!.inTransaction(s).stage(actor,native as UnitWardStage);
   case 'WARD_NURSING':check(WardNursingDirectStageSchema,native);return ports.WARD_NURSING!.inTransaction(s).stage(actor,native as WardNursingStage);
   case 'CAPABILITY':check(CapabilityStageSchema,native);return ports.CAPABILITY!.inTransaction(s).stage(actor,native as CapabilityStage);
   case 'PERMISSION':check(SubjectStageSchema,native);return ports.PERMISSION!.inTransaction(s).stage(actor,native as SubjectStage);
   case 'LOCATION':check(LocationStageSchema,native);return ports.LOCATION!.inTransaction(s).stage(actor,native as LocationStage);
   case 'LOCATION_USE':check(LocationUseDirectStageSchema,native);return ports.LOCATION_USE!.inTransaction(s).stage(actor,native as LocationUseStage);
  }
 };
 interface FileStored {id:string;version:string;digest:string;envelope:Envelope}
 const fileFrame=async(s:CatalogTransactionScope,actor:string,input:CareWorkspaceAction,permission:'READ'|'WRITE')=>{const r=await record<Stored>(s,actor,'FILE_BODY',{...input,permission}),content=unseal(r);if(!content.file||content.file.requestId!==input.requestId)throw new Error('REQUEST_CONFLICT');return {r,content};};
 const readFileReceipt=async(s:CatalogTransactionScope,actor:string,input:CareWorkspaceAction,permission:'READ'|'WRITE')=>{
  const frame=await fileFrame(s,actor,input,permission),digest=requestDigest('RECEIVE_FILE',input),stored=await record<FileStored|null>(s,actor,'FILE_LOOKUP',{...input,permission,requestDigest:digest});if(!stored)return null;
  const bytes=authenticateRegistrationEvidence({binding:['CARE_FILE_RECEIPT_V1',input.id,input.expectedVersion,input.requestId,stored.digest],envelope:stored.envelope},provider);
  try{const receipt:unknown=JSON.parse(bytes.toString());check(CareFileReceiptSchema,receipt);if(planBinding(provider,'CARE_FILE_RECEIPT_V1',receipt)!==stored.digest)throw new Error('PAYLOAD_UNAVAILABLE');const value=receipt as CareFileReceipt;
   const j=(await sql<{r:{contract:{definition:{sourceVersionId:string}}}}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:value.jobId})}::jsonb) r`.execute(s)).rows[0]!.r;
   await sql`select governance_catalog.registration_evidence_access(${actor},${value.sourceArtifactId}::uuid,${j.contract.definition.sourceVersionId}::uuid,${frame.content.campus})`.execute(s);
   if(value.input){const owner=ports[frame.content.kind as Exclude<CareWorkspaceKind,'LIFECYCLE'>];if(!owner)throw new Error('BLOCKED_DEPENDENCY');await owner.inTransaction(s).readInput(actor,{inputId:value.input.inputId});}return value;
  }finally{bytes.fill(0);}
 };
 return {
  ...careBasisRequests(provider,root,readRoot),
  async savedFile(actor:string,input:CareWorkspaceAction){check(CareWorkspaceActionSchema,input);return readRoot(async s=>{const {r,content}=await fileFrame(s,actor,input,'READ');return {id:r.id,version:r.version,kind:content.kind,campus:content.campus,file:content.file};});},
  async fileReceipt(actor:string,input:CareWorkspaceAction){check(CareWorkspaceActionSchema,input);return readRoot(s=>readFileReceipt(s,actor,input,'READ'));},
  async receiveFile(actor:string,input:CareWorkspaceAction){check(CareWorkspaceActionSchema,input);input=structuredClone(input);const prior=await readRoot(s=>readFileReceipt(s,actor,input,'WRITE'));if(prior)return prior;
   const frame=await readRoot(s=>fileFrame(s,actor,input,'WRITE')),receipt=await receiveWorkspaceFile(ports,actor,frame.content.kind,frame.content.file!),digest=planBinding(provider,'CARE_FILE_RECEIPT_V1',receipt),bytes=Buffer.from(canonicalPlan(receipt));
   try{await root(s=>record(s,actor,'FILE_RECORD',{...input,permission:'WRITE',requestDigest:requestDigest('RECEIVE_FILE',input),digest,envelope:sealProtectedPayload(bytes,['CARE_FILE_RECEIPT_V1',input.id,input.expectedVersion,input.requestId,digest],provider)}));}finally{bytes.fill(0);}
   const completed=await readRoot(s=>readFileReceipt(s,actor,input,'READ'));if(!completed)throw new Error('OWNER_RESPONSE_INVALID');return completed;
  },
  async save(actor:string,input:CareWorkspaceSave){check(CareWorkspaceSaveSchema,input);input=structuredClone(input);filledTimes(input.payload);if(input.file)filledTimes(input.file.body.input,'file.body.input');if(!!input.id!==!!input.expectedVersion)throw new Error('CLOSED_INPUT_REQUIRED');const content=contentOf(input),digest=requestDigest('SAVE',input);return root(async s=>{const prior=await record<Saved|null>(s,actor,'LOOKUP',{requestId:input.requestId,requestDigest:digest,...(input.id?{id:input.id}:{})});if(prior)return prior;const previous=input.id?await read(s,actor,input.id):undefined;return record<Saved>(s,actor,'SAVE',{...await seal(s,actor,content,previous?.metadata),requestId:input.requestId,requestDigest:digest,state:'EDITING',...(input.id?{id:input.id,expectedVersion:input.expectedVersion}:{})});});},
  async read(actor:string,input:{id:string}){check(CareWorkspaceIdSchema,input);return readRoot(async s=>{const r=await read(s,actor,input.id);return {id:r.id,version:r.version,state:r.state,recordedAt:r.recordedAt,...(r.submission?{submission:r.submission}:{}),content:unseal(r),maker:r.maker};});},
  async recover(actor:string,input:{requestId:string}){check(CareWorkspaceRecoverSchema,input);return readRoot(s=>record<Saved|null>(s,actor,'RECOVER',input));},
  async applications(actor:string,input:{kind:string;campus:string;after?:string;limit?:number}){check(CareWorkspaceApplicationsSchema,input);return readRoot(s=>record<{items:Array<{id:string;maker:string;recordedAt:string;submission:CareWorkspaceSubmission}>;nextAfterId:string|null}>(s,actor,'APPLICATIONS',{...input,limit:input.limit??50}));},
  async permissions(actor:string,input:{kind:string;campus:string;campusId?:string}){check(CareWorkspacePermissionsSchema,input);return readRoot(s=>record<{read:boolean;write:boolean;readRestricted:boolean;verify:boolean;review:boolean}>(s,actor,'PERMISSIONS',input));},
  async executions(actor:string,input:{kind:string;inputId:string;after?:string;limit?:number}){check(CareWorkspaceExecutionsSchema,input);return readRoot(s=>record<Static<typeof CareWorkspaceExecutionsResultSchema>>(s,actor,'EXECUTIONS',input));},
  async applicationReference(actor:string,input:{kind:string;inputId:string}){check(CareWorkspaceApplicationReferenceSchema,input);return readRoot(async s=>{const reference=await record<Static<typeof CareWorkspaceApplicationReferenceResultSchema>>(s,actor,'APPLICATION_REFERENCE',input);if(input.kind==='LIFECYCLE')return {...reference,source:null};const owner=ports[input.kind as Exclude<CareWorkspaceKind,'LIFECYCLE'>];if(!owner)throw new Error('BLOCKED_DEPENDENCY');return {...reference,source:await owner.sourceLocationInTransaction(s,actor,{inputId:input.inputId,row:null})};});},
  async list(actor:string,input:Static<typeof CareWorkspaceListSchema>){check(CareWorkspaceListSchema,input);return readRoot(s=>record<{items:Array<{id:string;version:string;kind:string;campus:string;state:string;recordedAt:string}>;nextAfterId:string|null}>(s,actor,'LIST',{...input,limit:input.limit??50}));},
  async storeMaterial(actor:string,input:Static<typeof CareWorkspaceMaterialStoreSchema>){check(CareWorkspaceMaterialStoreSchema,input);const bytes=Buffer.from(input.contentBase64,'base64');try{return await protectedArtifacts(db,provider).storeProtectedArtifact(actor,input.input,bytes);}finally{bytes.fill(0);}},
  async createMaterial(actor:string,input:Static<typeof CareWorkspaceMaterialCreateSchema>){check(CareWorkspaceMaterialCreateSchema,input);input=structuredClone(input);const bytes=Buffer.from(input.contentBase64,'base64');if(bytes.length<1||bytes.length>1048576)throw new Error('CLOSED_INPUT_REQUIRED');const child=(tag:string)=>{const h=createHash('sha256').update(input.requestId+'\0'+tag).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};try{return await root(async s=>{const command={action:'CREATE',scope:'SYNTHETIC',requestId:child('MATERIAL_JOB'),reason:'CARE_WORKSPACE',...input.transport,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:planBinding(provider,'CARE_WORKSPACE_MATERIAL_JOB_V1',input)}};const job=(await sql<{r:{id:string;revisionId:string}}>`select governance_catalog.import_job_command(${actor},${JSON.stringify(command)}::jsonb) r`.execute(s)).rows[0]!.r;const material=await protectedArtifacts(s,provider).storeProtectedArtifact(actor,{scope:'SYNTHETIC',requestId:child('MATERIAL_STORE'),jobId:job.id,revisionId:job.revisionId,campus:input.campus,purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:input.retentionSeconds},bytes);return {...material,jobId:job.id,revisionId:job.revisionId};});}finally{bytes.fill(0);}},
  async readMaterial(actor:string,input:Static<typeof CareWorkspaceMaterialReadSchema>){check(CareWorkspaceMaterialReadSchema,input);input=structuredClone(input);if(input.access==='OWN'){const {access:_,...dimensions}=input,bytes=await protectedArtifacts(db,provider).authorizeSensitiveRead(actor,dimensions);try{return {artifactId:input.artifactId,contentBase64:Buffer.from(bytes).toString('base64')};}finally{bytes.fill(0);}}return readRoot(async s=>{const port=ports[input.kind as Exclude<CareWorkspaceKind,'LIFECYCLE'>];if(!port)throw new Error('BLOCKED_DEPENDENCY');const native=await port.inTransaction(s).readInput(actor,{inputId:input.inputId});const content={kind:input.kind as CareWorkspaceKind,campus:native.campus,profile:native.profile,payload:native};if(!metadata(content).materials.includes(input.artifactId))throw new Error('ACCESS_DENIED');const ref=await port.lifecycleReferenceInTransaction(s,actor,input.inputId),j=(await sql<{r:{contract:{definition:{sourceVersionId:string}}}}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:native.jobId})}::jsonb) r`.execute(s)).rows[0]!.r;const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${input.artifactId}::uuid,${j.contract.definition.sourceVersionId}::uuid,${ref.campus}) r`.execute(s)).rows[0]!.r;await s.protectedReadCompleted();const bytes=authenticateRegistrationEvidence(proof,provider);try{return {artifactId:input.artifactId,contentBase64:bytes.toString('base64')};}finally{bytes.fill(0);}});},
  async discard(actor:string,input:CareWorkspaceAction){check(CareWorkspaceActionSchema,input);return root(async s=>{const digest=requestDigest('DISCARD',input),prior=await record<Saved|null>(s,actor,'LOOKUP',{...input,requestDigest:digest});if(prior)return prior;const r=await read(s,actor,input.id);return record<Saved>(s,actor,'SAVE',{...input,digest:r.digest,metadata:r.metadata,envelope:r.envelope,requestDigest:digest,state:'DISCARDED'});});},
  async submit(actor:string,input:CareWorkspaceAction){check(CareWorkspaceActionSchema,input);return root(async s=>{
   const digest=requestDigest('SUBMIT',input),prior=await record<Saved|null>(s,actor,'LOOKUP',{...input,requestDigest:digest});if(prior)return prior;
   const r=await read(s,actor,input.id);if(r.version!==input.expectedVersion||r.state!=='EDITING')throw new Error('STALE_HEAD');const content=unseal(r);if(content.file)throw new Error('FILE_RECEIPT_REQUIRED');
   const part=(tag:string)=>{const h=createHash('sha256').update(input.requestId+'\0'+tag).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
   let submission:CareWorkspaceSubmission;
   if(content.kind==='LIFECYCLE'){
    if(!ports.lifecycle||content.transport)throw new Error('BLOCKED_DEPENDENCY');const native={...content.payload,requestId:part('INPUT'),campus:content.campus};check(LifecycleStageSchema,native);
    submission={kind:'LIFECYCLE',...await ports.lifecycle.stageInTransaction(s,actor,native as LifecycleStage)};
   }else{
   if(!content.transport)throw new Error('BLOCKED_DEPENDENCY');
   const command={action:'CREATE',scope:'SYNTHETIC',requestId:part('JOB'),reason:'CARE_WORKSPACE',...content.transport,profile:content.profile,input:{kind:'METADATA_ONLY',declaredSha256:planBinding(provider,'CARE_WORKSPACE_TRANSPORT_V1',input)}};
   const job=(await sql<{r:{id:string;revisionId:string}}>`select governance_catalog.import_job_command(${actor},${JSON.stringify(command)}::jsonb) r`.execute(s)).rows[0]!.r;
   const native={...content.payload,requestId:part('INPUT'),jobId:job.id,revisionId:job.revisionId,campus:content.campus,profile:content.profile};
   const staged=await stageNative(s,actor,content.kind,native),reference=await ports[content.kind]!.lifecycleReferenceInTransaction(s,actor,staged.inputId);
   submission={kind:content.kind,inputId:staged.inputId,revisionId:staged.revisionId,digest:staged.digest,contractVersionId:reference.contractVersionId,jobId:job.id,jobRevisionId:job.revisionId};
   }
   return record<Saved>(s,actor,'SAVE',{...input,digest:r.digest,metadata:r.metadata,envelope:r.envelope,requestDigest:digest,state:'SUBMITTED',submission});
  });},
  async close(){await db.destroy();},
 };
}
export type CareWorkspaceOwner=ReturnType<typeof openCareWorkspace>;
