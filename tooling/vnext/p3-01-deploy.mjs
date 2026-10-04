import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {businessUnitFixture} from './p3-01-fixture.ts';
import {startWorkbench} from './workbench-runtime.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {createBusinessUnitClient} from '../../packages/generated-api-client/src/index.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-01'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8')),catalog=await openCatalog(connection,provider);let f,server;
try{
 f=await businessUnitFixture(receipt,service.role,catalog,provider,connection,true);
 const departmentId=await f.newDepartment(),binding=await f.endpoint(departmentId),input=await f.input([f.entry(binding)]);
 server=await startWorkbench({persistent:true,port:0});
 const maker=createBusinessUnitClient(server.url,'maker'),reviewer=createBusinessUnitClient(server.url,'reviewer'),staged=await maker.stage(input);assert.equal(staged.response.status,200);assert.ok(staged.data);
 assert.equal((await reviewer.verify(f.verification(input,staged.data))).response.status,200);
 const requestId=randomUUID(),planned=await maker.plan({inputId:staged.data.inputId,requestId});assert.equal(planned.response.status,200);assert.ok(planned.data);
 assert.equal((await reviewer.review({candidateId:planned.data.candidateId})).response.status,200);assert.equal((await reviewer.approve(planned.data)).response.status,200);
 const request={candidateId:planned.data.candidateId,requestId},applied=await maker.apply(request);assert.equal(applied.response.status,200);assert.equal(applied.data?.status,'COMMITTED');assert.deepEqual((await maker.apply(request)).data,applied.data);assert.equal((await maker.reconcile(request)).data?.status,'MATCHED');
 const unitId=applied.data.facts[0].id;assert.equal((await maker.query({id:unitId,businessAt:'2026-04-01T00:00:00'})).data?.clinicalReadiness,'NOT_READY');assert.equal((await maker.exact({id:unitId,version:'1'})).response.status,200);assert.equal((await createBusinessUnitClient(server.url,'outsider').query({id:unitId})).response.status,403);
 await deployment.complete();
 const result={status:'PASS',gate:'P3_01_PERSISTENT_GENERATED_HTTP',databaseOid:receipt.oid,unitId,departmentId,actualWorkbenchStartup:true,independentVerification:true,independentApproval:true,atomicApply:true,exactReplay:true,reconciliation:'MATCHED',unauthorizedDenied:true,candidateId:planned.data.candidateId,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',browser:'NOT_RUN',formalAcceptance:'NOT_RUN'};
 writeFileSync(evidence+'.http.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({status:'PASS',gate:result.gate,evidence:evidence+'.http.json'}));
}finally{await server?.close();await f?.close();await catalog.close();}
