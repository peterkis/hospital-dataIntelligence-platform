import type {BusinessUnitOwner,CapabilityUpstreamPorts} from '../modules/care-organization/index.js';
import type {ParameterValueOwner} from '../modules/governance-catalog/index.js';
export function unitCapabilityUpstreamPorts(units:BusinessUnitOwner,parameters:ParameterValueOwner):CapabilityUpstreamPorts{return {
 referenceAccess:(s,a,b)=>units.authorizeManagementReferenceInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id}),
 async unitWindow(s,a,b,from,to,r){const window={id:b.unit.id,campusId:b.campus.id,validFrom:from,validTo:to,recordAsOf:r},result=await units.evaluateCandidateManagementWindowInTransaction(s,a,window)??await units.evaluateManagementWindowInTransaction(s,a,window);if('kind' in result)return result;for(const p of result.parts){if(p.binding.subject.id!==b.subject.id||b.services.some(code=>!p.binding.services.includes(code)))throw new Error('CAPABILITY_SCOPE_NOT_COVERED');}return result;},
 async boundaries(s,a,b,rule,from,to,r){const points=await units.readRelationBoundariesInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id,validFrom:from,validTo:to,recordAsOf:r,mode:'ADMISSION'});if(rule.kind==='BOOLEAN_GATE_V1')points.push(...await parameters.readWindowBoundariesInTransaction(s,a,{id:rule.parameter.valueId,versionId:rule.parameter.versionId,validFrom:from,validTo:to,recordAsOf:r}));return points;},
 parameters,
};}
