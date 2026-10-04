import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {wardFixture} from './p3-02-fixture.ts';
import {startWorkbench} from './workbench-runtime.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {createWardClient} from '../../packages/generated-api-client/src/index.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-02'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8')),catalog=await openCatalog(connection,provider);let f,server;
try{
 f=await wardFixture(receipt,service.role,catalog,provider,connection,true);const binding=await f.endpoint(),input=await f.input([f.entry(binding)]);
 server=await startWorkbench({persistent:true,port:0});const maker=createWardClient(server.url,'maker'),reviewer=createWardClient(server.url,'reviewer'),i=await maker.stage(input);assert.equal(i.response.status,200);assert.ok(i.data);
 assert.equal((await reviewer.verify(f.verification(input,i.data))).response.status,200);const requestId=randomUUID(),candidate=await maker.plan({inputId:i.data.inputId,requestId});assert.equal(candidate.response.status,200,candidate.error?.code);assert.ok(candidate.data);
 assert.equal((await reviewer.review({candidateId:candidate.data.candidateId})).response.status,200);assert.equal((await reviewer.approve(candidate.data)).response.status,200);const request={candidateId:candidate.data.candidateId,requestId},outcome=await maker.apply(request);assert.equal(outcome.response.status,200);assert.equal(outcome.data?.status,'COMMITTED');assert.deepEqual((await maker.apply(request)).data,outcome.data);assert.equal((await maker.reconcile(request)).data?.status,'MATCHED');
 const {responseStatus:delivery,...durable}=outcome.data;assert.equal(delivery,'DELIVERED');assert.deepEqual((await maker.resume(request)).data,durable);
 assert.equal((await maker.query({id:outcome.data.facts[0].id,businessAt:'2026-04-01T00:00:00'})).data?.clinicalReadiness,'NOT_READY');assert.equal((await createWardClient(server.url,'outsider').query({id:outcome.data.facts[0].id})).response.status,403);
 await deployment.complete();writeFileSync(evidence+'.http.json',JSON.stringify({gate:'P3_02_PERSISTENT_GENERATED_HTTP',status:'PASS',databaseOid:receipt.oid,candidateId:candidate.data.candidateId,requestId,wardId:outcome.data.facts[0].id,actualWorkbenchStartup:true,exactReplay:true,exactResume:true,reconciliation:'MATCHED',currentAuthorization:true,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',sharedAdmission:'NOT_RUN_PENDING_P3_04',bedAcceptance:'NOT_RUN_PENDING_P7_05',browser:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({gate:'P3_02_PERSISTENT_GENERATED_HTTP',status:'PASS',evidence:evidence+'.http.json'}));
}finally{await server?.close();await f?.close();await catalog.close();}
