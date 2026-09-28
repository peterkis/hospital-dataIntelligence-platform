import {ApplicationListSchema,BundleListSchema,type ApplicationList,type BundleList} from './contracts.js';
import {openOrganizationImport,ReceiveOrganizationBundleSchema} from '../import/index.js';
import {randomUUID,createHash} from 'node:crypto';
import {Check} from 'typebox/value';
import {openOrganization,openCampus,openOperatingRelations} from '../index.js';
import {StageSchema} from '../contracts.js';
import {CampusStageSchema} from '../campus/contracts.js';
import {OperatingStageSchema} from '../operating/contracts.js';
import {sql} from 'kysely';
import {campusInput,check} from '../campus/input.js';
import {Id} from '../contracts.js';
import {canonicalPlan,planBinding,sealProtectedPayload,authenticateRegistrationEvidence,protectedArtifacts,type KeyProviderPort,type ImportContractItem,parseOrganizationWorkbookBounded,type OrganizationSheet,type ParserField} from '../../governance-catalog/index.js';
import {DraftSaveSchema,DraftContentSchema,draftMetadata,type DraftSave,type DraftContent,DraftActionSchema,type DraftAction,type Submission,type ApplicationAccess,type ApplicationSummary,type WorkspaceBundle,MaterialReviewSchema,type MaterialReview,PreflightSchema,type PreflightInput,ObjectContextInputSchema,PrepareRevisionSchema,type ObjectContextInput,type ObjectContext,type PrepareRevision,PrepareCampusLifecycleSchema,type PrepareCampusLifecycle} from './contracts.js';
export * from './contracts.js';
interface Saved {id:string;version:string;state:'EDITING'|'DISCARDED'|'SUBMITTED';recordedAt:string}
interface Stored extends Saved {submission:Submission|null;digest:string;metadata:ReturnType<typeof draftMetadata>;envelope:ReturnType<typeof sealProtectedPayload>}
export function openOrganizationWorkspace(connection:string,provider?:KeyProviderPort){
 const {db,root}=campusInput(connection,provider);
 const organization=openOrganization(connection,provider),campus=openCampus(connection,provider),operating=openOperatingRelations(connection,provider),bundle=openOrganizationImport(connection,provider);
 const unseal=(r:Stored):DraftSave=>{
  const bytes=authenticateRegistrationEvidence({binding:['WORKSPACE_DRAFT_V1',r.digest],envelope:r.envelope},provider);
  try{const content:DraftSave=JSON.parse(bytes.toString());check(DraftSaveSchema,content);
   // Verify old envelopes against their original projection. Missing licenseTarget
   // stays missing in SQL and never gains the 0073 maintenance exception on read.
   const format=Object.hasOwn(r.metadata,'manifestReferences')?'V4':Object.hasOwn(r.metadata,'manifestProtected')?'V3':Object.hasOwn(r.metadata,'licenseTarget')?'V2':'V1';
   const metadata=draftMetadata(content,format);
   if(planBinding(provider,'WORKSPACE_DRAFT_V1',{state:r.state,input:content})!==r.digest||canonicalPlan(metadata)!==canonicalPlan(r.metadata))throw new Error('PAYLOAD_UNAVAILABLE');
   // Historical payload-free bundle metadata could not prove whether its
   // manifest retained protected rows. Never release that ambiguous plaintext;
   // the immutable legacy draft remains as an audit record and must be replaced.
   const legacyManifest=content.domain==='BUNDLE'?content.metadata['manifest']:null;
   const legacyRows=legacyManifest&&typeof legacyManifest==='object'?Reflect.get(legacyManifest,'rows'):null;
   if(format!=='V3'&&format!=='V4'&&content.domain==='BUNDLE'&&!content.bytesBase64&&Array.isArray(legacyRows)&&legacyRows.length)throw new Error('BLOCKED_DEPENDENCY');
   return content;
  }finally{bytes.fill(0);}
 };
 const part=(requestId:string,label:string)=>{const bytes=createHash('sha256').update('WORKSPACE_REQUEST_V1\0'+requestId+'\0'+label).digest().subarray(0,16);bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
 const sourceContext=(actor:string,input:PrepareRevision)=>root(async scope=>(await sql<{r:ObjectContext&{inputId:string;transport:{contractId:string;contractVersionId:string}|null}}>`select organization_master.workspace_version_source(${actor},${input.kind},${input.id}::uuid,${input.version}) r`.execute(scope)).rows[0]!.r);
 const service={
  async listBundles(actor:string,filter:BundleList={}){check(BundleListSchema,filter);return root(async scope=>(await sql<{r:WorkspaceBundle[]}>`select organization_master.workspace_bundles(${actor},${filter.jobId??null}::uuid,${filter.revisionId??null}::uuid) r`.execute(scope)).rows[0]!.r);},
  async objectContext(actor:string,input:ObjectContextInput){check(ObjectContextInputSchema,input);return root(async scope=>(await sql<{r:ObjectContext}>`select organization_master.workspace_object_context(${actor},${input.kind},${input.id}::uuid) r`.execute(scope)).rows[0]!.r);},
  async prepareRevision(actor:string,input:PrepareRevision):Promise<DraftContent>{check(PrepareRevisionSchema,input);
   const context=await sourceContext(actor,input);
   if(input.kind==='CAMPUS'&&context.terminal)throw new Error('CAMPUS_RETIRED');
   const owner=input.kind==='ORGANIZATION'||input.kind==='LICENSE'?organization:input.kind==='CAMPUS'?campus:operating;
   const original=await owner.readRestrictedInput(actor,context.inputId),command:Record<string,unknown>=structuredClone(original.command);
   delete command['validFrom'];command['validTo']=null;
   if(input.kind==='ORGANIZATION'){command['action']='REVISE';command['target']={id:input.id,version:context.head};}
   else if(input.kind==='LICENSE'){command['action']='REVISE_LICENSE';command['target']={id:context.subjectId,version:context.subjectHead};command['licenseTarget']={id:input.id,version:context.head};}
   else if(input.kind==='CAMPUS'){command['action']='REVISE';command['target']={owner:'organization-master/campus',id:input.id,expectedVersion:context.head};delete command['sourceOperationStatus'];}
   else{command['action']=input.kind==='RELATION'?'REVISE_RELATION':'REVISE_SCOPE';command['target']={owner:input.kind==='RELATION'?'organization-master/operating-relation':'organization-master/license-scope',id:input.id,expectedVersion:context.head};}
   const content:DraftContent={domain:input.kind==='ORGANIZATION'||input.kind==='LICENSE'?'ORG01':input.kind==='CAMPUS'?'ORG02':'ORG03',campus:context.campus,...(context.transport?{transport:context.transport}:{}),command};check(DraftContentSchema,content);return content;
  },
  async prepareCampusLifecycle(actor:string,input:PrepareCampusLifecycle):Promise<DraftContent>{
   check(PrepareCampusLifecycleSchema,input);
   const context=await sourceContext(actor,input);
   const disposition=input.action==='RECORD_DISPOSITION'||input.action==='COMPLETE_DISPOSITION';
   if(context.terminal&&!disposition&&input.action!=='CANCEL_OPENING')throw new Error('CAMPUS_RETIRED');
   const history=await campus.references.history(actor,input.id);
   if(history.head!==context.head)throw new Error('STALE_HEAD');
   const retirement=history.operations.find(event=>event.action==='RETIRE');
   if(input.action==='RETIRE'&&retirement)throw new Error('CAMPUS_RETIRED');
   if(disposition&&!retirement)throw new Error('BLOCKED_DEPENDENCY');
   const original=await campus.readRestrictedInput(actor,context.inputId);
   const command:Record<string,unknown>={action:input.action,validTo:null,target:{owner:'organization-master/campus',id:input.id,expectedVersion:context.head},source:structuredClone(original.command.source),evidence:original.command.evidence};
   if(disposition){command['validFrom']=retirement!.validFrom;command['sourceOperationStatus']='RETIRED';}
   const content:DraftContent={domain:'ORG02',campus:context.campus,...(context.transport?{transport:context.transport}:{}),command};
   check(DraftContentSchema,content);return content;
  },
  async preflight(actor:string,input:PreflightInput){check(PreflightSchema,input);let observedAt:string|null=null;
   try{return await root(async scope=>{
    const r=(await (input.domain==='ORG03'?sql<{r:{domain:string;revision:string;campus:'NORTH'|'SOUTH'}}> `select organization_master.operating_input_read(${actor},${input.inputId}::uuid,'READ_RESTRICTED') r`:sql<{r:{domain:string;revision:string;campus:'NORTH'|'SOUTH'}}> `select organization_master.input_read(${actor},${input.inputId}::uuid,'READ_RESTRICTED') r`).execute(scope)).rows[0]!.r;
    if(r.domain!==input.domain)throw new Error('ACCESS_DENIED');
    observedAt=(await sql<{t:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') t`.execute(scope)).rows[0]!.t;
    const port=(input.domain==='ORG01'?organization:input.domain==='ORG02'?campus:operating).commandsInTransaction(scope).port;
    const reference={scope:'SYNTHETIC' as const,campus:r.campus,purpose:'IDENTITY_VERIFY' as const,jobId:input.inputId,revisionId:r.revision,requestId:randomUUID()};
    await port.authorize(scope,actor,reference,'READ');const unit=await port.observe(scope,actor,reference);await port.validate(scope,actor,unit);
    return {status:'ELIGIBLE_FOR_CANDIDATE' as const,codes:[] as string[],observedAt};
   });}catch(error){const code=error instanceof Error?error.message:'';
    if(!observedAt||!['STALE_VALIDATION','STALE_HEAD','BLOCKED_DEPENDENCY','IDENTIFIER_CONFLICT','LICENSE_END_UNKNOWN','LICENSE_PERIOD_NOT_COVERED','LICENSE_ID_MISMATCH','APPROVAL_REQUIRED','PRIMARY_OPERATOR_CONFLICT','OPERATING_CLOSED','CAMPUS_RETIRED','CAMPUS_SUSPENDED','DISPOSITION_INCOMPLETE','DISPOSITION_ALREADY_COMPLETE','UNSUPPORTED_STATE_TRANSITION','UNSUPPORTED_SERVICE','PARENT_PERIOD_NOT_COVERED','INVALID_BUSINESS_PERIOD','CLOSED_INPUT_REQUIRED'].includes(code))throw error;
    return {status:'BLOCKED' as const,codes:[code],observedAt};
   }
  },
  async reviewMaterials(actor:string,input:MaterialReview){check(MaterialReviewSchema,input);const target=input.domain==='ORG01'?organization:input.domain==='ORG02'?campus:operating;
   const candidate=await target.readApplyCandidate(actor,{candidateId:input.candidateId});
   const basis=input.domain==='ORG03'?candidate.unit.basis['basis']:candidate.unit.basis;
   const proof=basis&&typeof basis==='object'?Reflect.get(basis,input.domain==='ORG03'?'evidence':'source'):null;
   const artifactId=proof&&typeof proof==='object'&&'artifactId' in proof&&typeof proof.artifactId==='string'?proof.artifactId:null;
   const command:unknown=JSON.parse(candidate.unit.commands[0]!.value['command']!);
   const source=command&&typeof command==='object'&&'source' in command?command.source:null;
   const sourceVersion=source&&typeof source==='object'&&'versionId' in source?source.versionId:null;
   const sourceId=source&&typeof source==='object'&&'systemId' in source?source.systemId:null;
   const from=command&&typeof command==='object'&&'validFrom' in command?command.validFrom:null,to=command&&typeof command==='object'&&'validTo' in command?command.validTo:null;
   const materials=artifactId?await root(async scope=>{check(Id,sourceVersion);check(Id,sourceId);const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.evidence(${actor},${artifactId}::uuid,${sourceId}::uuid,${sourceVersion}::uuid,${candidate.unit.input.campus},${from}::timestamp,${to}::timestamp) r`.execute(scope)).rows[0]!.r;const bytes=authenticateRegistrationEvidence(proof,provider);try{return [{artifactId,bytesBase64:bytes.toString('base64')}];}finally{bytes.fill(0);}}):[];
   return {candidateId:candidate.candidateId,digest:candidate.digest,materials};
  },
  async applicationCapabilities(actor:string,id:string){check(Id,id);return root(async scope=>(await sql<{r:ApplicationAccess}>`select organization_master.workspace_application_access(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r);},
  async listApplications(actor:string,filter:ApplicationList={}){check(ApplicationListSchema,filter);return root(async scope=>(await sql<{r:ApplicationSummary[]}>`select organization_master.workspace_applications(${actor},${filter.inputId??null}::uuid) r`.execute(scope)).rows[0]!.r);},
  async previewWorkbook(actor:string,input:DraftContent){check(DraftContentSchema,input);input=structuredClone(input);if(input.domain!=='BUNDLE'||!input.bytesBase64)throw new Error('CLOSED_INPUT_REQUIRED');const metadata=draftMetadata(input),bytes=Buffer.from(input.bytesBase64,'base64');
   try{return await root(async scope=>{
    await sql`select organization_master.workspace_preview_access(${actor},${JSON.stringify(metadata)}::jsonb,${planBinding(provider,'WORKSPACE_PREVIEW_V1',{metadata,bytes:input.bytesBase64})})`.execute(scope);
    const fields:Record<OrganizationSheet,ParserField[]>={ORG01:[],ORG02:[],ORG03:[]};
    for(const binding of metadata.bindings){const rows=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'HISTORY',target:binding.contractId,versionId:binding.contractVersionId})}::jsonb) r`.execute(scope)).rows[0]!.r;
     const c=rows.filter(c=>c.status==='PUBLISHED').at(-1);if(!c||c.definition.templateVersion!==binding.dataset+'_BUNDLE_CORE_V1')throw new Error('BLOCKED_DEPENDENCY');
     fields[c.dataset as OrganizationSheet]=c.definition.fields.map(f=>({code:f.code,type:f.type}));
    }
    const parsed=await parseOrganizationWorkbookBounded(bytes,fields);
    return {policy:parsed.policy,structuralStatus:parsed.structuralStatus,qualification:'NOT_EVALUATED' as const,readOnly:true as const,fields:Object.entries(fields).map(([dataset,fields])=>({dataset,fields})),issues:parsed.issues.map(i=>({code:i.code,row:i.row,column:i.column,sheet:i.sheet??null})),cells:Object.values(parsed.sheets).flatMap(s=>s.cells.map(c=>({sheet:c.sheet,row:c.sourceRow,column:c.column,field:c.field,value:c.value,sourceType:c.sourceType})))};
   });}finally{bytes.fill(0);}
  },
  async capabilities(actor:string,input:DraftContent){check(DraftContentSchema,input);const metadata=draftMetadata(input);return root(async scope=>(await sql<{r:{canRead:boolean;canWrite:boolean;canReview:boolean;observedAt:string}}>`select organization_master.workspace_capabilities(${actor},${JSON.stringify(metadata)}::jsonb) r`.execute(scope)).rows[0]!.r);},
  async saveDraft(actor:string,input:DraftSave,state:'EDITING'|'DISCARDED'='EDITING'):Promise<Saved>{
   check(DraftSaveSchema,input);input=structuredClone(input);const metadata=draftMetadata(input),digest=planBinding(provider,'WORKSPACE_DRAFT_V1',{state,input}),raw=Buffer.from(canonicalPlan(input));
   if(raw.length>1800000)throw new Error('FILE_SIZE_OR_ENCODING');
   try{const envelope=sealProtectedPayload(raw,['WORKSPACE_DRAFT_V1',digest],provider);
    return root(async scope=>(await sql<{r:Saved}>`select organization_master.workspace_save(${actor},${JSON.stringify({requestId:input.requestId,id:input.id,expectedVersion:input.expectedVersion,state,metadata})}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb) r`.execute(scope)).rows[0]!.r);
   }finally{raw.fill(0);}
  },
  async readDraft(actor:string,id:string){check(Id,id);return root(async scope=>{
   const r=(await sql<{r:Stored}>`select organization_master.workspace_read(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;
   return {id:r.id,version:r.version,state:r.state,recordedAt:r.recordedAt,content:unseal(r),submission:r.submission};
  });},
  async submitDraft(actor:string,input:DraftAction):Promise<Submission>{check(DraftActionSchema,input);input=structuredClone(input);return root(async scope=>{
   const stored=(await sql<{r:Stored}>`select organization_master.workspace_read(${actor},${input.id}::uuid) r`.execute(scope)).rows[0]!.r;
   if(stored.submission){if(stored.submission.requestId!==input.requestId||stored.submission.expectedVersion!==input.expectedVersion)throw new Error('REQUEST_CONFLICT');return stored.submission;}
   if(stored.state!=='EDITING'||stored.version!==input.expectedVersion)throw new Error('STALE_HEAD');
   const content=unseal(stored);let submission:Submission;
   if(content.domain==='BUNDLE'){
    const metadata={...content.metadata,requestId:part(input.requestId,'bundle')};if(!Check(ReceiveOrganizationBundleSchema,metadata)||!content.bytesBase64)throw new Error('CLOSED_INPUT_REQUIRED');
    const raw=Buffer.from(content.bytesBase64,'base64');try{const received=await bundle.receiveInTransaction(scope,actor,metadata,raw);submission={draftId:input.id,requestId:input.requestId,expectedVersion:input.expectedVersion,domain:'BUNDLE',inputId:received.jobId,revisionId:received.revisionId,jobId:received.jobId,jobRevisionId:received.revisionId};}finally{raw.fill(0);}
   }else{if(content.profile==='FULL'||content.dependencies?.length||!content.transport)throw new Error('BLOCKED_DEPENDENCY');
   const contracts=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'HISTORY',target:content.transport.contractId,versionId:content.transport.contractVersionId})}::jsonb) r`.execute(scope)).rows[0]!.r;
   const contract=contracts.filter(c=>c.status==='PUBLISHED').at(-1),source=content.command['source'];
   if(!contract||contract.dataset!==content.domain||contract.profile!=='CORE'||contract.definition.templateVersion!==content.domain+'_MANUAL_CORE_V1'||!source||typeof source!=='object'||!('versionId' in source)||source.versionId!==contract.definition.sourceVersionId)throw new Error('BLOCKED_DEPENDENCY');
   const jobInput={action:'CREATE',scope:'SYNTHETIC',requestId:part(input.requestId,'job'),reason:'WORKSPACE_MANUAL',workspaceDraft:{id:input.id,expectedVersion:input.expectedVersion},...content.transport,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:planBinding(provider,'WORKSPACE_TRANSPORT_V1',input)}};
   const job=(await sql<{r:{id:string;revisionId:string}}>`select governance_catalog.import_job_command(${actor},${JSON.stringify(jobInput)}::jsonb) r`.execute(scope)).rows[0]!.r;
   const command=structuredClone(content.command);
   if(content.attachment){
    const raw=Buffer.from(content.attachment.bytesBase64,'base64');let artifactId:string;
    try{if(!raw.length||raw.length>1048576)throw new Error('FILE_SIZE_OR_ENCODING');const stored=await protectedArtifacts(scope,provider).storeProtectedArtifact(actor,{scope:'SYNTHETIC',campus:content.campus,purpose:'IDENTITY_VERIFY',requestId:part(input.requestId,'evidence'),jobId:job.id,revisionId:job.revisionId,kind:'RAW_FILE',retentionSeconds:86400},raw);artifactId=stored.artifactId;}finally{raw.fill(0);}
    if(content.domain==='ORG01'&&['CREATE','REVISE'].includes(String(command['action']))){
     const facts=command['facts']&&typeof command['facts']==='object'?command['facts']:{};
     if('registrationEvidence' in facts&&facts.registrationEvidence)throw new Error('EVIDENCE_SELECTION_CONFLICT');command['facts']={...facts,registrationEvidence:artifactId};
    }else if(content.domain==='ORG01'&&['ADD_LICENSE','REVISE_LICENSE'].includes(String(command['action']))){
     const license=command['license']&&typeof command['license']==='object'?command['license']:{};
     if('evidence' in license&&license.evidence)throw new Error('EVIDENCE_SELECTION_CONFLICT');command['license']={...license,evidence:artifactId};
    }else{if(command['evidence'])throw new Error('EVIDENCE_SELECTION_CONFLICT');command['evidence']=artifactId;}
   }
   const base={requestId:part(input.requestId,'stage'),jobId:job.id,revisionId:job.revisionId,profile:'CORE' as const,command};
   let staged:{inputId:string;revisionId:string};
   if(content.domain==='ORG01'){const value={...base,campus:content.campus,purpose:'IDENTITY_VERIFY' as const};if(!Check(StageSchema,value))throw new Error('CLOSED_INPUT_REQUIRED');staged=await organization.commandsInTransaction(scope).stage(actor,value);}
   else if(content.domain==='ORG02'){const value={...base,campus:content.campus,purpose:'IDENTITY_VERIFY' as const};if(!Check(CampusStageSchema,value))throw new Error('CLOSED_INPUT_REQUIRED');staged=await campus.commandsInTransaction(scope).stage(actor,value);}
   else {if(!Check(OperatingStageSchema,base))throw new Error('CLOSED_INPUT_REQUIRED');staged=await operating.commandsInTransaction(scope).stage(actor,base);}
   submission={draftId:input.id,requestId:input.requestId,expectedVersion:input.expectedVersion,domain:content.domain,...staged,jobId:job.id,jobRevisionId:job.revisionId};
   }
   const saved={...content,...input},digest=planBinding(provider,'WORKSPACE_DRAFT_V1',{state:'SUBMITTED',input:saved}),bytes=Buffer.from(canonicalPlan(saved));
   try{const envelope=sealProtectedPayload(bytes,['WORKSPACE_DRAFT_V1',digest],provider);await sql`select organization_master.workspace_save(${actor},${JSON.stringify({...input,state:'SUBMITTED',metadata:draftMetadata(saved),submission})}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb)`.execute(scope);}finally{bytes.fill(0);}
   return submission;
  });},
  async listDrafts(actor:string){return root(async scope=>(await sql<{r:Array<Saved&{domain:string;campus:string;action:string|null}>}>`select organization_master.workspace_list(${actor}) r`.execute(scope)).rows[0]!.r);},
  async discardDraft(actor:string,input:{id:string;expectedVersion:string;requestId:string}){check(Id,input.id);check(Id,input.requestId);const saved=await service.readDraft(actor,input.id);return service.saveDraft(actor,{...saved.content,...input},'DISCARDED');},
  async close(){await Promise.all([db.destroy(),organization.close(),campus.close(),operating.close(),bundle.close()]);}
 };
 return service;
}
