import type {openLocation,LocationUseUpstreamPorts} from '../modules/location-master/index.js';
import type {openDepartmentLifecycle} from '../modules/department-master/index.js';
import type {BusinessUnitOwner,WardOwner,NursingUnitOwner} from '../modules/care-organization/index.js';
/** Composition alone knows which target Owner supplies the full-window basis. */
export function locationUseUpstreamPorts(locations:ReturnType<typeof openLocation>,departments:ReturnType<typeof openDepartmentLifecycle>,units:BusinessUnitOwner,wards:WardOwner,nursing:NursingUnitOwner):LocationUseUpstreamPorts{
 const admitLocation:LocationUseUpstreamPorts['admitLocation']=(s,actor,a,from,to,r)=>locations.evaluateUseWindowInTransaction(s,actor,{id:a.location.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r});
 const admitTarget:LocationUseUpstreamPorts['admitTarget']=(s,actor,a,from,to,r)=>{const window={id:a.target.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r};return a.targetType==='ORG'?departments.evaluateUseWindowInTransaction(s,actor,window):a.targetType==='UNIT'?units.evaluateManagementWindowInTransaction(s,actor,window):a.targetType==='WARD'?wards.evaluateRelationWindowInTransaction(s,actor,{...window,purpose:'NURSING_COVERAGE'}):nursing.evaluateCoverageWindowInTransaction(s,actor,window);};
 return {
 admitLocation,admitTarget,
 async referenceAccess(s,actor,a){
  const scope=await locations.authorizeUseReferenceInTransaction(s,actor,{id:a.location.id,campusId:a.campus.id});
  if(a.targetType==='ORG')await departments.authorizeUseReferenceInTransaction(s,actor,{id:a.target.id});
  else if(a.targetType==='UNIT')await units.authorizeManagementReferenceInTransaction(s,actor,{id:a.target.id,campusId:a.campus.id});
  else if(a.targetType==='WARD')await wards.authorizeRelationReferenceInTransaction(s,actor,{id:a.target.id,campusId:a.campus.id});
  else await nursing.authorizeCoverageReferenceInTransaction(s,actor,{id:a.target.id,campusId:a.campus.id});return scope;
 },
 async admit(s,actor,a,from,to,r){
  return {location:await admitLocation(s,actor,a,from,to,r),upstream:await admitTarget(s,actor,a,from,to,r)};
 },
 async boundaries(s,actor,a,from,to,r){
  const window={id:a.target.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r},points=await locations.readUseBoundariesInTransaction(s,actor,{...window,id:a.location.id});
  if(a.targetType==='ORG')points.push(...await departments.readUseBoundariesInTransaction(s,actor,window));
  else if(a.targetType==='UNIT')points.push(...await units.readRelationBoundariesInTransaction(s,actor,{...window,mode:'ADMISSION'}));
  else if(a.targetType==='WARD'){const ward=await wards.readRelationBoundariesInTransaction(s,actor,window);points.push(...ward.points);for(const manager of ward.managers)points.push(...await units.readRelationBoundariesInTransaction(s,actor,{...window,id:manager.id,validFrom:manager.from,validTo:manager.to,mode:'ADMISSION'}));}
  else {const n=await nursing.readLocationUseBoundariesInTransaction(s,actor,window);points.push(...n.points);for(const department of n.departmentWindows)points.push(...await departments.readUseBoundariesInTransaction(s,actor,{id:department.id,validFrom:department.from,validTo:department.to,recordAsOf:r}));}return points;
 },
};}
