import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {ORGANIZATION_IDENTIFIER_FUNCTIONS,assertOrganizationIdentifiersProvisioned} from './organization-identifier-provisioning.mjs';
import {openCatalog,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openOrganizationIdentifiers} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {persistentOrganizationIdentifierFixture} from './p2-04-persistent-fixture.ts';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.ts';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';
import {createOrganizationIdentifierClient} from '../../packages/generated-api-client/src/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({evidenceTask:'p2-04'}),{receipt,connection,provider,evidence}=deployment;
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
peer(receipt.name,identitySQL(receipt)+` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;
 GRANT EXECUTE ON FUNCTION ${ORGANIZATION_IDENTIFIER_FUNCTIONS.map(f=>'department_master.'+f).join(',')} TO ${service.role};COMMIT;`);
const key=planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{});
peer(receipt.name,identitySQL(receipt)+` DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.department_write_authority WHERE key_hex=${quote(key)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH';END IF;END $$;`,{sensitive:true});
mkdirSync('.runtime/vnext/p2-04/http-requests',{recursive:true});
function saved(name,value){
 const path='.runtime/vnext/p2-04/http-requests/'+name+'.json';
 try{const prior=JSON.parse(readFileSync(path,'utf8'));assert.equal(prior.databaseOid,receipt.oid);assert.equal(prior.databaseRequestId,receipt.requestId);return prior.value;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,databaseRequestId:receipt.requestId,value}),{flag:'wx'});return value;
}
const requestId=name=>saved(name+'.request',randomUUID()),freeze=(name,value)=>saved(name+'.command',value);
const catalog=await openCatalog(connection,provider),owner=openOrganizationIdentifiers(connection,provider);let app;
try{
 const statePath='.runtime/vnext/p2-04/http-state.json';let state;
 try{state=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(state.databaseOid,receipt.oid);assert.equal(state.databaseRequestId,receipt.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!state){
  const f=await persistentOrganizationIdentifierFixture(receipt,catalog,provider,connection,requestId,freeze);
  const staged=await owner.stage('maker',f.input);
  await owner.verify('reviewer',{requestId:requestId('verify'),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'SYNTHETIC persistent alias verification',evidenceId:f.artifact.artifactId,policyApproved:true}]});
  const applyRequest=requestId('apply'),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:applyRequest});
  state={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,requestId:applyRequest,candidate,binding:f.binding,row:f.input.entries[0].row};writeFileSync(statePath,JSON.stringify(state,null,2),{flag:'wx'});
 }
 const provisionPath='.runtime/vnext/p2-04/provisioning.json';
 try{const prior=JSON.parse(readFileSync(provisionPath,'utf8'));assert.deepEqual(prior,state.binding);}catch(error){if(error.code!=='ENOENT')throw error;writeFileSync(provisionPath,JSON.stringify(state.binding,null,2),{flag:'wx'});}
 await assertOrganizationIdentifiersProvisioned(connection,provider,state.binding);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 const url=await app.listen({host:'127.0.0.1',port:0}),maker=createOrganizationIdentifierClient(url,'maker'),reviewer=createOrganizationIdentifierClient(url,'reviewer'),command={candidateId:state.candidate.candidateId,requestId:state.requestId};
 const resumed=await maker.resume(command);assert.equal(resumed.response.status,200);
 if(!resumed.data){assert.equal((await reviewer.review({candidateId:state.candidate.candidateId})).response.status,200);assert.equal((await reviewer.approve(state.candidate)).response.status,200);}
 const applied=await maker.apply(command);assert.equal(applied.response.status,200);assert.equal(applied.data.status,'COMMITTED');
 const replay=await maker.apply(command);assert.equal(replay.response.status,200);assert.deepEqual(replay.data,applied.data);
 const id=applied.data.facts[0].id,history=await maker.history({id,campus:'NORTH'});assert.equal(history.response.status,200);assert.equal(history.data.versions.length,1);
 const targetAliases=await maker.forTarget({type:'ORG',id:state.row.target_id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'});assert.equal(targetAliases.response.status,200);assert.ok(targetAliases.data.items.some(item=>item.id===id));
 assert.equal((await createOrganizationIdentifierClient(url,'outsider').list({campus:'NORTH'})).response.status,403);
 const recodePath='.runtime/vnext/p2-04/recode-state.json';let recode;
 try{recode=JSON.parse(readFileSync(recodePath,'utf8'));assert.equal(recode.databaseOid,receipt.oid);assert.equal(recode.databaseRequestId,receipt.requestId);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!recode){
  const prior=await maker.forTarget({type:'ORG',id:state.row.target_id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'});assert.equal(prior.response.status,200);const foundCode=prior.data.items.find(item=>item.kind==='HOSPITAL_CODE');assert.ok(foundCode);const code=saved('recode-original-code',foundCode);
  const original=saved('identifier-stage-input.command',null),entry=original.entries[0];
  const aliasJob=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:original.jobId});
  const job=await catalog.importJobCommand('maker',freeze('recode-job',{action:'CREATE',scope:'SYNTHETIC',requestId:requestId('recode-job'),reason:'SYNTHETIC_ORG_IDENTIFIER',profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},contractId:aliasJob.contract.id,contractVersionId:aliasJob.contract.versionId}));
  const input=freeze('recode-stage',{requestId:requestId('recode-stage'),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',entries:[{...entry,action:'CHANGE',identifier:{owner:'department-master/organization-identifier',id:code.id,expectedHead:code.version.number},row:{...entry.row,org_identifier_id:'PERSISTENT_DEMO_RECODE',identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:saved('recode-value','DEMO_'+randomUUID()),language:'',valid_from:'2026-06-01T00:00:00',source_record_id:'DEMO/ORG23/RECODE'}}]});
  const staged=await maker.stage(input);assert.equal(staged.response.status,200);
  const verified=await reviewer.verify(freeze('recode-verify',{requestId:requestId('recode-verify'),inputId:staged.data.inputId,inputDigest:staged.data.digest,rows:[{row:1,reason:'SYNTHETIC independent recode review',evidenceId:entry.evidenceId,policyApproved:true}]}));assert.equal(verified.response.status,200);
  const planned=await maker.plan(freeze('recode-plan',{inputId:staged.data.inputId,requestId:requestId('recode-apply')}));assert.equal(planned.response.status,200);
  recode={databaseOid:receipt.oid,databaseRequestId:receipt.requestId,candidate:planned.data,requestId:requestId('recode-apply'),oldCode:code,newCode:input.entries[0].row.identifier_value,targetId:state.row.target_id};writeFileSync(recodePath,JSON.stringify(recode,null,2),{flag:'wx'});
 }
 const recodeCommand={candidateId:recode.candidate.candidateId,requestId:recode.requestId},recodeResumed=await maker.resume(recodeCommand);assert.equal(recodeResumed.response.status,200);
 if(!recodeResumed.data){assert.equal((await reviewer.review({candidateId:recode.candidate.candidateId})).response.status,200);assert.equal((await reviewer.approve(recode.candidate)).response.status,200);}
 const changed=await maker.apply(recodeCommand);assert.equal(changed.response.status,200);assert.equal(changed.data.status,'COMMITTED');assert.equal(changed.data.facts.length,2);const {responseStatus,...committedOutcome}=changed.data;assert.equal(responseStatus,'DELIVERED');assert.deepEqual((await maker.resume(recodeCommand)).data,committedOutcome);
 const resolve=(value,businessAt,recordAsOf)=>maker.resolve({scheme:'SYNTHETIC_DEPARTMENT_CODE',value,campus:'NORTH',businessAt,...(recordAsOf?{recordAsOf}:{})});
 assert.equal((await resolve(recode.oldCode.value,'2026-05-31T23:59:59.999999')).data.status,'RESOLVED');assert.equal((await resolve(recode.oldCode.value,'2026-06-01T00:00:00')).data.status,'NOT_FOUND');assert.equal((await resolve(recode.newCode,'2026-06-01T00:00:00')).data.targetId,recode.targetId);assert.equal((await resolve(recode.oldCode.value,'2026-07-01T00:00:00',recode.oldCode.version.recorded_at)).data.targetId,recode.targetId);
 await deployment.complete();
 const output=evidence+'.http.json';writeFileSync(output,JSON.stringify({status:'PASS',gate:'P2-04-PERSISTENT-HTTP',databaseOid:receipt.oid,identifierId:id,candidateId:state.candidate.candidateId,recodeCandidateId:recode.candidate.candidateId,independentApproval:true,atomicApply:true,replaySameFacts:true,history:true,targetAliases:true,outsiderDenied:true,officialRecode:true,microsecondBoundary:true,oldRecordTime:true,authorization:'EXPLICIT_SYNTHETIC_ACTORS',hospitalPolicy:'NOT_ADOPTED',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});console.log(JSON.stringify({status:'PASS',gate:'P2-04-PERSISTENT-HTTP',evidence:output}));
}finally{await app?.close();await owner.close();await catalog.close();}
