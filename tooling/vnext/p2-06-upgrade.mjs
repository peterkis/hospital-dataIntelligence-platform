import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {evolutionFixture} from './p2-05-fixture.ts';

export async function validateImpactUpgrade(){
 // Execute the exact predecessor Owner against the real 0121 prefix. This is
 // validation-only source, never a production fallback or fabricated candidate.
 const baseline='6e16cbd',path='apps/governance-api/src/modules/department-master/vnext/organization-evolution.ts';
 const original=execFileSync('git',['show',baseline+':'+path],{encoding:'utf8',windowsHide:true});
 const source=original.replace(/from '([.][^']+)'/g,(_all,specifier)=>"from '"+pathToFileURL(resolve(dirname(path),specifier.replace(/\.js$/,'.ts'))).href+"'");
 mkdirSync('.runtime/vnext/p2-06',{recursive:true});const predecessor=resolve('.runtime/vnext/p2-06/predecessor-owner.mts');writeFileSync(predecessor,source);
 const {openOrganizationEvolutions:openPredecessor}=await import(pathToFileURL(predecessor).href);
 const owned=createTemporary('P2-06'),provider=new LocalSyntheticKeyProvider();let session,catalog,old,current;
 try{
  await migrate(owned.receipt,migrationFiles().slice(0,121));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,session.receipt.role);grantOrganization(owned.receipt,session.receipt.role);
  catalog=await openCatalog(session.connectionString,provider);const f=await evolutionFixture(owned.receipt,catalog,provider,session.connectionString);old=openPredecessor(session.connectionString,provider);
  const prepare=async()=>{
   const input=await f.input(),id=await f.newDepartment();f.grantTarget(id);input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0].from_target_id=id;input.relations[0].to_target_id=id;
   const staged=await old.stage('maker',input);await old.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST predecessor review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
   const requestId=randomUUID(),candidate=await old.plan('maker',{inputId:staged.inputId,requestId});await old.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await old.approveApplyUnit('reviewer',candidate);return {input,staged,candidate,command:{candidateId:candidate.candidateId,requestId}};
  };
  const accepted=await prepare(),outcome=await old.applyUnit('maker',accepted.command);assert.equal(outcome.status,'COMMITTED');
  const pending=await prepare(),eventId=outcome.facts[0].id,eventQuery={id:eventId,campus:'NORTH',businessAt:accepted.input.event.effective_at},event=await old.query('maker',eventQuery);
  await old.close();old=null;
  const before=await inspect(owned.receipt),tables=predecessorTables(before.tables),added={'vnext_control.actor':['principal_kind']},digest=predecessorDigest(owned.receipt,tables,added);
  const after=await migrate(owned.receipt);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,121),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables,added),digest);
  grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.department_impact_record(text,text) TO ${session.receipt.role}`);current=openOrganizationEvolutions(session.connectionString,provider);
  assert.deepEqual(await current.applyUnit('maker',accepted.command),outcome);assert.deepEqual(await current.query('maker',eventQuery),event);
  await assert.rejects(current.applyUnit('maker',pending.command),/IMPACT_ASSESSMENT_REQUIRED|STALE_VALIDATION/);assert.equal(await current.resumeOutcome('maker',pending.command),null);
  const assessment=await current.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST explicit later observation',target:{kind:'EVENT',id:eventId,campus:'NORTH'}});
  const cases=await current.listImpactCases('maker',{eventId,campus:'NORTH'});assert.ok(cases.items.length);assert.ok(cases.items.every(c=>c.observationBasis==='LATER_OBSERVATION'));assert.deepEqual(await current.query('maker',eventQuery),event);
  await current.verify('reviewer',{requestId:randomUUID(),inputId:pending.staged.inputId,inputDigest:pending.staged.digest,reason:'TEST fresh independent assessment',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  const requestId=randomUUID(),candidate=await current.plan('maker',{inputId:pending.staged.inputId,requestId});await current.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await current.approveApplyUnit('reviewer',candidate);assert.equal((await current.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status,'COMMITTED');
  const result={status:'P2_06_PREDECESSOR_UPGRADE_PASSED',baseline,sourceDigest:createHash('sha256').update(original).digest('hex'),prefix:121,current:after.ledger.length,priorRowsAndKeysPreserved:true,committedReplay:true,oldPendingBlocked:true,newApprovalCommitted:true,laterAssessmentId:assessment.assessmentId};
  writeFileSync('.runtime/vnext/p2-06/upgrade.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){session??=error.ownerSession;throw error;}finally{await old?.close();await current?.close();await catalog?.close();dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
}
