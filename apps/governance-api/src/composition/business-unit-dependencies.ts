import {departmentImpactPorts,type DepartmentImpactPorts,type ImpactReference} from '../modules/department-master/index.js';
import type {CatalogTransactionScope} from '../modules/governance-catalog/index.js';
import type {BusinessUnitOwner} from '../modules/care-organization/index.js';
export function withBusinessUnitImpacts(get:()=>BusinessUnitOwner|undefined):DepartmentImpactPorts{
 return {get businessUnitsAvailable(){return get()!==undefined;},replacement:departmentImpactPorts.replacement,
  async references(s:CatalogTransactionScope,a:string,departments:string[],campus:string){const existing=await departmentImpactPorts.references(s,a,departments,campus),units=get();return units?[...existing,...await units.readDepartmentReferencesInTransaction(s,a,departments,campus)]:existing;},
  async referenceAccess(s:CatalogTransactionScope,a:string,ref:ImpactReference,campus:string){if(ref.owner==='BUSINESS_UNIT'){const units=get();if(!units)throw new Error('BLOCKED_DEPENDENCY');await units.authorizeReferenceInTransaction(s,a,ref);}else await departmentImpactPorts.referenceAccess(s,a,ref,campus);},
 };
}
