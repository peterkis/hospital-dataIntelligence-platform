import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connect} from 'node:net';
import {root} from './lineage.mjs';

async function start(receiptPath, connectionString) {
  const child=fork('tooling/vnext/p0-10-recovery.mjs',[],{cwd:root,execArgv:['--import','tsx'],env:{...process.env,VNEXT_P0_10_RECEIPT:receiptPath,VNEXT_P0_10_OWNER:connectionString},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const stop=async()=>{
    if(child.connected)child.send('STOP');
    let timer;
    const result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000);})]);
    clearTimeout(timer);
    if(!result){child.kill();await exited;throw new Error('SERVICE_SHUTDOWN_TIMEOUT');}
    assert.equal(result.code,0,'SERVICE_EXIT_FAILED');
  };
  try {
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('SERVICE_START_TIMEOUT')),30000);
      const fail=()=>{clearTimeout(timer);reject(new Error('SERVICE_START_FAILED'));};
      child.once('error',fail);child.once('exit',fail);
      child.on('message',message=>{
        if(message?.event==='READY'){clearTimeout(timer);resolve(message);}
        else if(message?.event==='FAILED')fail();
      });
    });
    return {...ready,stop};
  } catch(error){try{await stop();}catch{}throw error;}
}
async function portClosed(url) {
  return new Promise((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port:Number(new URL(url).port)});
    socket.setTimeout(3000);
    socket.once('connect',()=>{socket.destroy();resolve(false);});
    socket.once('error',error=>{socket.destroy();error.code==='ECONNREFUSED'?resolve(true):reject(new Error('PORT_STATE_UNKNOWN'));});
    socket.once('timeout',()=>{socket.destroy();reject(new Error('PORT_STATE_UNKNOWN'));});
  });
}
export async function verifyHttpRestart(receiptPath,connectionString,contract,field) {
  const dimensions={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY'};
  let first, second;
  const request=async(service,path,body)=>{
    const response=await fetch(service.url+'/api/vnext/workbench/'+path,{method:body?'POST':'GET',headers:{'x-catalog-actor':'maker','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    const bodyValue = await response.json();
    assert.equal(response.status,200,'RESTART_HTTP_'+(typeof bodyValue.code==='string' && /^[A-Z_]+$/u.test(bodyValue.code)?bodyValue.code:'REQUEST_FAILED'));return bodyValue;
  };
  try {
    first=await start(receiptPath,connectionString);
    const received=await request(first,'upload',{
      bytes:Buffer.from(field+'\nDEMO_P0_10_HTTP_RESTART').toString('base64'),templateVersion:contract.definition.templateVersion,contractVersionId:contract.versionId,
      input:{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',
        job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_RESTART',contractId:contract.id,contractVersionId:contract.versionId,profile:contract.profile,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},
    });
    let summary=await request(first,'jobs/'+received.jobId);
    const action=(service,name)=>request(service,'action',{...dimensions,jobId:summary.jobId,revisionId:summary.revisionId,action:name,requestId:randomUUID(),outputRequestId:randomUUID(),issueRequestId:randomUUID()});
    assert.equal((await action(first,'PARSE')).status,'PARSED');
    await action(first,'VALIDATE');
    summary=await request(first,'jobs/'+received.jobId);
    const issues=await action(first,'ISSUES');
    assert.ok(issues.total>0,'RESTART_ISSUES_MISSING');
    await first.stop();
    assert.equal(await portClosed(first.url),true,'SERVICE_PORT_STILL_OPEN');
    second=await start(receiptPath,connectionString);
    assert.notEqual(first.pid,second.pid,'PROCESS_NOT_RESTARTED');
    const recovered=await request(second,'jobs/'+received.jobId);
    assert.deepEqual(recovered,summary,'RESTART_JOB_CHANGED');
    assert.deepEqual(await action(second,'ISSUES'),issues,'RESTART_ISSUES_CHANGED');
    await second.stop();
    return {status:'PASS',receiptBound:true,method:'HTTP_SERVICE_RESTART',firstProcessExited:true,portClosed:true,secondProcessExited:true,recovered:true,runCount:summary.runs.length,issueCount:issues.total,protectedPayloadRecovery:'NOT_CLAIMED_IN_MEMORY_KEYS',jobId:summary.jobId,revisionId:summary.revisionId,runIds:summary.runs.map(r=>r.runId)};
  } finally {await second?.stop();await first?.stop();}
}
