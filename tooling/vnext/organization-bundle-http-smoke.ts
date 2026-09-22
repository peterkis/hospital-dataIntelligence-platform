import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOrganizationBundleClient} from '../../packages/generated-api-client/src/vnext-client.js';
import type {openOrganizationImport} from '../../apps/governance-api/src/modules/organization-master/index.js';
import type {organizationBundleFixture} from './organization-bundle-fixture.js';
export async function organizationBundleHttpSmoke(owner:ReturnType<typeof openOrganizationImport>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>,record:(event:unknown)=>void=()=>{}){
 const app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 let loseNextAck=false;
 app.addHook('onSend',async(request,reply,payload)=>{if(loseNextAck&&request.url.endsWith('/apply')&&reply.statusCode===200){loseNextAck=false;reply.raw.destroy();}return payload;});
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
  const writer=createOrganizationBundleClient(base,'maker'),reviewer=createOrganizationBundleClient(base,'reviewer'),admin=createOrganizationBundleClient(base,'bundle-admin');
  const receive=await writer.receive({metadata:fixture.input,bytesBase64:fixture.workbook().toString('base64')});assert.equal(receive.response.status,200,JSON.stringify(receive.error));const ref={jobId:receive.data!.jobId,revisionId:receive.data!.revisionId};
  assert.equal((await createOrganizationBundleClient(base,'outsider').revision(ref)).response.status,403);
  const extra=await fetch(base+'/api/vnext/import/organization-bundles/revision',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...ref,actor:'reviewer'})});assert.equal(extra.status,400);
  const validate=await writer.validate({...ref,requestId:randomUUID()});assert.equal(validate.response.status,200,JSON.stringify(validate.error));assert.equal(validate.data!.decision,'BLOCKED');
  const preauth=await admin.preauthorize({...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});assert.equal(preauth.response.status,200,JSON.stringify(preauth.error));
  const legal=await reviewer.legalReview(ref);assert.equal(legal.response.status,200,JSON.stringify(legal.error));assert.ok(legal.data!.cells.length>0);
  const verify=await reviewer.verify({...ref,requestId:randomUUID(),digest:legal.data!.digest});assert.equal(verify.response.status,200,JSON.stringify(verify.error));
  const requestId=randomUUID(),plan=await writer.plan({...ref,requestId});assert.equal(plan.response.status,200,JSON.stringify(plan.error));const candidate=plan.data!;
  const review=await reviewer.review({candidateId:candidate.candidateId});assert.equal(review.response.status,200,JSON.stringify(review.error));assert.equal(review.data!.commands.length,12);
  assert.equal((await reviewer.approve(candidate)).response.status,200);
  loseNextAck=true;await assert.rejects(()=>writer.apply({candidateId:candidate.candidateId,requestId}));
  const recovered=await writer.resume({candidateId:candidate.candidateId,requestId});assert.equal(recovered.data!.status,'COMMITTED');
  const apply=await writer.apply({candidateId:candidate.candidateId,requestId});assert.equal(apply.response.status,200,JSON.stringify(apply.error));assert.equal(apply.data!.status,'COMMITTED');assert.equal(apply.data!.facts!.length,12);
  assert.deepEqual(recovered.data!.facts,apply.data!.facts);
  assert.ok(!JSON.stringify(apply.data).includes('DEMO_PROTECTED_SOURCE'));
  const replay=await writer.apply({candidateId:candidate.candidateId,requestId});assert.deepEqual(replay.data!.facts,apply.data!.facts);
  const resume=await writer.resume({candidateId:candidate.candidateId,requestId});assert.deepEqual(resume.data!.facts,apply.data!.facts);
  record({jobId:ref.jobId,revisionId:ref.revisionId,candidateId:candidate.candidateId,requestId,facts:apply.data!.facts});return apply.data!;
 }finally{await app.close();}
}

/** Reuses the generated transport for a third-relation error without applying any row. */
export async function rejectThirdRelationOverHttp(owner:ReturnType<typeof openOrganizationImport>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>){
 const app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
  const writer=createOrganizationBundleClient(base,'maker'),reviewer=createOrganizationBundleClient(base,'reviewer'),admin=createOrganizationBundleClient(base,'bundle-admin');
  const metadata=structuredClone(fixture.input);metadata.requestId=randomUUID();const third=metadata.manifest.rows.find(r=>r.dataset==='ORG03'&&r.row===4);assert.ok(third&&third.dataset==='ORG03');third.services=['UNADOPTED_DEMO_SERVICE'];
  const received=await writer.receive({metadata,bytesBase64:fixture.workbook().toString('base64')});assert.equal(received.response.status,200,JSON.stringify(received.error));const ref={jobId:received.data!.jobId,revisionId:received.data!.revisionId};
  const validated=await writer.validate({...ref,requestId:randomUUID()});assert.equal(validated.response.status,200,JSON.stringify(validated.error));assert.equal(validated.data!.decision,'BLOCKED');assert.ok(validated.data!.issues.some(i=>i.dataset==='ORG03'&&i.row===4&&i.code==='UNSUPPORTED_SERVICE'));
  assert.equal((await admin.preauthorize({...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))})).response.status,200);
  const legal=await reviewer.legalReview(ref);assert.equal(legal.response.status,503);assert.equal(legal.error!.code,'BLOCKED_DEPENDENCY');
  return {...ref,status:'BLOCKED' as const,issues:validated.data!.issues};
 }finally{await app.close();}
}
