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

const BASELINE='1ce02731828e88a7a29c1b77b37cebe80099e86e';
export async function validateLifecycleUpgrade(){
 const names=['index.ts','organization-evolution.ts','organization-evolution-contracts.ts','department-impact.ts','department-impact-cases.ts','department-impact-contracts.ts'];
 const original='apps/governance-api/src/modules/department-master/vnext',directory=resolve('.runtime/vnext/p2-08/predecessor-133');mkdirSync(directory,{recursive:true});
 const sources=new Map(names.map(name=>[resolve(original,name),execFileSync('git',['show',BASELINE+':'+original+'/'+name],{encoding:'utf8',windowsHide:true})]));
 const frozen=new Map(names.map(name=>[resolve(original,name),resolve(directory,name.replace(/\.ts$/,'.mts'))]));
 for(const [file,source] of sources)writeFileSync(frozen.get(file),source.replace(/from '([.][^']+)'/g,(_all,specifier)=>"from '"+pathToFileURL(frozen.get(resolve(dirname(file),specifier.replace(/\.js$/,'.ts')))??resolve(dirname(file),specifier.replace(/\.js$/,'.ts'))).href+"'"));
 const {openDepartment:openPredecessorDepartment}=await import(pathToFileURL(frozen.get(resolve(original,'index.ts'))).href);
 const {openOrganizationEvolutions:openPredecessor}=await import(pathToFileURL(frozen.get(resolve(original,'organization-evolution.ts'))).href);
 const owned=createTemporary('P2-08'),provider=new LocalSyntheticKeyProvider();let session,catalog,old,current;
 try{
  await migrate(owned.receipt,migrationFiles().slice(0,133));await seed(owned.receipt);session=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,session.receipt.role);grantOrganization(owned.receipt,session.receipt.role);
  catalog=await openCatalog(session.connectionString,provider);
  const base=await organizationMappingFixture(owned.receipt,catalog,provider,session.connectionString,openPredecessorDepartment),f=await evolutionFixture(owned.receipt,catalog,provider,session.connectionString,base);old=openPredecessor(session.connectionString,provider);
  const input=await f.input(),staged=await old.stage('maker',input);await old.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST predecessor accepted evidence',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  const requestId=randomUUID(),candidate=await old.plan('maker',{inputId:staged.inputId,requestId});await old.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await old.approveApplyUnit('reviewer',candidate);
  const request={candidateId:candidate.candidateId,requestId},outcome=await old.applyUnit('maker',request);assert.equal(outcome.status,'COMMITTED');
  const eventId=outcome.facts[0].id,query={id:eventId,campus:'NORTH',businessAt:input.event.effective_at},event=await old.query('maker',query),cases=await old.listImpactCases('maker',{eventId,campus:'NORTH'});assert.ok(cases.total>0);
  const pendingInput=await f.input(),pendingId=await f.newDepartment();f.grantTarget(pendingId);pendingInput.predecessors=[{owner:'department-master',id:pendingId,expectedVersion:'1'}];pendingInput.relations[0].from_target_id=pendingId;pendingInput.relations[0].to_target_id=pendingId;
  const pending=await old.stage('maker',pendingInput);await old.verify('reviewer',{requestId:randomUUID(),inputId:pending.inputId,inputDigest:pending.digest,reason:'TEST predecessor pending approval',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});const pendingRequestId=randomUUID(),pendingCandidate=await old.plan('maker',{inputId:pending.inputId,requestId:pendingRequestId});await old.readApplyCandidate('reviewer',{candidateId:pendingCandidate.candidateId});await old.approveApplyUnit('reviewer',pendingCandidate);
  await old.close();old=null;
  const before=await inspect(owned.receipt),tables=predecessorTables(before.tables),added={'department_master.evolution_event':['compensates_event_id']},digest=predecessorDigest(owned.receipt,tables,added);
  const after=await migrate(owned.receipt);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,133),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables,added),digest);
  grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  current=openOrganizationEvolutions(session.connectionString,provider);assert.deepEqual(await current.applyUnit('maker',request),outcome);assert.deepEqual(await current.query('maker',query),event);assert.deepEqual(await current.listImpactCases('maker',{eventId,campus:'NORTH'}),cases);
  const pendingRequest={candidateId:pendingCandidate.candidateId,requestId:pendingRequestId};await assert.rejects(current.applyUnit('maker',pendingRequest),/STALE_VALIDATION/);assert.equal(await current.resumeOutcome('maker',pendingRequest),null);
  const evidence={status:'P2_08_UPGRADE_PASSED',baseline:BASELINE,prefix:133,current:after.ledger.length,sourceFiles:names,sourceDigest:createHash('sha256').update(JSON.stringify([...sources])).digest('hex'),rowsAndKeysPreserved:true,originalLedgerPreserved:true,committedReplay:true,originalEventAndCasesPreserved:true,pendingApprovalRejectedAsStale:true};
  writeFileSync('.runtime/vnext/p2-08/upgrade.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }catch(error){session??=error.ownerSession;throw error;}finally{await old?.close();await current?.close();await catalog?.close();dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
}
