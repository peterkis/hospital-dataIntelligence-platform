import {sql} from 'kysely';
import {localTime} from '../modules/organization-master/index.js';
import type {NursingUpstreamPorts,NursingUnitOwner,BusinessUnitOwner} from '../modules/care-organization/index.js';
import {departmentImpactPorts,type DepartmentImpactPorts,type ImpactReference} from '../modules/department-master/index.js';

export const nursingUpstreamPorts:NursingUpstreamPorts={
 async referenceAccess(s,actor,b){
  await sql`select department_master.snapshot(${actor},${b.department.id}::uuid)`.execute(s);
  return (await sql<{r:{scope:'NORTH'|'SOUTH'}}>`select organization_master.campus_snapshot(${actor},${b.campus.id}::uuid) r`.execute(s)).rows[0]!.r;
 },
 async admit(s,actor,b){
  return (await sql<{r:unknown}>`select care_organization.nursing_admission(${actor},${JSON.stringify({department:b.department,campus:b.campus})}::jsonb,${localTime(b.validFrom)}::timestamp,${b.validTo===null?null:localTime(b.validTo)}::timestamp,${b.recordAsOf?localTime(b.recordAsOf):null}::timestamp) r`.execute(s)).rows[0]!.r;
 },
};

export function withCareOrganizationImpacts(units:()=>BusinessUnitOwner|undefined,nursing:()=>NursingUnitOwner|undefined):DepartmentImpactPorts{
 return {get businessUnitsAvailable(){return units()!==undefined;},get nursingUnitsAvailable(){return nursing()!==undefined;},replacement:departmentImpactPorts.replacement,
  async references(s,a,ids,campus){return [...await departmentImpactPorts.references(s,a,ids,campus),...await units()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[],...await nursing()?.readDepartmentReferencesInTransaction(s,a,ids,campus)??[]];},
  async referenceAccess(s,a,ref:ImpactReference,campus){
   if(ref.owner==='NURSING_UNIT'){const o=nursing();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else if(ref.owner==='BUSINESS_UNIT'){const o=units();if(!o)throw new Error('BLOCKED_DEPENDENCY');await o.authorizeReferenceInTransaction(s,a,ref);}
   else await departmentImpactPorts.referenceAccess(s,a,ref,campus);
  },
 };
}
