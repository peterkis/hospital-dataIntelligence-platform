import {withCareCandidatePeers} from './candidate-peers.js';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Check} from 'typebox/value';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,canonicalPlan} from '../governance-catalog/index.js';
import type {StagedWindowDiagnostic} from '../governance-catalog/index.js';
import {localTime,subtract,intersect} from '../organization-master/index.js';
import type {BusinessUnitOwner} from './owner.js';
import type {NursingUnitOwner} from './nursing-owner.js';
import type {WardOwner} from './ward-owner.js';
import type {UnitWardOwner} from './unit-ward-owner.js';
import type {WardNursingOwner} from './ward-nursing-owner.js';
import type {CapabilityOwner} from './capability-owner.js';
import type {SubjectPermissionOwner} from './subject-permission-owner.js';
import type {openLocation,LocationUseOwner} from '../location-master/index.js';
import type {openDepartmentLifecycle} from '../department-master/index.js';
import type {CareLocationLifecycleOwner} from './lifecycle-owner.js';
import type {LifecyclePorts} from './lifecycle-contracts.js';
import {CareValidationSchema,CareUnitImpactSchema,type CareValidation,type CareValidationItem,type CareValidationTarget} from './validation-contracts.js';
import {withCareCandidateContext} from './candidate-context.js';
import {registerLifecycleCareInputs} from './lifecycle-care-inputs.js';
export interface CareValidationPorts extends LifecyclePorts {UNIT?:BusinessUnitOwner;NURSING?:NursingUnitOwner;WARD?:WardOwner;UNIT_WARD?:UnitWardOwner;WARD_NURSING?:WardNursingOwner;CAPABILITY?:CapabilityOwner;PERMISSION?:SubjectPermissionOwner;LOCATION?:ReturnType<typeof openLocation>;LOCATION_USE?:LocationUseOwner;lifecycle?:CareLocationLifecycleOwner;departmentLifecycle?:ReturnType<typeof openDepartmentLifecycle>}
const unavailable=['PERSONNEL_ASSIGNMENT','BED_RESOURCE','BED_SNAPSHOT','PATIENT_BUSINESS','EXTERNAL_CONSUMERS'] as const;
const datasets={UNIT:'ORG07',NURSING:'ORG09',WARD:'ORG08',UNIT_WARD:'ORG10',WARD_NURSING:'ORG11',CAPABILITY:'ORG16',PERMISSION:'ORG17',LOCATION:'ORG12',LOCATION_USE:'ORG13'} as const;
interface NativeCheck {from:string;to:string|null;status:'SATISFIED'|'NOT_SATISFIED'|'REVIEW_REQUIRED';reason?:string;basis?:unknown;acceptedBasis?:unknown;versionId?:string|null;relationId?:string|null;capabilityId?:string|null;permissionId?:string|null;service?:string;partitionId?:string|null}
interface NativeWindow {status?:'SATISFIED'|'NOT_SATISFIED'|'REVIEW_REQUIRED';coreCovered?:boolean;covered?:boolean;checks?:NativeCheck[];parts?:Array<{from:string;to:string|null}>}
const unknownReason=(reason:string)=>['BLOCKED_DEPENDENCY','NOT_FOUND','STALE_VALIDATION','STALE_HEAD','LEGAL_REVIEW_REQUIRED','SCOPE_REVIEW_REQUIRED','SHARING_REVIEW_REQUIRED','HANDOVER_NOT_CONFIRMED'].includes(reason);
const check=(input:unknown)=>{if(!Check(CareValidationSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');};
export function openCareValidation(connection:string,ports:CareValidationPorts){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=async<T>(work:(s:CatalogTransactionScope,r:string)=>Promise<T>,asOf?:string)=>{let scope:CatalogTransactionScope|undefined;try{return await db.transaction().setIsolationLevel('repeatable read').execute(async trx=>{const r=asOf?localTime(asOf):(await sql<{r:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') r`.execute(trx)).rows[0]!.r;scope=CatalogTransactionScope.from(trx).atRecordTime(r);return work(scope,r);});}finally{await scope?.completeCurrentReadAudits();}};
 const item=(t:CareValidationTarget,input:CareValidation):Omit<CareValidationItem,'status'|'reason'|'basis'>=>({owner:t.owner,id:t.id,dataset:datasets[t.owner],field:'',inputId:null,row:null,source:null,from:localTime(input.validFrom),to:input.validTo===null?null:localTime(input.validTo)});
 const recover=async<T>(s:CatalogTransactionScope,work:()=>Promise<T>)=>{await sql`savepoint care_validation_item`.execute(s);try{const result=await work();await sql`release savepoint care_validation_item`.execute(s);return result;}catch(error){await sql`rollback to savepoint care_validation_item`.execute(s);await sql`release savepoint care_validation_item`.execute(s);throw error;}};
 const targetPiece=async(s:CatalogTransactionScope,actor:string,t:CareValidationTarget,input:CareValidation,r:string):Promise<CareValidationItem[]>=>{
  const value=item(t,input),port=ports[t.owner];if(!port)return [{...value,status:'UNKNOWN',reason:'BLOCKED_DEPENDENCY',basis:'null'}];
  const window={id:t.id,validFrom:value.from,validTo:value.to,recordAsOf:r};
  let evaluated:NativeWindow,source:{inputId:string;row:number}|undefined;
  if(t.owner==='UNIT'||t.owner==='NURSING'||t.owner==='WARD'){
   const owner=(t.owner==='UNIT'?ports.UNIT!:t.owner==='NURSING'?ports.NURSING!:ports.WARD!).inTransaction(s);
   const history=await owner.history(actor,{id:t.id,recordAsOf:r});
   const current=await owner.read(actor,{id:t.id,businessAt:value.from,recordAsOf:r});
   source=(current.version??history.versions.filter(v=>v.validFrom<=value.from).at(-1))?.facts.source.recordLocatorEvidence;
   const proposed=await (t.owner==='UNIT'?ports.UNIT!:t.owner==='NURSING'?ports.NURSING!:ports.WARD!).readCandidateTargetWindowInTransaction(s,actor,{...window,campusId:t.campusId,mode:input.mode});
   if(proposed?.campusConflict||!proposed&&current.binding&&current.binding.binding.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];
   evaluated=proposed&&!proposed.campusConflict?proposed.evaluated:input.mode==='HISTORICAL'?await owner.coverage(actor,window):await owner.evaluateWindow(actor,window);
  }else if(t.owner==='LOCATION'){
   const owner=ports.LOCATION!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r});if(history.campusId!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];
   source=(await owner.read(actor,{id:t.id,businessAt:value.from,recordAsOf:r})).version?.facts.source.recordLocatorEvidence;
   evaluated=await owner.coverage(actor,window);
   if(input.mode==='CURRENT_ADMISSION'&&evaluated.covered){const basis=await ports.LOCATION!.evaluateUseWindowInTransaction(s,actor,{...window,campusId:t.campusId});evaluated={...evaluated,checks:[{from:value.from,to:value.to,status:'SATISFIED',basis}]};}
  }else if(t.owner==='LOCATION_USE'){
   const owner=ports.LOCATION_USE!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r});source=history.versions.at(-1)?.facts.source.recordLocatorEvidence;
   if(history.applicability.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];evaluated=await owner.evaluateWindow(actor,{...window,mode:input.mode});
  }else if(t.owner==='UNIT_WARD'){
   const owner=ports.UNIT_WARD!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r});source=history.versions.at(-1)?.facts.source.recordLocatorEvidence;
   if(history.applicability.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];evaluated=await owner.evaluateWindow(actor,{applicability:history.applicability,validFrom:value.from,validTo:value.to,recordAsOf:r,mode:input.mode});
  }else if(t.owner==='WARD_NURSING'){
   const owner=ports.WARD_NURSING!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r}),declaration=history.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1);source=declaration?.facts.source.recordLocatorEvidence;
   if(!declaration)return [{...value,status:'UNKNOWN',reason:'NOT_FOUND',basis:'null'}];if(history.applicability.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];evaluated=await owner.evaluateWindow(actor,{applicability:history.applicability,coverage:declaration.facts.coverageScope,validFrom:value.from,validTo:value.to,recordAsOf:r,mode:input.mode});
  }else if(t.owner==='CAPABILITY'){
   const owner=ports.CAPABILITY!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r});source=history.versions.at(-1)?.facts.source.recordLocatorEvidence;
   if(history.applicability.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];evaluated=await owner.evaluateWindow(actor,{applicability:history.applicability,validFrom:value.from,validTo:value.to,recordAsOf:r,mode:input.mode});
  }else{
   const owner=ports.PERMISSION!.inTransaction(s),history=await owner.history(actor,{id:t.id,recordAsOf:r}),declaration=history.versions.filter(v=>v.action!=='RETIRE').at(-1);source=declaration?.facts.source.recordLocatorEvidence;
   if(!declaration)return [{...value,status:'UNKNOWN',reason:'NOT_FOUND',basis:'null'}];if(history.scope.campus.id!==t.campusId)return [{...value,status:'NOT_SATISFIED',reason:'CAMPUS_REFERENCE_CONFLICT',basis:'null'}];evaluated=await ports.PERMISSION!.evaluateExactWindowInTransaction(s,actor,{id:t.id,validFrom:value.from,validTo:value.to,recordAsOf:r,mode:input.mode});
  }
  // Native scope evaluators intentionally accept any legal successor in that
  // tuple. This endpoint names an exact identity, so retain that identity's
  // native checks and require its own coverage in every service or partition.
  const exactKey=t.owner==='CAPABILITY'?'capabilityId':t.owner==='PERMISSION'?'permissionId':['UNIT_WARD','WARD_NURSING'].includes(t.owner)?'relationId':null;
  if(exactKey){
   const native=evaluated.checks??[],own=native.filter(check=>check[exactKey]===t.id||check[exactKey]===null&&check.status!=='SATISFIED'),group=t.owner==='CAPABILITY'||t.owner==='PERMISSION'?'service':t.owner==='WARD_NURSING'?'partitionId':null;
   const namedGroups=group?[...new Set(native.map(check=>check[group]).filter(part=>part!==null&&part!==undefined))]:[],groups=namedGroups.length?namedGroups:[null];
   const gaps=groups.flatMap(part=>subtract({from:value.from,to:value.to},own.filter(check=>!group||check[group]===part||check[group]===null)).map(gap=>({...gap,status:'NOT_SATISFIED' as const,reason:t.owner+'_EXACT_REFERENCE_WINDOW_GAP'})));
   evaluated={...evaluated,checks:[...own,...gaps]};
  }
  const located={...value,inputId:source?.inputId??null,row:source?.row??null,source:source?await port.sourceLocationInTransaction(s,actor,{...source,physical:true}):null};
  const checks:NativeCheck[]=evaluated.checks??evaluated.parts?.map(p=>({...p,status:'SATISFIED' as const}))??[];
  const items:CareValidationItem[]=checks.map(c=>({...located,from:c.from,to:c.to,status:c.status==='REVIEW_REQUIRED'||unknownReason(c.reason??'')?'UNKNOWN':c.status,reason:c.reason??'SATISFIED',basis:canonicalPlan({accepted:'acceptedBasis' in c?c.acceptedBasis:null,current:'basis' in c?c.basis:null})}));
  if(evaluated.coreCovered===false||evaluated.covered===false)for(const gap of subtract({from:value.from,to:value.to},checks))items.push({...located,...gap,status:'NOT_SATISFIED',reason:t.owner+'_WINDOW_NOT_COVERED',basis:'null'});
  if(evaluated.status==='NOT_SATISFIED'&&!items.some(i=>i.status!=='SATISFIED'))items.push({...located,status:'NOT_SATISFIED',reason:t.owner+'_WINDOW_NOT_COVERED',basis:'null'});
  if(!items.length)items.push({...located,status:'UNKNOWN',reason:'BLOCKED_DEPENDENCY',basis:'null'});
  return items;
 };
 const semanticError=(error:unknown)=>{const code=error instanceof Error?error.message:'';if(!/^[A-Z][A-Z0-9_]+$/.test(code)||['ACCESS_DENIED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE'].includes(code))throw error;return code;};
 const target=async(s:CatalogTransactionScope,actor:string,t:CareValidationTarget,input:CareValidation,r:string):Promise<CareValidationItem[]>=>{
  const range=item(t,input),window={id:t.id,campusId:t.campusId,validFrom:range.from,validTo:range.to,recordAsOf:r};let points:string[]=[];
  if(t.owner==='UNIT'&&ports.UNIT)points=await ports.UNIT.readRelationBoundariesInTransaction(s,actor,{...window,mode:input.mode==='HISTORICAL'?'REFERENCE':'ADMISSION'});
  if(t.owner==='NURSING'&&ports.NURSING&&input.mode==='HISTORICAL')points=await ports.NURSING.readBindingBoundariesInTransaction(s,actor,window);
  if(t.owner==='WARD'&&ports.WARD&&input.mode==='HISTORICAL')points=await ports.WARD.readBindingBoundariesInTransaction(s,actor,window);
  if(t.owner==='NURSING'&&ports.NURSING&&input.mode==='CURRENT_ADMISSION'){
   const native=await ports.NURSING.readLocationUseBoundariesInTransaction(s,actor,window);points.push(...native.points);
   if(ports.departmentLifecycle)for(const d of native.departmentWindows)points.push(...await ports.departmentLifecycle.readUseBoundariesInTransaction(s,actor,{id:d.id,validFrom:d.from,validTo:d.to,recordAsOf:r}));
  }
  if(t.owner==='WARD'&&ports.WARD&&input.mode==='CURRENT_ADMISSION'){
   const native=await ports.WARD.readRelationBoundariesInTransaction(s,actor,window);points.push(...native.points);
   if(ports.UNIT)for(const manager of native.managers)points.push(...await ports.UNIT.readRelationBoundariesInTransaction(s,actor,{id:manager.id,campusId:t.campusId,validFrom:manager.from,validTo:manager.to,recordAsOf:r,mode:'ADMISSION'}));
  }
  if(t.owner==='LOCATION'&&ports.LOCATION&&input.mode==='CURRENT_ADMISSION')points=await ports.LOCATION.readUseBoundariesInTransaction(s,actor,window);
  const starts=[range.from,...new Set(points.map(localTime).filter(p=>p>range.from&&(range.to===null||p<range.to)))].sort();
  if(starts.length===1)return targetPiece(s,actor,t,input,r);
  const result:CareValidationItem[]=[];
  for(const [index,from] of starts.entries()){const piece={...input,validFrom:from,validTo:starts[index+1]??range.to};try{result.push(...await recover(s,()=>targetPiece(s,actor,t,piece,r)));}catch(error){const reason=semanticError(error);result.push({...item(t,piece),status:unknownReason(reason)?'UNKNOWN':'NOT_SATISFIED',reason,basis:'null'});}}
  // Segmentation locates gaps; it must not relax a native whole-window invariant.
  if(result.every(i=>i.status==='SATISFIED'))result.push(...(await targetPiece(s,actor,t,input,r)).filter(i=>i.status!=='SATISFIED'));
  return result;
 };
 const validateIn=async(s:CatalogTransactionScope,actor:string,input:CareValidation,r:string)=>{
  const items:CareValidationItem[]=[],seen=new Set<string>();
  for(const t of input.targets){const key=t.owner+'/'+t.id;if(seen.has(key))throw new Error('BATCH_CONFLICT');seen.add(key);}
  const modified=new Set<string>();
  const eligible:CareValidation['members']=[];
  for(const m of input.members){const key='INPUT/'+m.owner+'/'+m.inputId;if(seen.has(key))throw new Error('BATCH_CONFLICT');seen.add(key);const owner=ports[m.owner];try{if(!owner)throw new Error('BLOCKED_DEPENDENCY');await recover(s,async()=>{const reference=await owner.lifecycleReferenceInTransaction(s,actor,m.inputId);for(const field of ['revisionId','digest','contractVersionId'] as const)if(reference[field]!==m[field])throw new Error('STALE_VALIDATION');const native={jobId:reference.inputId,revisionId:reference.revisionId,requestId:reference.inputId,campus:reference.campus,scope:'SYNTHETIC' as const,purpose:'IDENTITY_VERIFY' as const};await owner.lifecyclePort.authorize(s,actor,native,'READ');});eligible.push(m);}catch(error){const reason=semanticError(error);items.push({...item({owner:m.owner,id:m.inputId,campusId:m.inputId},input),inputId:m.inputId,field:'dependency',status:unknownReason(reason)||reason==='STALE_VALIDATION'?'UNKNOWN':'NOT_SATISFIED',reason,basis:'null'});}}
  // Pre-read every authorized exact input before evaluating proposals. Source
  // identities are permanent within their native Owner, even when command
  // windows do not overlap. Do not let member order choose a winning producer.
  const sourceFields={UNIT:'unit_id',NURSING:'nursing_unit_id',WARD:'ward_id',UNIT_WARD:'unit_ward_rel_id',WARD_NURSING:'ward_nursing_rel_id',CAPABILITY:'capability_id',PERMISSION:'subject_license_id',LOCATION:'location_id',LOCATION_USE:'object_location_rel_id'} as const,sourceKeys=new Set<string>(),targetKeys=new Set<string>();
  for(const m of eligible){
   const native:unknown=await ports[m.owner]!.inTransaction(s).readInput(actor,{inputId:m.inputId});
   if(!native||typeof native!=='object'||!('entries' in native)||!Array.isArray(native.entries))continue;
   for(const entry of native.entries){
    if(!entry||typeof entry!=='object')continue;
    const row=entry.row as Record<string,unknown>|undefined,alias=row?.[sourceFields[m.owner]],source=row?.['source_system_id'];
    // Location file aliases are local proposal keys, not globally reserved
    // native source identities. Its own parser checks their containment graph.
    if(m.owner!=='LOCATION'&&typeof alias==='string'&&typeof source==='string'){const key=canonicalPlan([m.owner,...(m.owner==='PERMISSION'?[entry.kind]:[]),source,alias]);if(sourceKeys.has(key))throw new Error('BATCH_CONFLICT');sourceKeys.add(key);}
    const target=entry.target as {id?:unknown}|undefined;if(typeof target?.id==='string'){const key=m.owner+'/'+target.id;if(targetKeys.has(key))throw new Error('BATCH_CONFLICT');targetKeys.add(key);}
   }
  }
  await withCareCandidateContext(s,actor,eligible,ports,async ordered=>withCareCandidatePeers(s,async(register,seal)=>{
   // Gather every native producer before exposing any peer. Two-phase native
   // preflight means member ordering cannot select the winning reservation.
   for(const m of ordered){const owner=ports[m.owner]!;try{await recover(s,async()=>{
    const reference=await owner.lifecycleReferenceInTransaction(s,actor,m.inputId),native={jobId:reference.inputId,revisionId:reference.revisionId,requestId:reference.inputId,campus:reference.campus,scope:'SYNTHETIC' as const,purpose:'IDENTITY_VERIFY' as const};
    const unit=await owner.lifecyclePort.observe(s,actor,native);register(m.owner,m.inputId,unit);
    if(m.owner==='LOCATION'){await owner.lifecyclePort.validate(s,actor,unit);ports.LOCATION?.lifecycleRegisterInputsInTransaction?.(s,reference,unit);}
    if(m.owner==='UNIT'||m.owner==='NURSING'||m.owner==='WARD'){await owner.lifecyclePort.validate(s,actor,unit);registerLifecycleCareInputs(s,m.owner,reference,unit.commands);}
   });}catch(error){semanticError(error);}}
   seal();
   // Explicit existing targets share the same sealed native proposal graph.
   for(const t of input.targets)try{items.push(...await recover(s,()=>target(s,actor,t,input,r)));}catch(error){const reason=semanticError(error);items.push({...item(t,input),status:unknownReason(reason)?'UNKNOWN':'NOT_SATISFIED',reason,basis:'null'});}
   for(const m of ordered){
   const value={owner:m.owner,id:m.inputId,dataset:datasets[m.owner],field:'',inputId:m.inputId,row:null,source:null,from:localTime(input.validFrom),to:input.validTo===null?null:localTime(input.validTo)};
   const owner=ports[m.owner];if(!owner){items.push({...value,status:'UNKNOWN',reason:'BLOCKED_DEPENDENCY',basis:'null'});continue;}
   try{
    const evaluated=await recover(s,async()=>{const reference=await owner.lifecycleReferenceInTransaction(s,actor,m.inputId);for(const field of ['revisionId','digest','contractVersionId'] as const)if(reference[field]!==m[field])throw new Error('STALE_VALIDATION');
     const native={jobId:reference.inputId,revisionId:reference.revisionId,requestId:reference.inputId,campus:reference.campus,scope:'SYNTHETIC' as const,purpose:'IDENTITY_VERIFY' as const};await owner.lifecyclePort.authorize(s,actor,native,'READ');
     const preview=await owner.inTransaction(s).preview(actor,{inputId:m.inputId});if(preview.issues.length){const diagnostics:StagedWindowDiagnostic[]='diagnoseStagedWindowInTransaction' in owner?await owner.diagnoseStagedWindowInTransaction(s,actor,{inputId:m.inputId,revisionId:m.revisionId,digest:m.digest,contractVersionId:m.contractVersionId,validFrom:value.from,validTo:value.to}):[];return {issues:preview.issues,diagnostics,observed:null};}
     const unit=await owner.lifecyclePort.observe(s,actor,native);await owner.lifecyclePort.validate(s,actor,unit);
     return {issues:[],diagnostics:[],observed:unit};});
    if(!evaluated.observed){for(const[index,issue]of evaluated.issues.entries()){const located={...value,row:issue.row>0?issue.row:null,source:await owner.sourceLocationInTransaction(s,actor,{inputId:m.inputId,row:issue.row>0?issue.row:null})},diagnostics=evaluated.diagnostics.filter(d=>d.issue===index);if(diagnostics.length)for(const d of diagnostics)items.push({...located,field:d.field,from:d.from,to:d.to,problemScope:'INTERVAL',status:unknownReason(d.code)?'UNKNOWN':'NOT_SATISFIED',reason:d.code,basis:'null'});else items.push({...located,field:issue.field,problemScope:issue.row>0?'ROW':'BUNDLE',status:issue.status==='BLOCKED'||unknownReason(issue.code)?'UNKNOWN':'NOT_SATISFIED',reason:issue.code,basis:'null'});}continue;}
    const observed=evaluated.observed;
    const projected=await owner.candidatePeriodsInTransaction(s,actor,m.inputId);
    const writes=observed.commands.flatMap(command=>command.value['writes']?JSON.parse(command.value['writes']) as Array<{validFrom:string;validTo:string|null;sourceRow:number}>:[]);
    for(const [index,command] of observed.commands.entries()){
     if(command.target){const key=command.target.owner+'/'+command.target.id;if(modified.has(key))throw new Error('BATCH_CONFLICT');modified.add(key);}
     const write=writes[index];if(!write)throw new Error('BLOCKED_DEPENDENCY');
     const row=write.sourceRow,located={...value,row,source:await owner.sourceLocationInTransaction(s,actor,{inputId:m.inputId,row,physical:true})},window={from:value.from,to:value.to},period={from:localTime(write.validFrom),to:write.validTo===null?null:localTime(write.validTo)},basis=canonicalPlan({diff:observed.diff,dependencies:observed.basis['dependencies']??null});
     const coverage=projected[index];if(!coverage)throw new Error('BLOCKED_DEPENDENCY');
     const active=coverage.parts.flatMap(p=>intersect(window,p));
     for(const part of active.flatMap(p=>intersect(p,period)))items.push({...located,...part,status:'SATISFIED',reason:'SATISFIED',basis});
     // A command is not evidence that its proposed object exists outside its
     // native contribution period. Existing exact targets retain their native
     // interpretation in unchanged pieces; new identities have no such basis.
     for(const gap of active.flatMap(p=>subtract(p,[period]))){
      if(command.target){const history=await owner.inTransaction(s).history(actor,{id:command.target.id,recordAsOf:r});let campusId='campusId' in history?history.campusId:'applicability' in history?history.applicability.campus.id:'scope' in history?history.scope.campus.id:null;
       if(m.owner==='UNIT'||m.owner==='NURSING'||m.owner==='WARD'){const current=await ports[m.owner]!.inTransaction(s).read(actor,{id:command.target.id,businessAt:gap.from,recordAsOf:r});campusId=current.binding?.binding.campus.id??null;}
       if(!campusId)throw new Error('BLOCKED_DEPENDENCY');items.push(...await target(s,actor,{owner:m.owner,id:command.target.id,campusId},{...input,validFrom:gap.from,validTo:gap.to},r));}
      else items.push({...located,...gap,status:'NOT_SATISFIED',reason:'CANDIDATE_WINDOW_NOT_COVERED',basis:'null'});
     }
     for(const gap of subtract(window,active))items.push({...located,...gap,status:'NOT_SATISFIED',reason:'CANDIDATE_WINDOW_NOT_COVERED',basis:'null'});
    }
    if(!observed.commands.length)items.push({...value,status:'UNKNOWN',reason:'BLOCKED_DEPENDENCY',basis:'null'});
   }catch(error){const reason=semanticError(error);if(reason==='BATCH_CONFLICT')throw error;items.push({...value,field:'dependency',status:unknownReason(reason)?'UNKNOWN':'NOT_SATISFIED',reason,basis:'null'});}
  }}));
  if(input.profile==='FULL')for(const t of input.targets.length?input.targets:input.members.map(m=>({owner:m.owner,id:m.inputId,campusId:m.inputId})))items.push({...item(t,input),field:'profile',status:'UNKNOWN',reason:'BLOCKED_DEPENDENCY',basis:'null'});
  return {mode:input.mode,profile:input.profile,recordAsOf:r,decision:items.some(i=>i.status==='UNKNOWN')?'BLOCKED' as const:items.some(i=>i.status==='NOT_SATISFIED')?'FAIL' as const:'PASS' as const,items,unavailable:unavailable.map(owner=>({owner,status:'NOT_EVALUABLE' as const})),policy:'TEST_POLICY_ONLY' as const,clinicalReadiness:'NOT_READY' as const};
 };
 return {
  async validateCareOrganizationBundle(actor:string,input:CareValidation){check(input);input=structuredClone(input);if(input.validTo!==null&&localTime(input.validTo)<=localTime(input.validFrom))throw new Error('INVALID_BUSINESS_PERIOD');if(!input.targets.length&&!input.members.length||input.mode==='HISTORICAL'&&input.members.length)throw new Error('CLOSED_INPUT_REQUIRED');return root((s,r)=>validateIn(s,actor,input,r),input.recordAsOf);},
  async assessUnitImpact(actor:string,input:{id:string;validFrom:string;validTo:string|null;recordAsOf?:string}){if(!Check(CareUnitImpactSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');if(!ports.lifecycle)throw new Error('BLOCKED_DEPENDENCY');return root((s,r)=>ports.lifecycle!.assessSpaceMoveInTransaction(s,actor,{target:{kind:'UNIT',id:input.id},validFrom:input.validFrom,validTo:input.validTo,recordAsOf:r}),input.recordAsOf);},
  async close(){await db.destroy();},
 };
}
export type CareValidationOwner=ReturnType<typeof openCareValidation>;
