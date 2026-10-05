import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {provisionSubjects,assertSubjectsProvisioned} from './p3-09-provisioning.mjs';
import {startWorkbench} from './workbench-runtime.mjs';
import {createSubjectPermissionClient,createSubjectCodeClient} from '../../packages/generated-api-client/src/index.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-09'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));let server;
try{
 provisionSubjects(receipt,service.role,provider);await assertSubjectsProvisioned(connection,provider);
 server=await startWorkbench({persistent:true,port:0});
 // No new persistent synthetic institution or policy is necessary to expose the Owner.
 const missing='00000000-0000-7000-8000-000000000009';
 const codes=await createSubjectCodeClient(server.url,'outsider').read({id:missing}),permissions=await createSubjectPermissionClient(server.url,'outsider').query({id:missing});
 assert.equal(codes.response.status,403);assert.ok([403,404].includes(permissions.response.status));assert.notEqual(permissions.response.status,503);
 await deployment.complete();writeFileSync(evidence+'.http.json',JSON.stringify({gate:'P3_09_PERSISTENT_HTTP',status:'PASS',oid:receipt.oid,actualWorkbenchStartup:true,readiness:'PROVISIONED',currentUnauthorizedCodeRead:codes.response.status,currentMissingPermissionRead:permissions.response.status,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',clinicalReadiness:'NOT_READY',browser:'NOT_RUN',fullRestart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
 console.log(JSON.stringify({gate:'P3_09_PERSISTENT_HTTP',status:'PASS',evidence:evidence+'.http.json'}));
}finally{await server?.close();}
