import type {BusinessUnitOwner,WardUpstreamPorts} from '../modules/care-organization/index.js';
export function wardUpstreamPorts(units:BusinessUnitOwner):WardUpstreamPorts{return {
 referenceAccess:(s,a,b)=>units.authorizeManagementReferenceInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id}),
 admit:(s,a,b)=>units.evaluateManagementWindowInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id,validFrom:b.validFrom,validTo:b.validTo,...(b.recordAsOf?{recordAsOf:b.recordAsOf}:{})}),
 boundaries:(s,a,b)=>{const r=b.recordAsOf??s.recordAsOf;if(!r)throw new Error('READ_CONTEXT_REQUIRED');return units.readRelationBoundariesInTransaction(s,a,{id:b.unit.id,campusId:b.campus.id,validFrom:b.validFrom,validTo:b.validTo,recordAsOf:r,mode:'ADMISSION'});},
};}
