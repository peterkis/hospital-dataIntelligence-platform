import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, ValuesNode, ValueNode, RawNode, ColumnNode, type Kysely, type KyselyPlugin, type OperationNode, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { ASSIGNMENT_SEMANTIC_POLICY } from '../../apps/governance-api/src/modules/person-master/assignment-semantics-policy.js';
import type { TemporaryCheck, TemporaryFixture } from './person-assignment-temporary-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { temporarySource, temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import { Jan, Jun, Jul, Aug, Dec } from './person-assignment-fixture.js';

const ROLLBACK=new Error('C04_SQL_PROBE_ROLLBACK');
type NativeRefusal={name:string;sqlState:string;message:string};
function literal(value:unknown):unknown {
  if(value&&typeof value==='object'&&'kind' in value) {
    if(value.kind==='ValueNode'&&'value' in value) return value.value;
    if(value.kind==='RawNode'&&'parameters' in value&&Array.isArray(value.parameters)&&value.parameters.length===1) return literal(value.parameters[0]);
  }
  return value;
}
/** Parameter-level test adapter only. SQL guards remain enabled in the owned fresh database. */
function inserts(edit:(table:string,values:Record<string,unknown>)=>Record<string,unknown>|'OMIT'|'OMIT_AUDIT'|null) {
  let changed=0;
  const suppressedAuditQueries=new Set<unknown>();
  const plugin:KyselyPlugin={
    transformQuery(args) {
      const node=args.node;
      if(node.kind!=='InsertQueryNode'||!node.into||!node.values||!ValuesNode.is(node.values)) return node;
      const table=node.into.table.identifier.name;
      const original=node.values.values[0];
      if(!original||!node.columns) return node;
      const values=Object.fromEntries(node.columns.map((column,i)=>[column.column.name,literal(original.values[i])]));
      const changes=edit(table,values);
      if(changes===null) return node;
      changed++;
      if(changes==='OMIT'||changes==='OMIT_AUDIT') {
        if(changes==='OMIT_AUDIT') suppressedAuditQueries.add(args.queryId);
        const target=table==='audit_event'?'audit.audit_event':'person_master.assignment_command_outcome';
        const columns=node.columns.map(column=>`"${column.column.name.replaceAll('"','""')}"`).join(',');
        // Keep INSERT as the root node (required by Kysely); the real statement
        // inserts zero rows. The audit-only placeholder below lets the caller
        // reach native completion, which must detect the actual missing row.
        return {...node,values:RawNode.createWithSql(`select ${columns} from ${target} where false`)};
      }
      const extra=Object.keys(changes).filter(key=>!node.columns!.some(column=>column.column.name===key));
      return {...node,columns:[...node.columns,...extra.map(key=>ColumnNode.create(key))],
        values:ValuesNode.create(node.values.values.map(row=>row.kind==='PrimitiveValueListNode'
          ? {...row,values:[...row.values.map((item,i)=>Object.hasOwn(changes,node.columns![i]!.column.name)?changes[node.columns![i]!.column.name]:item),
            ...extra.map(key=>changes[key])]}
          : {...row,values:[...row.values.map((item,i):OperationNode=>Object.hasOwn(changes,node.columns![i]!.column.name)
            ?ValueNode.create(changes[node.columns![i]!.column.name]):item),...extra.map(key=>ValueNode.create(changes[key]))]}))};
    },async transformResult(args){
      if(suppressedAuditQueries.has(args.queryId)) {
        assert.equal(args.result.rows.length,0,'C04_OMITTED_INSERT_UNEXPECTEDLY_WROTE');
        return {...args.result,rows:[{audit_event_id:randomUUID(),recorded_at:'2026-09-08T00:00:00'}]};
      }
      return args.result;
    },
  };
  return {plugin,hits:()=>changed};
}
export async function runTemporarySql(database:Kysely<DB>,f:TemporaryFixture,check:TemporaryCheck) {
  if(f.ownership.mode==='RETAINED') {
    await check(['MD-03','MD-05','MD-06','MD-07'],'Native corruption/omission and destructive probes run only in matching receipt-owned fresh databases',async()=>({
      reason:'C04_NATIVE_CORRUPTION_FRESH_ONLY'}),'SKIPPED_BY_SCOPE');return;
  }
  await requireTemporaryFixtureTarget(database,'CORRUPTION');
  const {source,engagement}=await temporarySource(f);
  // One real non-overlapping concurrent candidate makes omission of candidate
  // evidence observable; no impossible PRIMARY conflict is inserted behind guards.
  await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,
    {modeCode:'STANDING_CONCURRENT',businessValidFrom:Jan,businessValidTo:Jun}));
  const before=await temporarySourceSnapshot(database,source.assignmentId);
  async function negative(name:string,work:(tx:Transaction<DB>)=>Promise<unknown>,expected='23514|23503|23502',isolation:'read committed'|'repeatable read'='read committed'):Promise<NativeRefusal> {
    await requireTemporaryFixtureTarget(database,'CORRUPTION');
    let evidence:NativeRefusal|undefined;
    try {await database.transaction().setIsolationLevel(isolation).execute(async tx=>{await work(tx);await sql`set constraints all immediate`.execute(tx);throw ROLLBACK;});}
    catch(error) {
      if(error!==ROLLBACK) {
        assert.ok(error&&typeof error==='object'&&'code' in error,`${name}: NATIVE_SQL_ERROR_REQUIRED: ${error instanceof Error?error.message:'UNKNOWN'}`);
        evidence={name,sqlState:String(error.code),message:error instanceof Error?error.message:'POSTGRES_ERROR'};
      }
    }
    assert.ok(evidence,`${name}: SQL_NEGATIVE_ACCEPTED`);assert.match(evidence.sqlState,new RegExp(`^(?:${expected})$`));
    assert.deepEqual(await temporarySourceSnapshot(database,source.assignmentId),before);
    return evidence;
  }
  async function altered(name:string,table:string,column:string,value:unknown,expected='23514|23503|23502|40001') {
    const adapter=inserts((current)=>current===table?{[column]:value}:null);
    const result=await negative(name,async tx=>{
      await (await createAssignmentScope(tx.withPlugin(adapter.plugin),f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    },expected);
    assert.ok(adapter.hits()>0);return result;
  }
  await check(['MD-03','MD-05','SO-01','SO-03','SO-05','DW-02'],'Native source identity, exact head, period, purpose and fingerprints reject mismatched headers',async()=>{
    const cases:[string,unknown][]=[['source_assignment_id',randomUUID()],['source_assignment_version_id',randomUUID()],
      ['source_semantic_version_id',randomUUID()],['person_id',randomUUID()],['engagement_id',randomUUID()],['governance_object_id',randomUUID()],
      ['source_department_id',f.target.departmentId],['source_department_governance_object_id',f.scope.governanceObjectId],
      ['source_department_version_id',f.target.departmentVersionId],['target_department_governance_object_id',f.scope.governanceObjectId],
      ['preserved_purpose_code','CLINICAL_PRACTICE'],['source_semantic_fingerprint',Buffer.alloc(32,9)],
      ['source_acceptance_dependency_fingerprint',Buffer.alloc(32,8)],['source_declared_from',Jul],['source_declared_to',Jul],
      ['temporary_to',null],['temporary_to','infinity'],['temporary_to','9999-12-31T23:59:59'],['temporary_from',Aug],
      ['target_assignment_id',source.assignmentId],['target_admission_version_id',source.assignmentVersionId],
      ['target_department_id',f.department.departmentId],['policy_digest',Buffer.alloc(32,1)]];
    const observations=[];
    for(const [column,value] of cases) observations.push(await altered(`header ${column}`,'assignment_temporary_source',column,value));
    return {method:'actual INSERT parameter mutations, all native guards enabled, rollback-only',observations};
  });
  await check(['MD-03','MD-04','MD-06','DW-10'],'Target/V1/semantic clocks, actor/request and admission fingerprints must pair with the native header',async()=>{
    const cases:[string,string,unknown][]=[['assignment','created_at',Jan],['assignment','person_id',randomUUID()],
      ['assignment_version','recorded_from',Jan],['assignment_version','business_valid_to',Dec],
      ['assignment_version','dependency_fingerprint',Buffer.alloc(32,2)],['assignment_version','created_by',randomUUID()],
      ['assignment_version','request_id',randomUUID()],['assignment_version_semantics','semantic_recorded_from',Jan],
      ['assignment_version_semantics','evaluation_record_as_of',Jan],['assignment_version_semantics','semantic_operation_kind','CLASSIFIED_CREATE'],
      ['assignment_command_outcome','operation_type','CLASSIFIED_CREATE']];
    const observations=[];
    for(const [table,column,value] of cases) observations.push(await altered(`${table}.${column}`,table,column,value));
    return observations;
  });
  await check(['MD-06'],'Sourceless SECONDMENT cannot commit even when a test adapter substitutes its correct definition and root operation into an ordinary writer',async()=>{
    const mode=await f.semantics().findAssignmentSemanticTermAsOf({...f.scope,dimension:'MODE',code:'SECONDMENT',recordAsOf:await f.now()});assert.ok(mode);
    const adapter=inserts((table,values)=>{
      if(table==='assignment_version_semantics') {
        assert.equal(typeof values['evaluation'],'string');
        const evaluation:Record<string,unknown>=JSON.parse(String(values['evaluation']));evaluation['modeTermVersionId']=mode.termVersionId;
        return {mode_code:'SECONDMENT',mode_term_version_id:mode.termVersionId,semantic_operation_kind:'TEMPORARY_CREATE',
          evaluation:JSON.stringify(evaluation),semantic_fingerprint:canonicalSha256({assignmentVersionId:values['assignment_version_id'],...ASSIGNMENT_SEMANTIC_POLICY,evaluation})};
      }
      if(table==='assignment_command_outcome') return {operation_type:'TEMPORARY_CREATE'};
      return null;
    });
    const refusal=await negative('bare SECONDMENT semantic without source link',async tx=>{
      const result=await (await createAssignmentScope(tx.withPlugin(adapter.plugin),f.context())).assignment.createClassifiedAssignment(
        f.classifiedCommand(engagement.engagementId,{modeCode:'STANDING_CONCURRENT',businessValidFrom:Jul,businessValidTo:Aug}));
      assert.ok(result.ok);
    });
    assert.equal(refusal.message,'ASSIGNMENT_TEMPORARY_SOURCE_LINK_REQUIRED');assert.equal(adapter.hits(),2);
    return {refusal,actualSubstitutions:adapter.hits()};
  });
  await check(['MD-06','TX-10'],'Omitting the root outcome or any one of three success audits is refused by deferred native completion',async()=>{
    const observations=[];
    for(const omitted of ['OUTCOME','PERSON_ASSIGNMENT_CREATED','ASSIGNMENT_SEMANTICS_RECORDED','PERSON_ASSIGNMENT_TEMPORARY_CREATED']) {
      const adapter=inserts((table,values)=>omitted==='OUTCOME'&&table==='assignment_command_outcome'?'OMIT':
        table==='audit_event'&&values['action']===omitted?'OMIT_AUDIT':null);
      const refusal=await negative(`missing ${omitted}`,async tx=>{
        await (await createAssignmentScope(tx.withPlugin(adapter.plugin),f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      });
      assert.match(refusal.message,/ASSIGNMENT_(?:SUCCESS_OUTCOME_REQUIRED|TEMPORARY_AUDIT_REQUIRED|TEMPORARY_INCOMPLETE)/u);
      assert.equal(adapter.hits(),1);observations.push({omitted,refusal});
    }
    return {method:'real zero-row INSERT SELECT; audit-only test return placeholder reaches native completion; no trigger disabled',observations};
  });
  await check(['MD-03','MD-06'],'Native success audits bind exact entity type, stable target and target version',async()=>{
    const observations=[];
    for(const action of ['PERSON_ASSIGNMENT_CREATED','ASSIGNMENT_SEMANTICS_RECORDED','PERSON_ASSIGNMENT_TEMPORARY_CREATED'])
      for(const [column,value] of [['stable_entity_id',randomUUID()],['entity_version_id',randomUUID()],['entity_type','PERSON_SUBJECT']] as const) {
        const adapter=inserts((table,values)=>table==='audit_event'&&values['action']===action?{[column]:value}:null);
        const refusal=await negative(`audit ${action}.${column}`,async tx=>{
          await (await createAssignmentScope(tx.withPlugin(adapter.plugin),f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
        });
        assert.equal(adapter.hits(),1);assert.equal(refusal.message,'ASSIGNMENT_TEMPORARY_AUDIT_REQUIRED');observations.push(refusal);
      }
    return observations;
  });
  await check(['DW-10','MD-03'],'Bounded evidence rejects an omitted current candidate, extra schema fields and 65,537 bytes before acceptance',async()=>{
    const observations=[];
    for(const kind of ['CANDIDATE_OMITTED','EXTRA_WINDOW_FIELD','OVERSIZED_WINDOW'] as const) {
      const adapter=inserts((table,values)=>{
        if(table!=='assignment_temporary_source') return null;
        const key=kind==='CANDIDATE_OMITTED'?'source_primary_evaluation_evidence':'source_window_validation_evidence';
        const value:Record<string,unknown>=JSON.parse(String(values[key]));
        if(kind==='CANDIDATE_OMITTED') value['candidates']=[];
        else value['untrustedExtra']=kind==='OVERSIZED_WINDOW'?'x'.repeat(65537):'NO';
        return {[key]:JSON.stringify(value)};
      });
      const refusal=await negative(kind,async tx=>{
        await (await createAssignmentScope(tx.withPlugin(adapter.plugin),f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
      });
      assert.equal(adapter.hits(),1);
      if(kind==='OVERSIZED_WINDOW') assert.equal(refusal.message,'ASSIGNMENT_TEMPORARY_EVALUATION_LIMIT');
      observations.push(refusal);
    }
    return observations;
  });
  await check(['MD-06','TX-08'],'Non-RC temporary creation and stale evaluation R remain rejected without relaxing old semantic isolation guards',async()=>{
    const isolation=await negative('repeatable read temporary write',async tx=>{
      await (await createAssignmentScope(tx,f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(source));
    },'0A000','repeatable read');
    assert.equal(isolation.message,'ASSIGNMENT_TEMPORARY_WRITE_ISOLATION_UNSUPPORTED');
    const stale=await altered('caller old evaluation R','assignment_temporary_source','evaluation_record_as_of',Jan);
    assert.match(stale.message,/ASSIGNMENT_TEMPORARY_SOURCE_INVALID|ASSIGNMENT_TEMPORARY_SNAPSHOT_STALE/u);
    return {isolation,stale};
  });
  await check(['SO-08','OV-02','TX-05'],'Middle-only PRIMARY observation refuses in the application and native temporary overlap survives a corrupted application candidate read',async()=>{
    function candidateAdapter(change:(row:Record<string,unknown>)=>Record<string,unknown>|null) {
      const queries=new Set<unknown>();let changed=0;
      const plugin:KyselyPlugin={transformQuery(args){
        if(args.node.kind==='RawNode'&&args.node.sqlFragments.some(part=>part.includes('as "modeCode"')))queries.add(args.queryId);
        return args.node;
      },async transformResult(args){
        if(!queries.has(args.queryId))return args.result;
        const rows=[];for(const row of args.result.rows){const next=change(row);if(next!==row)changed++;if(next)rows.push(next);}
        return {...args.result,rows};
      }};
      return {plugin,hits:()=>changed};
    }
    const middleSource=await temporarySource(f);
    const concurrent=(await f.semantics().createClassifiedAssignment(f.classifiedCommand(middleSource.engagement.engagementId,
      {modeCode:'STANDING_CONCURRENT',businessValidFrom:'2026-07-12T00:00:00',businessValidTo:'2026-07-13T00:00:00'}))).coreVersion;
    const primaryFault=candidateAdapter(row=>row['assignmentId']===concurrent.assignmentId?{...row,modeCode:'PRIMARY_AFFILIATION'}:row);
    let applicationRefusal;
    try {await database.transaction().execute(async tx=>{
      const result=await (await createAssignmentScope(tx.withPlugin(primaryFault.plugin),f.context())).temporary.createSourceLinkedTemporaryAssignment(f.temporaryCommand(middleSource.source));
      assert.ok(!result.ok);assert.equal(result.code,'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');applicationRefusal=result;throw ROLLBACK;
    });}catch(error){if(error!==ROLLBACK)throw error;}
    assert.equal(primaryFault.hits(),1);
    const overlapSource=await temporarySource(f),existing=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(overlapSource.source));
    const hidden=candidateAdapter(row=>row['assignmentId']===existing.targetAssignmentId?null:row);
    const actualCandidate={assignmentId:existing.targetAssignmentId,assignmentVersionId:existing.targetAdmissionVersionId,
      businessValidFrom:existing.targetAdmission.businessValidFrom,businessValidTo:existing.targetAdmission.businessValidTo,
      purposeCode:existing.sourceLink.preservedPurposeCode,modeCode:'SECONDMENT'};
    const proof=inserts((table,values)=>{
      if(table!=='assignment_temporary_source')return null;
      const primary=JSON.parse(String(values['source_primary_evaluation_evidence'])),overlap=JSON.parse(String(values['temporary_overlap_evaluation_evidence']));
      primary.candidates=[actualCandidate];overlap.candidates=[actualCandidate];
      return {source_primary_evaluation_evidence:JSON.stringify(primary),temporary_overlap_evaluation_evidence:JSON.stringify(overlap)};
    });
    const native=await negative('native overlap after application candidate omission',async tx=>{
      await (await createAssignmentScope(tx.withPlugin(hidden.plugin).withPlugin(proof.plugin),f.context())).temporary
        .createSourceLinkedTemporaryAssignment(f.temporaryCommand(overlapSource.source));
    });
    assert.equal(native.message,'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT');assert.ok(hidden.hits()>=2);assert.equal(proof.hits(),1);
    return {applicationRefusal,middleCandidateVersion:concurrent.assignmentVersionId,primaryMethod:'TEST_LOCAL_CANDIDATE_OBSERVATION_CORRUPTION_NOT_PERSISTED_PRIMARY_FACTS',
      native,existingTarget:existing.targetAssignmentId,guardsDisabled:0};
  });
  await check(['SO-01','TX-08'],'A direct native header waiting on an immutable source identity sees the newly committed source head under READ COMMITTED',async()=>{
    const queued=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(queued.source));
    const template=await database.selectFrom('person_master.assignment_temporary_source').selectAll().where('target_assignment_id','=',child.targetAssignmentId).executeTakeFirstOrThrow();
    let enter!:(pid:number)=>void,fail!:(error:unknown)=>void,release!:()=>void;
    const ready=new Promise<number>((resolve,reject)=>{enter=resolve;fail=reject;}),released=new Promise<void>(resolve=>{release=resolve;});
    const writer=database.transaction().execute(async tx=>{
      await tx.selectFrom('person_master.assignment').select('assignment_id').where('assignment_id','=',queued.source.assignmentId).forUpdate().execute();
      enter((await sql<{pid:number}>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);await released;
      const result=await (await createAssignmentScope(tx,f.context())).assignment.reviseClassifiedAssignmentPeriod({...f.scope,
        assignmentId:queued.source.assignmentId,expectedCurrentVersionId:queued.source.assignmentVersionId,businessValidFrom:Jan,businessValidTo:Dec,reasonCode:'VALIDITY_CORRECTION'});
      assert.ok(result.ok);return result.value;
    });
    void writer.catch(fail);const pid=await ready;
    const raw=database.transaction().execute(tx=>tx.insertInto('person_master.assignment_temporary_source').values({...template,
      target_assignment_id:sql`uuidv7()`,target_admission_version_id:sql`uuidv7()`,request_id:randomUUID(),evaluation_record_as_of:sql`platform.local_now()`}).execute());
    const failedRaw=raw.then(()=>null,error=>error);let waits:unknown;
    try {
      const start=performance.now();
      while(performance.now()-start<15000){
        const rows=(await sql<{pid:number;blockers:number[]}>`select pid,pg_blocking_pids(pid) as blockers from pg_stat_activity
          where datname=current_database() and application_name='hdi-pv006-c04-application' and ${pid}=any(pg_blocking_pids(pid))`.execute(database)).rows;
        if(rows.length){waits=rows;break;}await delay(10);
      }
      assert.ok(waits,'C04_NATIVE_SOURCE_WAIT_NOT_OBSERVED');
    }finally{release();}
    const revised=await writer,error=await failedRaw;
    assert.ok(error&&typeof error==='object'&&'code' in error);assert.equal(error.code,'23514');
    const nativeSqlState=String(error.code);
    assert.ok(error instanceof Error);assert.equal(error.message,'ASSIGNMENT_TEMPORARY_SOURCE_INVALID');
    return {waits,oldHead:queued.source.assignmentVersionId,newHead:revised.assignmentVersionId,nativeSqlState,nativeMessage:error.message};
  });
  await check(['MD-05','MD-07','MD-08'],'Every Assignment immutable table rejects UPDATE/DELETE/TRUNCATE; an existing child cannot gain another source or ordinary V2',async()=>{
    const other=await temporarySource(f),child=await f.temporary().createSourceLinkedTemporaryAssignment(f.temporaryCommand(other.source));
    const closed=await f.closure().endAssignment(f.endCommand(child.targetAdmission,'2026-07-20T00:00:00'));
    const transferSource=await temporarySource(f),transfer=await f.transfer().transferAssignment({...f.scope,sourceAssignmentId:transferSource.source.assignmentId,
      expectedSourceVersionId:transferSource.source.assignmentVersionId,effectiveAt:Aug,targetPlacement:child.sourceLink.targetPlacement,reasonCode:'ORGANIZATIONAL_TRANSFER'});
    const header=await database.selectFrom('person_master.assignment_temporary_source').selectAll().where('target_assignment_id','=',child.targetAssignmentId).executeTakeFirstOrThrow();
    const duplicate=await negative('duplicate source link on known child',tx=>tx.insertInto('person_master.assignment_temporary_source').values(header).execute());
    assert.equal(duplicate.message,'ASSIGNMENT_OPERATION_CONFLICT');
    const alternate=await temporarySource(f);
    const secondSource=await negative('new root and different source on existing child',tx=>tx.insertInto('person_master.assignment_temporary_source').values({
      ...header,request_id:randomUUID(),source_assignment_id:alternate.source.assignmentId,source_assignment_version_id:alternate.source.assignmentVersionId,
      source_semantic_version_id:alternate.source.assignmentVersionId}).execute());
    assert.equal(secondSource.message,'ASSIGNMENT_TEMPORARY_TARGET_ALREADY_KNOWN');
    const prior=await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id','=',child.targetAdmissionVersionId).executeTakeFirstOrThrow();
    const {business_period:ignored,...writable}=prior;void ignored;
    const revision=await negative('ordinary ADMISSION V2 of temporary child',tx=>tx.insertInto('person_master.assignment_version').values({...writable,
      assignment_version_id:sql`uuidv7()`,version_no:'3',supersedes_assignment_version_id:closed.assignmentVersionId,request_id:randomUUID(),
      recorded_from:sql`platform.local_now()`,reason_code:'VALIDITY_CORRECTION'}).execute());
    assert.equal(revision.message,'ASSIGNMENT_TEMPORARY_REVISION_NOT_SUPPORTED_IN_SLICE');
    const tables:[string,string,string][]=[['assignment','assignment_id',other.source.assignmentId],['assignment_version','assignment_version_id',other.source.assignmentVersionId],
      ['assignment_validation_segment','assignment_version_id',other.source.assignmentVersionId],['assignment_version_semantics','assignment_version_id',other.source.assignmentVersionId],
      ['assignment_semantic_term','term_id',f.definition.termId],['assignment_semantic_term_version','term_version_id',f.definition.termVersionId],
      ['assignment_temporary_source','target_assignment_id',child.targetAssignmentId],['assignment_closure_evidence','closure_assignment_version_id',closed.assignmentVersionId],
      ['assignment_transfer','transfer_id',transfer.transferId],['assignment_command_outcome','assignment_version_id',child.targetAdmissionVersionId]];
    const observations=[];
    for(const [table,key,id] of tables) {
      for(const operation of ['UPDATE','DELETE'] as const) observations.push(await negative(`${table} ${operation}`,tx=>operation==='UPDATE'
        ?sql`update ${sql.id('person_master',table)} set ${sql.id(key)}=${sql.id(key)} where ${sql.id(key)}=${id}::uuid`.execute(tx)
        :sql`delete from ${sql.id('person_master',table)} where ${sql.id(key)}=${id}::uuid`.execute(tx),'55000'));
      observations.push(await negative(`${table} TRUNCATE`,tx=>sql`truncate ${sql.id('person_master',table)}`.execute(tx),'55000|0A000'));
    }
    const all=await negative('complete Assignment table set TRUNCATE',tx=>sql`truncate ${sql.join(tables.map(([table])=>sql.id('person_master',table)))}`.execute(tx),'55000');
    return {duplicate,secondSource,revision,observations,all,guardsDisabled:0};
  });
}
