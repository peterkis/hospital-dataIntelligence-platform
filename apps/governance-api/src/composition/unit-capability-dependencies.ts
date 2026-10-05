import type {BusinessUnitOwner,CapabilityUpstreamPorts} from '../modules/care-organization/index.js';
import type {ParameterValueOwner} from '../modules/governance-catalog/index.js';
export function unitCapabilityUpstreamPorts(units:BusinessUnitOwner,parameters:ParameterValueOwner):CapabilityUpstreamPorts{return {
 referenceAccess:(s,a,b)=>units.authorizeManagementReferenceInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id}),
 async unitWindow(s,a,b,from,to,r){const result=await units.evaluateManagementWindowInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id,validFrom:from,validTo:to,recordAsOf:r});for(const p of result.parts){if(p.binding.subject.id!==b.subject.id||b.services.some(code=>!p.binding.services.includes(code)))throw new Error('CAPABILITY_SCOPE_NOT_COVERED');}return result;},
 parameters,
};}
