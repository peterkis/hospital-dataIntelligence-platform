import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction, type Insertable, type KyselyPlugin } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { ASSIGNMENT_SEMANTIC_POLICY } from '../../apps/governance-api/src/modules/person-master/assignment-semantics-policy.js';
import { assignmentScope, departmentScope } from './person-assignment-fixture.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import type { SemanticAppFactory, SemanticCheck, SemanticCommandFactory, SemanticFixture } from './person-assignment-semantics-test-support.js';

const ROLLBACK=new Error('C02_SQL_PROBE_ROLLBACK');
export const assignmentSemanticSqlObservations:unknown[]=[];
export async function runAssignmentSemanticSqlProbe(database:Kysely<DB>, f:SemanticFixture,app:SemanticAppFactory,
  command:SemanticCommandFactory,check:SemanticCheck) {
  const e=await f.createEngagement();
  const source=await app().createClassifiedAssignment(command(e.engagementId,{modeCode:'STANDING_CONCURRENT'}));
  const sourceStable=await database.selectFrom('person_master.assignment').selectAll().where('assignment_id','=',source.coreVersion.assignmentId).executeTakeFirstOrThrow();
  const sourceVersion=await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id','=',source.coreVersion.assignmentVersionId).executeTakeFirstOrThrow();
  const sourceSegments=await database.selectFrom('person_master.assignment_validation_segment').selectAll().where('assignment_version_id','=',source.coreVersion.assignmentVersionId).execute();
  const sourceSemantic=await database.selectFrom('person_master.assignment_version_semantics').selectAll().where('assignment_version_id','=',source.coreVersion.assignmentVersionId).executeTakeFirstOrThrow();
  const primaryDefinition=await app().findAssignmentSemanticTermAsOf({...assignmentScope,dimension:'MODE',code:'PRIMARY_AFFILIATION',recordAsOf:await f.now()});
  assert.ok(primaryDefinition);
  async function clone(tx:Transaction<DB>,options:{primary?:boolean;semantic?:Partial<Insertable<DB['person_master.assignment_version_semantics']>>;
    omitSemantic?:boolean;outcomeOperation?:string}={}) {
    const request=randomUUID();
    const {assignment_id:oldId,created_at:oldCreated,...stableFields}=sourceStable; void oldId;void oldCreated;
    const stable=await tx.insertInto('person_master.assignment').values({...stableFields,creation_request_id:request}).returningAll().executeTakeFirstOrThrow();
    const {assignment_version_id:oldVersionId,business_period:oldPeriod,recorded_from:oldR,...versionFields}=sourceVersion;
    void oldVersionId;void oldPeriod;void oldR;
    const recordAsOf=(await sql<{value:string}>`select platform.local_now() as value`.execute(tx)).rows[0]!.value;
    const version=await tx.insertInto('person_master.assignment_version').values({...versionFields,assignment_id:stable.assignment_id,
      request_id:request,evaluation_record_as_of:recordAsOf,recorded_from:sql`platform.local_now()`}).returningAll().executeTakeFirstOrThrow();
    await tx.insertInto('person_master.assignment_validation_segment').values(sourceSegments.map(s=>({...s,assignment_version_id:version.assignment_version_id}))).execute();
    if (!options.omitSemantic) {
      const evaluation={...source.semantics.evaluation,evaluationRecordAsOf:recordAsOf,
        modeTermVersionId:options.primary?primaryDefinition!.termVersionId:source.semantics.mode.termVersionId,
        result:options.primary?'SATISFIED':'NOT_APPLICABLE_NON_PRIMARY',
        candidates:[{assignmentId:source.coreVersion.assignmentId,assignmentVersionId:source.coreVersion.assignmentVersionId,
          businessValidFrom:source.coreVersion.businessValidFrom,businessValidTo:source.coreVersion.businessValidTo,
          purposeCode:source.semantics.purpose.code,modeCode:source.semantics.mode.code,
          intersectionFrom:source.coreVersion.businessValidFrom,intersectionTo:source.coreVersion.businessValidTo}]};
      await tx.insertInto('person_master.assignment_version_semantics').values({...sourceSemantic,
        assignment_version_id:version.assignment_version_id,assignment_id:stable.assignment_id,request_id:request,
        semantic_recorded_from:version.recorded_from,evaluation_record_as_of:recordAsOf,
        mode_code:options.primary?'PRIMARY_AFFILIATION':'STANDING_CONCURRENT',
        mode_term_version_id:options.primary?primaryDefinition!.termVersionId:source.semantics.mode.termVersionId,
        evaluation:sql`${JSON.stringify(evaluation)}::jsonb`,semantic_fingerprint:canonicalSha256({assignmentVersionId:version.assignment_version_id,
          ...ASSIGNMENT_SEMANTIC_POLICY,evaluation}),...options.semantic}).execute();
    }
    await tx.insertInto('person_master.assignment_command_outcome').values({governance_object_id:version.governance_object_id,
      request_id:request,created_by:version.created_by,operation_hash:version.operation_hash,
      operation_type:options.outcomeOperation??'CLASSIFIED_CREATE',assignment_version_id:version.assignment_version_id,rejection_code:null}).execute();
  }
  async function probe(work:(tx:Transaction<DB>)=>Promise<void>,expected:string|null,isolation:'read committed'|'repeatable read'='read committed') {
    let observed:{code:string;constraint:string|null;message:string}|null=null;
    try {
      await database.transaction().setIsolationLevel(isolation).execute(async tx=> {
        await work(tx);await sql`set constraints all immediate`.execute(tx);throw ROLLBACK;
      });
    } catch(error) {
      if (error!==ROLLBACK) {
        assert.ok(error!==null && typeof error==='object' && 'code' in error,'REAL_POSTGRES_ERROR_REQUIRED');
        observed={code:String(error.code),constraint:'constraint' in error?String(error.constraint):null,
          message:error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)?error.message:'NATIVE_CONSTRAINT_REJECTION'};
      }
    }
    const observation={sqlObservation:observed??{code:'ROLLED_BACK_VALID_CONTROL'},expected,isolation};
    assignmentSemanticSqlObservations.push(observation);console.log(JSON.stringify(observation));
    if (expected===null) assert.equal(observed,null,'VALID_SQL_CONTROL_FAILED');
    else {assert.ok(observed,'SQL_NEGATIVE_WAS_ACCEPTED');assert.match(observed.code,new RegExp(expected));}
    return observed??{code:'ROLLED_BACK_VALID_CONTROL'};
  }
  await check(['TX-01'],'native valid control and missing/mismatched classified pairing (structural part)',async()=> {
    const valid=await probe(tx=>clone(tx),null);
    const missing=await probe(tx=>clone(tx,{omitSemantic:true}),'23514');
    const wrongOutcome=await probe(tx=>clone(tx,{outcomeOperation:'CREATE'}),'23514');
    return {valid,missing,wrongOutcome};
  });
  await check(['DF-01','DF-04','DF-06'],'native axis references, future definition clock and immutable rows',async()=> {
    const wrongAxis=await probe(tx=>clone(tx,{semantic:{mode_term_version_id:sourceSemantic.purpose_term_version_id}}),'23503');
    const nonexistent=await probe(tx=>clone(tx,{semantic:{purpose_term_version_id:randomUUID()}}),'23503');
    const wrongScope=await probe(tx=>clone(tx,{semantic:{governance_object_id:departmentScope.governanceObjectId}}),'23503');
    const wrongClock=await probe(tx=>clone(tx,{semantic:{semantic_recorded_from:'2026-01-01T00:00:00'}}),'23514');
    assert.ok('message' in wrongClock);
    assert.equal(wrongClock.message,'ASSIGNMENT_SEMANTIC_VERSION_PAIR_INVALID');
    const definitions=await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
      .where('term_id','=',primaryDefinition.termId).orderBy('version_no','desc').executeTakeFirstOrThrow();
    const future=await probe(async tx=> {
      const {term_version_id,recorded_from,...fields}=definitions; void term_version_id;void recorded_from;
      await tx.insertInto('person_master.assignment_semantic_term_version').values({...fields,
        version_no:String(BigInt(definitions.version_no)+1n),supersedes_term_version_id:definitions.term_version_id,
        request_id:randomUUID(),reason_code:'LABEL_CORRECTION',recorded_from:sql`platform.local_now()+interval '1 day'`}).execute();
    },'23514');
    const immutable=[];
    for (const action of [
      (tx:Transaction<DB>)=>tx.updateTable('person_master.assignment_semantic_term').set({code:'STANDING_CONCURRENT'}).where('term_id','=',primaryDefinition.termId).execute(),
      (tx:Transaction<DB>)=>tx.deleteFrom('person_master.assignment_semantic_term_version').where('term_version_id','=',definitions.term_version_id).execute(),
      (tx:Transaction<DB>)=>tx.updateTable('person_master.assignment_version_semantics').set({mode_code:'PRIMARY_AFFILIATION'}).where('assignment_version_id','=',source.coreVersion.assignmentVersionId).execute(),
      (tx:Transaction<DB>)=>sql`truncate person_master.assignment_version_semantics,person_master.assignment_closure_evidence,person_master.assignment_temporary_source`.execute(tx),
    ]) immutable.push(await probe(async tx=>{await action(tx);},'55000'));
    return {wrongAxis,nonexistent,wrongScope,wrongClock,future,immutable};
  });
  await check(['HV-07'],'native raw V2 cannot follow an already classified V1',async()=> {
    return probe(async tx=> {
      const request=randomUUID();
      const {assignment_version_id,business_period,recorded_from,...fields}=sourceVersion;
      void assignment_version_id;void business_period;void recorded_from;
      const version=await tx.insertInto('person_master.assignment_version').values({...fields,version_no:'2',
        supersedes_assignment_version_id:sourceVersion.assignment_version_id,reason_code:'VALIDITY_CORRECTION',request_id:request,
        evaluation_record_as_of:sql`platform.local_now()`,recorded_from:sql`platform.local_now()`}).returningAll().executeTakeFirstOrThrow();
      await tx.insertInto('person_master.assignment_validation_segment').values(sourceSegments.map(s=>({...s,assignment_version_id:version.assignment_version_id}))).execute();
      await tx.insertInto('person_master.assignment_command_outcome').values({governance_object_id:version.governance_object_id,
        request_id:request,created_by:version.created_by,operation_hash:version.operation_hash,operation_type:'REVISE',
        assignment_version_id:version.assignment_version_id,rejection_code:null}).execute();
    },'23514');
  });
  await check(['HV-06'],'cannot attach classification behind an already committed raw CREATE outcome',async()=> {
    const {purposeCode,modeCode,...raw}=command(e.engagementId); void purposeCode;void modeCode;
    const accepted=await f.app().createAssignment(raw);
    const revised=await f.app().reviseAssignment({...assignmentScope,assignmentId:accepted.assignmentId,
      expectedCurrentVersionId:accepted.assignmentVersionId,businessValidFrom:accepted.businessValidFrom,
      businessValidTo:accepted.businessValidTo,reasonCode:'VALIDITY_CORRECTION'});
    const observed=[];
    for (const target of [accepted,revised]) {
      const v=await database.selectFrom('person_master.assignment_version').selectAll()
        .where('assignment_version_id','=',target.assignmentVersionId).executeTakeFirstOrThrow();
      const evaluationRecordAsOf = v.evaluation_record_as_of;
      assert.ok(evaluationRecordAsOf !== null, 'ADMISSION_EVALUATION_REQUIRED');
      observed.push(await probe(async tx=> {
        await tx.insertInto('person_master.assignment_version_semantics').values({...sourceSemantic,
          assignment_version_id:v.assignment_version_id,assignment_id:v.assignment_id,request_id:v.request_id,
          created_by:v.created_by,operation_hash:v.operation_hash,semantic_recorded_from:v.recorded_from,
          evaluation_record_as_of:evaluationRecordAsOf}).execute();
      },'23514'));
      assert.equal((await app().getAssignmentVersionSemantics({...assignmentScope,assignmentId:target.assignmentId,
        assignmentVersionId:target.assignmentVersionId})).classification,'UNCLASSIFIED');
    }
    // Explicit non-primary adoption removes this test's unknown from later controls.
    await app().adoptAssignmentSemantics({...assignmentScope,assignmentId:accepted.assignmentId,
      expectedCurrentVersionId:revised.assignmentVersionId,purposeCode:'ORGANIZATIONAL_AFFILIATION',modeCode:'STANDING_CONCURRENT'});
    return {observed,rawVersions:[accepted.assignmentVersionId,revised.assignmentVersionId],rawHistoryUnchanged:true};
  });
  await check(['TX-03'],'direct SQL old RR snapshot restriction (additional SQL concurrency boundary)',async()=> {
    let externalVersionId:string|null=null;
    const observed=await probe(async tx=> {
      // Establish RR before the other transaction commits. No business rows in this transaction yet.
      await tx.selectFrom('person_master.assignment_version').select('assignment_version_id').where('engagement_id','=',e.engagementId).execute();
      const external=await app().createClassifiedAssignment(command(e.engagementId));
      externalVersionId=external.coreVersion.assignmentVersionId;
      await clone(tx,{primary:true});
    },'0A000','repeatable read');
    return {externalVersionId,observed,invalidRowsCommitted:0};
  });
  await check(['UK-05'],'controlled candidate-read corruption returns CONFLICT without disabling any native guard',async()=> {
    const before=(await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
      .where('engagement_id','=',e.engagementId).execute()).length;
    let resolution:unknown;
    // Multiple PRIMARY rows cannot legitimately persist. Corrupt only this test's
    // candidate observation over real SQL results; all native guards remain enabled.
    // This is reader fault injection, not a claim of persisted conflicting facts.
    const reads=new Set<unknown>();let altered=0;
    const plugin:KyselyPlugin={
      transformQuery(args){
        if(args.node.kind==='RawNode'&&args.node.sqlFragments.some(part=>part.includes('as "modeCode"'))) reads.add(args.queryId);
        return args.node;
      },
      async transformResult(args){
        if(!reads.has(args.queryId))return args.result;
        return {...args.result,rows:args.result.rows.map(row=>{
          if(row['assignmentId']!==source.coreVersion.assignmentId)return row;
          altered++;return {...row,modeCode:'PRIMARY_AFFILIATION'};
        })};
      },
    };
    await probe(async tx=> {
      const scope=await createAssignmentScope(tx.withPlugin(plugin),f.context());
      const recordAsOf=(await sql<{value:string}>`select platform.local_now() as value`.execute(tx)).rows[0]!.value;
      const value=await scope.assignment.resolvePrimaryAffiliation({...assignmentScope,engagementId:e.engagementId,
        purposeCode:'ORGANIZATIONAL_AFFILIATION',scopeCode:'HOSPITAL_DEPARTMENT_PLACEMENTS',
        businessAt:source.coreVersion.businessValidFrom,recordAsOf});
      assert.equal(value.resolution,'CONFLICT');assert.equal(value.knownPrimaryAssignmentVersionRefs.length,2);
      assert.equal(value.selectedAssignmentVersionId,null);resolution=value;
    },null);
    assert.equal(altered,1);
    assert.equal((await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
      .where('engagement_id','=',e.engagementId).execute()).length,before);
    const enabled=(await sql<{enabled:string}>`select tgenabled as enabled from pg_trigger
      where tgrelid='person_master.assignment_version_semantics'::regclass and tgname='assignment_semantics_guard'`.execute(database)).rows[0]!.enabled;
    assert.equal(enabled,'O');
    return {resolution,method:'TEST_LOCAL_CANDIDATE_RESULT_ADAPTER_OVER_REAL_DATABASE',rolledBack:true,
      triggerStayedEnabled:enabled,corruptRowsPersisted:0,businessVersionCountUnchanged:before};
  });
}
