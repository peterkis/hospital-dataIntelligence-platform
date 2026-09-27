import {createRegistrationReader} from './registration.js';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {Pool,types} from 'pg';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {applyCoordinator,type ApplyOwnerPort,type OwnerFact,CatalogTransactionScope,canonicalPlan,planBinding,authenticateRegistrationEvidence,type KeyProviderPort} from '../governance-catalog/index.js';
import {StageSchema,InputSchema,ReadSchema,QualificationSchema,LicenseReadSchema,OrganizationCommandSchema,Id,type StageInput,type OrganizationCommand,type OrganizationRead,type OrganizationFact} from './contracts.js';
import {localTime,licenseEnd,covered,intersect,subtract} from './time.js';
export * from './contracts.js';
type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface InputRecord {id:string;domain?:string;revision:string;digest:string;campus:'NORTH'|'SOUTH';target:string|null;envelope:Envelope;jobId:string;jobRevision:string;currentRevision:string;withdrawn:boolean}
interface StoredPeriod {id:string;number:number;valid_from:string;valid_to:string|null;recorded_at:string;input_id:string}
interface Version extends StoredPeriod {registration_evidence:string;identifier_keys:Array<{kind:string;namespace:string;digest:string}>;legal_name:string;entity_nature:string;authority:string|null;legal_address:string|null}
interface LicenseVersion extends StoredPeriod {license_id:string;authority:string;end_kind:'FINITE'|'VERIFIED_UNBOUNDED'|'UNKNOWN';evidence:string;revoked:boolean}
interface Verification {id:string;subject_version:string;licenses:string[];valid_from:string;valid_to:string|null;recorded_at:string}
interface Snapshot {versions:Version[];licenses:LicenseVersion[];verifications:Verification[];identifierKinds:string[]}
const stamp=(s:string)=>localTime(s.replace(' ','T'));
const safeCodes=new Set(['ACCESS_DENIED','NOT_FOUND','STALE_VALIDATION','REQUEST_CONFLICT','BLOCKED_DEPENDENCY','PAYLOAD_UNAVAILABLE','KEY_UNAVAILABLE','CLOSED_INPUT_REQUIRED','IDENTIFIER_CONFLICT','LICENSE_END_UNKNOWN','LICENSE_PERIOD_NOT_COVERED','LICENSE_ID_MISMATCH','APPROVAL_REQUIRED','ALREADY_COMMITTED']);
function safe(error:unknown):Error {return new Error(error instanceof Error&&safeCodes.has(error.message)?error.message:'ORGANIZATION_OPERATION_FAILED');}
function check<S>(schema:S,value:unknown){if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}

export function openOrganization(connectionString:string,provider?:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:4,options:'-c timezone=Asia/Shanghai',types:{getTypeParser:(oid,format)=>oid===1114?(v:string)=>v:types.getTypeParser(oid,format)}})})});
 const root=<T>(work:(scope:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const record=(scope:Scope,actor:string,id:string,permission='READ')=>sql<{r:InputRecord}>`select organization_master.input_read(${actor},${id}::uuid,${permission}) r`.execute(scope).then(result=>{const r=result.rows[0]!.r;if(r.domain!==undefined&&r.domain!=='ORG01')throw new Error('ACCESS_DENIED');return r;});
 const snapshot=(scope:Scope,actor:string,id:string,campus:string)=>sql<{r:Snapshot}>`select organization_master.snapshot(${actor},${id}::uuid,${campus}) r`.execute(scope).then(r=>r.rows[0]!.r);
 const seal=(value:unknown,digest:string):Envelope=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  const {id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('ORGANIZATION_INPUT_V1\0'+digest));
  const bytes=Buffer.from(canonicalPlan(value));try{const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return {keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('hex')};}finally{bytes.fill(0);}
 };
 const unseal=(r:InputRecord):StageInput=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from('ORGANIZATION_INPUT_V1\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value=JSON.parse(bytes.toString()) as StageInput;check(StageSchema,value);if(planBinding(provider,'ORGANIZATION_INPUT_V1',value)!==r.digest)throw new Error();return value;}finally{bytes.fill(0);}}
  catch(error){if(error instanceof Error&&error.message==='KEY_UNAVAILABLE')throw error;throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const normalize=(raw:OrganizationCommand):OrganizationCommand=>{
  const c=structuredClone(raw);c.validFrom=localTime(c.validFrom);c.validTo=c.validTo===null?null:localTime(c.validTo);
  localTime(c.source.recordedAt);if(c.validTo!==null&&c.validTo<=c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');
  if('license' in c){c.license.validFrom=localTime(c.license.validFrom);c.license.validTo=licenseEnd(c.license.validTo,c.license.endKind);if(c.license.validTo!==null&&c.license.validTo<=c.license.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');}
  if('identifiers' in c&&new Set(c.identifiers.map(i=>i.kind)).size!==c.identifiers.length)throw new Error('CLOSED_INPUT_REQUIRED');
  return c;
 };
 const claimKeys=(claims:Array<{kind:string;namespace:string;value:string}>)=>claims.map(i=>({kind:i.kind,namespace:i.namespace,digest:planBinding(provider,'ORGANIZATION_IDENTIFIER_V1',[i.kind,i.namespace,i.value])}));
 const keys=(c:OrganizationCommand)=>claimKeys('identifiers' in c?c.identifiers:'license' in c?[{kind:'LICENSE',namespace:c.license.namespace,value:c.license.number}]:[]);
 const evidence=async(scope:Scope,actor:string,id:string,c:OrganizationCommand,campus:string,asOf:string|null=null)=>{
  const result=await sql<{r:{artifactId:string;sourceVersion:string;expiresAt:string;binding:unknown[];envelope:Envelope}}>`select organization_master.evidence(${actor},${id}::uuid,${c.source.systemId}::uuid,${c.source.versionId}::uuid,${campus},${c.validFrom}::timestamp,${c.validTo}::timestamp,${asOf}::timestamp) r`.execute(scope);
  const r=result.rows[0]!.r,bytes=authenticateRegistrationEvidence(r,provider);try{return {artifactId:r.artifactId,sourceVersion:r.sourceVersion,expiresAt:r.expiresAt,contentDigest:planBinding(provider,'ORGANIZATION_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const port:ApplyOwnerPort={
  async authorize(scope,actor,input,permission){const r=await record(scope,actor,input.jobId,permission);if(permission==='REVIEW')await record(scope,actor,input.jobId,'READ_RESTRICTED');if(r.campus!==input.campus||input.purpose!=='IDENTITY_VERIFY'||input.revisionId!==r.revision)throw new Error('ACCESS_DENIED');},
  async observe(scope,actor,input){
   // The original input identity owns planning; coordinator approval checks the same identity.
   // Rechecks by a reviewer do not create candidates and must not acquire planning authority.
   const r=await record(scope,actor,input.jobId);if(r.withdrawn||r.revision!==input.revisionId||r.currentRevision!==r.jobRevision)throw new Error('STALE_VALIDATION');
   const raw=unseal(r);if(raw.profile==='FULL'||raw.dependencies?.length)throw new Error('BLOCKED_DEPENDENCY');
   const c=normalize(raw.command);const facts=r.target?await snapshot(scope,actor,r.target,r.campus):null;
   const source=c.action==='REVOKE_LICENSE'?null:await evidence(scope,actor,'facts' in c?c.facts.registrationEvidence:'license' in c?c.license.evidence:c.evidence,c,r.campus);
   const collision=(await sql<{r:boolean}>`select organization_master.conflict(${r.target}::uuid,${JSON.stringify(keys(c))}::jsonb) r`.execute(scope)).rows[0]!.r;
   return {input,atomicRule:'ORGANIZATION_SINGLE_COMMAND_V1',basis:{contract:'ORG01-MANUAL-CORE-V1',inputDigest:r.digest,source,heads:facts,keys:keys(c),...(collision?{blockingIssues:['IDENTIFIER_CONFLICT']}:{})},commands:[{owner:'organization-master',row:1,intent:c.action==='CREATE'?'CREATE':'REVISE',target:'target' in c?{owner:'organization-master',...c.target}:null,aliases:[],value:{inputId:r.id,command:canonicalPlan(c),original:canonicalPlan(raw.command)}}],diff:[c]};
  },
  async validate(scope,actor,unit,stage){
   const c=JSON.parse(unit.commands[0]!.value['command']!) as OrganizationCommand;check(OrganizationCommandSchema,c);
   const r=await record(scope,actor,unit.input.jobId);const s=r.target?await snapshot(scope,actor,r.target,r.campus):null;
   if('target' in c&&(!s?.versions.length||r.target!==c.target.id||
    (c.action!=='VERIFY_REGISTRATION'&&String(s.versions.at(-1)!.number)!==c.target.version)))throw new Error('STALE_VALIDATION');
   if('licenseTarget' in c){const current=s!.licenses.filter(v=>v.license_id===c.licenseTarget.id).at(-1);if(!current||String(current.number)!==c.licenseTarget.version)throw new Error('STALE_VALIDATION');}
   if(!c.source.approvalRef)throw new Error('APPROVAL_REQUIRED');
   if(c.source.recordStatus!=='PUBLISHED')throw new Error('BLOCKED_DEPENDENCY');
   const collision=(await sql<{r:boolean}>`select organization_master.conflict(${r.target}::uuid,${JSON.stringify(keys(c))}::jsonb) r`.execute(scope)).rows[0]!.r;
   if(collision&&stage!=='FREEZE')throw new Error('IDENTIFIER_CONFLICT');
   if(c.action==='VERIFY_REGISTRATION'){
    if(new Set(c.licenseTargets.map(ref=>ref.id)).size!==1)throw new Error('LICENSE_ID_MISMATCH');
    // Verification references immutable business versions; observe() separately
    // freezes every current head, so concurrent changes still invalidate approval.
    const subject=s!.versions.find(v=>String(v.number)===c.target.version);
    if(!subject)throw new Error('STALE_VALIDATION');
    const kinds=subject.identifier_keys.map(k=>k.kind);
    if(!kinds.includes('INSTITUTION_CODE')||(c.creditCodeStatus==='HELD'&&!kinds.includes('UNIFIED_CREDIT_CODE')))throw new Error('BLOCKED_DEPENDENCY');
    const selected=c.licenseTargets.map(ref=>{const v=s!.licenses.find(l=>l.license_id===ref.id&&String(l.number)===ref.version);if(!v||v.revoked)throw new Error('STALE_VALIDATION');licenseEnd(v.valid_to,v.end_kind,true);return v;});
    if(new Set(c.licenseTargets.map(v=>`${v.id}/${v.version}`)).size!==c.licenseTargets.length)throw new Error('CLOSED_INPUT_REQUIRED');
    const span=(v:StoredPeriod)=>({from:stamp(v.valid_from),to:v.valid_to&&stamp(v.valid_to)});
    const subjectSpans=subtract(span(subject),s!.versions.filter(v=>v.number>subject.number).map(span));
    const licenseSpans=selected.flatMap(l=>subtract(span(l),s!.licenses.filter(v=>v.license_id===l.license_id&&v.number>l.number).map(span)));
    if(!covered(subjectSpans,c.validFrom,c.validTo)||!covered(licenseSpans,c.validFrom,c.validTo))throw new Error('LICENSE_PERIOD_NOT_COVERED');
    for(const l of selected){const original=unseal(await record(scope,actor,l.input_id)).command;await evidence(scope,actor,l.evidence,original,r.campus,stamp(l.recorded_at));}
    const original=unseal(await record(scope,actor,subject.input_id)).command;
    await evidence(scope,actor,subject.registration_evidence,original,r.campus,stamp(subject.recorded_at));
   }
  },
  async apply(scope,actor,command){const c=JSON.parse(command.value['command']!) as OrganizationCommand;const result=await sql<{r:OwnerFact}>`select organization_master.write(${actor},${command.value['inputId']}::uuid,${JSON.stringify(c)}::jsonb,${JSON.stringify(keys(c))}::jsonb) r`.execute(scope);return {ok:true,fact:result.rows[0]!.r};},
  async exactRead(scope,actor,input,fact){
   const r=await record(scope,actor,input.jobId);const command=unseal(r).command;
   const subject=fact.owner==='organization-master'?fact.id:'target' in command?command.target.id:null;if(!subject)return null;
   const s=await snapshot(scope,actor,subject,r.campus);
   const found=fact.owner==='organization-master'?s.versions.some(v=>String(v.number)===fact.version):fact.owner==='organization-master/license'?s.licenses.some(v=>v.license_id===fact.id&&String(v.number)===fact.version):s.verifications.some(v=>v.id===fact.id&&fact.version==='1');return found?fact:null;
  }
 };
 const stageInTransaction=async(scope:Scope,actor:string,input:StageInput)=>{check(StageSchema,input);input=structuredClone(input);normalize(input.command);
   const digest=planBinding(provider,'ORGANIZATION_INPUT_V1',input);
   return (await sql<{r:{inputId:string;revisionId:string}}>`select organization_master.stage(${actor},${JSON.stringify({requestId:input.requestId,jobId:input.jobId,revisionId:input.revisionId,campus:input.campus,target:'target' in input.command?input.command.target.id:null})}::jsonb,${digest},${JSON.stringify(seal(input,digest))}::jsonb) r`.execute(scope)).rows[0]!.r;
 };
 const coordinator=applyCoordinator(db,provider,port);
 const service={commandsInTransaction:(scope:Scope)=>({stage:(actor:string,input:StageInput)=>stageInTransaction(scope,actor,input),port}),registration:createRegistrationReader(root),
  async inspectClaimsInTransaction(scope:Scope,actor:string,input:{subjectId:string|null;campus:'NORTH'|'SOUTH';claims:Array<{kind:'UNIFIED_CREDIT_CODE'|'INSTITUTION_CODE'|'LICENSE';namespace:string;value:string}>}){
   await sql`select organization_master.authorize(${actor},${input.subjectId}::uuid,${input.campus},'READ')`.execute(scope);const claims=claimKeys(input.claims);
   if((await sql<{r:boolean}>`select organization_master.conflict(${input.subjectId}::uuid,${JSON.stringify(claims)}::jsonb) r`.execute(scope)).rows[0]!.r)throw new Error('IDENTIFIER_CONFLICT');return claims;
  },
  readApplyCandidate:coordinator.readApplyCandidate,
  approveApplyUnit:coordinator.approveApplyUnit,
  applyUnit:coordinator.applyUnit,
  resumeOutcome:coordinator.resumeOutcome,
  reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async stage(actor:string,input:StageInput){try{return await root(scope=>stageInTransaction(scope,actor,input));}catch(error){throw safe(error);}},
  async plan(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);try{const r=await root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:InputRecord}>`select organization_master.plan_input(${actor},${input.inputId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});}catch(error){throw safe(error);}},
  async withdraw(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);try{return await root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:{inputId:string;status:'WITHDRAWN'}}>`select organization_master.withdraw(${actor},${input.inputId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r;});}catch(error){throw safe(error);}},
  async read(actor:string,input:OrganizationRead):Promise<OrganizationFact[]>{check(ReadSchema,input);if(input.mode!=='LIST'&&!input.id||input.mode==='EXACT'&&!input.version)throw new Error('CLOSED_INPUT_REQUIRED');for(const t of [input.asOf,input.businessAt])if(t)localTime(t);try{return await root(async scope=>(await sql<{r:OrganizationFact[]}>`select organization_master.read(${actor},${JSON.stringify(input)}::jsonb) r`.execute(scope)).rows[0]!.r);}catch(error){throw safe(error);}},
  async qualification(actor:string,input:{id:string;validFrom:string;validTo:string|null;asOf?:string}){
   check(QualificationSchema,input);const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);if(to!==null&&to<=from)throw new Error('CLOSED_INPUT_REQUIRED');
   try{return await root(async scope=>{
    const rows=(await sql<{r:OrganizationFact[]}>`select organization_master.read(${actor},${JSON.stringify({id:input.id,mode:'HISTORY',...(input.asOf?{asOf:input.asOf}:{})})}::jsonb) r`.execute(scope)).rows[0]!.r;
    if(!rows.length)throw new Error('NOT_FOUND');
    const basis=await createRegistrationReader(root).inTransaction(scope).read(actor,{id:input.id,...(input.asOf?{asOf:input.asOf}:{})});
    const perLicense=new Map<string,Array<{from:string;to:string|null}>>();
    for(const p of basis.qualified)perLicense.set(p.licenseId,[...(perLicense.get(p.licenseId)??[]),{from:p.from,to:p.to}]);
    return {status:[...perLicense.values()].some(spans=>covered(spans,from,to))?'LICENSED_REGISTRATION' as const:'NOT_ESTABLISHED' as const,organizationId:input.id,validFrom:from,validTo:to,operatingPermission:'NOT_EVALUABLE' as const};
   });}catch(error){throw safe(error);}
  },
  async historyDetails(actor:string,id:string,asOf?:string){
   check(Id,id);const at=asOf===undefined?null:localTime(asOf);try{return await root(async scope=>{
    const s=(await sql<{r:Snapshot}>`select organization_master.qualification_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;
    if(at!==null&&!s.versions.some(v=>stamp(v.recorded_at)<=at))throw new Error('NOT_FOUND');
    return {organizationId:id,licenses:s.licenses.filter(l=>at===null||stamp(l.recorded_at)<=at).map(l=>({id:l.license_id,version:String(l.number),versionId:l.id,authority:l.authority,validFrom:stamp(l.valid_from),validTo:l.valid_to&&stamp(l.valid_to),endKind:l.end_kind,revoked:l.revoked,recordedAt:stamp(l.recorded_at)})),verifications:s.verifications.filter(v=>at===null||stamp(v.recorded_at)<=at).map(v=>({id:v.id,subjectVersionId:v.subject_version,licenseVersionIds:v.licenses,validFrom:stamp(v.valid_from),validTo:v.valid_to&&stamp(v.valid_to),recordedAt:stamp(v.recorded_at)}))};
   });}catch(error){throw safe(error);}
  },
  async readRestrictedInput(actor:string,id:string){check(Id,id);try{const r=await root(scope=>record(scope,actor,id,'READ_RESTRICTED'));return unseal(r);}catch(error){throw safe(error);}},
  async readLicenses(actor:string,input:{id:string;licenseId?:string;mode:'HISTORY'|'EFFECTIVE'|'EXACT';version?:string;businessAt?:string;asOf?:string}){
   check(LicenseReadSchema,input);if(input.mode==='EXACT'&&(!input.licenseId||!input.version))throw new Error('CLOSED_INPUT_REQUIRED');
   const now=(await sql<{value:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') value`.execute(db)).rows[0]!.value;
   const at=localTime(input.businessAt??now),asOf=localTime(input.asOf??now);
   const rows=(await service.historyDetails(actor,input.id)).licenses.filter(l=>(!input.licenseId||l.id===input.licenseId)&&l.recordedAt<=asOf);
   if(input.mode==='HISTORY')return rows;
   if(input.mode==='EXACT')return rows.filter(l=>l.version===input.version);
   const chosen=new Map<string,typeof rows[number]>();for(const l of rows)if(l.validFrom<=at&&(l.validTo===null||at<l.validTo))chosen.set(l.id,l);
   return [...chosen.values()].filter(l=>!l.revoked);
  },
  async diff(actor:string,id:string,fromVersion:string,toVersion:string){
   for(const version of [fromVersion,toVersion])check(ReadSchema,{id,mode:'EXACT',version});
   try{return await root(async scope=>{
    const s=(await sql<{r:Snapshot}>`select organization_master.qualification_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;
    const before=s.versions.find(v=>String(v.number)===fromVersion),after=s.versions.find(v=>String(v.number)===toVersion);if(!before||!after)throw new Error('NOT_FOUND');
    const publicFacts=(v:Version)=>({legalName:v.legal_name,entityNature:v.entity_nature,authority:v.authority,legalAddress:v.legal_address,validFrom:stamp(v.valid_from),validTo:v.valid_to&&stamp(v.valid_to)});
    const old=publicFacts(before),next=publicFacts(after);
    const fields=['legalName','entityNature','authority','legalAddress','validFrom','validTo'] as const;
    const changes:Array<{field:string;before:string|null;after:string|null;redacted?:boolean}>=fields.filter(f=>old[f]!==next[f]).map(field=>({field,before:old[field],after:next[field]}));
    for(const [kind,field] of [['INSTITUTION_CODE','institutionCode'],['UNIFIED_CREDIT_CODE','unifiedCreditCode']] as const){
     const fingerprint=(v:Version)=>canonicalPlan(v.identifier_keys.filter(k=>k.kind===kind).map(k=>[k.namespace,k.digest]).sort((a,b)=>canonicalPlan(a).localeCompare(canonicalPlan(b))));
     if(fingerprint(before)!==fingerprint(after))changes.push({field,before:null,after:null,redacted:true});
    }
    if(before.registration_evidence!==after.registration_evidence)changes.push({field:'registrationEvidence',before:null,after:null,redacted:true});
    return {id,fromVersion,toVersion,changes};
   });}catch(error){throw safe(error);}
  },
  async close(){await db.destroy();},
 };
 return service;
}
export type OrganizationOwner=ReturnType<typeof openOrganization>;

export {openCampus,type CampusOwner,type CampusCommand,CampusStageSchema,CampusCommandSchema,CampusReadSchema,CampusListSchema,CampusVersionSchema,CampusDiffSchema,Facts as CampusFactsSchema} from './campus/index.js';

export * from './campus/reference-contracts.js';
export type {CampusReferencePort} from './campus/reader.js';

export type {OrganizationRegistrationPort} from './registration.js';

export {openOperatingRelations,type OperatingOwner} from './operating/index.js';
export * from './operating/contracts.js';

export {openOrganizationImport} from './import/index.js';
export * from './import/contracts.js';

export {openOrganizationWorkspace} from './workspace/index.js';
export {ApplicationListSchema,BundleListSchema,type ApplicationList,type BundleList,DraftSaveSchema,DraftContentSchema,DraftActionSchema,SubmissionSchema,WorkspaceBundleSchema,ApplicationSchema,ApplicationAccessSchema,MaterialReviewSchema,PreflightSchema,ObjectContextInputSchema,ObjectContextSchema,PrepareRevisionSchema,type ObjectContextInput,type PrepareRevision,type PreflightInput,type MaterialReview,type DraftAction,type DraftSave,type DraftContent} from './workspace/index.js';
