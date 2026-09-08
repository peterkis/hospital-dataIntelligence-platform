import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, type Driver } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import type { TemporaryFixture, TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { temporarySource, temporarySourceSnapshot, temporaryRequestCounts } from './person-assignment-temporary-test-support.js';
import { Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

const REQUIRED = ['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_WRITE','PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE',
  'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE','PERSON_MASTER_ENGAGEMENT_READ',
  'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ','DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];

export async function runTemporaryRequests(database: Kysely<DB>, f: TemporaryFixture, check: TemporaryCheck) {
  await check(['TX-01','TX-03'], 'Root replay is exact and common request authority rejects changed input/actor and all cross-entry reuse', async () => {
    const {source,engagement}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source);
    const result=await f.temporary(root).createSourceLinkedTemporaryAssignment(command),before=await temporaryRequestCounts(database,root);
    assert.deepEqual(await f.temporary(root).createSourceLinkedTemporaryAssignment(command),result);
    for(const changes of [{sourceAssignmentId:randomUUID()},{expectedSourceVersionId:randomUUID()},
      {businessValidFrom:'2026-07-02T00:00:00'},{businessValidTo:Dec},
      {targetPlacement:{...command.targetPlacement,departmentId:f.department.departmentId}}])
      await assert.rejects(f.temporary(root).createSourceLinkedTemporaryAssignment({...command,...changes}),{message:'ASSIGNMENT_OPERATION_CONFLICT'});
    const otherActor=await f.principal(REQUIRED);
    await assert.rejects(f.temporary(root,otherActor).createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_OPERATION_CONFLICT'});
    for(const action of [()=>f.app(root).createAssignment(f.command(engagement.engagementId)),
      ()=>f.semantics(root).createClassifiedAssignment(f.classifiedCommand(engagement.engagementId)),
      ()=>f.closure(root).endAssignment(f.endCommand(source,Aug)),
      ()=>f.transfer(root).transferAssignment({...f.scope,sourceAssignmentId:source.assignmentId,expectedSourceVersionId:source.assignmentVersionId,
        effectiveAt:Jul,targetPlacement:command.targetPlacement,reasonCode:'ORGANIZATIONAL_TRANSFER'})])
      await assert.rejects(action(),{message:'ASSIGNMENT_OPERATION_CONFLICT'});
    const directions=[];
    for(const operation of ['CREATE','CLASSIFIED_CREATE','END','TRANSFER'] as const) {
      const next=await temporarySource(f),request=randomUUID();
      if(operation==='CREATE') await f.app(request).createAssignment(f.command((await f.createEngagement()).engagementId));
      if(operation==='CLASSIFIED_CREATE') await f.semantics(request).createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId));
      if(operation==='END') await f.closure(request).endAssignment(f.endCommand(next.source,Dec));
      if(operation==='TRANSFER') await f.transfer(request).transferAssignment({...f.scope,sourceAssignmentId:next.source.assignmentId,
        expectedSourceVersionId:next.source.assignmentVersionId,effectiveAt:Jul,targetPlacement:command.targetPlacement,reasonCode:'ORGANIZATIONAL_TRANSFER'});
      await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(f.temporaryCommand(next.source)),{message:'ASSIGNMENT_OPERATION_CONFLICT'});
      directions.push({operation,request});
    }
    for(const prefix of ['~assignment-transfer:fake:source',`~assignment-transfer:${'a'.repeat(64)}:target`])
      await assert.rejects(f.temporary(prefix).createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN'});
    assert.deepEqual(await temporaryRequestCounts(database,root),before);
    return {root,result,counts:before,reverseDirections:directions};
  });
  await check(['TX-02'], 'A persisted refusal remains refused after publication; a new request can use the improved conditions', async () => {
    const {source}=await temporarySource(f),draft=await f.createDepartment('C04-DENIAL-REPLAY',false),root=randomUUID();
    const command=f.temporaryCommand(source,{targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:draft.departmentId}});
    const app=f.temporary(root),before=await temporarySourceSnapshot(database,source.assignmentId);
    await assert.rejects(app.createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_PLACEMENT_UNPUBLISHED'});
    await f.publishDepartment(draft);
    await assert.rejects(app.createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_PLACEMENT_UNPUBLISHED'});
    assert.deepEqual(await temporaryRequestCounts(database,root),{stable:0,version:0,segments:0,semantic:0,links:0,outcomes:1,success:0});
    const retry=await f.temporary().createSourceLinkedTemporaryAssignment(command);
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
    return {root,refusal:'ASSIGNMENT_PLACEMENT_UNPUBLISHED',retry};
  });
  await check(['TX-10','MD-01','MD-02'], 'Every target/link/semantic/outcome and success-audit fault rolls the root back and the same request may retry', async () => {
    const faults:[string,number][]=[['ASSIGNMENT_TEMPORARY_SOURCE_LINK_WRITTEN',0],['ASSIGNMENT_TEMPORARY_STABLE_WRITTEN',0],
      ['ASSIGNMENT_TEMPORARY_VERSION_WRITTEN',0],['ASSIGNMENT_TEMPORARY_SEGMENTS_WRITTEN',0],['ASSIGNMENT_TEMPORARY_SEMANTICS_WRITTEN',0],
      ['ASSIGNMENT_TEMPORARY_OUTCOME_WRITTEN',0],['ASSIGNMENT_TEMPORARY_AUDIT_WRITTEN',0],
      ['AUDIT_EVENT_WRITTEN',0],['AUDIT_EVENT_WRITTEN',1],['AUDIT_EVENT_WRITTEN',2]];
    const observations=[];
    for(const [point,hits] of faults) {
      const {source}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source),before=await temporarySourceSnapshot(database,source.assignmentId);
      try {
        configureControlledPublicationFault(point,hits);
        await assert.rejects(f.temporary(root).createSourceLinkedTemporaryAssignment(command),{message:`CONTROLLED_PUBLICATION_FAULT:${point}`});
      } finally {configureControlledPublicationFault(null);}
      const after=await temporaryRequestCounts(database,root);
      assert.deepEqual(after,{stable:0,version:0,segments:0,semantic:0,links:0,outcomes:0,success:0});
      assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id','=',root).execute()).length,0);
      assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
      const recovered=await f.temporary(root).createSourceLinkedTemporaryAssignment(command);
      assert.deepEqual(await f.temporary(root).createSourceLinkedTemporaryAssignment(command),recovered);
      observations.push({point,hits,root,rollback:after,recoveredTarget:recovered.targetAssignmentId});
    }
    return observations;
  });
  await check(['TX-11'], 'A simulated lost response after commit ACK and independent visibility replays the original target', async () => {
    const {source}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source);
    let acknowledged=false;
    class LostResponseDialect extends PostgresDialect {
      override createDriver(): Driver {
        const actual=super.createDriver();
        return {init:options=>actual.init(options),acquireConnection:options=>actual.acquireConnection(options),
          beginTransaction:(connection,settings)=>actual.beginTransaction(connection,settings),
          async commitTransaction(connection) {await actual.commitTransaction(connection);acknowledged=true;throw new Error('C04_SIMULATED_RESPONSE_LOSS_AFTER_ACK');},
          rollbackTransaction:connection=>actual.rollbackTransaction(connection),releaseConnection:(connection,options)=>actual.releaseConnection(connection,options),
          destroy:options=>actual.destroy(options)};
      }
    }
    const isolated=new Kysely<DB>({dialect:new LostResponseDialect({pool:new Pool({connectionString:process.env['DATABASE_URL'],max:1,
      application_name:'hdi-pv006-c04-response-loss'})})});
    try {await assert.rejects(createTemporaryAssignmentApplication(isolated,f.context(f.actor,root)).createSourceLinkedTemporaryAssignment(command),
      {message:'C04_SIMULATED_RESPONSE_LOSS_AFTER_ACK'});} finally {await isolated.destroy();}
    assert.equal(acknowledged,true);
    const visible=await database.selectFrom('person_master.assignment_command_outcome').select('assignment_version_id').where('request_id','=',root).executeTakeFirstOrThrow();
    const replay=await f.temporary(root).createSourceLinkedTemporaryAssignment(command);
    assert.equal(replay.targetAdmissionVersionId,visible.assignment_version_id);
    const counts=await temporaryRequestCounts(database,root); assert.equal(counts.stable,1); assert.equal(counts.success,1);
    return {root,commitAcknowledgedBeforeLoss:acknowledged,independentVisibilityAfterLoss:visible,replay,counts,isolatedPoolClosed:true};
  });
  await check(['TX-12','LF-12','EV-07'], 'Current active-human permissions are independent; creation requires neither END nor TRANSFER and revocation defeats replay', async () => {
    const {source}=await temporarySource(f),actor=await f.principal(REQUIRED),root=randomUUID(),command=f.temporaryCommand(source);
    const result=await f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command);
    for(const removed of REQUIRED) {
      const missing=await f.principal(REQUIRED.filter(permission=>permission!==removed));
      await assert.rejects(f.temporary(root,missing).createSourceLinkedTemporaryAssignment(command),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    }
    for(const [kind,status] of [['SERVICE','ACTIVE'],['PERSON','DISABLED']] as const) {
      const denied=await f.principal(REQUIRED,kind,status);
      await assert.rejects(f.temporary(root,denied).createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_HUMAN_ACTOR_REQUIRED'});
    }
    await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment({...command,governanceObjectId:departmentScope.governanceObjectId}),
      {message:'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID'});
    const reader=await f.principal(['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']);
    assert.deepEqual(await f.temporary(randomUUID(),reader).getTemporaryAssignment({...f.scope,targetAssignmentId:result.targetAssignmentId}),result);
    await assert.rejects(f.temporary(randomUUID(),reader).assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:result.targetAssignmentId,
      assignmentVersionId:result.targetAdmissionVersionId,recordAsOf:await f.now()}),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    const assessmentReader=await f.principal(REQUIRED.filter(permission=>!['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE','PERSON_MASTER_ASSIGNMENT_WRITE','PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE'].includes(permission)));
    const assessment=await f.temporary(randomUUID(),assessmentReader).assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:result.targetAssignmentId,
      assignmentVersionId:result.targetAdmissionVersionId,recordAsOf:await f.now()});
    assert.equal(assessment.constraintResult,'SATISFIED');
    await f.grant(actor,['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE'],'DENY','2');
    await assert.rejects(f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    const payloads=await database.selectFrom('audit.audit_event').select('event_payload').where('request_id','=',root).execute();
    assert.doesNotMatch(JSON.stringify(payloads),/canonicalName|birthDate|sourceRecordKey|identifierValue|postgres(?:ql)?:\/\/|password|token/iu);
    const before=await temporarySourceSnapshot(database,result.targetAssignmentId);
    try {
      configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      await assert.rejects(f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:result.targetAssignmentId,
        assignmentVersionId:result.targetAdmissionVersionId,recordAsOf:await f.now()}),{message:'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN'});
    } finally {configureControlledPublicationFault(null);}
    assert.deepEqual(await temporarySourceSnapshot(database,result.targetAssignmentId),before);
    return {required:REQUIRED,createdWithoutEndOrTransfer:true,root,actor,reader,assessmentReader,assessment,revocation:'DENY',auditPayloadsChecked:payloads.length};
  });
}
