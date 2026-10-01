import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {randomUUID} from 'node:crypto';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openDepartment,openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {organizationMappingFixture} from './p2-03-fixture.ts';
import {evolutionFixture} from './p2-05-fixture.ts';

async function validatePredecessorUpgrade(){
 const owned=createTemporary('P2-05'),provider=new LocalSyntheticKeyProvider();let session,catalog,department,evolution;
 try{
  await migrate(owned.receipt,migrationFiles().slice(0,117));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,session.receipt.role);grantOrganization(owned.receipt,session.receipt.role);
  catalog=await openCatalog(session.connectionString,provider);const base=await organizationMappingFixture(owned.receipt,catalog,provider,session.connectionString);department=openDepartment(session.connectionString,provider);
  const prior=await department.history('maker',base.targetId),oldR=prior.versions[0].recorded_at.replace(' ','T');
  const before=await inspect(owned.receipt),tables=predecessorTables(before.tables),digest=predecessorDigest(owned.receipt,tables);
  const after=await migrate(owned.receipt);assert.deepEqual(after.ledger.slice(0,117),before.ledger);assert.equal(after.identity.oid,before.identity.oid);assert.equal(predecessorDigest(owned.receipt,tables,{'department_master.version':['evolution_event_id']}),digest);
  grantDepartment(owned.receipt,session.receipt.role);const f=await evolutionFixture(owned.receipt,catalog,provider,session.connectionString,base);evolution=openOrganizationEvolutions(session.connectionString,provider);
  const input=await f.input(),staged=await evolution.stage('maker',input);
  await evolution.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST POLICY ONLY independent predecessor upgrade evidence',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
  assert.equal((await evolution.validate('maker',{inputId:staged.inputId})).decision,'PASS');const requestId=randomUUID(),candidate=await evolution.plan('maker',{inputId:staged.inputId,requestId});await evolution.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await evolution.approveApplyUnit('reviewer',candidate);
  assert.equal((await evolution.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status,'COMMITTED');
  assert.equal((await department.read('maker',{id:base.targetId,campus:'NORTH',businessAt:input.event.effective_at,recordAsOf:oldR})).version.facts.name,prior.versions[0].facts.name);
  assert.equal((await department.read('maker',{id:base.targetId,campus:'NORTH',businessAt:input.event.effective_at})).version.facts.name,input.rename.name);
  assert.deepEqual((await department.history('maker',base.targetId)).versions[0].facts,prior.versions[0].facts);
  console.log(JSON.stringify({status:'PREDECESSOR_OWNER_UPGRADE_PASSED',prefix:117,current:after.ledger.length,oldOwnerFactAndKnowledgePreserved:true,renameApplied:true}));
 }catch(error){session??=error.ownerSession;throw error;}
 finally{await evolution?.close();await department?.close();await catalog?.close();dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
}

if(process.argv[1]?.replaceAll('\\','/').endsWith('/p2-05-validate.mjs')){
 const args=process.argv.slice(2);if(args.some(a=>!['--generate','--upgrade'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
 if(args.includes('--upgrade'))await validatePredecessorUpgrade();
 const owned=createTemporary('P2-05');let owner;
 try{
  await migrate(owned.receipt);await seed(owned.receipt);
  owner=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,owner.receipt.role);grantOrganization(owned.receipt,owner.receipt.role);
  if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
  assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p2-05-db.config.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P2-05'},stdio:'inherit',windowsHide:true});
  process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P2-05',exit:run.status,mode:args.includes('--upgrade')?'FRESH_SUITE_AFTER_117_UPGRADE_VERIFICATION':'FRESH'}));
 }catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
