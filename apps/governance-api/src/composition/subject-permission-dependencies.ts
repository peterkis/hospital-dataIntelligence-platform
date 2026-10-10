import type {BusinessUnitOwner,SubjectPermissionPorts} from '../modules/care-organization/index.js';
import type {openDepartmentLifecycle} from '../modules/department-master/index.js';
import type {OperatingOwner} from '../modules/organization-master/index.js';

/** Native target boundaries only. The subject Owner retains code, license and
 * complete-window admission; this port does not select or authorize a successor. */
export function subjectPermissionUpstreamPorts(units:BusinessUnitOwner,department:ReturnType<typeof openDepartmentLifecycle>,operating:OperatingOwner):SubjectPermissionPorts {
 return {operatingWindow:operating.evaluateOperatingWindowInTransaction,
  async candidateTarget(s,actor,a,from,to,r){if(a.target.type!=='UNIT')return null;const result=await units.evaluateCandidateSubjectWindowInTransaction(s,actor,{id:a.target.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r});if(result)for(const part of result.parts)if(part.binding.subject.id!==a.subject.id||a.services.some(service=>!part.binding.services.includes(service)))throw new Error('SUBJECT_SCOPE_MISMATCH');return result;},
  async targetBoundaries(s,actor,a,context,from,to,r){
   const points=await operating.readSubjectProfileBoundariesInTransaction(s,actor,{subject:a.subject,campus:a.campus,validFrom:from,validTo:to,recordAsOf:r});
   if(a.target.type==='UNIT')points.push(...await units.readRelationBoundariesInTransaction(s,actor,{id:a.target.id,campusId:a.campus.id,validFrom:from,validTo:to,recordAsOf:r,mode:'REFERENCE'}));
   if(a.target.type==='ORG'){if(!context)throw new Error('BLOCKED_DEPENDENCY');points.push(...await department.readUseBoundariesInTransaction(s,actor,{id:a.target.id,validFrom:from,validTo:to,recordAsOf:r}));}
   return points;
  },
 };
}
