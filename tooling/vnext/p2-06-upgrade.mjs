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
import {organizationMappingFixture} from './p2-03-fixture.ts';
import {evolutionFixture} from './p2-05-fixture.ts';

export async function validateImpactUpgrade(){
 await validateImpactUpgradeFrom(121,'6e16cbd');
 await validateImpactUpgradeFrom(124,'ff98277');
}
async function validateImpactUpgradeFrom(prefix,baseline){
 // Freeze the predecessor's impact modules too: current helpers can require
 // migrations that the populated predecessor intentionally does not have yet.
 const path='apps/governance-api/src/modules/department-master/vnext/organization-evolution.ts';
 const names=['index.ts','organization-evolution.ts','organization-evolution-contracts.ts',...(prefix>=122?['department-impact.ts','department-impact-cases.ts','department-impact-contracts.ts']:[])];
 const directory=resolve('.runtime/vnext/p2-06/predecessor-'+prefix);mkdirSync(directory,{recursive:true});
 const sources=new Map(names.map(name=>{const file=resolve(dirname(path),name);return [file,execFileSync('git',['show',baseline+':'+dirname(path).replaceAll('\\','/')+'/'+name],{encoding:'utf8',windowsHide:true})];}));
 const frozen=new Map(names.map(name=>[resolve(dirname(path),name),resolve(directory,name.replace(/\.ts$/,'.mts'))]));
 for(const [file,source] of sources){
  const rewritten=source.replace(/from '([.][^']+)'/g,(_all,specifier)=>{
   const target=resolve(dirname(file),specifier.replace(/\.js$/,'.ts'));
   return "from '"+pathToFileURL(frozen.get(target)??target).href+"'";
  });
  writeFileSync(frozen.get(file),rewritten);
 }
 const predecessor=frozen.get(resolve(path));
 const sourceDigest=createHash('sha256').update(JSON.stringify(names.map(name=>({name,source:sources.get(resolve(dirname(path),name))})))).digest('hex');
 const {openOrganizationEvolutions:openPredecessor}=await import(pathToFileURL(predecessor).href);
 const {openDepartment:openPredecessorDepartment}=await import(pathToFileURL(frozen.get(resolve(dirname(path),'index.ts'))).href);
 const owned=createTemporary('P2-06'),provider=new LocalSyntheticKeyProvider();let session,catalog,old,current;
 try{
  await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,session.receipt.role);grantOrganization(owned.receipt,session.receipt.role);
  catalog=await openCatalog(session.connectionString,provider);const base=await organizationMappingFixture(owned.receipt,catalog,provider,session.connectionString,openPredecessorDepartment);const f=await evolutionFixture(owned.receipt,catalog,provider,session.connectionString,base);old=openPredecessor(session.connectionString,provider);
  const prepare=async()=>{
   const input=await f.input(),id=await f.newDepartment();f.grantTarget(id);input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0].from_target_id=id;input.relations[0].to_target_id=id;
   input.impacts=input.impacts.filter(item=>item.domain!=='IDENTIFIER');
   const staged=await old.stage('maker',input);await old.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST predecessor review',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews.filter(item=>item.domain!=='IDENTIFIER')});
   const requestId=randomUUID(),candidate=await old.plan('maker',{inputId:staged.inputId,requestId});await old.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await old.approveApplyUnit('reviewer',candidate);return {input,staged,candidate,command:{candidateId:candidate.candidateId,requestId}};
  };
  const accepted=await prepare(),outcome=await old.applyUnit('maker',accepted.command);assert.equal(outcome.status,'COMMITTED');
  const pending=await prepare(),eventId=outcome.facts[0].id,eventQuery={id:eventId,campus:'NORTH',businessAt:accepted.input.event.effective_at},event=await old.query('maker',eventQuery);
  let closedCase;
  if(prefix===124){
   peer(owned.receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['WRITE','REVIEW']) p ON CONFLICT DO NOTHING;");
   const item=(await old.listImpactCases('maker',{eventId,campus:'NORTH'})).items.find(item=>item.obligation.owner==='IDENTIFIER');assert.ok(item);
   const cmd=(action,values)=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_UPGRADE_CLOSED_CASE',...values});
   const draft=await catalog.command('maker',cmd('CREATE',{kind:'RESPONSIBILITY',code:'UPGRADE_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset:'ORG23',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}));
   const submitted=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
   const responsibility=await catalog.command('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
   const base={caseId:item.id,campus:'NORTH',reason:'TEST preserve original accepted history'};
   const assigned=await old.assignImpactCase('maker',{...base,requestId:randomUUID(),expectedHead:'0',responsibilityId:responsibility.id});
   const proposal=await old.recordDisposition('maker',{...base,requestId:randomUUID(),expectedHead:assigned.head,disposition:{kind:'KEEP_HISTORY',evidenceId:f.material.artifactId}});
   const approval=await old.approveDisposition('reviewer',{...base,requestId:randomUUID(),expectedHead:proposal.head,proposalEventId:proposal.eventId});
   assert.equal((await old.recheckImpact('maker',{...base,requestId:randomUUID(),expectedHead:approval.head})).status,'RESOLVED');
   closedCase=await old.readImpactCase('maker',{caseId:item.id,campus:'NORTH'});
  }
  await old.close();old=null;
  const before=await inspect(owned.receipt),tables=predecessorTables(before.tables),added=prefix===121?{'vnext_control.actor':['principal_kind'],'department_master.evolution_event':['compensates_event_id']}:{'department_master.evolution_event':['compensates_event_id']},digest=predecessorDigest(owned.receipt,tables,added);
  added['department_master.evolution_event']=['compensates_event_id'];const after=await migrate(owned.receipt);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables,added),digest);
  grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.department_impact_record(text,text) TO ${session.receipt.role}`);current=openOrganizationEvolutions(session.connectionString,provider);
  assert.deepEqual(await current.applyUnit('maker',accepted.command),outcome);assert.deepEqual(await current.query('maker',eventQuery),event);
  if(closedCase)assert.deepEqual(await current.readImpactCase('maker',{caseId:closedCase.item.id,campus:'NORTH'}),closedCase);
  await assert.rejects(current.applyUnit('maker',pending.command),/IMPACT_ASSESSMENT_REQUIRED|STALE_VALIDATION/);assert.equal(await current.resumeOutcome('maker',pending.command),null);
  const assessment=await current.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST explicit later observation',target:{kind:'EVENT',id:eventId,campus:'NORTH'}});
  const cases=await current.listImpactCases('maker',{eventId,campus:'NORTH'});assert.ok(cases.items.length);assert.ok(cases.items.every(c=>c.observationBasis===(prefix===121?'LATER_OBSERVATION':'FROZEN_APPROVAL')));assert.deepEqual(await current.query('maker',eventQuery),event);
  await assert.rejects(current.verify('reviewer',{requestId:randomUUID(),inputId:pending.staged.inputId,inputDigest:pending.staged.digest,reason:'TEST incomplete historical declaration',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews}),/CLOSED_INPUT_REQUIRED/);
  const fresh=await f.input();fresh.predecessors=pending.input.predecessors;fresh.relations=pending.input.relations;fresh.event=pending.input.event;
  const restaged=await current.stage('maker',fresh);
  await current.verify('reviewer',{requestId:randomUUID(),inputId:restaged.inputId,inputDigest:restaged.digest,reason:'TEST fresh nine-domain independent assessment',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  const requestId=randomUUID(),candidate=await current.plan('maker',{inputId:restaged.inputId,requestId});await current.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await current.approveApplyUnit('reviewer',candidate);assert.equal((await current.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status,'COMMITTED');
  const result={status:'P2_06_PREDECESSOR_UPGRADE_PASSED',baseline,sourceDigest,sourceFiles:names,prefix,current:after.ledger.length,priorRowsAndKeysPreserved:true,committedReplay:true,closedCasePreserved:prefix===124,oldPendingBlocked:true,newApprovalCommitted:true,laterAssessmentId:assessment.assessmentId};
  writeFileSync(`.runtime/vnext/p2-06/upgrade-${prefix}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){session??=error.ownerSession;throw error;}finally{await old?.close();await current?.close();await catalog?.close();dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
}
