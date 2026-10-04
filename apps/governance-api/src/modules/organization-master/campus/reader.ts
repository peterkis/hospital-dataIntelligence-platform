import {sql} from 'kysely';
import {canonicalPlan} from '../../governance-catalog/index.js';
import {localTime,subtract,intersect} from '../time.js';
import {CampusReadSchema,CampusListSchema,CampusVersionSchema,CampusDiffSchema,Id,type CampusCommand,type CampusFacts} from './contracts.js';
import {CampusCoverageSchema,type CampusCoverageInput,CampusPinSchema,type CampusPinInput,CampusResolveSchema,type CampusResolveInput} from './reference-contracts.js';
import {check,type Scope} from './input.js';
export interface CampusEvent {id:string;number:number;action:CampusCommand['action'];valid_from:string;valid_to:string|null;recorded_at:string;input_id:string;facts:CampusFacts|null;state:'PLANNING'|'TRIAL_RUNNING'|'RUNNING'|'SUSPENDED'|'RETIRED'|null;planned_opening_at:string|null}
export interface CampusSnapshot {id:string;scope:string;events:CampusEvent[]}
export interface LocationCampusCoverage {campusId:string;scope:string;covered:boolean;segments:Array<{versionId:string;version:string;from:string;to:string|null}>;retiredAt:string|null}
type Root=<T>(work:(scope:Scope)=>Promise<T>)=>Promise<T>;
const stamp=(s:string)=>localTime(s.replace(' ','T'));
const reference=(id:string)=>({owner:'organization-master/campus' as const,id});
const publicEvent=(e:CampusEvent)=>({version:String(e.number),versionId:e.id,action:e.action,validFrom:stamp(e.valid_from),validTo:e.valid_to&&stamp(e.valid_to),recordedAt:stamp(e.recorded_at)});
const versionReference=(id:string,e:CampusEvent)=>({...reference(id),version:String(e.number),versionId:e.id});
function unique(references:readonly {id:string}[]){if(new Set(references.map(r=>r.id)).size!==references.length)throw new Error('CAMPUS_REFERENCE_CONFLICT');}
export function campusOperationAt(events:CampusEvent[],at:string){const active=events.filter(e=>e.state!==null&&stamp(e.valid_from)<=at&&(e.valid_to===null||at<stamp(e.valid_to)));return active.find(e=>e.state==='RETIRED')??active.at(-1);}
function project(s:CampusSnapshot,businessAt:string,asOf:string){
 const known=s.events.filter(e=>stamp(e.recorded_at)<=asOf);
 const effective=(rows:CampusEvent[])=>rows.filter(e=>stamp(e.valid_from)<=businessAt&&(e.valid_to===null||businessAt<stamp(e.valid_to))).at(-1);
 const v=effective(known.filter(e=>e.facts!==null)),p=effective(known.filter(e=>['SCHEDULE_OPENING','CANCEL_OPENING'].includes(e.action))),o=campusOperationAt(known,businessAt);
 return {view:{id:s.id,head:String(known.at(-1)?.number??0),facts:v?.facts??null,operationStatus:o?.state??'NOT_ESTABLISHED' as const,plannedOpeningAt:p?.planned_opening_at?stamp(p.planned_opening_at):null,operatingPermission:'NOT_EVALUABLE' as const},version:v};
}
/** One Owner projection shared by both legacy-shaped reads and typed references. */
export function createCampusReader(root:Root,snapshot:(scope:Scope,actor:string,id:string)=>Promise<CampusSnapshot>){
 const make=(execute:Root)=>{
  const run=<T>(actor:string,work:(scope:Scope,now:string)=>Promise<T>)=>execute(async scope=>{
   // Reentrant for existing roots; also protects transaction-bound consumer calls.
   await sql`select pg_advisory_xact_lock(901002)`.execute(scope);
   // Empty reference batches are valid, but every read still needs a current actor grant.
   // Reuse the granted Owner-level list boundary; per-reference snapshot() keeps exact object checks.
   await sql`select organization_master.campus_list(${actor},null::uuid,1,null::timestamp)`.execute(scope);
   const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
   return work(scope,now);
  });
  const exactIn=async(scope:Scope,actor:string,id:string,version:string)=>{
   const s=await snapshot(scope,actor,id),e=s.events.find(e=>e.facts!==null&&String(e.number)===version);
   if(!e)throw new Error('NOT_FOUND');return {...publicEvent(e),facts:e.facts!};
  };
  return {
   async readLocationCampusCoverage(actor:string,input:{id:string;validFrom:string;validTo:string|null}){
    check(Id,input.id);const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);
    if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');
    return run(actor,async scope=>(await sql<{r:LocationCampusCoverage}>`select organization_master.location_coverage(${actor},${input.id}::uuid,${from}::timestamp,${to}::timestamp) r`.execute(scope)).rows[0]!.r);
   },
   async resolveCampusReference(actor:string,input:CampusResolveInput){
    check(CampusResolveSchema,input);input=structuredClone(input);unique(input.references);
    return run(actor,async(scope,observedAt)=>{
     const businessAt=localTime(input.businessAt??observedAt),asOf=localTime(input.asOf??observedAt),items=[];
     for(const ref of input.references){const s=await snapshot(scope,actor,ref.id),p=project(s,businessAt,asOf);if(p.view.head==='0')throw new Error('NOT_FOUND');items.push({...p.view,reference:reference(s.id),profileVersion:p.version?versionReference(s.id,p.version):null});}
     return {observedAt,businessAt,asOf,items};
    });
   },
   async pinCampusVersion(actor:string,input:CampusPinInput){
    check(CampusPinSchema,input);input=structuredClone(input);unique(input.references);
    return run(actor,async(scope,observedAt)=>{
     const asOf=localTime(input.asOf??observedAt),items=[];
     for(const ref of input.references){
      const s=await snapshot(scope,actor,ref.id);
      if(!s.events.some(e=>stamp(e.recorded_at)<=asOf))throw new Error('NOT_FOUND');
      const e=s.events.find(e=>e.facts!==null&&String(e.number)===ref.version&&e.id===ref.versionId&&stamp(e.recorded_at)<=asOf);
      if(!e)throw new Error('CAMPUS_VERSION_MISMATCH');items.push({reference:versionReference(s.id,e),validFrom:stamp(e.valid_from),validTo:e.valid_to&&stamp(e.valid_to),recordedAt:stamp(e.recorded_at),facts:e.facts!});
     }
     return {observedAt,asOf,items};
    });
   },
   async readCampusReferenceCoverage(actor:string,input:CampusCoverageInput){
    check(CampusCoverageSchema,input);input=structuredClone(input);unique(input.references);
    const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);
    if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');
    return run(actor,async(scope,observedAt)=>{
     const asOf=localTime(input.asOf??observedAt),items=[];
     const span=(e:CampusEvent)=>({from:stamp(e.valid_from),to:e.valid_to===null?null:stamp(e.valid_to)});
     for(const ref of input.references){
      const s=await snapshot(scope,actor,ref.id),known=s.events.filter(e=>stamp(e.recorded_at)<=asOf);
      if(!known.length)throw new Error('NOT_FOUND');
      const profiles=known.filter(e=>e.facts!==null);
      const segments=profiles.flatMap(e=>subtract(span(e),profiles.filter(later=>later.number>e.number).map(span)).flatMap(p=>intersect(p,{from,to})).map(p=>({...p,profileVersion:versionReference(s.id,e)}))).sort((a,b)=>a.from.localeCompare(b.from));
      const gaps=subtract({from,to},segments);
      items.push({reference:reference(s.id),coverage:gaps.length?'NOT_COVERED' as const:'COVERED' as const,segments,gaps,operatingPermission:'NOT_EVALUABLE' as const});
     }
     return {observedAt,asOf,validFrom:from,validTo:to,items};
    });
   },
   async read(actor:string,input:{id:string;businessAt?:string;asOf?:string}){
    check(CampusReadSchema,input);input=structuredClone(input);
    return run(actor,async(scope,now)=>project(await snapshot(scope,actor,input.id),localTime(input.businessAt??now),localTime(input.asOf??now)).view);
   },
   async list(actor:string,input:{after?:string;limit?:number;businessAt?:string;asOf?:string}){
    check(CampusListSchema,input);input=structuredClone(input);
    return run(actor,async(scope,now)=>{
     const at=localTime(input.businessAt??now),asOf=localTime(input.asOf??now);
     const ids=(await sql<{r:string[]}>`select organization_master.campus_list(${actor},${input.after??null}::uuid,${input.limit??100},${asOf}::timestamp) r`.execute(scope)).rows[0]!.r;
     const rows=[];for(const id of ids)rows.push(project(await snapshot(scope,actor,id),at,asOf).view);return rows;
    });
   },
   async history(actor:string,id:string,asOf?:string){check(Id,id);const selected=asOf===undefined?undefined:localTime(asOf);return run(actor,async(scope,now)=>{const raw=await snapshot(scope,actor,id),s={...raw,events:raw.events.filter(e=>stamp(e.recorded_at)<=(selected??now))};if(!s.events.length)throw new Error('NOT_FOUND');return {id:s.id,head:String(s.events.at(-1)!.number),versions:s.events.filter(e=>e.facts!==null).map(e=>({...publicEvent(e),facts:e.facts!})),plans:s.events.filter(e=>['SCHEDULE_OPENING','CANCEL_OPENING'].includes(e.action)).map(e=>({...publicEvent(e),plannedOpeningAt:e.planned_opening_at&&stamp(e.planned_opening_at)})),operations:s.events.filter(e=>e.state!==null).map(e=>({...publicEvent(e),state:e.state!}))};});},
   async exact(actor:string,input:{id:string;version:string}){check(CampusVersionSchema,input);input=structuredClone(input);return run(actor,scope=>exactIn(scope,actor,input.id,input.version));},
   async diff(actor:string,input:{id:string;fromVersion:string;toVersion:string}){
    check(CampusDiffSchema,input);input=structuredClone(input);
    return run(actor,async scope=>{
     const a=await exactIn(scope,actor,input.id,input.fromVersion),b=await exactIn(scope,actor,input.id,input.toVersion);
     const before={...a.facts,validFrom:a.validFrom,validTo:a.validTo},after={...b.facts,validFrom:b.validFrom,validTo:b.validTo};
     const render=(v:unknown)=>v===null?null:typeof v==='string'?v:canonicalPlan(v);const changes=[];
     for(const field of Object.keys(before) as Array<keyof typeof before>)if(canonicalPlan(before[field])!==canonicalPlan(after[field]))changes.push({field,before:render(before[field]),after:render(after[field])});
     return {...input,changes};
    });
   }
  };
 };
 return {...make(root),inTransaction:(scope:Scope)=>make(work=>work(scope))};
}
export type CampusReferencePort=ReturnType<typeof createCampusReader>;
