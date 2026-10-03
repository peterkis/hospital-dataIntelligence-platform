import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {DEPARTMENT_IMPACT_FUNCTIONS,assertDepartmentImpactsProvisioned} from './department-impact-provisioning.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createDepartmentImpactClient,createOrganizationEvolutionClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const prior=JSON.parse(readFileSync('.runtime/vnext/p2-05/http-state.json','utf8'));
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-06',addedColumns:{'vnext_control.actor':['principal_kind']}}),{receipt,connection,provider,evidence}=deployment;
assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
assert.match(service.role,/^hdi_owner_[a-f0-9]{16}$/);
peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;GRANT EXECUTE ON FUNCTION ${DEPARTMENT_IMPACT_FUNCTIONS.join(',')} TO ${service.role};COMMIT;`);
await assertDepartmentImpactsProvisioned(connection);
mkdirSync('.runtime/vnext/p2-06/http-requests',{recursive:true});
function saved(name,value){const path='.runtime/vnext/p2-06/http-requests/'+name+'.json';if(existsSync(path)){const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);return prior.value;}writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,value}),{flag:'wx'});return value;}
const catalog=await openCatalog(connection,provider),owner=openOrganizationEvolutions(connection,provider);let app;
try{
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),evolutions=createOrganizationEvolutionClient(url,'maker'),impacts=createDepartmentImpactClient(url,'maker');
 const command={candidateId:prior.candidate.candidateId,requestId:prior.requestId},replay=await evolutions.apply(command);assert.equal(replay.response.status,200);assert.equal(replay.data.status,'COMMITTED');
 const eventId=replay.data.facts[0].id,query={id:eventId,campus:'NORTH',businessAt:prior.input.event.effective_at},before=await evolutions.query(query);assert.equal(before.response.status,200);assert.equal(before.data.handoff,'NOT_EXECUTED');
 const assessmentCommand=saved('assessment',{requestId:randomUUID(),reason:'TEST POLICY ONLY explicit current observation of legacy event',target:{kind:'EVENT',id:eventId,campus:'NORTH'}});
 const assessed=await impacts.assess(assessmentCommand);assert.equal(assessed.response.status,200,JSON.stringify(assessed.error));assert.equal((await impacts.assessment({assessmentId:assessed.data.assessmentId,campus:'NORTH'})).response.status,200);
 const repeated=await impacts.assess(assessmentCommand);assert.deepEqual(repeated.data,assessed.data);
 const list=await impacts.cases({eventId,campus:'NORTH'});assert.equal(list.response.status,200);assert.ok(list.data.total>0);assert.ok(list.data.items.every(item=>item.observationBasis==='LATER_OBSERVATION'));
 const detail=await impacts.case({caseId:list.data.items[0].id,campus:'NORTH'});assert.equal(detail.response.status,200);
 assert.equal((await createDepartmentImpactClient(url,'outsider').cases({eventId,campus:'NORTH'})).response.status,403);
 assert.deepEqual((await evolutions.query(query)).data,before.data);assert.deepEqual((await evolutions.apply(command)).data,replay.data);
 writeFileSync(evidence+'.http.json',JSON.stringify({status:'PASS',databaseOid:receipt.oid,eventId,assessmentId:assessed.data.assessmentId,actualLoopbackHttp:true,generatedClient:true,committedLegacyReplay:true,originalEventUnchanged:true,laterObservation:true,caseCount:list.data.total,unresolved:list.data.unresolved,simulatedCompleted:list.data.simulatedCompleted,sourcePolicyApproval:'PENDING',realIntegration:'NOT_IMPLEMENTED',formalAcceptance:'NOT_RUN',browserAcceptance:'NOT_RUN',restart:'NOT_RUN'},null,2),{flag:'wx'});
 await deployment.complete();console.log(JSON.stringify({status:'P2_06_PERSISTENT_HTTP_PASSED',evidence:evidence+'.http.json'}));
}finally{await app?.close();await owner.close();await catalog.close();}
