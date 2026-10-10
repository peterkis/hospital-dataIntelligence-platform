import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {validationKeys} from './p3-05-validation-keys.mjs';
import {withHandoverPredecessor,handoverPredecessorBaseline} from './p3-05-handover-upgrade.mjs';
import {readReceipt,peer,identitySQL} from './lineage.mjs';
import {openCatalog,openParameterValues,type UnitOutcome} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openDepartmentLifecycle} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openOperatingRelations} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openBusinessUnit,openWard,openNursingUnit,openWardNursingCoverage,type WardNursingEntry,type WardNursingVerification,type WardNursingHistory,type WardNursingVersion} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.js';
import {nursingUpstreamPorts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {wardNursingUpstreamPorts} from '../../apps/governance-api/src/composition/ward-nursing-dependencies.js';
import type {wardNursingFixture} from './p3-05-fixture.js';
import type {wardFixture} from './p3-02-fixture.js';

type Request={candidateId:string;requestId:string};
type LegacyFixture=Awaited<ReturnType<typeof wardNursingFixture>>;
type Query={id:string;businessAt:string;recordAsOf:string};
interface CapturedRelation {history:WardNursingHistory;exact:WardNursingVersion;queries:Array<{input:Query;result:Awaited<ReturnType<LegacyFixture['owner']['read']>>}>}
interface LegacyEvidence {
 gate:string;baseline:string;prefix:number;oid:string;sourceSha256:string;sourceLoaderOverlay:unknown;
 committed:{request:Request;applied:Awaited<ReturnType<LegacyFixture['owner']['applyUnit']>>;outcome:UnitOutcome;relations:CapturedRelation[]};
 pending:{request:Request;inputId:string;inputDigest:string;verification:WardNursingVerification;sourceHistory:WardNursingHistory;successorAlias:string};
}
type SetupResult={kind:'COMMITTED';value:LegacyEvidence['committed']}|{kind:'PENDING';value:LegacyEvidence['pending']};

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--verify'))throw new Error('CLOSED_COMMAND_REQUIRED');
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receiptPath=process.env['VNEXT_TEST_RECEIPT']!;
if(!connection||!receiptPath)throw new Error('VALIDATION_ENVIRONMENT_REQUIRED');
const receipt=readReceipt(receiptPath);if(receipt.taskId!=='P3-05'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('TEMPORARY_VALIDATION_REQUIRED');
const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1}),evidencePath=receiptPath+'.handover0199.json';
const proofCount=()=>peer(receipt.name,'\\set QUIET on\n'+identitySQL(receipt)+'SELECT count(*) FROM care_organization.nursing_handover_confirmation;');
try{
 const identity=(await pool.query('select current_user role,current_database() database,d.oid::text oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls from pg_database d join pg_roles r on r.rolname=current_user where d.datname=current_database()')).rows[0]!;
 assert.equal(identity.database,receipt.name);assert.equal(identity.oid,receipt.oid);assert.match(identity.role,/^hdi_validation_[a-f0-9]{16}$/);assert.ok(!identity.rolsuper&&!identity.rolcreatedb&&!identity.rolcreaterole&&!identity.rolbypassrls);
 const installed=Number((await pool.query('select count(*)::integer n from vnext_control.migration')).rows[0]!.n);
 if(args[0]!=='--verify'){
  assert.equal(installed,199);
  await withHandoverPredecessor(async(directory:string,sourceReceipt:{sha256:string;loaderOverlay:unknown})=>{
   const load=(file:string)=>import(pathToFileURL(resolve(directory,file)).href),{openCatalog:openLegacyCatalog}=await load('apps/governance-api/src/modules/governance-catalog/index.ts'),{wardNursingFixture:legacyFixture}=await load('tooling/vnext/p3-05-fixture.ts') as {wardNursingFixture:typeof wardNursingFixture},{wardFixture:legacyWardFixture}=await load('tooling/vnext/p3-02-fixture.ts') as {wardFixture:typeof wardFixture};
   const catalog=await openLegacyCatalog(connection,provider);let fixture:LegacyFixture|undefined,wards:Awaited<ReturnType<typeof wardFixture>>|undefined;
   try{
    // Establish the archived cold transport/service bindings before the Nursing
    // fixture reuses them. The legacy WN default constructs a persistent Ward.
    wards=await legacyWardFixture(receipt,identity.role,catalog,provider,connection,false);
    fixture=await legacyFixture(receipt,identity.role,catalog,provider,connection,false,wards);const f=fixture;
    const setup=async(commit:boolean):Promise<SetupResult>=>{
     const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),first=await f.apply(await f.input([entry])),id=first.facts[0]!.id,T='2030-04-01T00:00:00.000001',incoming=f.entry(b);incoming.row={...incoming.row,valid_from:T,handover_rule_ref:'TEST_LEGACY_BOOL_HANDOVER'};
     const ending:WardNursingEntry={...entry,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},endAt:T,row:{...entry.row,record_status:'RETIRED'}},input=await f.input([ending,incoming]),staged=await f.owner.stage('maker',input),verification=f.verification(input,staged);
     const row=verification.rows[1]!;row.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_LEGACY_BOOL_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true};
     assert.ok(!('nursingConfirmation' in row.handover));await f.owner.verify('reviewer',verification);assert.equal((await f.owner.preview('maker',{inputId:staged.inputId})).decision,'PASS');
     const requestId=randomUUID(),planned=await f.owner.plan('maker',{inputId:staged.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:planned.candidateId});await f.owner.approveApplyUnit('reviewer',planned);const request={candidateId:planned.candidateId,requestId};
     if(!commit)return {kind:'PENDING',value:{request,inputId:staged.inputId,inputDigest:staged.digest,verification,sourceHistory:await f.owner.history('maker',{id}),successorAlias:incoming.row.ward_nursing_rel_id}};
     const applied=await f.owner.applyUnit('maker',request);if(applied.status!=='COMMITTED')throw new Error('LEGACY_HANDOVER_COMMIT_REQUIRED');
     const outcome=await f.owner.resumeOutcome('maker',request);if(!outcome)throw new Error('LEGACY_HANDOVER_OUTCOME_REQUIRED');assert.equal((await f.owner.reconcileCommittedUnit('maker',request)).status,'MATCHED');
     const ids=[id,outcome.facts[1]!.id],relations:CapturedRelation[]=[];
     for(const relationId of ids){
      const history=await f.owner.history('maker',{id:relationId}),exact=await f.owner.exact('maker',{id:relationId,version:'1'}),queries:CapturedRelation['queries']=[];
      for(const businessAt of ['2030-03-31T23:59:59.999999',T]){const query={id:relationId,businessAt,recordAsOf:outcome.recordedAt};queries.push({input:query,result:await f.owner.read('maker',query)});}
      assert.ok(history.versions.every(version=>version.facts.handover.kind!=='CONFIRMED_HANDOVER'||!version.facts.handover.nursingConfirmation));relations.push({history,exact,queries});
     }
     return {kind:'COMMITTED',value:{request,applied,outcome,relations}};
    };
    const committedResult=await setup(true),pendingResult=await setup(false);if(committedResult.kind!=='COMMITTED'||pendingResult.kind!=='PENDING')throw new Error('LEGACY_CAPTURE_SHAPE');
    const committed=committedResult.value,pending=pendingResult.value;
    assert.equal(pending.sourceHistory.versions.length,1);assert.equal(await f.owner.resumeOutcome('maker',pending.request),null);
    const evidence:LegacyEvidence={gate:'P3_05_BOOL_HANDOVER_POPULATED_0199',baseline:handoverPredecessorBaseline,prefix:199,oid:receipt.oid,sourceSha256:sourceReceipt.sha256,sourceLoaderOverlay:sourceReceipt.loaderOverlay,committed,pending};
    writeFileSync(evidencePath,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify({gate:evidence.gate,status:'PASS',baseline:evidence.baseline,prefix:199,realLegacyOwner:true,committedBooleanOnly:true,pendingBooleanOnly:true,evidence:evidencePath}));
   }finally{await fixture?.close();await wards?.close();await catalog.close();}
  },receipt);
 }else{
  assert.equal(installed,200);const prior=JSON.parse(readFileSync(evidencePath,'utf8')) as LegacyEvidence;
  assert.equal(prior.gate,'P3_05_BOOL_HANDOVER_POPULATED_0199');assert.equal(prior.baseline,handoverPredecessorBaseline);assert.equal(prior.prefix,199);assert.equal(prior.oid,receipt.oid);assert.equal(proofCount(),'0');
  const sourceWindows=openParameterValues(connection),catalog=await openCatalog(connection,provider),lifecycle=openDepartmentLifecycle(connection,provider),operating=openOperatingRelations(connection,provider),units=openBusinessUnit(connection,provider,{departmentCoverage:lifecycle.readUnitBindingCoverageInTransaction,departmentBoundaries:lifecycle.readUnitBindingBoundariesInTransaction,referenceAccess:lifecycle.authorizeUnitReferenceInTransaction,operatingWindow:operating.evaluateOperatingWindowInTransaction}),ward=openWard(connection,provider,wardUpstreamPorts(units)),nursing=openNursingUnit(connection,provider,nursingUpstreamPorts),owner=openWardNursingCoverage(connection,provider,wardNursingUpstreamPorts(ward,nursing,units,sourceWindows));
  try{
   const assertLegacy=async()=>{for(const relation of prior.committed.relations){assert.deepEqual(await owner.history('maker',{id:relation.history.id}),relation.history);assert.deepEqual(await owner.exact('maker',{id:relation.history.id,version:'1'}),relation.exact);for(const query of relation.queries)assert.deepEqual(await owner.read('maker',query.input),query.result);}};
   await assertLegacy();assert.deepEqual(await owner.applyUnit('maker',prior.committed.request),prior.committed.applied);assert.deepEqual(await owner.resumeOutcome('maker',prior.committed.request),prior.committed.outcome);assert.equal((await owner.reconcileCommittedUnit('maker',prior.committed.request)).status,'MATCHED');
   await assert.rejects(owner.resumeOutcome('outsider',prior.committed.request),/ACCESS_DENIED/);assert.equal(proofCount(),'0','Recovering an old accepted outcome must not manufacture proof');await assertLegacy();
   const blocked=await owner.preview('maker',{inputId:prior.pending.inputId});assert.equal(blocked.decision,'BLOCKED');assert.ok(blocked.issues.some(issue=>/HANDOVER.*CONFIRM|CONFIRM.*HANDOVER/.test(issue.code)),'Legacy pending approval must be blocked by missing Nursing proof');
   await assert.rejects(owner.verify('reviewer',{...prior.pending.verification,requestId:randomUUID()}),/HANDOVER_NOT_CONFIRMED|NURSING_HANDOVER_CONFIRMATION_REQUIRED/);
   await assert.rejects(owner.applyUnit('maker',prior.pending.request));assert.equal(await owner.resumeOutcome('maker',prior.pending.request),null);assert.deepEqual(await owner.history('maker',{id:prior.pending.sourceHistory.id}),prior.pending.sourceHistory);assert.equal(proofCount(),'0');
   const handover=prior.pending.verification.rows[1]!.handover;if(handover.kind!=='CONFIRMED_HANDOVER')throw new Error('LEGACY_HANDOVER_REQUIRED');
   const confirmed=await nursing.confirmCoverageHandover('reviewer',{requestId:randomUUID(),inputId:prior.pending.inputId,inputDigest:prior.pending.inputDigest,row:2,handover:{...handover,confirmed:true},reason:'TEST independent Nursing proof after genuine0199 upgrade'}),freshVerification:WardNursingVerification={...prior.pending.verification,requestId:randomUUID(),rows:prior.pending.verification.rows.map(row=>row.row===2?{...row,handover:{...handover,nursingConfirmation:{id:confirmed.confirmationId,digest:confirmed.digest}}}:row)};
   await owner.verify('reviewer',freshVerification);assert.equal((await owner.preview('maker',{inputId:prior.pending.inputId})).decision,'PASS');
   const requestId=randomUUID(),planned=await owner.plan('maker',{inputId:prior.pending.inputId,requestId});assert.notEqual(planned.candidateId,prior.pending.request.candidateId);await owner.readApplyCandidate('reviewer',{candidateId:planned.candidateId});await owner.approveApplyUnit('reviewer',planned);const freshRequest={candidateId:planned.candidateId,requestId},fresh=await owner.applyUnit('maker',freshRequest);assert.equal(fresh.status,'COMMITTED');assert.equal((await owner.reconcileCommittedUnit('maker',freshRequest)).status,'MATCHED');
   if(fresh.status!=='COMMITTED')throw new Error('REFROZEN_HANDOVER_COMMIT_REQUIRED');const successor=await owner.history('maker',{id:fresh.facts[1]!.id});assert.deepEqual(successor.versions[0]!.facts.handover.kind==='CONFIRMED_HANDOVER'?successor.versions[0]!.facts.handover.nursingConfirmation:null,{id:confirmed.confirmationId,digest:confirmed.digest});assert.equal(proofCount(),'1');await assertLegacy();
   const evidence=receiptPath+'.handover0200.json';writeFileSync(evidence,JSON.stringify({gate:'P3_05_BOOL_HANDOVER_0200_RECOVERY',status:'PASS',baseline:handoverPredecessorBaseline,oid:receipt.oid,restrictedApplicationRole:true,currentPublicOwners:true,originalHistoriesPreserved:true,originalBRQueriesPreserved:true,originalApplyOutcomePreserved:true,resumePreserved:true,reconcile:'MATCHED',currentOutsiderDenied:true,noProofBackfill:true,legacyPendingBlocked:true,freshIndependentNursingProof:true,refrozenCandidateId:planned.candidateId,oldPendingCandidateId:prior.pending.request.candidateId,confirmationId:confirmed.confirmationId,newOutcome:fresh,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({gate:'P3_05_BOOL_HANDOVER_0200_RECOVERY',status:'PASS',evidence}));
  }finally{await sourceWindows.close();await owner.close();await nursing.close();await ward.close();await units.close();await operating.close();await lifecycle.close();await catalog.close();}
 }
}finally{await pool.end();}
