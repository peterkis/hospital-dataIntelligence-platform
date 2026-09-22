import {sql} from 'kysely';
import {Type} from 'typebox';
import {CatalogTransactionScope} from '../governance-catalog/index.js';
import {check} from './campus/input.js';
import {Id,Time} from './contracts.js';
import {localTime,intersect,subtract} from './time.js';
interface Period {id:string;number:number;valid_from:string;valid_to:string|null;recorded_at:string}
interface SubjectVersion extends Period {legal_name:string}
interface LicenseVersion extends Period {license_id:string;end_kind:string;revoked:boolean}
interface Verification {id:string;subject_version:string;licenses:string[];valid_from:string;valid_to:string|null;recorded_at:string}
interface Snapshot {versions:SubjectVersion[];licenses:LicenseVersion[];verifications:Verification[]}
type Root=<T>(work:(scope:CatalogTransactionScope)=>Promise<T>)=>Promise<T>;
export const registrationStamp=(value:string)=>localTime(value.replace(' ','T'));
export const registrationSpan=(v:{valid_from:string;valid_to:string|null})=>({from:registrationStamp(v.valid_from),to:v.valid_to===null?null:registrationStamp(v.valid_to)});
/** Same qualification intersection as P1-01, exposed per accurate license version for ORG03. */
export function createRegistrationReader(root:Root){
 const make=(execute:Root)=>({async read(actor:string,input:{id:string;asOf?:string}){
  check(Type.Object({id:Id,asOf:Type.Optional(Time)},{additionalProperties:false}),input);input=structuredClone(input);
  return execute(async scope=>{
   await sql`select pg_advisory_xact_lock(901002)`.execute(scope);
   const s=(await sql<{r:Snapshot}>`select organization_master.qualification_snapshot(${actor},${input.id}::uuid) r`.execute(scope)).rows[0]!.r;
   const known=(v:{recorded_at:string})=>!input.asOf||registrationStamp(v.recorded_at)<=localTime(input.asOf);
   const versions=s.versions.filter(known),licenses=s.licenses.filter(known),verifications=s.verifications.filter(known);
   const profiles=versions.flatMap(v=>subtract(registrationSpan(v),versions.filter(x=>x.number>v.number).map(registrationSpan)).map(p=>({...p,versionId:v.id,version:String(v.number)})));
   const qualified:Array<{from:string;to:string|null;licenseId:string;licenseVersionId:string;verificationId:string}>=[];
   for(const v of verifications){
    const subject=versions.find(x=>x.id===v.subject_version),selected=v.licenses.map(id=>licenses.find(x=>x.id===id));
    if(!subject||!selected.length||selected.some(l=>!l||l.license_id!==selected[0]?.license_id))continue;
    const subjectSpans=subtract(registrationSpan(subject),versions.filter(x=>x.number>subject.number).map(registrationSpan));
    for(const l of selected){if(!l||l.revoked||l.end_kind==='UNKNOWN')continue;
     const licensed=subtract(registrationSpan(l),licenses.filter(x=>x.license_id===l.license_id&&x.number>l.number).map(registrationSpan));
     for(const p of subjectSpans.flatMap(p=>intersect(p,registrationSpan(v))).flatMap(p=>licensed.flatMap(q=>intersect(p,q))))qualified.push({...p,licenseId:l.license_id,licenseVersionId:l.id,verificationId:v.id});
    }
   }
   return {profiles,licenses:licenses.map(l=>({id:l.id,license_id:l.license_id,number:l.number,valid_from:l.valid_from,valid_to:l.valid_to,recorded_at:l.recorded_at,end_kind:l.end_kind,revoked:l.revoked})),qualified};
  });
 }});
 return {...make(root),inTransaction:(scope:CatalogTransactionScope)=>make(work=>work(scope))};
}
export type OrganizationRegistrationPort=ReturnType<typeof createRegistrationReader>;
