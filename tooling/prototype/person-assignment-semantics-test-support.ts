import type { AssignmentSemanticsApplication, CreateClassifiedAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import type { createAssignmentFixture } from './person-assignment-fixture.js';
export type SemanticFixture = Awaited<ReturnType<typeof createAssignmentFixture>>;
export type SemanticAppFactory = (requestId?:string,actor?:string)=>AssignmentSemanticsApplication;
export type SemanticCommandFactory = (engagementId:string,changes?:Partial<CreateClassifiedAssignment>)=>CreateClassifiedAssignment;
export type SemanticCheck = (ids:string[],name:string,work:()=>Promise<unknown>)=>Promise<void>;
