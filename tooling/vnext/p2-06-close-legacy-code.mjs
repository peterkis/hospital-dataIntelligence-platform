import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {readReceipt,inspect,peer,identitySQL,quote} from './lineage.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {localTime} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationEvolutions,openOrganizationIdentifiers} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createDepartmentImpactClient,createOrganizationIdentifierClient,createOrganizationEvolutionClient} from '../../packages/generated-api-client/src/index.ts';

const mode=process.argv[2];if(process.argv.length!==3||!['--inspect','--close'].includes(mode))throw new Error('CLOSED_COMMAND_REQUIRED');
const receipt=readReceipt(),database=await inspect(receipt);assert.equal(database.identity.oid,receipt.oid);assert.ok(database.ledger.length>=124);
const prior=JSON.parse(readFileSync('.runtime/vnext/p2-05/http-state.json','utf8'));assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);
const connection=await ownerServiceConnection(),provider=organizationKeys(receipt),catalog=await openCatalog(connection,provider),owner=openOrganizationEvolutions(connection,provider),identifiers=openOrganizationIdentifiers(connection,provider);
const directory='.runtime/vnext/p2-06/legacy-code-closure';mkdirSync(directory,{recursive:true});
const saved=(name,value)=>{const path=directory+'/'+name+'.json';if(existsSync(path)){const row=JSON.parse(readFileSync(path,'utf8'));assert.equal(row.databaseOid,receipt.oid);return row.value;}writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,value},null,2),{flag:'wx'});return value;};
const requestId=name=>saved(name+'-request',randomUUID());
const ok=async promise=>{const response=await promise;assert.equal(response.response.status,200,JSON.stringify(response.error));return response.data;};
let app;
try{
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:identifiers,actor:r=>actor(r.headers)},{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),impact=createDepartmentImpactClient(url,'maker'),review=createDepartmentImpactClient(url,'reviewer'),codes=createOrganizationIdentifierClient(url,'maker'),codeReviewer=createOrganizationIdentifierClient(url,'reviewer'),evolution=createOrganizationEvolutionClient(url,'maker');
 const replay=await ok(evolution.apply({candidateId:prior.candidate.candidateId,requestId:prior.requestId}));assert.equal(replay.status,'COMMITTED');
 const eventId=replay.facts[0].id,list=await ok(impact.cases({eventId,campus:'NORTH'}));assert.equal(list.total,1);
 const detail=await ok(impact.case({caseId:list.items[0].id,campus:'NORTH'}));assert.equal(detail.item.obligation.kind,'REFERENCE');assert.equal(detail.item.obligation.owner,'IDENTIFIER');
 const history=await ok(codes.history({id:detail.item.obligation.reference.id,campus:'NORTH'}));assert.equal(history.kind,'HOSPITAL_CODE');assert.equal(history.scheme,'SYNTHETIC_DEPARTMENT_CODE');assert.equal(history.target_id,prior.predecessorId);
 const end='2026-06-01T00:00:00.000000';assert.equal(prior.input.event.effective_at.slice(0,10),'2026-06-01');
 if(mode==='--inspect'){
  saved('before',{eventId,detail,history,replay});console.log(JSON.stringify({status:'INSPECTED',caseId:detail.item.id,caseStatus:detail.item.status,identifierId:history.id,kind:history.kind,targetId:history.target_id,versions:history.versions.map(v=>({id:v.id,number:v.number,action:v.action,validFrom:v.valid_from,validTo:v.valid_to})),effectiveEnd:end}));
 }else{
  assert.ok(existsSync(directory+'/before.json'),'INSPECTION_REQUIRED');
  const before=saved('before',null);assert.ok(before);assert.equal(before.detail.item.id,detail.item.id);assert.equal(before.history.versions.length,1);assert.equal(before.history.versions[0].valid_to,null);
  const original=before.history.versions[0];assert.equal(original.action,'REGISTER');assert.equal(original.id,detail.item.obligation.reference.versionId);
  const stamp=value=>localTime(value.replace(' ','T'));
  const applyRequest=requestId('end-apply');let candidate;
  if(existsSync(directory+'/end-candidate.json'))candidate=saved('end-candidate',null);
  else if(history.versions.length===2&&history.versions[1].action==='END'){
   const verified=saved('end-verify',null);assert.ok(verified);candidate=saved('end-candidate',await ok(codes.plan({inputId:verified.inputId,requestId:applyRequest})));
  }else{
  const policies=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'}),policy=policies.find(p=>p.dataset==='ORG23'&&p.profile==='CORE'&&p.status==='PUBLISHED');assert.ok(policy);
  const job=await catalog.importJobCommand('maker',saved('end-job',{action:'CREATE',scope:'SYNTHETIC',requestId:requestId('end-job'),reason:'USER_AUTHORIZED_SYNTHETIC_CODE_END',contractId:policy.id,contractVersionId:policy.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}}));
  const material=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:requestId('end-evidence'),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:2592000},Buffer.from('TEST POLICY ONLY: user authorized ending this synthetic predecessor code at the accepted split boundary 2026-06-01. Retain original assertions, permanent ownership, audit and replay. No code reassignment.'));
  const input=saved('end-input',{requestId:requestId('end-input'),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',entries:[{action:'END',identifier:{owner:'department-master/organization-identifier',id:history.id,expectedHead:original.number},reason:'USER_AUTHORIZED_END_AT_SPLIT',evidenceId:material.artifactId,row:{org_identifier_id:'P2_06_LEGACY_CODE_END',target_type:'ORG',target_id:history.target_id,identifier_kind:history.kind,identifier_system:history.scheme,identifier_value:original.value,language:original.language,is_preferred:original.preferred?'Y':'N',version_no:'2',valid_from:stamp(original.valid_from),valid_to:end,record_status:'ACTIVE',source_system_id:original.facts.sourceSystemId,source_record_id:'TEST/P2-06/LEGACY_CODE_END',approval_ref:'USER_AUTHORIZED_SYNTHETIC_CLOSURE',recorded_at:'2026-10-02T00:00:00'}}]});
  const staged=await ok(codes.stage(input));
  await ok(codeReviewer.verify(saved('end-verify',{requestId:requestId('end-verify'),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST POLICY ONLY independent END review; keep permanent reservation',evidenceId:material.artifactId,policyApproved:true}]})));
  const validation=await ok(codes.validate({inputId:staged.inputId}));assert.equal(validation.decision,'PASS',JSON.stringify(validation.issues));
  candidate=saved('end-candidate',await ok(codes.plan({inputId:staged.inputId,requestId:applyRequest})));
  }
  const command={candidateId:candidate.candidateId,requestId:applyRequest};
  if(!await ok(codes.resume(command))){await ok(codeReviewer.review({candidateId:candidate.candidateId}));await ok(codeReviewer.approve(candidate));}
  const outcome=await ok(codes.apply(command));assert.equal(outcome.status,'COMMITTED');assert.deepEqual(await ok(codes.apply(command)),outcome);
  const ended=await ok(codes.history({id:history.id,campus:'NORTH'}));assert.equal(ended.versions.length,2);assert.deepEqual(ended.versions[0],original);assert.equal(ended.versions[1].action,'END');assert.equal(stamp(ended.versions[1].valid_to),end);assert.equal(ended.target_id,history.target_id);
  const proof={owner:'IDENTIFIER',id:history.id,versionId:ended.versions[1].id,candidateId:candidate.candidateId,requestId:applyRequest};
  let responsibility=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='RESPONSIBILITY'&&i.status==='PUBLISHED'&&i.payload.dataset==='ORG23'&&i.payload.fieldGroup==='ALL'&&i.payload.role==='OWNER'&&['ALL','NORTH'].includes(i.payload.authorityScope));
  if(!responsibility){
   const draft=await catalog.command('maker',saved('responsibility-create',{action:'CREATE',scope:'SYNTHETIC',requestId:requestId('responsibility-create'),reason:'TEST_OWNER_FOR_EXPLICIT_CODE_CLOSURE',kind:'RESPONSIBILITY',code:'P2_06_ORG23_CLOSURE_OWNER',values:{dataset:'ORG23',authorityScope:'NORTH',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}));
   const submitted=await catalog.command('maker',saved('responsibility-submit',{action:'SUBMIT',scope:'SYNTHETIC',requestId:requestId('responsibility-submit'),reason:'TEST_OWNER',target:draft.id,expectedHead:draft.head}));
   responsibility=await catalog.command('reviewer',saved('responsibility-publish',{action:'PUBLISH',scope:'SYNTHETIC',requestId:requestId('responsibility-publish'),reason:'TEST_INDEPENDENT_OWNER_REVIEW',target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest}));
  }
  const base={caseId:detail.item.id,campus:'NORTH'},assigned=await ok(impact.assign(saved('assign',{...base,requestId:requestId('assign'),reason:'USER_AUTHORIZED_ORG23_CLOSURE',expectedHead:before.detail.item.head,responsibilityId:responsibility.id})));
  const proposal=await ok(impact.disposition(saved('disposition',{...base,requestId:requestId('disposition'),reason:'LINK_COMMITTED_END_KEEP_PERMANENT_OWNERSHIP',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:prior.input.decisionEvidenceId,result:proof}})));
  const approved=await ok(review.approve(saved('approve',{...base,requestId:requestId('approve'),reason:'INDEPENDENT_REVIEW_OF_EXACT_END_RESULT',expectedHead:proposal.head,proposalEventId:proposal.eventId})));
  const checked=await ok(impact.recheck(saved('recheck',{...base,requestId:requestId('recheck'),reason:'VERIFY_NO_POST_SPLIT_CODE_OBLIGATION',expectedHead:approved.head})));assert.equal(checked.status,'RESOLVED');assert.deepEqual(checked.remainingSpans,[]);
  const finalList=await ok(impact.cases({eventId,campus:'NORTH'}));assert.equal(finalList.total,1);assert.equal(finalList.unresolved,0);
  const finalDetail=await ok(impact.case(base));assert.equal(finalDetail.history.length,4);
  if(detail.item.status==='RESOLVED')assert.deepEqual(finalDetail,detail);
  const resolve=(businessAt,recordAsOf)=>ok(codes.resolve({scheme:history.scheme,value:original.value,campus:'NORTH',businessAt,...(recordAsOf?{recordAsOf}: {})}));
  assert.equal((await resolve('2026-05-31T23:59:59.999999')).targetId,history.target_id);assert.equal((await resolve(end)).status,'NOT_FOUND');assert.equal((await resolve(end,stamp(original.recorded_at))).targetId,history.target_id);
  assert.deepEqual(await ok(evolution.apply({candidateId:prior.candidate.candidateId,requestId:prior.requestId})),before.replay);
  const reservation=JSON.parse(peer(receipt.name,identitySQL(receipt)+`SELECT jsonb_build_object('id',id,'targetId',target_id,'reservedValue',reserved_value)::text FROM department_master.organization_identifier WHERE id=${quote(history.id)}::uuid;`).split(/\r?\n/).filter(line=>line!=='DO').join('\n'));
  assert.equal(reservation.targetId,history.target_id);assert.equal(reservation.reservedValue,original.value);
  const after=await inspect(receipt);assert.deepEqual(after.ledger,database.ledger);
  const result={status:'PASS',databaseOid:receipt.oid,eventId,caseId:detail.item.id,identifierId:history.id,endedAt:end,endCandidateId:candidate.candidateId,endVersionId:proof.versionId,caseStatus:checked.status,remainingCases:finalList.unresolved,identifierVersions:ended.versions.length,caseEvents:finalDetail.history.length,originalVersionPreserved:true,permanentCodeOwnerPreserved:true,beforeBoundaryResolves:true,afterBoundaryNotFound:true,oldRecordTimeResolves:true,oldEventReplayPreserved:true,actualHttp:true,independentApproval:true,synthetic:true};
  writeFileSync(directory+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }
}finally{await app?.close();await owner.close();await identifiers.close();await catalog.close();}
