import type {openLocation,LocationUseUpstreamPorts} from '../modules/location-master/index.js';
import {sql} from 'kysely';
import {localTime,intersect} from '../modules/organization-master/index.js';
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
  else {const n=await nursing.readCoverageBoundariesInTransaction(s,actor,window);points.push(...n.points);for(const id of n.sourceIds){const spans=(await sql<{r:Array<{from:string;to:string|null}>}>`select governance_catalog.use_source_windows(${actor},${id}::uuid,${from}::timestamp,${to}::timestamp,${r}::timestamp) r`.execute(s)).rows[0]!.r;points.push(...spans.flatMap(p=>[p.from,p.to]).filter((p):p is string=>p!==null).map(localTime));}for(const department of n.departmentWindows)for(const span of intersect(department,{from,to}))points.push(...await departments.readUseBoundariesInTransaction(s,actor,{id:department.id,validFrom:span.from,validTo:span.to,recordAsOf:r}));}return points;
 },
};}
