import type {ParameterValueOwner} from '../modules/governance-catalog/index.js';
import {localTime} from '../modules/organization-master/index.js';
import type {WardOwner,NursingUnitOwner,BusinessUnitOwner,WardNursingUpstreamPorts} from '../modules/care-organization/index.js';
export function wardNursingUpstreamPorts(wards:WardOwner,nursing:NursingUnitOwner,units:BusinessUnitOwner,sources:Pick<ParameterValueOwner,'readSourceWindowBoundariesInTransaction'>):WardNursingUpstreamPorts {
 const wardInput=(a:{ward:{id:string};campus:{id:string}},from:string,to:string|null,r:string)=>({id:a.ward.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r});
 return {
  async referenceAccess(s,actor,a){const scope=await wards.authorizeRelationReferenceInTransaction(s,actor,{id:a.ward.id,campusId:a.campus.id});if('nursing' in a)await nursing.authorizeCoverageReferenceInTransaction(s,actor,{id:a.nursing.id,campusId:a.campus.id});return scope;},
  async confirmation(s,actor,basis,expected){return nursing.readHandoverConfirmationInTransaction(s,actor,basis,expected);},
  async admitWard(s,actor,a,from,to,r){const input=wardInput(a,from,to,r);return {ward:await wards.readNursingCoverageBasisInTransaction(s,actor,input),operatingWard:await wards.evaluateRelationWindowInTransaction(s,actor,{...input,purpose:'NURSING_COVERAGE'})};},
  async wardBoundaries(s,actor,a,from,to,r){const ward=await wards.readRelationBoundariesInTransaction(s,actor,wardInput(a,from,to,r)),points=[...ward.points];for(const p of ward.managers)points.push(...await units.readRelationBoundariesInTransaction(s,actor,{id:p.id,campusId:a.campus.id,validFrom:p.from,validTo:p.to,recordAsOf:r,mode:'ADMISSION'}));return points;},
  async admit(s,actor,a,from,to,r,rule){const input=wardInput(a,from,to,r),participants=[];if(rule.kind==='SHARED_BOUNDARY')for(const id of [...rule.participants].sort())participants.push(await nursing.evaluateCoverageWindowInTransaction(s,actor,{id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r}));return {ward:await wards.readNursingCoverageBasisInTransaction(s,actor,input),nursing:await nursing.evaluateCoverageWindowInTransaction(s,actor,{id:a.nursing.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r}),participants,operatingWard:await wards.evaluateRelationWindowInTransaction(s,actor,{...input,purpose:'NURSING_COVERAGE'})};},
  async boundaries(s,actor,a,from,to,r,rule){
   const input=wardInput(a,from,to,r),ward=await wards.readRelationBoundariesInTransaction(s,actor,input),points=[...ward.points];
   for(const id of new Set([a.nursing.id,...(rule.kind==='SHARED_BOUNDARY'?rule.participants:[])])){
    const boundary=await nursing.readCoverageBoundariesInTransaction(s,actor,{id,recordAsOf:r});points.push(...boundary.points);
    for(const source of boundary.sourceIds)points.push(...(await sources.readSourceWindowBoundariesInTransaction(s,actor,{id:source,validFrom:from,validTo:to,recordAsOf:r,sourceKind:'WARD_NURSING'})).map(localTime));
   }
   for(const p of ward.managers)points.push(...await units.readRelationBoundariesInTransaction(s,actor,{id:p.id,campusId:a.campus.id,validFrom:p.from,validTo:p.to,recordAsOf:r,mode:'ADMISSION'}));return points;
  },
 };
}
