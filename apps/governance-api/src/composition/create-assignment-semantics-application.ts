import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import { createAuditModule, type PersonAuditEventType } from '../modules/audit/index.js';
import type { AssignmentSemanticsApplication, ClassifiedAssignmentResult } from '../modules/person-master/index.js';
import { createAssignmentScope } from './create-assignment-application.js';

export function createAssignmentSemanticsApplication(database: Kysely<DB>, context: RequestContext): AssignmentSemanticsApplication {
  type Scope=Awaited<ReturnType<typeof createAssignmentScope>>;
  async function run<T>(governanceObjectId: string,read: boolean,work:(scope:Scope)=>Promise<T>):Promise<T> {
    try {
      const tx=read ? database.transaction().setIsolationLevel('repeatable read') : database.transaction();
      return await tx.execute(async transaction=>work(await createAssignmentScope(transaction,context)));
    } catch(error) {
      if (error instanceof Error && ['OBJECT_PERMISSION_FORBIDDEN','ASSIGNMENT_HUMAN_ACTOR_REQUIRED','ASSIGNMENT_GOVERNANCE_SCOPE_INVALID'].includes(error.message)) {
        await database.transaction().execute(async tx=> {
          const exists=await tx.selectFrom('platform.governance_object').select('governance_object_id')
            .where('governance_object_id','=',governanceObjectId).executeTakeFirst();
          if (exists) await createAuditModule(tx,context).append({governanceObjectId,aggregateType:'PERSON_ASSIGNMENT',aggregateId:governanceObjectId,
            eventType:'PERSON_ASSIGNMENT_ACCESS_DENIED',payload:{operation:read?'SEMANTICS_READ':'SEMANTICS_WRITE',reason:error.message},
            afterHash:null,authorityScope:'PERSON_MASTER:HOSPITAL'});
        });
      }
      throw error;
    }
  }
  async function read<T>(governanceObjectId:string,aggregateId:string,eventType:PersonAuditEventType,
    payload:Readonly<Record<string,unknown>>,work:(scope:Scope)=>Promise<T>):Promise<T> {
    const value=await run(governanceObjectId,true,work);
    // The shared Person audit stream must see fresh sequence state after the RR snapshot closes.
    await database.transaction().execute(tx=>createAuditModule(tx,context).append({governanceObjectId,aggregateType:'PERSON_ASSIGNMENT',aggregateId,
      eventType,payload,afterHash:null,authorityScope:'PERSON_MASTER:HOSPITAL'}));
    return value;
  }
  async function mutate(governanceObjectId:string,work:(scope:Scope)=>ReturnType<Scope['assignment']['createClassifiedAssignment']>):Promise<ClassifiedAssignmentResult> {
    const result=await run(governanceObjectId,false,async scope=> {
      const outcome=await work(scope);
      if (!outcome.ok) return outcome;
      if (!outcome.semantics) throw new Error('ASSIGNMENT_SEMANTICS_REQUIRED');
      return {ok:true as const,value:{coreVersion:outcome.value,semantics:outcome.semantics}};
    });
    if (!result.ok) throw new Error(result.code);
    return result.value;
  }
  return {
    adoptAssignmentSemantics:command=>mutate(command.governanceObjectId,scope=>scope.assignment.adoptAssignmentSemantics(command)),
    correctAssignmentSemantics:command=>mutate(command.governanceObjectId,scope=>scope.assignment.correctAssignmentSemantics(command)),
    reviseClassifiedAssignmentPeriod:command=>mutate(command.governanceObjectId,scope=>scope.assignment.reviseClassifiedAssignmentPeriod(command)),
    registerAssignmentSemanticTerm: command=>run(command.governanceObjectId,false,scope=>scope.definitions.registerAssignmentSemanticTerm(command)),
    appendAssignmentSemanticTermVersion: command=>run(command.governanceObjectId,false,scope=>scope.definitions.appendAssignmentSemanticTermVersion(command)),
    getAssignmentSemanticTermVersion: query=>read(query.governanceObjectId,query.termVersionId,'ASSIGNMENT_SEMANTIC_TERM_READ',
      {view:'EXACT',termVersionId:query.termVersionId},scope=>scope.definitions.getAssignmentSemanticTermVersion(query)),
    findAssignmentSemanticTermAsOf: query=>read(query.governanceObjectId,query.governanceObjectId,'ASSIGNMENT_SEMANTIC_TERM_READ',
      {view:'AS_OF',dimension:query.dimension,code:query.code,recordAsOf:query.recordAsOf},scope=>scope.definitions.findAssignmentSemanticTermAsOf(query)),
    createClassifiedAssignment:command=>mutate(command.governanceObjectId,scope=>scope.assignment.createClassifiedAssignment(command)),
    getAssignmentVersionSemantics: query=>read(query.governanceObjectId,query.assignmentId,'ASSIGNMENT_SEMANTICS_READ',
      {view:'EXACT',assignmentVersionId:query.assignmentVersionId},scope=>scope.assignment.readAssignmentSemanticsSnapshot(query)),
    getAssignmentSemanticsAsOf: query=>read(query.governanceObjectId,query.assignmentId,'ASSIGNMENT_SEMANTICS_READ',
      {view:'AS_OF',businessAt:query.businessAt,recordAsOf:query.recordAsOf},scope=>scope.assignment.getAssignmentSemanticsAsOf(query)),
    resolvePrimaryAffiliation:query=>read(query.governanceObjectId,query.engagementId,'ASSIGNMENT_PRIMARY_RESOLVED',
      {purposeCode:query.purposeCode,scopeCode:query.scopeCode,businessAt:query.businessAt,recordAsOf:query.recordAsOf},scope=>scope.assignment.resolvePrimaryAffiliation(query)),
  };
}
