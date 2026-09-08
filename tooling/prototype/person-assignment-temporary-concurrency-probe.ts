import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { TemporaryCheck, TemporaryFixture } from './person-assignment-temporary-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { temporarySource, temporarySourceSnapshot, temporaryRequestCounts } from './person-assignment-temporary-test-support.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

type Settled<T>={ok:true;value:T}|{ok:false;code:string;sqlState:string|null};
async function settle<T>(promise:Promise<T>):Promise<Settled<T>> {
  try{return {ok:true,value:await promise};}
  catch(error){return {ok:false,code:error instanceof Error?error.message:'UNKNOWN',
    sqlState:error&&typeof error==='object'&&'code' in error?String(error.code):null};}
}
function success<T>(result:Settled<T>):T {assert.ok(result.ok,JSON.stringify(result));return result.value;}

export async function runTemporaryConcurrency(database:Kysely<DB>,f:TemporaryFixture,check:TemporaryCheck) {
  async function gate(lock:(tx:Transaction<DB>)=>Promise<unknown>) {
    let release!:()=>void,entered!:(pid:number)=>void,failed!:(error:unknown)=>void;
    const released=new Promise<void>(resolve=>{release=resolve;});
    const ready=new Promise<number>((resolve,reject)=>{entered=resolve;failed=reject;});
    const completed=database.transaction().execute(async tx=>{
      await lock(tx);entered((await sql<{pid:number}>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);await released;
    });
    void completed.catch(failed);
    return {pid:await ready,async close(){release();await completed;}};
  }
  async function blockedBy(pid:number,count=1) {
    const start=performance.now();
    while(performance.now()-start<15000) {
      const rows=(await sql<{pid:number;wait_event:string;blockers:number[]}>`select pid,wait_event,pg_blocking_pids(pid) as blockers
        from pg_stat_activity where datname=current_database() and application_name='hdi-pv006-c04-application'
          and cardinality(pg_blocking_pids(pid))>0 order by pid`.execute(database)).rows;
      const chain=new Set([pid]);
      for(let i=0;i<rows.length;i++) for(const row of rows) if(row.blockers.some(blocker=>chain.has(blocker))) chain.add(row.pid);
      const descendants=rows.filter(row=>row.pid!==pid&&chain.has(row.pid));
      if(descendants.length>=count) return descendants;
      await delay(10);
    }
    throw new Error('C04_EXPECTED_LOCK_QUEUE_NOT_OBSERVED');
  }
  const engagementGate=(id:string)=>gate(tx=>tx.selectFrom('person_master.engagement').select('engagement_id').where('engagement_id','=',id).forUpdate().execute());
  const auditGate=()=>gate(tx=>sql`select pg_advisory_xact_lock(hashtextextended(${f.scope.governanceObjectId},47))`.execute(tx));
  async function ordered<T,U>(engagementId:string,first:()=>Promise<T>,second:()=>Promise<U>) {
    const held=await engagementGate(engagementId),a=settle(first());
    let b:Promise<Settled<U>>|undefined,waits;
    try {await blockedBy(held.pid);b=settle(second());waits=await blockedBy(held.pid,2);}
    finally {await held.close();}
    assert.ok(b);return {first:await a,second:await b,waits};
  }
  await check(['TX-04'], 'Two identical roots visibly queue and commit exactly one target, source link, outcome and success audit',async()=>{
    const {source}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source);
    const before=await temporarySourceSnapshot(database,source.assignmentId);
    const held=await gate(tx=>sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${f.scope.governanceObjectId}:${root}`},0))`.execute(tx));
    const first=settle(f.temporary(root).createSourceLinkedTemporaryAssignment(command)),second=settle(f.temporary(root).createSourceLinkedTemporaryAssignment(command));
    let waits;try {waits=await blockedBy(held.pid,2);}finally{await held.close();}
    const a=success(await first),b=success(await second);assert.deepEqual(a,b);
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
    const counts=await temporaryRequestCounts(database,root);assert.deepEqual(counts,{stable:1,version:1,segments:1,semantic:1,links:1,outcomes:1,success:1});
    return {root,waits,target:a.targetAssignmentId,counts,sourceUnchanged:before};
  });
  await check(['TX-05','OV-02'], 'Different roots and target Departments serialize the overlapping same-purpose secondment declaration',async()=>{
    const {source,engagement}=await temporarySource(f),other=await f.createDepartment('C04-RACE-OTHER');
    const a=randomUUID(),b=randomUUID();
    const result=await ordered(engagement.engagementId,()=>f.temporary(a).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),
      ()=>f.temporary(b).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source,{targetPlacement:{scope:'DEPARTMENT',
        departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:other.departmentId}})));
    success(result.first);assert.ok(!result.second.ok);assert.equal(result.second.code,'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT');
    assert.equal((await temporaryRequestCounts(database,a)).links,1);assert.equal((await temporaryRequestCounts(database,b)).links,0);
    return {a,b,...result};
  });
  await check(['TX-06','TX-07','TX-08'], 'END, TRANSFER, period and semantic changes respect both observed source-lock queue orders',async()=>{
    const observations=[];
    for(const operation of ['END','TRANSFER','PERIOD','SEMANTIC'] as const) for(const temporaryFirst of [false,true]) {
      const {source,engagement}=await temporarySource(f),root=randomUUID();
      const temp=()=>f.temporary(root).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      const change=async()=>{
        if(operation==='END') return f.closure().endAssignment(f.endCommand(source,Jun));
        if(operation==='TRANSFER') return f.transfer().transferAssignment({...f.scope,sourceAssignmentId:source.assignmentId,
          expectedSourceVersionId:source.assignmentVersionId,effectiveAt:Jun,targetPlacement:{scope:'DEPARTMENT',
            departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:f.target.departmentId},reasonCode:'ORGANIZATIONAL_TRANSFER'});
        if(operation==='PERIOD') return f.semantics().reviseClassifiedAssignmentPeriod({...f.scope,assignmentId:source.assignmentId,
          expectedCurrentVersionId:source.assignmentVersionId,businessValidFrom:Jan,businessValidTo:Jun,reasonCode:'VALIDITY_CORRECTION'});
        return f.semantics().correctAssignmentSemantics({...f.scope,assignmentId:source.assignmentId,expectedCurrentVersionId:source.assignmentVersionId,
          purposeCode:'ORGANIZATIONAL_AFFILIATION',modeCode:'STANDING_CONCURRENT',reasonCode:'MODE_CORRECTION'});
      };
      if(temporaryFirst) {
        const result=await ordered(engagement.engagementId,temp,change),child=success(result.first);success(result.second);
        const assessed=await f.temporary().assessTemporaryAssignmentDependencies({...f.scope,targetAssignmentId:child.targetAssignmentId,
          assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:await f.now()});
        assert.equal(assessed.constraintResult,'NOT_SATISFIED');assert.equal(assessed.baselineSourceEvidence.sourceAssignmentId,source.assignmentId);
        observations.push({operation,temporaryFirst,result,assessed});
      } else {
        const result=await ordered(engagement.engagementId,change,temp);success(result.first);
        assert.ok(!result.second.ok);assert.equal(result.second.code,'ASSIGNMENT_STALE_VERSION');
        assert.equal((await temporaryRequestCounts(database,root)).links,0);observations.push({operation,temporaryFirst,result});
      }
    }
    return observations;
  });
  await check(['TX-09','DW-10'], 'Both source and target publication switches yield one complete old snapshot or a bounded same-root retry',async()=>{
    const observations=[];
    for(const side of ['SOURCE','TARGET'] as const) for(const temporaryFirst of [false,true]) {
      const department=await f.createDepartment(`C04-PUB-${side}-${temporaryFirst}`);
      const placement={scope:'DEPARTMENT' as const,departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:department.departmentId};
      const {source}=await temporarySource(f,side==='SOURCE'?{placement}:{}),root=randomUUID();
      const command=f.temporaryCommand(source,side==='TARGET'?{targetPlacement:placement}:{});
      const draft=await f.reviseDepartment(department.departmentId,'ACTIVE','SYNTHETIC C04 NEW PUBLICATION',null,false);
      const selected=(result:Awaited<ReturnType<ReturnType<TemporaryFixture['temporary']>['createSourceLinkedTemporaryAssignment']>>)=>
        side==='SOURCE'?result.sourceLink.sourceWindowValidationEvidence.sourceDepartment.departmentVersionId:result.targetAdmission.acceptanceEvidence.department.departmentVersionId;
      if(temporaryFirst) {
        const held=await auditGate(),creating=settle(f.temporary(root).createSourceLinkedTemporaryAssignment(command));
        let publishing,waits;
        try {await blockedBy(held.pid);publishing=settle(f.publishDepartment(draft));waits=await blockedBy(held.pid,2);}
        finally {await held.close();}
        assert.ok(publishing);const child=success(await creating);success(await publishing);assert.equal(selected(child),department.departmentVersionId);
        observations.push({side,temporaryFirst,waits,selected:selected(child),child:child.targetAssignmentId});
      } else {
        const held=await gate(tx=>tx.selectFrom('department_master.department_version').select('department_version_id')
          .where('department_version_id','=',department.departmentVersionId).forUpdate().execute());
        const publishing=settle(f.publishDepartment(draft));let creating,waits;
        try {await blockedBy(held.pid);creating=settle(f.temporary(root).createSourceLinkedTemporaryAssignment(command));waits=await blockedBy(held.pid,2);}
        finally {await held.close();}
        success(await publishing);assert.ok(creating);const first=await creating;
        let child;
        if(!first.ok) {
          assert.equal(first.code,'DEPENDENCY_CHANGED_DURING_VALIDATION');
          assert.equal((await temporaryRequestCounts(database,root)).outcomes,0);
          child=await f.temporary(root).createSourceLinkedTemporaryAssignment(command);
        } else child=first.value;
        assert.equal(selected(child),draft.departmentVersionId);observations.push({side,temporaryFirst,waits,first,selected:selected(child),child:child.targetAssignmentId});
      }
    }
    return observations;
  });
  if(f.ownership.mode==='RETAINED') await check(['SC-06','TX-09'],'Shared-definition races are skipped on retained and require matching owned-fresh evidence',async()=>({
    database:f.ownership.identity.database,reason:'C04_RETAINED_SHARED_MUTATION_FORBIDDEN'}),'SKIPPED_BY_SCOPE');
  else await check(['SC-06','TX-09','DW-09'],'Purpose and SECONDMENT definition appends serialize in both orders only after fresh ownership validation',async()=>{
    const observations=[];
    for(const dimension of ['PURPOSE','MODE'] as const) for(const temporaryFirst of [false,true]) {
      await requireTemporaryFixtureTarget(database,'SHARED_DEFINITION_MUTATION');
      const {source}=await temporarySource(f);
      const term=await f.semantics().findAssignmentSemanticTermAsOf({...f.scope,dimension,code:dimension==='MODE'?'SECONDMENT':'ORGANIZATIONAL_AFFILIATION',recordAsOf:await f.now()});
      assert.ok(term);
      const append=async()=>{
        await requireTemporaryFixtureTarget(database,'SHARED_DEFINITION_MUTATION');
        return f.semantics().appendAssignmentSemanticTermVersion({...f.scope,termId:term.termId,expectedCurrentVersionId:term.termVersionId,
          label:'SYNTHETIC C04 DEFINITION RACE',definitionState:'ENABLED',businessValidFrom:Jan,businessValidTo:null,reasonCode:'LABEL_CORRECTION'});
      };
      let updated;
      if(temporaryFirst) {
        const held=await auditGate(),creating=settle(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)));
        let updating,waits;
        try {await blockedBy(held.pid);updating=settle(append());waits=await blockedBy(held.pid,2);}finally{await held.close();}
        assert.ok(updating);const child=success(await creating);updated=success(await updating);
        assert.equal(dimension==='MODE'?child.targetSemantics.mode.termVersionId:child.targetSemantics.purpose.termVersionId,term.termVersionId);
        observations.push({dimension,temporaryFirst,waits,child:child.targetAssignmentId,selected:term.termVersionId,newDefinition:updated.termVersionId});
      } else {
        const held=await gate(tx=>tx.selectFrom('person_master.assignment_semantic_term').select('term_id').where('term_id','=',term.termId).forUpdate().execute());
        const updating=settle(append());let creating,waits;
        try {await blockedBy(held.pid);creating=settle(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)));waits=await blockedBy(held.pid,2);}
        finally {await held.close();}
        updated=success(await updating);assert.ok(creating);const child=success(await creating);
        assert.equal(dimension==='MODE'?child.targetSemantics.mode.termVersionId:child.targetSemantics.purpose.termVersionId,updated.termVersionId);
        observations.push({dimension,temporaryFirst,waits,child:child.targetAssignmentId,selected:updated.termVersionId});
      }
      await requireTemporaryFixtureTarget(database,'SHARED_DEFINITION_MUTATION');
      await f.semantics().appendAssignmentSemanticTermVersion({...f.scope,termId:term.termId,expectedCurrentVersionId:updated.termVersionId,
        label:term.label,definitionState:term.definitionState,businessValidFrom:term.businessValidFrom,businessValidTo:term.businessValidTo,reasonCode:'LABEL_CORRECTION'});
    }
    return observations;
  });
  await check(['OV-08','TX-05','LF-12'], 'Independent Engagement progresses while another waits; simultaneous RR readers append audit after their snapshots close',async()=>{
    const first=await temporarySource(f),independent=await temporarySource(f),held=await engagementGate(first.engagement.engagementId);
    const pending=settle(f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(first.source)));
    let timer:ReturnType<typeof setTimeout>|undefined,waits,other;
    try {
      waits=await blockedBy(held.pid);
      other=await Promise.race([f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(independent.source)),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('C04_INDEPENDENT_ENGAGEMENT_BLOCKED')),15000);})]);
    }finally{clearTimeout(timer);await held.close();}
    const child=success(await pending);assert.ok(other);
    const audit=await auditGate(),query={...f.scope,targetAssignmentId:child.targetAssignmentId,assignmentVersionId:child.targetAdmissionVersionId,recordAsOf:await f.now()};
    const a=settle(f.temporary().assessTemporaryAssignmentDependencies(query)),b=settle(f.temporary().assessTemporaryAssignmentDependencies(query));let readers;
    try {readers=await blockedBy(audit.pid,2);}finally{await audit.close();}
    assert.deepEqual(success(await a),success(await b));
    return {waits,independentTarget:other.targetAssignmentId,readers,readOnlyComparisons:2};
  });
}
