import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {ORGANIZATION_EVOLUTION_FUNCTIONS,EVOLUTION_CATALOG_FUNCTIONS,assertOrganizationEvolutionsProvisioned} from './organization-evolution-provisioning.mjs';
import {DEPARTMENT_FUNCTIONS} from './department-provisioning.mjs';
import {openCatalog,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationEvolutions,openDepartment} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {persistentEvolutionFixture} from './p2-05-persistent-fixture.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createOrganizationEvolutionClient,createDepartmentClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-05',addedColumns:{'department_master.version':['evolution_event_id']}}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;GRANT EXECUTE ON FUNCTION ${[...new Set([...DEPARTMENT_FUNCTIONS,...ORGANIZATION_EVOLUTION_FUNCTIONS])].map(name=>'department_master.'+name).join(',')},${EVOLUTION_CATALOG_FUNCTIONS.map(name=>'governance_catalog.'+name).join(',')} TO ${service.role};COMMIT;`);
peer(receipt.name,identitySQL(receipt)+` DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.department_write_authority WHERE key_hex=${quote(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}))}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH';END IF;END $$;`,{sensitive:true});
mkdirSync('.runtime/vnext/p2-05/http-requests',{recursive:true});
function saved(name,value){
 const path='.runtime/vnext/p2-05/http-requests/'+name+'.json';
 try{const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);return prior.value;}catch(error){if(error.code!=='ENOENT')throw error;}
 writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,value}),{flag:'wx'});return value;
}
const requestId=name=>saved(name+'.requestId',randomUUID()),freeze=(name,value)=>saved(name+'.command',value);
const catalog=await openCatalog(connection,provider),owner=openOrganizationEvolutions(connection,provider),department=openDepartment(connection,provider);let app;
try{
 const statePath='.runtime/vnext/p2-05/http-state.json';let state;
 try{state=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(state.databaseOid,receipt.oid);assert.equal(state.databaseRequestId,receipt.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
 let fixture;
 if(!state)fixture=await persistentEvolutionFixture(receipt,catalog,provider,connection,requestId,freeze);
 const binding=state?.binding??{database:receipt.name,databaseOid:receipt.oid,serviceRole:service.role,serviceRoleOid:service.roleOid,campus:'NORTH',sourceId:fixture.sourceId};
 const provisionPath='.runtime/vnext/p2-05/provisioning.json';try{assert.deepEqual(JSON.parse(readFileSync(provisionPath,'utf8')),binding);}catch(error){if(error.code!=='ENOENT')throw error;writeFileSync(provisionPath,JSON.stringify(binding,null,2),{flag:'wx'});}
 await assertOrganizationEvolutionsProvisioned(connection,provider,binding);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner:department,actor:r=>actor(r.headers)},undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),maker=createOrganizationEvolutionClient(url,'maker'),reviewer=createOrganizationEvolutionClient(url,'reviewer');
 if(!state){
  const staged=await maker.stage(fixture.input);assert.equal(staged.response.status,200);
  const verification=await reviewer.verify(freeze('evolution-verify',{requestId:requestId('evolution-verify'),inputId:staged.data.inputId,inputDigest:staged.data.digest,reason:'TEST POLICY ONLY independent external Owner signatures and destination material',policyApproved:true,materialsAccepted:true,impactReviews:fixture.impactReviews}));assert.equal(verification.response.status,200);
  const validated=await maker.validate({inputId:staged.data.inputId});assert.equal(validated.response.status,200);assert.equal(validated.data.decision,'PASS');
  const request=requestId('evolution-apply'),candidate=await maker.plan({inputId:staged.data.inputId,requestId:request});assert.equal(candidate.response.status,200);
  const original=await department.history('maker',fixture.predecessorId);
  state={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,binding,requestId:request,candidate:candidate.data,predecessorId:fixture.predecessorId,original,input:fixture.input};writeFileSync(statePath,JSON.stringify(state,null,2),{flag:'wx'});
 }
 const command={candidateId:state.candidate.candidateId,requestId:state.requestId},resumed=await maker.resume(command);assert.equal(resumed.response.status,200);
 if(!resumed.data){const review=await reviewer.review({candidateId:state.candidate.candidateId});assert.equal(review.response.status,200);assert.equal(review.data.inputCoverage,'COMPLETE');assert.equal(review.data.commandFacts.length,1);assert.equal((await reviewer.approve(state.candidate)).response.status,200);}
 const applied=await maker.apply(command);assert.equal(applied.response.status,200);assert.equal(applied.data.status,'COMMITTED');const replay=await maker.apply(command);assert.equal(replay.response.status,200);assert.deepEqual(replay.data,applied.data);
 const eventId=applied.data.facts[0].id,query={id:eventId,campus:'NORTH',businessAt:state.input.event.effective_at},event=await maker.query(query);assert.equal(event.response.status,200);assert.equal(event.data.successors.length,2);assert.equal(event.data.edges.length,2);assert.equal(event.data.handoff,'NOT_EXECUTED');assert.deepEqual(event.data.aliasMap.filter(item=>item.dataset==='ORG04').map(item=>item.sourceClientKey),state.input.successors.map(item=>item.row.org_id));
 const ids=[state.predecessorId,...event.data.successors.map(item=>item.id)];
 // Explicit synthetic read grants are separate administration; the Owner
 // never inherits predecessor permissions for newly created identities.
 peer(receipt.name,identitySQL(receipt)+` INSERT INTO department_master.mapping_target_access SELECT a,'ORG',id::uuid,'NORTH' FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY[${ids.map(quote).join(',')}]) id ON CONFLICT DO NOTHING;`);
 const departmentClient=createDepartmentClient(url,'maker'),beforeT=await departmentClient.read({id:state.predecessorId,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'}),atT=await departmentClient.read({id:state.predecessorId,campus:'NORTH',businessAt:state.input.event.effective_at});assert.equal(beforeT.response.status,200);assert.equal(beforeT.data.businessState,'ACTIVE');assert.equal(atT.response.status,200);assert.equal(atT.data.businessState,'SUPERSEDED');assert.equal(atT.data.version,null);
 const oldR=state.original.versions[0].recorded_at.replace(' ','T'),old=await departmentClient.read({id:state.predecessorId,campus:'NORTH',businessAt:state.input.event.effective_at,recordAsOf:oldR});assert.equal(old.response.status,200);assert.equal(old.data.businessState,'ACTIVE');assert.deepEqual((await department.history('maker',state.predecessorId)).versions,state.original.versions);
 for(const successor of event.data.successors){assert.equal((await department.exact('maker',{id:successor.id,version:'1'})).recordedAt,event.data.recordedAt);assert.equal((await departmentClient.read({id:successor.id,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'})).data.businessState,'NOT_EFFECTIVE');}
 const graph=await maker.graph(query),history=await maker.history({...query,id:state.predecessorId});assert.equal(graph.response.status,200);assert.equal(graph.data.edges.length,2);assert.equal(history.response.status,200);assert.deepEqual(history.data.events.map(item=>item.id),[eventId]);assert.equal((await createOrganizationEvolutionClient(url,'outsider').query(query)).response.status,403);
 const job=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:state.input.jobId});
 const template=await maker.template({campus:'NORTH',contractId:job.contract.id,contractVersionId:job.contract.versionId,contracts:state.input.contracts});assert.equal(template.response.status,200);assert.equal(template.data.parserPolicy,'STRICT_ORGANIZATION_EVOLUTION_V1');
 writeFileSync(evidence+'.http.json',JSON.stringify({status:'PASS',databaseOid:receipt.oid,eventId,candidateId:state.candidate.candidateId,successorIds:event.data.successors.map(item=>item.id),scope:'SYNTHETIC_CORE',actualLoopbackHttp:true,replay:true,oldBusinessAndRecordTimePreserved:true,handoff:'NOT_EXECUTED',sourcePolicyApproval:'PENDING',browserAcceptance:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
 await deployment.complete();console.log(JSON.stringify({status:'P2_05_PERSISTENT_HTTP_PASSED',evidence:evidence+'.http.json'}));
}finally{await app?.close();await owner.close();await department.close();await catalog.close();}
