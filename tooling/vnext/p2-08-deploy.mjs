import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {DEPARTMENT_LIFECYCLE_FUNCTIONS,assertDepartmentLifecycleProvisioned} from './department-lifecycle-provisioning.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openDepartment,openDepartmentLifecycle,EVOLUTION_IMPACT_DOMAINS} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createDepartmentLifecycleClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-08',addedColumns:{'department_master.evolution_event':['compensates_event_id']}}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;GRANT EXECUTE ON FUNCTION ${DEPARTMENT_LIFECYCLE_FUNCTIONS.join(',')} TO ${service.role};COMMIT;`);
await assertDepartmentLifecycleProvisioned(connection);
const directory='.runtime/vnext/p2-08/http-requests';mkdirSync(directory,{recursive:true});
function saved(name,value){const path=directory+'/'+name+'.json';if(existsSync(path)){const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);return prior.value;}writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,value}),{flag:'wx'});return value;}
const catalog=await openCatalog(connection,provider),department=openDepartment(connection,provider),owner=openDepartmentLifecycle(connection,provider);let app;
try{
 const statePath='.runtime/vnext/p2-08/http-state.json';let state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):null;
 if(state){assert.equal(state.databaseOid,receipt.oid);assert.equal(state.databaseRequestId,receipt.requestId);}
 else{
  const contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG04'&&c.profile==='CORE'&&c.status==='PUBLISHED');if(!contract)throw new Error('BLOCKED_DEPENDENCY');
  const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.versionId===contract.definition.sourceVersionId);if(!source)throw new Error('BLOCKED_DEPENDENCY');
  const job=await catalog.importJobCommand('maker',saved('department-job',{action:'CREATE',scope:'SYNTHETIC',reason:'TEST_LIFECYCLE',requestId:randomUUID(),profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},contractId:contract.id,contractVersionId:contract.versionId}));
  const artifact=await catalog.storeProtectedArtifact('maker',saved('department-material',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200}),Buffer.from('TEST POLICY ONLY P2-08 lifecycle cohort'));
  const raw=saved('department-input',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{intent:'CREATE',target:null,origin:'NEW',evidenceId:artifact.artifactId,row:{org_id:randomUUID(),org_code:'TEST_P208_'+randomUUID(),org_name:'TEST P2-08 科室',org_short_name:'',org_type:'CLINICAL',established_on:'2026-01-01',abolished_on:'',establishment_doc:'TEST_DOC',description:'TEST POLICY ONLY',is_virtual:'N',version_no:'1',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:source.id,source_record_id:'TEST_P208/ORG04/2',approval_ref:'TEST_APPROVAL',recorded_at:'2026-01-02T00:00:00'}}]}),input=await department.stage('maker',raw);await department.verify('reviewer',saved('department-review',{requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST POLICY ONLY P2-08 HTTP cohort',evidenceId:artifact.artifactId}]}));
  const requestId=saved('department-apply',randomUUID()),candidate=await department.plan('maker',{inputId:input.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);const committed=await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId});assert.equal(committed.status,'COMMITTED');
  const id=committed.facts[0].id;
  state={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,id,evidenceId:artifact.artifactId,contractId:contract.id,contractVersionId:contract.versionId};writeFileSync(statePath,JSON.stringify(state),{flag:'wx'});
 }
 // The new synthetic cohort gets the same explicit per-target read authority
 // used by the existing source-reference and identifier impact Owners.
 peer(receipt.name,identitySQL(receipt)+` INSERT INTO department_master.mapping_target_access SELECT a,'ORG',${quote(state.id)}::uuid,'NORTH' FROM unnest(ARRAY['maker','reviewer']) a ON CONFLICT DO NOTHING;`);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),maker=createDepartmentLifecycleClient(url,'maker'),reviewer=createDepartmentLifecycleClient(url,'reviewer');
 const checked=async value=>{assert.equal(value.response.status,200,JSON.stringify(value.error));return value.data;};
 async function apply(name,action,head,effectiveAt){
  const path=directory+'/'+name+'-accepted.json';let candidate,requestId;
  if(existsSync(path)){const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);({candidate,requestId}=prior);}
  else{
   const job=await catalog.importJobCommand('maker',saved(name+'-job',{action:'CREATE',scope:'SYNTHETIC',reason:'TEST_LIFECYCLE',requestId:randomUUID(),profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},contractId:state.contractId,contractVersionId:state.contractVersionId}));
   const input=await checked(await maker.stage(saved(name+'-input',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',commands:[{action,department:{owner:'department-master',id:state.id,expectedVersion:'1',expectedLifecycleHead:head},effectiveAt,reason:'TEST POLICY ONLY persistent HTTP lifecycle',evidenceId:state.evidenceId}],impacts:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,determination:domain==='IDENTIFIER'?'AFFECTED':'UNAFFECTED',ownerRole:'TEST_ONLY_'+domain,ownerSignatory:'TEST_ONLY_'+domain+'_OWNER',ownerDecisionRef:'TEST_ONLY_'+domain+'_DECISION',requiredAction:'TEST explicit disposition pending',reason:'TEST POLICY ONLY',evidenceId:state.evidenceId}))})));
   await checked(await reviewer.verify(saved(name+'-verify',{requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,reason:'TEST POLICY ONLY independent review',policyApproved:true,materialsAccepted:true,impactReviews:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,ownerAttestationAccepted:true,dispositionAccepted:true,reason:'TEST independent review'}))})));
   requestId=saved(name+'-apply',randomUUID());candidate=await checked(await maker.plan({inputId:input.inputId,requestId}));await checked(await reviewer.review({candidateId:candidate.candidateId}));await checked(await reviewer.approve(candidate));writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,candidate,requestId}),{flag:'wx'});
  }
  const command={candidateId:candidate.candidateId,requestId},result=await checked(await maker.apply(command));assert.equal(result.status,'COMMITTED');const accepted=value=>{const {responseStatus:_,...facts}=value;return facts;};assert.deepEqual(accepted(await checked(await maker.apply(command))),accepted(result));assert.deepEqual(accepted(await checked(await maker.resume(command))),accepted(result));return result;
 }
 await apply('suspend','SUSPEND','0','2026-06-01T00:00:00');await apply('resume','RESUME','1','2026-07-01T00:00:00');
 assert.equal((await checked(await maker.admission({id:state.id,validFrom:'2026-06-01T00:00:00',validTo:'2026-07-01T00:00:00'}))).covered,false);
 assert.equal((await checked(await maker.admission({id:state.id,validFrom:'2026-07-01T00:00:00',validTo:null}))).covered,true);
 const history=await checked(await maker.history({id:state.id}));assert.equal(history.lifecycleHead,'2');assert.equal(history.head,'1');assert.equal((await createDepartmentLifecycleClient(url,'outsider').history({id:state.id})).response.status,403);
 await deployment.complete();writeFileSync(evidence+'.http.json',JSON.stringify({status:'P2_08_PERSISTENT_HTTP_PASSED',databaseOid:receipt.oid,departmentId:state.id,actualLoopbackHttp:true,generatedClient:true,replayAndRecovery:true,explicitSuspensionAndResume:true,applicationRoleVerified:true,hospitalPolicy:'NOT_ADOPTED',assignmentIntegration:'P4_PENDING',browserAcceptance:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({status:'P2_08_PERSISTENT_HTTP_PASSED',evidence:evidence+'.http.json'}));
}finally{await app?.close();await owner.close();await department.close();await catalog.close();}
