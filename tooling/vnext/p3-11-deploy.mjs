import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {readReceipt,inspect,checkPrefix,migrationFiles} from './lineage.mjs';
import {captureP311Preservation,assertP311Preserved} from './p3-11-preservation.mjs';
import {provisionCareLifecycle,assertCareLifecycleProvisioned} from './p3-11-provisioning.mjs';
import {startWorkbench} from './workbench-runtime.mjs';
import {locationUseFixture} from './p3-07-fixture.ts';
import {createCareLocationLifecycleClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const retained=readReceipt();assert.equal(retained.name,'hdi_mc_vnext_a7049c9e5c2a4364');assert.equal(retained.oid,'206108');assert.equal(retained.lineage,'HDIP-MC-VNEXT');
const preflight=await inspect(retained);assert.ok(checkPrefix(migrationFiles(),preflight.ledger)>=205,'P3_07_CURRENT_DEPLOYMENT_REQUIRED');
const keyPath='.runtime/vnext/p1-01/keys.secret.json',before=captureP311Preservation(retained,preflight,keyPath),deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-11'}),{receipt,connection,provider,evidence}=deployment;
writeFileSync(evidence+'.p3-11-before.json',JSON.stringify(before,null,2),{flag:'wx'});
assertP311Preserved(before,captureP311Preservation(receipt,await inspect(receipt),keyPath),{exactRows:true});
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));let server,fixture;
const ok=result=>{assert.equal(result.response.status,200,result.error?.code);assert.ok(result.data);return result.data;};
try{
 provisionCareLifecycle(receipt,service.role);await assertCareLifecycleProvisioned(connection);
 server=await startWorkbench({persistent:true,port:0});fixture=await locationUseFixture(receipt,service.role,server.catalog,provider,connection,true);
 const maker=createCareLocationLifecycleClient(server.url,'maker'),reviewer=createCareLocationLifecycleClient(server.url,'reviewer'),units=fixture.base,entry=units.entry(await units.endpoint(await units.newDepartment()));assert.equal(entry.action,'CREATE');
 const created=await units.apply(await units.input([entry])),id=created.facts[0].id,{binding:_binding,...accepted}=entry,receipts=[];
 for(const [action,head,at] of [['SUSPEND','1','2027-01-01T00:00:00.000001'],['RESUME','2','2027-02-01T00:00:00.000001']]){
  const native=await units.input([{...accepted,action,target:{owner:'care-organization/unit',id,expectedHead:head},row:{...entry.row,record_status:action==='SUSPEND'?'SUSPENDED':'ACTIVE',valid_from:at}}]),member=await units.owner.stage('maker',native);await units.owner.verify('reviewer',units.verification(native,member));
  const root=ok(await maker.stage({requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:action==='SUSPEND'?'CLOSE':'RESUME',cutover:at,reason:'TEST retained P3-11 explicit same-identity lifecycle',members:[{owner:'UNIT',...member,contractVersionId:units.contract.versionId}]}));
  ok(await reviewer.verify({requestId:randomUUID(),inputId:root.inputId,inputDigest:root.digest,reason:'TEST retained current dependency and identity check',policy:'TEST_POLICY_ONLY'}));const requestId=randomUUID(),candidate=ok(await maker.plan({inputId:root.inputId,requestId}));ok(await reviewer.review({candidateId:candidate.candidateId}));ok(await reviewer.approve(candidate));const request={candidateId:candidate.candidateId,requestId},outcome=ok(await maker.apply(request));assert.equal(outcome.status,'COMMITTED');assert.equal(outcome.facts[0].id,id);assert.equal(ok(await maker.reconcile(request)).status,'MATCHED');receipts.push({inputId:root.inputId,candidateId:candidate.candidateId,requestId,recordedAt:outcome.recordedAt,id});
 }
 assert.equal((await units.owner.read('maker',{id,businessAt:'2027-01-15T00:00:00'})).state,'SUSPENDED');assert.equal((await units.owner.read('maker',{id,businessAt:'2027-02-01T00:00:00.000001'})).state,'ACTIVE');
 const final=await inspect(receipt),preservation=assertP311Preserved(before,captureP311Preservation(receipt,final,keyPath));assert.equal(final.identity.oid,'206108');assert.equal(checkPrefix(migrationFiles(),final.ledger),migrationFiles().length);await deployment.complete();
 const report={gate:'P3_11_PERSISTENT_GENERATED_HTTP',status:'PASS',previousPrefix:preflight.ledger.length,currentPrefix:final.ledger.length,oid:receipt.oid,preservation,receipts,policy:'TEST_POLICY_ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',personnelAndBeds:'NOT_EVALUABLE',browser:'NOT_RUN',restart:'NOT_RUN',capacity:'NOT_RUN',formalAcceptance:'NOT_RUN'};writeFileSync(evidence+'.p3-11-http.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({gate:report.gate,status:'PASS',evidence:evidence+'.p3-11-http.json'}));
}finally{await fixture?.close();await server?.close();}
