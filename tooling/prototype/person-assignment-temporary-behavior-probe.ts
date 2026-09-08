import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { ASSIGNMENT_PURPOSES, type AssignmentVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { evaluateAssignmentPrimary } from '../../apps/governance-api/src/modules/person-master/assignment-semantics-policy.js';
import type { TemporaryFixture, TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { assertTemporarySuccess, temporarySource, temporarySourceSnapshot, temporaryRequestCounts } from './person-assignment-temporary-test-support.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

export async function runTemporaryBehavior(database: Kysely<DB>, f: TemporaryFixture, check: TemporaryCheck) {
  await check(['SC-03','SC-04','DW-01','MD-01','MD-02','MD-04','OV-01'], 'All three frozen purposes retain source identity and PRIMARY; target is a new finite SECONDMENT', async () => {
    const results = [];
    for (const purposeCode of ASSIGNMENT_PURPOSES) {
      const { source } = await temporarySource(f, { purposeCode });
      const before = await temporarySourceSnapshot(database, source.assignmentId), request = randomUUID();
      const result = await f.temporary(request).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      assert.equal(result.sourceLink.preservedPurposeCode, purposeCode);
      assert.equal(result.targetSemantics.purpose.code, purposeCode);
      assert.equal(result.targetSemantics.purpose.termVersionId, result.targetSemantics.evaluation.purposeTermVersionId);
      assert.deepEqual(await temporarySourceSnapshot(database, source.assignmentId), before);
      assert.notEqual(result.targetAssignmentId, source.assignmentId);
      assert.doesNotMatch(JSON.stringify(result), /sourceRecordKey|canonicalName|identifierValue|clinicalPermission|campusId|fte/iu);
      results.push({ result, before, proof: await assertTemporarySuccess(database, f, source, request, result) });
    }
    return results;
  });
  await check(['SC-03','SC-04','DW-01','SO-06','SC-05'], 'Closed inputs reject caller identity, codes, location, bypass flags and non-finite or empty periods', async () => {
    const { source } = await temporarySource(f), command = f.temporaryCommand(source);
    const before = await temporarySourceSnapshot(database, source.assignmentId);
    const injected = ['personId','engagementId','purposeCode','modeCode','sourceVersion','sourceEnd','targetId','sourceRecordKey',
      'campusId','sourceChain','transferFallback','validated','evaluationRecordAsOf','skip','override'];
    for (const key of injected) await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment({ ...command, [key]: 'FORBIDDEN' }),
      /PERSON_INPUT_INVALID|ASSIGNMENT_INPUT_INVALID/u);
    for (const targetPlacement of [ { ...command.targetPlacement, campusId: randomUUID() },
      { ...command.targetPlacement, scope: 'GROUP_NODE' }, { ...command.targetPlacement, scope: 'CAMPUS' } ])
      // Runtime contract negative, deliberately outside the compile-time closed input.
      await assert.rejects(Reflect.apply(f.temporary().createSourceLinkedTemporaryAssignment, undefined, [{ ...command, targetPlacement }]),
        /INPUT_INVALID/u);
    for (const businessValidTo of [null, undefined, '', 'Infinity', 'infinity', '9999-12-31T23:59:59', Jul,
      '2026-06-30T23:59:59', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00+08:00'])
      await assert.rejects(Reflect.apply(f.temporary().createSourceLinkedTemporaryAssignment, undefined, [{ ...command, businessValidTo }]));
    for (const method of ['createClassifiedAssignment','adoptAssignmentSemantics','correctAssignmentSemantics'] as const) {
      const ordinary = method === 'createClassifiedAssignment' ? f.classifiedCommand(source.acceptanceEvidence.engagement.engagementId)
        : { ...f.scope, assignmentId: source.assignmentId, expectedCurrentVersionId: source.assignmentVersionId,
          purposeCode: 'ORGANIZATIONAL_AFFILIATION', ...(method === 'correctAssignmentSemantics' ? { reasonCode:'MODE_CORRECTION' } : {}) };
      await assert.rejects(Reflect.apply(f.semantics()[method], undefined, [{ ...ordinary, modeCode:'SECONDMENT' }]),
        { message:'ASSIGNMENT_MODE_NOT_SUPPORTED_IN_SLICE' });
    }
    assert.deepEqual(await temporarySourceSnapshot(database, source.assignmentId), before);
    return { injectedFields: injected, periodNegatives: 10, oldModeEntrypoints: 3, sourceUnchanged: before };
  });
  await check(['SO-01','SO-02','SO-03','SO-04','MD-02'], 'Source must be exact current classified PRIMARY ADMISSION with no temporary parent', async () => {
    const observations = [];
    for (const sourceKind of ['RAW','CONCURRENT','CLOSED','STALE','CHILD','UNKNOWN'] as const) {
      const e = await f.createEngagement();
      const original = sourceKind === 'RAW' ? await f.app().createAssignment(f.command(e.engagementId))
        : (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId,
          { modeCode: sourceKind === 'CONCURRENT' ? 'STANDING_CONCURRENT' : 'PRIMARY_AFFILIATION', businessValidTo:Dec }))).coreVersion;
      let source: AssignmentVersion = original;
      if (sourceKind === 'CLOSED') source = await f.closure().endAssignment(f.endCommand(original, Dec));
      if (sourceKind === 'STALE') await f.semantics().reviseClassifiedAssignmentPeriod({ ...f.scope, assignmentId:original.assignmentId,
        expectedCurrentVersionId:original.assignmentVersionId, businessValidFrom:Jan, businessValidTo:Dec, reasonCode:'VALIDITY_CORRECTION' });
      if (sourceKind === 'CHILD') source = (await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(original))).targetAdmission;
      const input = f.temporaryCommand(source, sourceKind === 'UNKNOWN' ? { sourceAssignmentId:randomUUID() } : {}), request = randomUUID();
      const before = await temporarySourceSnapshot(database, source.assignmentId);
      const expected = sourceKind === 'RAW' || sourceKind === 'CONCURRENT' ? 'ASSIGNMENT_TEMPORARY_SOURCE_PRIMARY_REQUIRED'
        : sourceKind === 'CLOSED' ? 'ASSIGNMENT_ALREADY_CLOSED' : sourceKind === 'STALE' ? 'ASSIGNMENT_STALE_VERSION'
          : sourceKind === 'CHILD' ? 'ASSIGNMENT_TEMPORARY_SOURCE_CHAIN_NOT_SUPPORTED' : 'ASSIGNMENT_NOT_FOUND';
      await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(input), { message:expected });
      assert.deepEqual(await temporarySourceSnapshot(database, source.assignmentId), before);
      assert.deepEqual(await temporaryRequestCounts(database, request), { stable:0,version:0,segments:0,semantic:0,links:0,outcomes:1,success:0 });
      observations.push({ sourceKind, expected, request, sourceVersionId:source.assignmentVersionId });
    }
    return observations;
  });
  await check(['SO-05','SO-06','SO-07','DW-03'], 'Complete containment preserves equal endpoints and microseconds; an open source accepts only a finite covered window', async () => {
    const examples = [
      { from:Jan, to:Aug, childFrom:Jan, childTo:Aug, accepts:true },
      { from:Jan, to:Aug, childFrom:Jul, childTo:Dec, accepts:false },
      { from:Jul, to:Dec, childFrom:Jun, childTo:Aug, accepts:false },
      { from:Jan, to:null, childFrom:Jul, childTo:Aug, accepts:true },
      { from:Jan, to:'2026-08-01T00:00:00.000001', childFrom:Jul, childTo:'2026-08-01T00:00:00.000001', accepts:true },
      { from:Jan, to:'2026-08-01T00:00:00.000001', childFrom:Jul, childTo:'2026-08-01T00:00:00.000002', accepts:false },
    ];
    const observations = [];
    for (const example of examples) {
      const { source } = await temporarySource(f, { businessValidFrom:example.from, businessValidTo:example.to });
      const request = randomUUID(), command = f.temporaryCommand(source, { businessValidFrom:example.childFrom, businessValidTo:example.childTo });
      const before = await temporarySourceSnapshot(database, source.assignmentId);
      const oracle = (await sql<{ covered:boolean }>`select tsrange(${example.from}::timestamp,${example.to}::timestamp,'[)') @>
        tsrange(${example.childFrom}::timestamp,${example.childTo}::timestamp,'[)') as covered`.execute(database)).rows[0]!.covered;
      assert.equal(oracle, example.accepts);
      if (example.accepts) await f.temporary(request).createSourceLinkedTemporaryAssignment(command);
      else await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(command), { message:'ASSIGNMENT_TEMPORARY_SOURCE_PERIOD_NOT_COVERED' });
      assert.deepEqual(await temporarySourceSnapshot(database, source.assignmentId), before);
      observations.push({ ...example, oracle, request });
    }
    const department = await f.createDepartment('C04-WINDOW-SOURCE');
    const { source } = await temporarySource(f, { businessValidTo:null, placement:{ scope:'DEPARTMENT',
      departmentGovernanceObjectId:departmentScope.governanceObjectId, departmentId:department.departmentId } });
    await f.reviseDepartment(department.departmentId,'ACTIVE','SYNTHETIC C04 FINITE WINDOW',Aug);
    const result = await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    assert.equal(result.sourceLink.sourceDeclaredTo,null);
    assert.equal(result.sourceLink.sourceWindowValidationEvidence.sourceDepartment.businessValidTo,Aug);
    return { observations, openSourceFiniteCurrentDepartment:result.sourceLink };
  });
  await check(['SO-08','SO-09','DW-10'], 'Full-window primary proof handles a middle-only candidate and refuses late unclassified overlap', async () => {
    const { source, engagement } = await temporarySource(f);
    const middleFrom='2026-07-12T00:00:00', middleTo='2026-07-13T00:00:00';
    const counterexample = evaluateAssignmentPrimary({ businessValidFrom:Jul,businessValidTo:Aug,purposeCode:'ORGANIZATIONAL_AFFILIATION',modeCode:'PRIMARY_AFFILIATION' },
      [{assignmentId:randomUUID(),assignmentVersionId:randomUUID(),businessValidFrom:middleFrom,businessValidTo:middleTo,purposeCode:'ORGANIZATIONAL_AFFILIATION',modeCode:'PRIMARY_AFFILIATION'}]);
    assert.equal(counterexample.result,'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');
    // The native C02 invariant prevents this conflicting state from persisting.
    // Observe its public refusal separately from the C04 pure interval counterexample.
    await assert.rejects(f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,
      {businessValidFrom:middleFrom,businessValidTo:middleTo})), {message:'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT'});
    const unknown = await f.app().createAssignment(f.command(engagement.engagementId, { businessValidFrom:middleFrom,businessValidTo:middleTo }));
    const before=await temporarySourceSnapshot(database,source.assignmentId), request=randomUUID();
    await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),
      {message:'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE'});
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
    return {counterexample, persistedUnknownVersionId:unknown.assignmentVersionId, request, knownConflictEvidence:'PUBLIC_C02_REFUSAL_AND_PURE_C04_WINDOW_CHECK'};
  });
  await check(['DW-02','DW-04','DW-05','SC-03'], 'Both real Department scopes and full current published ACTIVE windows are required', async () => {
    const observations=[];
    for (const scenario of ['SAME','WRONG_SCOPE','MISSING','DRAFT','TARGET_INACTIVE','TARGET_GAP','SOURCE_INACTIVE','SOURCE_GAP'] as const) {
      const sourceDepartment=await f.createDepartment(`C04-SRC-${scenario}`);
      const {source}=await temporarySource(f,{placement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:sourceDepartment.departmentId}});
      const target=await f.createDepartment(`C04-DST-${scenario}`,scenario!=='DRAFT',scenario==='TARGET_GAP'?Jul:null);
      if(scenario==='TARGET_INACTIVE') await f.reviseDepartment(target.departmentId,'SUSPENDED');
      if(scenario==='SOURCE_INACTIVE') await f.reviseDepartment(sourceDepartment.departmentId,'SUSPENDED');
      if(scenario==='SOURCE_GAP') await f.reviseDepartment(sourceDepartment.departmentId,'ACTIVE','SYNTHETIC C04 SOURCE GAP',Jul);
      const command=f.temporaryCommand(source,{targetPlacement:{scope:'DEPARTMENT',
        departmentGovernanceObjectId:scenario==='WRONG_SCOPE'?f.scope.governanceObjectId:departmentScope.governanceObjectId,
        departmentId:scenario==='SAME'?sourceDepartment.departmentId:scenario==='MISSING'?randomUUID():target.departmentId}});
      const expected=scenario==='SAME'?'ASSIGNMENT_TEMPORARY_SAME_DEPARTMENT':scenario==='WRONG_SCOPE'?'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID':
        scenario==='MISSING'?'ASSIGNMENT_PLACEMENT_NOT_FOUND':scenario==='DRAFT'?'ASSIGNMENT_PLACEMENT_UNPUBLISHED':
          scenario==='TARGET_INACTIVE'?'ASSIGNMENT_PLACEMENT_NOT_ACTIVE':scenario==='TARGET_GAP'?'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED':
            scenario==='SOURCE_INACTIVE'?'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_NOT_ACTIVE':'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_PERIOD_NOT_COVERED';
      const before=await temporarySourceSnapshot(database,source.assignmentId);
      await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment(command),{message:expected});
      assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before); observations.push({scenario,expected});
    }
    return observations;
  });
  await check(['DW-06','DW-07'], 'An interior one-microsecond suspension and an unresolved prefix suspension both refuse admission', async () => {
    const observations=[];
    for(const prefix of [false,true]) {
      const {source,engagement}=await temporarySource(f);
      const at=prefix?Jun:'2026-07-15T12:00:00.000001';
      await f.lifecycle().suspendEngagement({...f.scope,engagementId:engagement.engagementId,expectedLifecycleSequence:'0',businessEffectiveAt:at,reasonCode:'SYNTHETIC_C04_SUSPEND'});
      if(!prefix) await f.lifecycle().resumeEngagement({...f.scope,engagementId:engagement.engagementId,expectedLifecycleSequence:'1',
        businessEffectiveAt:'2026-07-15T12:00:00.000002',reasonCode:'SYNTHETIC_C04_RESUME'});
      const before=await temporarySourceSnapshot(database,source.assignmentId),request=randomUUID();
      await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),
        {message:'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED'});
      const owner=await f.periodReader().getEngagementEffectivePeriodAsOf({...f.scope,engagementId:engagement.engagementId,requestedFrom:Jul,requestedTo:Aug,recordAsOf:await f.now()});
      assert.ok(owner.stateSegments.some(s=>s.businessState==='SUSPENDED'));
      if(!prefix) {
        assert.equal(owner.stateSegments[0]!.businessState,'ACTIVE'); assert.equal(owner.stateSegments.at(-1)!.businessState,'ACTIVE');
        const suspended=owner.stateSegments.find(s=>s.businessState==='SUSPENDED')!;
        assert.equal(suspended.from,at); assert.equal(suspended.to,'2026-07-15T12:00:00.000002');
      }
      assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before); observations.push({prefix,request,owner});
    }
    return observations;
  });
  await check(['DW-08'], 'Historical and planned Engagement windows use business coverage, not current-day state', async () => {
    const observations=[];
    for(const [from,to,childFrom,childTo] of [[Jan,Jun,'2026-02-01T00:00:00','2026-03-01T00:00:00'],
      ['2030-01-01T00:00:00','2030-12-01T00:00:00','2030-07-01T00:00:00','2030-08-01T00:00:00']] as const) {
      const e=await f.createEngagement(from,to);
      const source=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId,{businessValidFrom:from,businessValidTo:to}))).coreVersion;
      const child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source,{businessValidFrom:childFrom,businessValidTo:childTo}));
      assert.equal(child.targetAdmission.acceptanceEvidence.engagement.stateSegments[0]!.businessState,'ACTIVE'); observations.push(child.sourceLink);
    }
    return observations;
  });
  await check(['OV-02','OV-03','OV-04','OV-05'], 'Temporary overlap uses Engagement/Purpose across target departments, with half-open adjacency and ordinary concurrent coexistence', async () => {
    const {source,engagement}=await temporarySource(f);
    await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,{modeCode:'STANDING_CONCURRENT'}));
    const first=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const other=await f.createDepartment('C04-OVERLAP-OTHER');
    const targetPlacement={scope:'DEPARTMENT' as const,departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:other.departmentId};
    await assert.rejects(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source,{targetPlacement,
      businessValidFrom:'2026-07-12T00:00:00',businessValidTo:'2026-07-13T00:00:00'})),{message:'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT'});
    const adjacent=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source,{targetPlacement,businessValidFrom:Aug,businessValidTo:Dec}));
    const otherPurpose=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,{purposeCode:'CLINICAL_PRACTICE'}))).coreVersion;
    const differentPurpose=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(otherPurpose));
    const another=await temporarySource(f),differentEngagement=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(another.source));
    const parallelEngagement=await f.createEngagement(Jul,Aug,source.acceptanceEvidence.engagement.personId);
    const parallelSource=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(parallelEngagement.engagementId,
      {businessValidFrom:Jul,businessValidTo:Aug}))).coreVersion;
    const samePersonDifferentEngagement=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(parallelSource));
    assert.equal(first.sourceLink.temporaryTo,adjacent.sourceLink.temporaryFrom);
    assert.equal(differentPurpose.sourceLink.preservedPurposeCode,'CLINICAL_PRACTICE');
    assert.notEqual(differentEngagement.sourceLink.engagementId,first.sourceLink.engagementId);
    assert.equal(samePersonDifferentEngagement.sourceLink.personId,first.sourceLink.personId);
    assert.notEqual(samePersonDifferentEngagement.sourceLink.engagementId,first.sourceLink.engagementId);
    return {first,adjacent,differentPurpose,differentEngagement,samePersonDifferentEngagement};
  });
  await check(['MD-08','MD-09','SO-03'], 'Old child revision, adoption, correction and transfer entrypoints remain closed', async () => {
    const {source}=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    const before=await temporarySourceSnapshot(database,child.targetAssignmentId);
    const period={...f.scope,assignmentId:child.targetAssignmentId,expectedCurrentVersionId:child.targetAdmissionVersionId,businessValidFrom:Jul,businessValidTo:Dec,reasonCode:'CONTINUATION_EXTENSION' as const};
    const codes={...f.scope,assignmentId:child.targetAssignmentId,expectedCurrentVersionId:child.targetAdmissionVersionId,purposeCode:'ORGANIZATIONAL_AFFILIATION' as const,modeCode:'STANDING_CONCURRENT' as const};
    for(const action of [()=>f.app().reviseAssignment(period),()=>f.semantics().reviseClassifiedAssignmentPeriod(period),
      ()=>f.semantics().adoptAssignmentSemantics(codes),()=>f.semantics().correctAssignmentSemantics({...codes,reasonCode:'MODE_CORRECTION'}),
      ()=>f.transfer().transferAssignment({...f.scope,sourceAssignmentId:child.targetAssignmentId,expectedSourceVersionId:child.targetAdmissionVersionId,
        effectiveAt:'2026-07-15T00:00:00',targetPlacement:{...child.sourceLink.sourcePlacement},reasonCode:'ORGANIZATIONAL_TRANSFER'})])
      await assert.rejects(action(),{message:'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE'});
    assert.deepEqual(await temporarySourceSnapshot(database,child.targetAssignmentId),before);
    return {child:child.targetAssignmentId,unchanged:before,blockedEntrypoints:5};
  });
  await check(['OV-08','DW-10'], 'Candidate max+1 and lifecycle-event budgets fail explicitly before any temporary business write', async () => {
    const candidate=await temporarySource(f);
    for(let i=0;i<65;i++) await f.app().createAssignment(f.command(candidate.engagement.engagementId,{businessValidFrom:Jan,businessValidTo:Jun}));
    const request=randomUUID();
    await assert.rejects(f.temporary(request).createSourceLinkedTemporaryAssignment(f.temporaryCommand(candidate.source)),
      {message:'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT'});
    const lifecycle=await temporarySource(f);
    for(let i=0;i<65;i++) {
      const input={...f.scope,engagementId:lifecycle.engagement.engagementId,expectedLifecycleSequence:String(i),
        businessEffectiveAt:`2026-07-10T00:00:00.${String(i+1).padStart(6,'0')}`,reasonCode:'SYNTHETIC_C04_BUDGET'};
      if(i%2===0) await f.lifecycle().suspendEngagement(input); else await f.lifecycle().resumeEngagement(input);
    }
    const lifecycleRequest=randomUUID();
    await assert.rejects(f.temporary(lifecycleRequest).createSourceLinkedTemporaryAssignment(f.temporaryCommand(lifecycle.source)),
      {message:'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT'});
    for(const root of [request,lifecycleRequest]) assert.equal((await temporaryRequestCounts(database,root)).stable,0);
    return {candidateCount:65,candidateRequest:request,lifecycleEventCount:65,lifecycleRequest};
  });
}
