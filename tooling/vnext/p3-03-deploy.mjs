import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {nursingFixture} from './p3-03-fixture.ts';
import {startWorkbench} from './workbench-runtime.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {createNursingUnitClient} from '../../packages/generated-api-client/src/index.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-03'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8')),catalog=await openCatalog(connection,provider);let f,server;
try{
 console.log(JSON.stringify({gate:'P3_03_EXISTING_CONTRACTS',contracts:(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).filter(c=>c.dataset==='ORG09').map(c=>({profile:c.profile,status:c.status,template:c.definition.templateVersion,fields:c.definition.fields.length}))}));
 f=await nursingFixture(receipt,service.role,catalog,provider,connection,true);const binding=await f.endpoint(),input=await f.input([f.entry(binding)]);
 server=await startWorkbench({persistent:true,port:0});const maker=createNursingUnitClient(server.url,'maker'),reviewer=createNursingUnitClient(server.url,'reviewer'),i=await maker.stage(input);assert.equal(i.response.status,200);assert.ok(i.data);
 assert.equal((await reviewer.verify(f.verification(input,i.data))).response.status,200);const requestId=randomUUID(),c=await maker.plan({inputId:i.data.inputId,requestId});assert.equal(c.response.status,200,c.error?.code);assert.ok(c.data);
 assert.equal((await reviewer.review({candidateId:c.data.candidateId})).response.status,200);assert.equal((await reviewer.approve(c.data)).response.status,200);const request={candidateId:c.data.candidateId,requestId},o=await maker.apply(request);assert.equal(o.response.status,200);assert.equal(o.data?.status,'COMMITTED');assert.deepEqual((await maker.apply(request)).data,o.data);assert.equal((await maker.reconcile(request)).data?.status,'MATCHED');
 assert.equal((await maker.query({id:o.data.facts[0].id,businessAt:'2026-04-01T00:00:00'})).data?.clinicalReadiness,'NOT_READY');assert.equal((await createNursingUnitClient(server.url,'outsider').query({id:o.data.facts[0].id})).response.status,403);
 await deployment.complete();writeFileSync(evidence+'.http.json',JSON.stringify({gate:'P3_03_PERSISTENT_GENERATED_HTTP',status:'PASS',databaseOid:receipt.oid,candidateId:c.data.candidateId,requestId,nursingId:o.data.facts[0].id,actualWorkbenchStartup:true,exactReplay:true,reconciliation:'MATCHED',currentAuthorization:true,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',coverageAcceptance:'NOT_RUN_PENDING_P3_05',browser:'NOT_RUN',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({gate:'P3_03_PERSISTENT_GENERATED_HTTP',status:'PASS',evidence:evidence+'.http.json'}));
}finally{await server?.close();await f?.close();await catalog.close();}
