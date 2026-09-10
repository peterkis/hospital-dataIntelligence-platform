import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { TemporaryFixture, TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { temporarySource, temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

export async function runTemporaryHistory(database: Kysely<DB>, f: TemporaryFixture, check: TemporaryCheck) {
  await check(['LF-12','EV-07'], 'Sensitive exact and historical reads audit validated temporal conditions and the exact selected version', async () => {
    const {source}=await temporarySource(f);
    const child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const reference={...f.scope,targetAssignmentId:child.targetAssignmentId};
    const closed=await f.closure().endAssignment(f.endCommand(child.targetAdmission,'2026-07-15T00:00:00'));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId),observations=[];
    for(const query of [
      {...reference,businessAt:Jul,recordAsOf:child.sourceLink.recordedFrom},
      {...reference,businessAt:Aug,recordAsOf:child.sourceLink.recordedFrom},
      {...reference,businessAt:Jul,recordAsOf:closed.recordedFrom},
    ]) {
      const requestId=randomUUID(),value=await f.temporary(requestId).getTemporaryAssignmentAsOf(query);
      const events=await database.selectFrom('audit.audit_event')
        .select(['actor_principal_id','stable_entity_id','entity_version_id','event_payload'])
        .where('request_id','=',requestId).where('action','=','PERSON_ASSIGNMENT_READ').execute();
      assert.equal(events.length,1);const event=events[0]!;
      assert.deepEqual(event.event_payload,{view:'TEMPORARY_AS_OF',businessAt:query.businessAt,recordAsOf:query.recordAsOf},
        'C04_SENSITIVE_AS_OF_QUERY_CONDITIONS_REQUIRED');
      assert.equal(event.actor_principal_id,f.actor);assert.equal(event.stable_entity_id,child.targetAssignmentId);
      assert.equal(event.entity_version_id,value.selectedVersion.assignmentVersionId,'C04_SELECTED_READ_VERSION_REQUIRED');
      observations.push(event);
    }
    const requestId=randomUUID(),exact=await f.temporary(requestId).getTemporaryAssignment(reference);
    const exactAudit=await database.selectFrom('audit.audit_event').select(['entity_version_id','event_payload'])
      .where('request_id','=',requestId).where('action','=','PERSON_ASSIGNMENT_READ').executeTakeFirstOrThrow();
    assert.equal(exactAudit.entity_version_id,exact.targetAdmissionVersionId);
    assert.deepEqual(exactAudit.event_payload,{view:'EXACT_TEMPORARY_RECEIPT'});
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    return {observations,exactAudit,childBusinessRowsUnchanged:true};
  });
  await check(['LF-01','LF-02','LF-11','LF-12','MD-04','MD-10'], 'Expiry is a read-only boundary; early END inherits SECONDMENT and full assessment uses the shorter child period', async () => {
    const {source}=await temporarySource(f),root=randomUUID();
    const result=await f.temporary(root).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const sourceBefore=await temporarySourceSnapshot(database,source.assignmentId),childBefore=await temporarySourceSnapshot(database,result.targetAssignmentId);
    const reference={...f.scope,targetAssignmentId:result.targetAssignmentId};
    await assert.rejects(f.temporary().getTemporaryAssignmentAsOf({...reference,businessAt:Jul,recordAsOf:source.recordedFrom}),
      {message:'ASSIGNMENT_NOT_KNOWN_AS_OF'});
    const beforeEnd=await f.temporary().getTemporaryAssignmentAsOf({...reference,businessAt:'2026-07-31T23:59:59.999999',recordAsOf:result.sourceLink.recordedFrom});
    const expired=await f.temporary().getTemporaryAssignmentAsOf({...reference,businessAt:Aug,recordAsOf:await f.now()});
    assert.equal(beforeEnd.declaration.isWithinDeclaredPeriod,true); assert.equal(expired.declaration.isWithinDeclaredPeriod,false);
    assert.equal(expired.declaration.endBoundaryReached,true); assert.equal(expired.declaration.explicitClosureKnownAsOf,false);
    assert.deepEqual(await temporarySourceSnapshot(database,result.targetAssignmentId),childBefore);
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),sourceBefore);
    const initialAssessment=await f.temporary().assessTemporaryAssignmentDependencies({...reference,assignmentVersionId:result.targetAdmissionVersionId,recordAsOf:await f.now()});
    assert.equal(initialAssessment.referenceComparison,'UNCHANGED'); assert.equal(initialAssessment.constraintResult,'SATISFIED');
    for(const endedAt of [Jun,Jul,'2026-08-01T00:00:00.000001']) await assert.rejects(f.closure().endAssignment(f.endCommand(result.targetAdmission,endedAt)),
      {message:endedAt===Jun||endedAt===Jul?'ASSIGNMENT_CLOSURE_PERIOD_INVALID':'ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN'});
    const endedAt='2026-07-15T00:00:00';
    const closed=await f.closure().endAssignment(f.endCommand(result.targetAdmission,endedAt));
    const inherited=await f.semantics().getAssignmentVersionSemantics({...f.scope,assignmentId:result.targetAssignmentId,assignmentVersionId:closed.assignmentVersionId});
    assert.equal(inherited.classification,'CLASSIFIED');
    if(inherited.classification!=='CLASSIFIED') throw new Error('C04_EXPECTED_CLASSIFIED');
    assert.equal(inherited.mode.code,'SECONDMENT'); assert.equal(inherited.semanticRole,'INHERITED_FOR_CLOSURE');
    const nowClosed=await f.temporary().getTemporaryAssignmentAsOf({...reference,businessAt:endedAt,recordAsOf:closed.recordedFrom});
    assert.equal(nowClosed.declaration.explicitClosureKnownAsOf,true); assert.equal(nowClosed.declaration.isWithinDeclaredPeriod,false);
    const old=await f.temporary().getTemporaryAssignmentAsOf({...reference,businessAt:endedAt,recordAsOf:result.sourceLink.recordedFrom});
    assert.equal(old.declaration.isWithinDeclaredPeriod,true); assert.equal(old.declaration.explicitClosureKnownAsOf,false);
    const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...reference,assignmentVersionId:closed.assignmentVersionId,recordAsOf:await f.now()});
    assert.equal(assessment.constraintResult,'SATISFIED'); assert.equal(assessment.baselineSourceEvidence.targetAdmissionVersionId,result.targetAdmissionVersionId);
    for(const version of [result.targetAdmissionVersionId,closed.assignmentVersionId]) await assert.rejects(f.app().assessAssignmentDependencies({
      ...f.scope,assignmentId:result.targetAssignmentId,assignmentVersionId:version,recordAsOf:await f.now()}),
      {message:'ASSIGNMENT_TEMPORARY_FULL_ASSESSMENT_REQUIRED'});
    assert.deepEqual((await f.temporary().getTemporaryAssignment(reference)).sourceLink,result.sourceLink);
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),sourceBefore);
    assert.deepEqual(await f.temporary(root).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),result);
    const equalSource=await temporarySource(f),equalChild=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(equalSource.source));
    const equalEnd=await f.closure().endAssignment(f.endCommand(equalChild.targetAdmission,Aug));
    assert.equal(equalEnd.closureEvidence.isPeriodPreservingEndConfirmation,true);
    assert.equal(equalEnd.businessValidTo,equalChild.targetAdmission.businessValidTo);
    return {result,sourceBefore,childBefore,beforeEnd,expired,initialAssessment,closed,inherited,assessment,equalEnd};
  });
  await check(['LF-04','LF-05','LF-07','TX-01','SO-04'], 'Late source shortening changes assessment without changing the child; historical coverage can remain satisfied after END', async () => {
    const observations=[];
    for(const endAt of [Jul,Dec]) {
      const {source}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source);
      const child=await f.temporary(root).createSourceLinkedTemporaryAssignment(command),before=await temporarySourceSnapshot(database,child.targetAssignmentId);
      const ended=await f.closure().endAssignment(f.endCommand(source,endAt));
      const query={...f.scope,targetAssignmentId:child.targetAssignmentId,assignmentVersionId:child.targetAdmissionVersionId};
      const old=await f.temporary().assessTemporaryAssignmentDependencies({...query,recordAsOf:child.sourceLink.recordedFrom});
      const current=await f.temporary().assessTemporaryAssignmentDependencies({...query,recordAsOf:ended.recordedFrom});
      assert.equal(old.referenceComparison,'UNCHANGED'); assert.equal(old.constraintResult,'SATISFIED');
      assert.equal(current.referenceComparison,'CHANGED'); assert.equal(current.constraintResult,endAt===Dec?'SATISFIED':'NOT_SATISFIED');
      assert.equal(current.observedSourceEvidence.sourceVersion?.assignmentVersionId,ended.assignmentVersionId);
      assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
      assert.deepEqual(await f.temporary(root).createSourceLinkedTemporaryAssignment(command),child);
      await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(ended)),{message:'ASSIGNMENT_ALREADY_CLOSED'});
      observations.push({endAt,child,ended,old,current,unchanged:before});
    }
    const {source}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const revised=await f.semantics().reviseClassifiedAssignmentPeriod({...f.scope,assignmentId:source.assignmentId,expectedCurrentVersionId:source.assignmentVersionId,
      businessValidFrom:Jan,businessValidTo:Jul,reasonCode:'VALIDITY_CORRECTION'});
    const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
      assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:revised.coreVersion.recordedFrom});
    assert.equal(assessment.constraintResult,'NOT_SATISFIED'); assert.equal(assessment.referenceComparison,'CHANGED');
    return {observations,sourceRevision:{child,revised,assessment}};
  });
  await check(['LF-06','OV-02','OV-06','OV-07','MD-09'], 'Source transfer never reparents the child or frees its declaration; explicit child END releases only its tail', async () => {
    const {source}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId),successorDepartment=await f.createDepartment('C04-SOURCE-SUCCESSOR');
    const transferred=await f.transfer().transferAssignment({...f.scope,sourceAssignmentId:source.assignmentId,expectedSourceVersionId:source.assignmentVersionId,
      effectiveAt:Jun,targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:successorDepartment.departmentId},
      reasonCode:'ORGANIZATIONAL_TRANSFER'});
    const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
      assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:transferred.transferRecordedFrom});
    assert.equal(assessment.constraintResult,'NOT_SATISFIED'); assert.equal(assessment.baselineSourceEvidence.sourceAssignmentId,source.assignmentId);
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(transferred.targetAdmission)),{message:'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT'});
    const closed=await f.closure().endAssignment(f.endCommand(child.targetAdmission,'2026-07-15T00:00:00'));
    const next=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(transferred.targetAdmission,
      {businessValidFrom:closed.businessValidTo,businessValidTo:Aug}));
    assert.notEqual(next.sourceLink.sourceAssignmentId,child.sourceLink.sourceAssignmentId);
    const reference={...f.scope,targetAssignmentId:child.targetAssignmentId,businessAt:'2026-07-20T00:00:00'};
    assert.equal((await f.temporary().getTemporaryAssignmentAsOf({...reference,recordAsOf:child.sourceLink.recordedFrom})).declaration.isWithinDeclaredPeriod,true);
    assert.equal((await f.temporary().getTemporaryAssignmentAsOf({...reference,recordAsOf:closed.recordedFrom})).declaration.isWithinDeclaredPeriod,false);
    assert.deepEqual((await f.temporary().getTemporaryAssignment({...f.scope,targetAssignmentId:child.targetAssignmentId})).sourceLink,child.sourceLink);
    return {child,transferred,assessment,closed,next};
  });
  await check(['LF-08'], 'Source purpose and mode corrections remain allowed and explicitly invalidate the frozen child dependency', async () => {
    const observations=[];
    for(const change of ['PURPOSE','MODE'] as const) {
      const {source}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      const before=await temporarySourceSnapshot(database,child.targetAssignmentId);
      const corrected=await f.semantics().correctAssignmentSemantics({...f.scope,assignmentId:source.assignmentId,expectedCurrentVersionId:source.assignmentVersionId,
        purposeCode:change==='PURPOSE'?'CLINICAL_PRACTICE':'ORGANIZATIONAL_AFFILIATION',modeCode:change==='MODE'?'STANDING_CONCURRENT':'PRIMARY_AFFILIATION',
        reasonCode:change==='PURPOSE'?'PURPOSE_CORRECTION':'MODE_CORRECTION'});
      const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
        assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:corrected.coreVersion.recordedFrom});
      assert.equal(assessment.referenceComparison,'CHANGED'); assert.equal(assessment.componentResults.sourceDeclaration,'NOT_SATISFIED');
      assert.equal(assessment.constraintResult,'NOT_SATISFIED'); assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
      observations.push({change,child,corrected,assessment});
    }
    return observations;
  });
  await check(['LF-09','LF-12'], 'Late suspension distinguishes old and new record knowledge without modifying child facts', async () => {
    const {source,engagement}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId);
    const suspended=await f.lifecycle().suspendEngagement({...f.scope,engagementId:engagement.engagementId,expectedLifecycleSequence:'0',
      businessEffectiveAt:'2026-07-10T00:00:00',reasonCode:'SYNTHETIC_C04_LATE_SUSPENSION'});
    const reference={...f.scope,targetAssignmentId:child.targetAssignmentId,assignmentVersionId:child.targetAdmissionVersionId};
    const old=await f.temporary().assessTemporaryAssignmentDependencies({...reference,recordAsOf:child.sourceLink.recordedFrom});
    const current=await f.temporary().assessTemporaryAssignmentDependencies({...reference,recordAsOf:await f.now()});
    assert.equal(old.constraintResult,'SATISFIED'); assert.equal(current.constraintResult,'REVIEW_REQUIRED');
    assert.equal(current.referenceComparison,'CHANGED');
    const declared=await f.temporary().getTemporaryAssignmentAsOf({...f.scope,targetAssignmentId:child.targetAssignmentId,businessAt:'2026-07-20T00:00:00',recordAsOf:await f.now()});
    assert.equal(declared.declaration.isWithinDeclaredPeriod,true);
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    return {child,suspended,old,current,declared};
  });
  await check(['LF-04','LF-10'], 'A new Department label and source refreshed acceptance can be CHANGED and still SATISFIED; evaluation time alone is unchanged', async () => {
    const sourceDepartment=await f.createDepartment('C04-REFRESH-SOURCE');
    const {source}=await temporarySource(f,{placement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:sourceDepartment.departmentId}});
    const child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const reference={...f.scope,targetAssignmentId:child.targetAssignmentId,assignmentVersionId:child.targetAdmissionVersionId};
    const initial=await f.temporary().assessTemporaryAssignmentDependencies({...reference,recordAsOf:await f.now()});
    assert.equal(initial.referenceComparison,'UNCHANGED');
    await f.reviseDepartment(sourceDepartment.departmentId,'ACTIVE','SYNTHETIC C04 RENAMED SOURCE');
    const labelOnly=await f.temporary().assessTemporaryAssignmentDependencies({...reference,recordAsOf:await f.now()});
    assert.equal(labelOnly.referenceComparison,'CHANGED'); assert.equal(labelOnly.constraintResult,'SATISFIED');
    const refreshed=await f.semantics().reviseClassifiedAssignmentPeriod({...f.scope,assignmentId:source.assignmentId,expectedCurrentVersionId:source.assignmentVersionId,
      businessValidFrom:Jan,businessValidTo:Dec,reasonCode:'VALIDITY_CORRECTION'});
    const current=await f.temporary().assessTemporaryAssignmentDependencies({...reference,recordAsOf:refreshed.coreVersion.recordedFrom});
    assert.equal(current.referenceComparison,'CHANGED'); assert.equal(current.constraintResult,'SATISFIED');
    assert.equal(current.baselineSourceEvidence.sourceAssignmentVersionId,source.assignmentVersionId);
    assert.equal(current.observedSourceEvidence.sourceVersion?.assignmentVersionId,refreshed.coreVersion.assignmentVersionId);
    assert.deepEqual((await f.temporary().getTemporaryAssignment({...f.scope,targetAssignmentId:child.targetAssignmentId})).sourceLink,child.sourceLink);
    return {child,initial,labelOnly,refreshed,current};
  });
  await check(['LF-12','DW-10'],'Insufficient bounded owner evidence reports NOT_COMPARABLE/UNKNOWN without modifying the child',async()=>{
    const {source,engagement}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId);
    for(let i=0;i<65;i++) {
      const command={...f.scope,engagementId:engagement.engagementId,expectedLifecycleSequence:String(i),
        businessEffectiveAt:`2026-07-10T00:00:00.${String(i+1).padStart(6,'0')}`,reasonCode:'SYNTHETIC_C04_ASSESSMENT_BUDGET'};
      if(i%2===0) await f.lifecycle().suspendEngagement(command);else await f.lifecycle().resumeEngagement(command);
    }
    const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
      assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:await f.now()});
    assert.equal(assessment.referenceComparison,'NOT_COMPARABLE');assert.equal(assessment.constraintResult,'UNKNOWN');
    assert.ok(assessment.reasons.includes('ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT'));
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    return {child:child.targetAssignmentId,eventCount:65,assessment};
  });
  await check(['LF-12','DW-10'],'An oversized complete comparison fails closed rather than returning SATISFIED with truncated evidence',async()=>{
    const engagement=await f.createEngagement();
    for(let i=0;i<63;i++) await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,
      {modeCode:'STANDING_CONCURRENT',businessValidTo:Dec}));
    const source=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,{businessValidTo:Dec}))).coreVersion;
    const child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId);
    const assessment=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
      assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:await f.now()});
    assert.equal(assessment.referenceComparison,'NOT_COMPARABLE');assert.equal(assessment.constraintResult,'UNKNOWN');
    assert.deepEqual(assessment.reasons,['ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT']);
    assert.ok(Buffer.byteLength(JSON.stringify(assessment),'utf8')<=65536);
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    return {currentCandidatesExcludingChild:64,child:child.targetAssignmentId,assessmentBytes:Buffer.byteLength(JSON.stringify(assessment),'utf8'),
      result:assessment.constraintResult,reason:assessment.reasons[0]};
  });
}
