import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {readReceipt,inspect,checkPrefix,migrationFiles} from './lineage.mjs';
import {captureP311Preservation} from './p3-11-preservation.mjs';
import {assertP310Preserved} from './p3-10-preservation.mjs';
import {provisionCareWorkspace,assertCareWorkspaceProvisioned} from './p3-10-provisioning.mjs';
import {provisionUnitCapability,assertUnitCapabilityProvisioned} from './p3-08-provisioning.mjs';
import {startWorkbench} from './workbench-runtime.mjs';
import {createCareWorkspaceClient,createCareOperationClient,createCareValidationClient} from '../../packages/generated-api-client/src/index.ts';

// One receipt-bound retained synthetic deployment. No fault injection, teardown,
// selector, force option or replacement database is accepted by this entry.
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const retained=readReceipt();assert.equal(retained.name,'hdi_mc_vnext_a7049c9e5c2a4364');assert.equal(retained.oid,'206108');assert.equal(retained.lineage,'HDIP-MC-VNEXT');
const preflight=await inspect(retained),previousPrefix=checkPrefix(migrationFiles(),preflight.ledger);assert.ok(previousPrefix>=252,'P3_11_MERGED_DEPLOYMENT_REQUIRED');
const keyPath='.runtime/vnext/p1-01/keys.secret.json',anchorPath='.runtime/vnext/p3-10/retained-original-preservation.json',captured=captureP311Preservation(retained,preflight,keyPath);
if(!existsSync(anchorPath)){assert.equal(previousPrefix,252,'ORIGINAL_0252_PRESERVATION_REQUIRED');writeFileSync(anchorPath,JSON.stringify({receipt:{name:retained.name,oid:retained.oid,requestId:retained.requestId},prefix:previousPrefix,before:captured},null,2),{flag:'wx'});}
const anchor=JSON.parse(readFileSync(anchorPath,'utf8'));assert.deepEqual(anchor.receipt,{name:retained.name,oid:retained.oid,requestId:retained.requestId});assert.equal(anchor.prefix,252);assert.equal(anchor.before.ledger.length,252);
const before=anchor.before,deployment=await prepareWorkspaceDeployment({evidenceTask:'p3-10'}),{receipt,connection,provider,evidence}=deployment;
writeFileSync(evidence+'.p3-10-before.json',JSON.stringify(before,null,2),{flag:'wx'});
const service=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));let server;
assertP310Preserved(before,captureP311Preservation(receipt,await inspect(receipt),keyPath),service.role);
const ok=result=>{assert.equal(result.response.status,200,result.error?.code);assert.ok(result.data);return result.data;};
try{
 provisionCareWorkspace(receipt,service.role);provisionUnitCapability(receipt,service.role,provider);await assertCareWorkspaceProvisioned(connection);await assertUnitCapabilityProvisioned(connection,provider);
 // Original ACL entries retain exact bytes; only listed public Execute grants
 // may be appended to this receipt-bound service role, with no grant options.
 assertP310Preserved(before,captureP311Preservation(receipt,await inspect(receipt),keyPath),service.role);
 server=await startWorkbench({persistent:true,port:0});
 const maker=createCareWorkspaceClient(server.url,'maker'),alias=createCareWorkspaceClient(server.url,'maker-alias'),operations=createCareOperationClient(server.url,'maker'),reviewer=createCareOperationClient(server.url,'reviewer'),validation=createCareValidationClient(server.url,'maker');
 const checkpointPath='.runtime/vnext/p3-10/retained-http-checkpoint.json',seedPath='.runtime/vnext/p3-10/retained-recovery-seed.json';let checkpoint;
 const persist=()=>writeFileSync(checkpointPath,JSON.stringify(checkpoint,null,2));
 if(existsSync(checkpointPath))checkpoint=JSON.parse(readFileSync(checkpointPath,'utf8'));
 else if(existsSync(seedPath)){
  const seed=JSON.parse(readFileSync(seedPath,'utf8'));assert.deepEqual(seed.receipt,anchor.receipt);const current=ok(await maker.read(seed.draftId));assert.equal(current.state,'SUBMITTED');assert.deepEqual(current.submission,seed.submission);
  checkpoint={receipt:seed.receipt,saved:current,submit:seed.submit,aliasOriginalDenied:seed.checks.some(c=>c.actor==='maker-alias'&&c.permission==='WRITE'&&c.status==='ACCESS_DENIED'),requestId:randomUUID(),aliasProofRequestId:randomUUID()};persist();
 }else throw new Error('ORIGINAL_RETAINED_CHECKPOINT_REQUIRED');
 assert.deepEqual(checkpoint.receipt,anchor.receipt);const saved=checkpoint.saved,submit=checkpoint.submit,submitted=ok(await maker.submit(submit));assert.deepEqual(ok(await maker.submit(submit)),submitted);
 const aliasCurrent=await alias.read(saved.id);assert.ok([200,403].includes(aliasCurrent.response.status));
 if(checkpoint.aliasOriginalDenied)assert.equal(aliasCurrent.response.status,403);else if(aliasCurrent.response.status===403){checkpoint.aliasOriginalDenied=true;persist();}
 const aliasReplay=await alias.submit(submit);if(checkpoint.aliasOriginalDenied)assert.equal(aliasReplay.response.status,403);else assert.deepEqual(ok(aliasReplay),submitted);
 // A same-person alias still needs every current reference permission. Keep
 // the retained Department refusal; do not grant unrelated Department access.
 const current=ok(await maker.read(saved.id)),proof=ok(await maker.save({kind:'UNIT',campus:current.content.campus,profile:'CORE',requestId:checkpoint.aliasProofRequestId,transport:current.content.transport,payload:{entries:[{action:'CREATE',row:{unit_name:'TEST retained alias incomplete ownership proof'}}]}})),restored=ok(await alias.read(proof.id));assert.equal(restored.maker,'maker');assert.equal(restored.id,proof.id);assert.equal((await createCareWorkspaceClient(server.url,'reviewer').read(proof.id)).response.status,403);checkpoint.aliasProofDraftId=proof.id;persist();
 const staged=submitted.submission;assert.equal(staged.kind,'UNIT');const original=ok(await operations.call('readBusinessUnitInput',{inputId:staged.inputId}));assert.deepEqual(original.entries,current.content.payload.entries);
 const native=original,binding=native.entries[0].binding;
 assert.equal(current.maker,'maker');assert.equal(native.profile,'CORE');assert.equal(native.entries.length,1);assert.equal(native.entries[0].row.source_record_id,'TEST/ORG07/2');assert.equal(native.entries[0].row.approval_ref,'TEST_POLICY_ONLY');assert.equal(native.entries[0].row.receiving_rule_ref,'');assert.equal(native.entries[0].row.business_owner_id,'');
 const requestId=checkpoint.requestId;let candidate=checkpoint.candidate;
 if(!candidate){
  if(!checkpoint.verificationRequestId){checkpoint.verificationRequestId=randomUUID();persist();}
  ok(await reviewer.call('verifyBusinessUnitInput',{requestId:checkpoint.verificationRequestId,inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST independent retained receiving review',policyVersion:'ORG07_CORE_V1',rows:native.entries.map((entry,index)=>({row:index+1,evidenceId:entry.evidenceId,classificationAccepted:true,receiving:{kind:'NO_SPECIAL_RESTRICTION',confirmed:true,validFrom:entry.row.valid_from,validTo:entry.row.valid_to||null}}))}));assert.equal(ok(await operations.call('previewBusinessUnitInput',{inputId:staged.inputId})).decision,'PASS');
  const admission=ok(await validation.validateCareOrganizationBundle({mode:'CURRENT_ADMISSION',profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,targets:[],members:[{owner:'UNIT',inputId:staged.inputId,revisionId:staged.revisionId,digest:staged.digest,contractVersionId:staged.contractVersionId}]}));assert.equal(admission.decision,'PASS');checkpoint.admissionRecordAsOf=admission.recordAsOf;
  candidate=ok(await operations.call('planBusinessUnitInput',{inputId:staged.inputId,requestId}));checkpoint.candidate=candidate;persist();
 }
 const request={candidateId:candidate.candidateId,requestId},recovery=await operations.call('resumeBusinessUnitOutcome',request);assert.equal(recovery.response.status,200,recovery.error?.code);let outcome;
 if(recovery.data===null){ok(await reviewer.call('reviewBusinessUnitCandidate',{candidateId:candidate.candidateId}));ok(await reviewer.call('approveBusinessUnitCandidate',candidate));outcome=ok(await operations.call('applyBusinessUnitCandidate',request));}
 else outcome=ok(recovery);
 assert.equal(outcome.status,'COMMITTED');const {responseStatus:_delivery,...committed}=outcome;assert.deepEqual(ok(await operations.call('resumeBusinessUnitOutcome',request)),committed);assert.equal(ok(await operations.call('reconcileBusinessUnitOutcome',request)).status,'MATCHED');checkpoint.committedOutcome=committed;persist();
 const fact=outcome.facts[0],history=ok(await operations.call('getBusinessUnitHistory',{id:fact.id}));assert.equal(history.versions.length,1);const bundle=ok(await validation.validateCareOrganizationBundle({mode:'CURRENT_ADMISSION',profile:'CORE',validFrom:'2026-01-01T00:00:00',validTo:null,targets:[{owner:'UNIT',id:fact.id,campusId:binding.campus.id}],members:[]}));assert.equal(bundle.decision,'PASS');
 const impact=ok(await validation.assessUnitImpact({id:fact.id,validFrom:'2026-01-01T00:00:00',validTo:null}));assert.ok(impact);
 const stopFile='.runtime/vnext/p3-10/retained-stop-'+process.pid,readiness={event:'P3_10_RETAINED_BROWSER_READY',url:server.url+'/admin/vnext/care-space',parentPid:process.pid,oid:receipt.oid,previousPrefix,currentPrefix:migrationFiles().length,draftId:saved.id,inputId:staged.inputId,candidateId:candidate.candidateId,requestId,factId:fact.id,stopFile,evidence};writeFileSync('.runtime/vnext/p3-10/retained-browser-server.json',JSON.stringify(readiness,null,2));console.log(JSON.stringify(readiness));
 // The caller closes the exact task-owned service after actual browser checks.
 // The retained database, key, receipt and all predecessor resources remain.
 while(!existsSync(stopFile))await delay(500);
 const final=await inspect(receipt),preservation=assertP310Preserved(before,captureP311Preservation(receipt,final,keyPath),service.role);assert.equal(final.identity.oid,'206108');assert.equal(checkPrefix(migrationFiles(),final.ledger),migrationFiles().length);await deployment.complete();
 const report={gate:'P3_10_PERSISTENT_GENERATED_HTTP',status:'PASS',previousPrefix,currentPrefix:final.ledger.length,originalPrefix:anchor.prefix,originalPreservation:anchorPath,oid:receipt.oid,preservation,readiness,recordAsOf:bundle.recordAsOf,protectedDraftPrivate:true,sameIdentityAliasIncompleteRestore:true,aliasFilledReplay:checkpoint.aliasOriginalDenied?'ACCESS_DENIED_CURRENT_REFERENCE_PERMISSION':'ORIGINAL_RESULT',aliasProofDraftId:checkpoint.aliasProofDraftId,originalRequestReplayedBy:'maker',originalInputRead:true,committed:true,reconciled:'MATCHED',factVersions:history.versions.length,policy:'TEST_POLICY_ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',personnelAndBeds:'NOT_EVALUABLE',browser:'SEE_SEPARATE_BROWSER_EVIDENCE',restart:'SEE_OWNED_TEMPORARY_EVIDENCE',capacity:'NOT_RUN',formalAcceptance:'NOT_RUN'};writeFileSync(evidence+'.p3-10-http.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({gate:report.gate,status:'PASS',evidence:evidence+'.p3-10-http.json'}));
}finally{await server?.close();}
