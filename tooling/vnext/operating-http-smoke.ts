import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {OperatingCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOperatingRelationClient,createLicenseScopeClient} from '../../packages/generated-api-client/src/vnext-client.js';
import type {operatingScenario} from './operating-scenario.js';

/** Real loopback transport, reused by isolated and retained-database validation. */
export async function operatingHttpSmoke(x:Awaited<ReturnType<typeof operatingScenario>>,record:(event:unknown)=>void=()=>{}){
 const app=await buildCatalogServer(undefined,'CONTROL_PLANE',undefined,undefined,{owner:x.operating,actor:r=>actor(r.headers)});
 try{
  await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
  const relation=createOperatingRelationClient(base,'maker'),reviewer=createOperatingRelationClient(base,'reviewer'),scope=createLicenseScopeClient(base,'maker'),scopeReviewer=createLicenseScopeClient(base,'reviewer');
  const commit=async(command:OperatingCommand)=>{
   const isScope=['VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE'].includes(command.action),writer=isScope?scope:relation,checker=isScope?scopeReviewer:reviewer;
   const staged=await writer.stage(x.operatingInput(command));assert.equal(staged.response.status,200,JSON.stringify(staged.error));
   const requestId=randomUUID(),planned=await writer.plan({inputId:staged.data!.inputId,requestId});assert.equal(planned.response.status,200,JSON.stringify(planned.error));const candidate=planned.data!;
   assert.equal((await checker.review({candidateId:candidate.candidateId})).response.status,200);
   const approval=await checker.approve(candidate);assert.equal(approval.response.status,200,JSON.stringify(approval.error));
   const applied=await writer.apply({candidateId:candidate.candidateId,requestId});assert.equal(applied.response.status,200,JSON.stringify(applied.error));assert.equal(applied.data!.status,'COMMITTED');const fact=applied.data!.facts![0]!;
   assert.deepEqual((await writer.resume({candidateId:candidate.candidateId,requestId})).data?.facts,applied.data!.facts);
   record({action:command.action,fact,requestId,candidateId:candidate.candidateId});return fact;
  };
  const subject=await x.createSubject();record({subject});const license=await x.addLicense(subject);
  const campuses=[];
  for(const [name,role] of [['DEMO_ORG03 本部','HEADQUARTERS'],['DEMO_ORG03 高新','HIGH_TECH'],['DEMO_ORG03 中心','CITY_CENTER']] as const){
   const node=await x.createCampus(name,role);record({campus:node});campuses.push(node);x.grantPair(subject.id,node.id);await x.activateCampus(node);
   const endpoints=x.endpoints(subject,node),scopeFacts={license,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A','DEMO_MEDICAL_B'],licenseScopeText:'DEMO independently reviewed license scope'};
   const scopeFact=await commit({...x.common,...endpoints,action:'VERIFY_SCOPE',evidence:x.artifact.artifactId,facts:scopeFacts});
   const exact=await scope.read({kind:'SCOPE',mode:'EXACT',id:scopeFact.id,version:scopeFact.version});assert.equal(exact.response.status,200);
   const scopeRef={owner:'organization-master/license-scope' as const,id:scopeFact.id,version:scopeFact.version,versionId:exact.data![0]!.versionId};
   const facts={role:'OPERATOR' as const,primary:'Y' as const,relationTypeText:'DEMO operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A','DEMO_MEDICAL_B'],licenseScopeText:'DEMO licensed services',scopeTargets:[scopeRef]};
   const command={...x.common,...endpoints,action:'ESTABLISH' as const,evidence:x.artifact.artifactId,facts},established=await commit(command);
   const query={...endpoints,services:facts.services,validFrom:x.common.validFrom,validTo:null};
   const before=await relation.evaluateOperatingWindow(query);assert.equal(before.response.status,200);assert.equal(before.data!.status,'SATISFIED');
   const conflictInput=await relation.stage(x.operatingInput(command)),conflict=await relation.plan({inputId:conflictInput.data!.inputId,requestId:randomUUID()});assert.equal(conflict.response.status,200);
   assert.ok((await reviewer.review({candidateId:conflict.data!.candidateId})).data!.blockingIssues.includes('PRIMARY_OPERATOR_CONFLICT'));
   const denied=await reviewer.approve(conflict.data!);assert.equal(denied.response.status,409);assert.equal(denied.error!.code,'PRIMARY_OPERATOR_CONFLICT');
   const revised=await commit({...x.common,...endpoints,action:'REVISE_SCOPE',target:{owner:'organization-master/license-scope',id:scopeFact.id,expectedVersion:scopeFact.version},evidence:x.artifact.artifactId,facts:{...scopeFacts,licenseScopeText:'DEMO newly independently reviewed scope'}});
   assert.equal((await relation.evaluateOperatingWindow(query)).data!.status,'REVIEW_REQUIRED');
   const revisedExact=await scope.read({kind:'SCOPE',mode:'EXACT',id:revised.id,version:revised.version});assert.equal(revisedExact.response.status,200);
   const revalidated=await commit({...x.common,...endpoints,action:'REVALIDATE',target:{owner:'organization-master/operating-relation',id:established.id,expectedVersion:established.version},evidence:x.artifact.artifactId,facts:{...facts,scopeTargets:[{...scopeRef,version:revised.version,versionId:revisedExact.data![0]!.versionId}]}});
   const stable=await relation.evaluateOperatingWindow(query);assert.equal(stable.data!.status,'SATISFIED');
   await commit({...x.common,...endpoints,action:'CLOSE',target:{owner:'organization-master/operating-relation',id:established.id,expectedVersion:revalidated.version},validFrom:'2026-06-01T00:00:00',evidence:null,reason:'DEMO explicit end'});
   assert.equal((await relation.evaluateOperatingWindow(query)).data!.status,'NOT_SATISFIED');assert.equal((await relation.evaluateOperatingWindow({...query,asOf:stable.data!.observedAt})).data!.status,'SATISFIED');
   const history=await relation.read({kind:'RELATION',mode:'HISTORY',id:established.id});assert.equal(history.response.status,200);assert.equal(history.data!.length,3);assert.ok(history.data!.every(v=>v.subject.id===subject.id));
  }
  return {subjectId:subject.id,campusIds:campuses.map(c=>c.id),method:'REAL_HTTP_GENERATED_CLIENT',primaryConflict:true,reviewRevalidation:true,closeAndHistoricalR:true};
 }finally{await app.close();}
}
