import {sql} from 'kysely';
import {localTime} from '../modules/organization-master/index.js';
import type {NursingUpstreamPorts,NursingUnitOwner,BusinessUnitOwner,WardOwner,CapabilityOwner,UnitWardOwner,WardNursingOwner} from '../modules/care-organization/index.js';
import {departmentImpactPorts,type DepartmentImpactPorts,type ImpactReference} from '../modules/department-master/index.js';

export const nursingUpstreamPorts:NursingUpstreamPorts={
 async referenceAccess(s,actor,b){
  await sql`select department_master.snapshot(${actor},${b.department.id}::uuid)`.execute(s);
  return (await sql<{r:{scope:'NORTH'|'SOUTH'}}>`select organization_master.campus_snapshot(${actor},${b.campus.id}::uuid) r`.execute(s)).rows[0]!.r;
 },
 async admit(s,actor,b){
  return (await sql<{r:unknown}>`select care_organization.nursing_admission(${actor},${JSON.stringify({department:b.department,campus:b.campus})}::jsonb,${localTime(b.validFrom)}::timestamp,${b.validTo===null?null:localTime(b.validTo)}::timestamp,${b.recordAsOf?localTime(b.recordAsOf):null}::timestamp) r`.execute(s)).rows[0]!.r;
 },
 async boundaries(s,actor,b){
  const r=localTime(b.recordAsOf!),value=(await sql<{r:{department:{versions:Array<{valid_from:string;valid_to:string|null;recorded_at:string}>};lifecycle:Array<{effective_at:string}>}}> `select department_master.lifecycle_snapshot(${actor},${b.department.id}::uuid,${r}::timestamp) r`.execute(s)).rows[0]!.r;
  return [...value.department.versions.filter(v=>localTime(v.recorded_at.replace(' ','T'))<=r).flatMap(v=>[v.valid_from,v.valid_to]),...value.lifecycle.map(v=>v.effective_at)].filter((p):p is string=>p!==null).map(p=>localTime(p.replace(' ','T')));
 },
};

export function withCareOrganizationImpacts(units:()=>BusinessUnitOwner|undefined,nursing:()=>NursingUnitOwner|undefined,wards:()=>WardOwner|undefined=()=>undefined,capabilities:()=>CapabilityOwner|undefined=()=>undefined,relations:()=>UnitWardOwner|undefined=()=>undefined,coverages:()=>WardNursingOwner|undefined=()=>undefined):DepartmentImpactPorts{
 return {get businessUnitsAvailable(){return units()!==undefined;},get nursingUnitsAvailable(){return nursing()!==undefined;},get wardsAvailable(){return wards()!==undefined;},get capabilitiesAvailable(){return capabilities()!==undefined;},get unitWardRelationsAvailable(){return relations()!==undefined;},get wardNursingCoveragesAvailable(){return coverages()!==undefined;},replacement:departmentImpactPorts.replacement,
  async references(s,a,ids,campus){return [...await departmentImpactPorts.references(s,a,ids,campus),...await units()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await nursing()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await wards()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await capabilities()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await relations()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await coverages()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[]];},
  async referenceAccess(s,a,ref:ImpactReference,campus){
   if(ref.owner==='WARD_NURSING_COVERAGE'){const o=coverages();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='UNIT_WARD_RELATION'){const o=relations();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='UNIT_CAPABILITY'){const o=capabilities();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='WARD'){const o=wards();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='NURSING_UNIT'){const o=nursing();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='BUSINESS_UNIT'){const o=units();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else await departmentImpactPorts.referenceAccess(s,a,ref,campus);
  },
 };
}
