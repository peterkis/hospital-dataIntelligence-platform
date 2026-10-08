import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocationUseClient,createLocationUsageTypeClient} from '../../packages/generated-api-client/src/index.js';
import {ORG13_FIELDS,type LocationUseStage,type LocationUseEntry} from '../../apps/governance-api/src/modules/location-master/index.js';
import type {UsageTypeItem} from '../../apps/governance-api/src/modules/location-master/usage-type-contracts.js';
import type {locationUseFixture} from './p3-07-fixture.js';

type Fixture=Awaited<ReturnType<typeof locationUseFixture>>;
const success=<T>(value:{response:Response;data?:T;error?:{code?:string}}):T=>{
 assert.equal(value.response.status,200,value.error?.code);assert.ok(value.data);return value.data;
};

/** Real loopback requests through the generated client and started workbench. */
export async function runLocationUseHttp(runtime:{url:string},fixture:Fixture){
 const maker=createLocationUseClient(runtime.url,'maker'),reviewer=createLocationUseClient(runtime.url,'reviewer');
 const types=createLocationUsageTypeClient(runtime.url,'maker'),typeReviewer=createLocationUsageTypeClient(runtime.url,'reviewer');
 const create={action:'CREATE' as const,requestId:randomUUID(),reason:'TEST POLICY ONLY HTTP purpose creation',code:'HTTP_'+randomUUID().replaceAll('-','').toUpperCase(),name:'HTTP 办公用途',meaning:'TEST independently approved office occupation',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:fixture.source.id,sourceVersionId:fixture.source.versionId,evidenceId:fixture.artifact.artifactId};
 const draft=success(await types.command(create));assert.equal(draft.status,'DRAFT');
 success(await typeReviewer.command({action:'VERIFY',requestId:randomUUID(),reason:'TEST HTTP independent purpose verification',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:fixture.artifact.artifactId,meaningAccepted:true}));
 const approved:UsageTypeItem=success(await typeReviewer.command({action:'APPROVE',requestId:randomUUID(),reason:'TEST HTTP independent purpose approval',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest}));
 assert.equal(approved.status,'APPROVED');assert.equal(approved.enabled,true);
 const transactions:Array<{request:{candidateId:string;requestId:string};inputId:string;recordedAt:string;facts:unknown;replay:true;resume:true;reconciliation:'MATCHED'}>=[];
 const publish=async(input:LocationUseStage)=>{
  const staged=success(await maker.stage(fixture.nativeInput(input)));assert.deepEqual(success(await maker.readInput({inputId:staged.inputId})),input);
  success(await reviewer.verify(fixture.verification(input,staged)));
  const preview=success(await maker.preview({inputId:staged.inputId}));assert.equal(preview.decision,'PASS',preview.issues.map(issue=>issue.code).join(','));
  const requestId=randomUUID(),planned=success(await maker.plan({inputId:staged.inputId,requestId}));
  success(await reviewer.review({candidateId:planned.candidateId}));success(await reviewer.approve(planned));
  const request={candidateId:planned.candidateId,requestId},applied=success(await maker.apply(request));assert.ok(applied.status==='COMMITTED');
  assert.equal(applied.responseStatus,'DELIVERED');const {responseStatus:_delivery,...durable}=applied;
  assert.deepEqual(success(await maker.resume(request)),durable);assert.equal(success(await maker.reconcile(request)).status,'MATCHED');assert.deepEqual(success(await maker.apply(request)),applied);
  transactions.push({request,inputId:staged.inputId,recordedAt:applied.recordedAt,facts:applied.facts,replay:true,resume:true,reconciliation:'MATCHED'});return applied;
 };
 const endpoint=await fixture.endpoint('ORG'),scope={...endpoint,usageType:{owner:'location-master/usage-type' as const,id:approved.id}},base=await fixture.entry(scope),entry:LocationUseEntry={...base,row:{...base.row,is_primary:'Y'}};
 assert.equal(ORG13_FIELDS.length,15);assert.deepEqual(Object.keys(entry.row).sort(),[...ORG13_FIELDS].sort());assert.equal(typeof entry.row.version_no,'number');assert.equal(entry.row.valid_to,null);
 const created=await publish(await fixture.input([entry]));assert.equal(created.facts.length,1);assert.equal(created.facts[0]!.owner,'location-master/location-use');
 const id=created.facts[0]!.id,queryRequest={id,businessAt:'2026-02-01T00:00:00',recordAsOf:created.recordedAt};
 const originalQuery=success(await maker.query(queryRequest)),originalExact=success(await maker.exact({id,version:'1'}));assert.equal(originalQuery.state,'ACTIVE');
 const window={id,validFrom:'2026-01-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION' as const};
 const beforeDisable=success(await maker.evaluate(window));assert.equal(beforeDisable.declarationCovered,true);assert.equal(beforeDisable.primaryCovered,true);assert.equal(beforeDisable.currentAdmissionCovered,true);
 const disable={action:'DISABLE' as const,requestId:randomUUID(),reason:'TEST HTTP direct pause without separate approval',target:approved.id,expectedHead:approved.head},disabled=success(await types.command(disable));
 assert.equal(disabled.enabled,false);assert.equal(disabled.events.at(-1)?.actor,'maker');assert.equal(disabled.events.at(-1)?.reason,disable.reason);assert.deepEqual(success(await types.command(disable)),disabled);
 assert.equal(success(await maker.evaluate(window)).currentAdmissionCovered,true);const disabledWindow=success(await maker.evaluate({...window,validFrom:disabled.events.at(-1)!.recordedAt,validTo:null}));assert.equal(disabledWindow.declarationCovered,true);assert.equal(disabledWindow.primaryCovered,true);assert.equal(disabledWindow.currentAdmissionCovered,false);
 const enabled=success(await types.command({action:'ENABLE',requestId:randomUUID(),reason:'TEST HTTP restore after checking dependencies',target:approved.id,expectedHead:disabled.head}));assert.equal(enabled.enabled,true);
 assert.deepEqual(enabled.events.map(event=>event.action),['DISABLE','ENABLE']);
 const stoppedAt=disabled.events.at(-1)!.recordedAt;assert.equal(success(await types.read({id:approved.id,recordAsOf:stoppedAt})).enabled,false);
 const restoredWindow=success(await maker.evaluate({...window,validFrom:enabled.events.at(-1)!.recordedAt,validTo:null}));assert.equal(restoredWindow.currentAdmissionCovered,true);
 assert.deepEqual(success(await maker.query(queryRequest)),originalQuery);assert.deepEqual(success(await maker.exact({id,version:'1'})),originalExact);
 const endAt='2026-04-01T00:00:00.000001',end:LocationUseEntry={...entry,action:'END',target:{owner:'location-master/location-use',id,expectedHead:'1'},endAt,row:{...entry.row,record_status:'RETIRED'}};
 const ended=await publish(await fixture.input([end]));assert.equal(success(await maker.query({id,businessAt:'2026-04-01T00:00:00.000000'})).state,'ACTIVE');assert.equal(success(await maker.query({id,businessAt:endAt})).state,'ENDED');
 const history=success(await maker.history({id}));assert.equal(history.versions.length,2);assert.equal(history.versions[1]!.action,'END');
 assert.deepEqual(success(await maker.query(queryRequest)),originalQuery);assert.deepEqual(success(await maker.exact({id,version:'1'})),originalExact);
 assert.ok(success(await maker.list({campus:'NORTH',targetId:scope.target.id})).items.some(item=>item.id===id));
 const typeHistory=success(await types.history({id:approved.id}));assert.equal(typeHistory.length,1);assert.deepEqual(typeHistory[0]!.events.map(event=>event.action),['DISABLE','ENABLE']);
 assert.ok(success(await types.list({limit:100})).items.some(item=>item.id===approved.id));
 assert.equal((await createLocationUseClient(runtime.url,'outsider').query({id})).response.status,403);
 assert.equal((await createLocationUsageTypeClient(runtime.url,'outsider').read({id:approved.id})).response.status,403);
 const oversized=await types.command({...disable,requestId:randomUUID(),reason:'X'.repeat(300001)});assert.equal(oversized.response.status,413);assert.equal(oversized.error?.code,'FST_ERR_CTP_BODY_TOO_LARGE');
 return {gate:'P3_07_GENERATED_HTTP',status:'PASS',actualWorkbenchStartup:true,generatedClientRealLoopback:true,all15Fields:true,nativeNumberAndNull:true,independentVerification:true,independentApproval:true,directDictionaryLifecycle:true,dictionary:{approved,disabled,enabled,history:typeHistory},relation:{createdFacts:created.facts,endedFacts:ended.facts,history,originalQuery:{request:queryRequest,response:originalQuery},originalExactVersion:originalExact,windows:{beforeDisable,disabled:disabledWindow,restored:restoredWindow}},transactions,exactReplay:true,resume:true,reconciliation:'MATCHED',unauthorizedRead:403,actualOversizedBody:413,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',FULL:'BLOCKED_DEPENDENCY',clinicalReadiness:'NOT_READY',browser:'SEE_SEPARATE_BROWSER_EVIDENCE',fullRestart:'NOT_RUN',capacity:'NOT_RUN',formalAcceptance:'NOT_RUN'};
}
