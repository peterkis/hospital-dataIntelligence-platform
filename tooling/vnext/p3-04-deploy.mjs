import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {provisionUnitWard,assertUnitWardProvisioned} from './p3-04-provisioning.mjs';
import {startWorkbench} from './workbench-runtime.mjs';
import {unitWardFixture} from './p3-04-fixture.ts';
import {createUnitWardClient} from '../../packages/generated-api-client/src/index.ts';

const args=process.argv.slice(2),priorFile=args[0]?.slice('--prior-http='.length);
if(args.length>1||(args.length&&(!args[0].startsWith('--prior-http=')||!/^\.runtime\/vnext\/p3-04\/deployment-[0-9]+\.http\.json$/.test(priorFile)||lstatSync(priorFile).isSymbolicLink())))throw new Error('CLOSED_COMMAND_REQUIRED');
const prior=priorFile?JSON.parse(readFileSync(priorFile,'utf8')):null;
if(prior&&(prior.gate!=='P3_04_PERSISTENT_HTTP'||prior.status!=='PASS'||prior.policy!=='TEST POLICY ONLY'||prior.clinicalReadiness!=='NOT_READY'))throw new Error('PRIOR_SYNTHETIC_P3_04_EVIDENCE_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-04'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));let server,fixture;
try{
 provisionUnitWard(receipt,service.role,provider);await assertUnitWardProvisioned(connection,provider);
 server=await startWorkbench({persistent:true,port:0});
 fixture=await unitWardFixture(receipt,service.role,server.catalog,provider,connection,true);
 const a=await fixture.endpoint(),b=await fixture.sameWard(a),rule=fixture.shared([a.unit.id,b.unit.id]),entries=[fixture.entry(a),fixture.entry(b)].map(e=>({...e,rule,row:{...e.row,relation_type:'共享',sharing_rule:'TEST POLICY ONLY reviewed shared Ward boundary'}}));
 const maker=createUnitWardClient(server.url,'maker'),reviewer=createUnitWardClient(server.url,'reviewer');
 const publish=async rows=>{
  const input=await fixture.input(rows),staged=await maker.stage(input);assert.equal(staged.response.status,200);assert.ok(staged.data);
  assert.equal((await reviewer.verify(fixture.verification(input,staged.data))).response.status,200);
  const preview=await maker.preview({inputId:staged.data.inputId});
  assert.equal(preview.response.status,200,preview.error?.code);assert.equal(preview.data?.decision,'PASS',preview.data?.issues.map(i=>i.code).join(','));
  const requestId=randomUUID(),planned=await maker.plan({inputId:staged.data.inputId,requestId});assert.equal(planned.response.status,200);assert.ok(planned.data);
  assert.equal((await reviewer.review({candidateId:planned.data.candidateId})).response.status,200);
  assert.equal((await reviewer.approve(planned.data)).response.status,200);
  const request={candidateId:planned.data.candidateId,requestId},applied=await maker.apply(request);assert.equal(applied.response.status,200);assert.equal(applied.data?.status,'COMMITTED');
  const {responseStatus,...committed}=applied.data;assert.equal(responseStatus,'DELIVERED');assert.deepEqual((await maker.resume(request)).data,committed);assert.equal((await maker.reconcile(request)).data?.status,'MATCHED');
  assert.deepEqual((await maker.apply(request)).data,applied.data);
  return applied.data;
 };
 let legacyEnd=null;
 if(prior){
  assert.equal(prior.oid,receipt.oid);assert.equal(prior.createdFacts[1].owner,'care-organization/unit-ward-relation');const id=prior.createdFacts[1].id,history=(await maker.history({id})).data;assert.ok(history);assert.ok(history.versions.length>0&&history.versions.slice(1).every(v=>v.action==='END'));const original=history.versions[0];assert.equal(original.action,'CREATE');assert.equal(original.facts.sharingRule,'TEST POLICY ONLY reviewed shared Ward boundary');assert.equal(original.facts.source.sourceVersion,'9');assert.equal(original.facts.rule.kind,'SHARED_BOUNDARY');assert.ok(!original.facts.rule.validFrom.includes('.'));
  const stored=(await maker.readInput({inputId:original.facts.source.recordLocatorEvidence.inputId})).data;assert.ok(stored);const entry=stored.entries.find(e=>e.row.unit_ward_rel_id===original.facts.source.sourceAlias);assert.ok(entry);
  const replay=await maker.stage(stored);assert.equal(replay.response.status,200);assert.equal(replay.data.inputId,original.facts.source.recordLocatorEvidence.inputId);
  const ended=await publish([{...entry,action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:history.versions.at(-1).number},endAt:entry.row.valid_from,row:{...entry.row,record_status:'RETIRED'}}]);
  assert.deepEqual((await maker.exact({id,version:'1'})).data,original);const after=(await maker.history({id})).data;assert.deepEqual(after.versions.slice(0,history.versions.length),history.versions);assert.deepEqual(after.versions.at(-1).facts.rule,original.facts.rule);
  legacyEnd={priorEvidence:priorFile,id,facts:ended.facts,oldInputReplay:true,oldVersionPreserved:true,originalRulePreserved:true};
 }
 const created=await publish(entries);assert.equal(created.facts.length,2);
 const id=created.facts[0].id,at='2026-02-01T00:00:00',historical=(await maker.query({id,businessAt:at,recordAsOf:created.recordedAt})).data;
 assert.equal(historical?.state,'ACTIVE');assert.equal((await maker.exact({id,version:'1'})).data?.number,'1');
 const ended=await publish([{...entries[0],action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'1'},endAt:'2026-03-01T00:00:00',row:{...entries[0].row,record_status:'RETIRED'}}]);
 assert.equal((await maker.query({id,businessAt:'2026-04-01T00:00:00'})).data?.state,'ENDED');
 assert.deepEqual((await maker.query({id,businessAt:at,recordAsOf:created.recordedAt})).data,historical);
 const shortened=await publish([{...entries[0],action:'END',target:{owner:'care-organization/unit-ward-relation',id,expectedHead:'2'},endAt:entries[0].row.valid_from,row:{...entries[0].row,record_status:'RETIRED'}}]);
 assert.equal((await maker.query({id,businessAt:entries[0].row.valid_from})).data?.state,'ENDED');
 assert.deepEqual((await maker.query({id,businessAt:at,recordAsOf:created.recordedAt})).data,historical);
 assert.equal((await maker.history({id})).data?.versions.length,3);
 assert.equal((await createUnitWardClient(server.url,'outsider').query({id})).response.status,403);
 await deployment.complete();
 writeFileSync(evidence+'.http.json',JSON.stringify({gate:'P3_04_PERSISTENT_HTTP',status:'PASS',oid:receipt.oid,legacyEnd,actualWorkbenchStartup:true,protectedInput:true,independentVerification:true,independentApproval:true,createdFacts:created.facts,endedFacts:ended.facts,shortenedFacts:shortened.facts,originalHistoryPreserved:true,exactReplay:true,reconciliation:'MATCHED',unauthorizedRead:403,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',clinicalReadiness:'NOT_READY',browser:'NOT_RUN',fullRestart:'NOT_RUN',capacity:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
 console.log(JSON.stringify({gate:'P3_04_PERSISTENT_HTTP',status:'PASS',evidence:evidence+'.http.json'}));
}finally{await fixture?.close();await server?.close();}
