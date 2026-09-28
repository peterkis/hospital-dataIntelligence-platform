import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {prepareWorkspaceDeployment} from './p1-06-deployment.mjs';
import {root} from './lineage.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const deployment=await prepareWorkspaceDeployment({reuseExisting:true,evidenceTask:'p1-07'});
const catalog=await openCatalog(deployment.connection,deployment.provider),campus=openCampus(deployment.connection,deployment.provider);
let node,retirement,request;
try{
 const transport=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG02'&&c.profile==='CORE'&&c.status==='PUBLISHED'&&c.definition.templateVersion==='ORG02_MANUAL_CORE_V1');
 assert.ok(transport,'PUBLISHED_ORG02_TRANSPORT_REQUIRED');
 const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(s=>s.versionId===transport.definition.sourceVersionId);assert.ok(source);
 const job=await catalog.importJobCommand('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DEMO_CAMPUS_RESTART',contractId:transport.id,contractVersionId:transport.versionId,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'7'.repeat(64)}});
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_P1_07_RESTART_EVIDENCE'));
 const common={validFrom:'2026-09-28T00:00:00',validTo:null,evidence:artifact.artifactId,source:{systemId:source.id,versionId:source.versionId,alias:'DEMO_P1_07',versionNo:1,recordLocator:'DEMO_P1_07_RESTART',recordedAt:'2026-09-28T00:00:00',recordStatus:'PUBLISHED',approvalRef:'DEMO_OFFICE_REVIEW'}};
 const commit=async command=>{
  const staged=await campus.stage('maker',{jobId:job.id,revisionId:job.revisionId,requestId:randomUUID(),campus:'NORTH',purpose:'IDENTITY_VERIFY',command});
  const requestId=randomUUID(),candidate=await campus.plan('maker',{inputId:staged.inputId,requestId});
  await campus.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await campus.approveApplyUnit('reviewer',candidate);
  const request={candidateId:candidate.candidateId,requestId},outcome=await campus.applyUnit('maker',request);assert.equal(outcome.status,'COMMITTED');return {request,outcome};
 };
 const created=await commit({...common,action:'CREATE',sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_P107_'+randomUUID(),campusName:'DEMO P1-07 持久重启验证',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}});node=created.outcome.facts[0];
 const report=await campus.assessCampusImpact('maker',{id:node.id,validFrom:common.validFrom,validTo:null});
 const retired=await commit({...common,action:'RETIRE',sourceOperationStatus:'RETIRED',target:{owner:'organization-master/campus',id:node.id,expectedVersion:node.version},reason:'DEMO_RESTART',assessmentDigest:report.digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2027-01-01T00:00:00',actions:'Synthetic restart; unknown downstream remains open'}});
 retirement=retired.outcome;request=retired.request;
}finally{await campus.close();await catalog.close();}

async function start(){
 const child=spawn(process.execPath,['--import','tsx','tooling/vnext/workbench-runtime.mjs','--persistent'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let ready=false,exited=false,exitCode;
 child.stdout.on('data',chunk=>{const text=chunk.toString();if(text.includes('WORKBENCH_READY'))ready=true;process.stdout.write(text);});
 child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('exit',code=>{exited=true;exitCode=code;});
 const stopFile=resolve(root,'.runtime/vnext/p0-09/stop-'+child.pid);
 const stop=async()=>{if(!exited)writeFileSync(stopFile,'P1_07_OWNED_RESTART');const until=Date.now()+30000;while(!exited&&Date.now()<until)await delay(100);assert.ok(exited,'SERVICE_STOP_TIMEOUT');assert.equal(exitCode,0);};
 const until=Date.now()+30000;while(!ready&&!exited&&Date.now()<until)await delay(100);
 if(!ready){await stop();throw new Error('SERVICE_START_FAILED');}
 const info=JSON.parse(readFileSync(resolve(root,'.runtime/vnext/p0-09/server.json'),'utf8'));assert.equal(info.stopFile,stopFile);
 return {pid:child.pid,stop};
}
async function post(path,body){const r=await fetch('http://127.0.0.1:4317'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();}
let draft,firstHistory;const pids=[];
for(let cycle=0;cycle<2;cycle++){
 const server=await start();pids.push(server.pid);
 try{
  assert.equal((await post('/api/vnext/campuses/query',{id:node.id})).operationStatus,'RETIRED');
  const {responseStatus,...committed}=retirement;assert.equal(responseStatus,'DELIVERED');assert.deepEqual(await post('/api/vnext/campuses/resume',request),committed);
  const history=await post('/api/vnext/campuses/history',{id:node.id});if(cycle===0)firstHistory=history;else assert.deepEqual(history,firstHistory);
  if(cycle===0)draft=await post('/api/vnext/organization-workspace/drafts/save',{requestId:randomUUID(),domain:'ORG02',campus:'NORTH',command:{action:'CREATE',facts:{campusName:'DEMO P1-07 重启草稿'}}});
  const restored=await post('/api/vnext/organization-workspace/drafts/read',{id:draft.id});assert.equal(restored.version,draft.version);
  assert.equal((await post('/api/vnext/campuses/impact',{id:node.id,validFrom:'2026-09-28T00:00:00',validTo:null})).completed,false);
 }finally{await server.stop();}
}
assert.notEqual(pids[0],pids[1]);await deployment.complete();
const result={status:'PASS',method:'TWO_SEPARATE_SERVICE_PROCESSES_REAL_HTTP',pids,campusId:node.id,retirementRequest:request,draftId:draft.id,identity:deployment.receipt.oid,historyAndOutcomePreserved:true,unknownDispositionStillOpen:true};
writeFileSync('.runtime/vnext/p1-07/restart-'+Date.now()+'.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
