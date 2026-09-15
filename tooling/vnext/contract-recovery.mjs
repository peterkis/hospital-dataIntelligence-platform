import { readFileSync } from 'node:fs';
import { resolve,dirname,basename } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { readReceipt,inspect,migrate,root } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { runtime } from './catalog-runtime.mjs';
import { saveExclusiveReceipt } from './receipt.mjs';

const [mode,path,...extra]=process.argv.slice(2);
const evidence=resolve(path??'');
if(!['prepare','recover'].includes(mode)||extra.length||dirname(evidence)!==resolve(root,'.runtime/vnext')||!/^P0-02-recovery-\d+\.json$/u.test(basename(evidence)))throw new Error('CLOSED_RECOVERY_COMMAND_REQUIRED');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let catalog;let owned;let prepared=false;
try {
 if(mode==='prepare'){
  owned=createTemporary('P0-02');await migrate(owned.receipt);await seed(owned.receipt);catalog=await runtime(owned.receiptPath);
  const cmd=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_RECOVERY',...extra});
  const publish=async draft=>{
   const review=await catalog.command('maker',cmd('SUBMIT',{target:draft.id,expectedHead:draft.head}));
   return catalog.command('reviewer',cmd('PUBLISH',{target:review.id,expectedHead:review.head,reviewDigest:review.reviewDigest}));
  };
  const dataset=await publish(await catalog.command('maker',cmd('CREATE',{kind:'DATASET',code:'ORG01',values:{name:'合成契约恢复目录'},validFrom:'2026-01-01T00:00:00'})));
  const source=await publish(await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'RECOVERY_CONTRACT_SOURCE',values:{name:'合成契约恢复来源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'})));
  const parameter=await catalog.parameterCommand('maker',cmd('CREATE',{systemVersionId:source.versionId,parameterKey:'RECOVERY_PARAMETER',group:'SYNTHETIC',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'TEXT',enumValues:['A','B'],description:'合成恢复验证结构声明'},validFrom:'2026-01-01T00:00:00',validTo:null}));
  await catalog.parameterCommand('reviewer',cmd('APPROVE',{target:parameter.id,versionId:parameter.versionId,reviewDigest:parameter.reviewDigest}));
  const request=cmd('CREATE',{datasetVersionId:dataset.versionId,profile:'CORE',validFrom:'2026-01-01T00:00:00.000001',validTo:null,definition:{businessKey:['legal_name'],ruleVersion:'RECOVERY_1',templateVersion:'RECOVERY_1',sourceVersionId:source.versionId,fields:[{code:'legal_name',type:'text',required:'R',privacy:'INTERNAL',condition:'ALWAYS',enumValues:[]}],rules:[],references:[],codeSets:[]}});
  const outcome=await catalog.contractCommand('maker',request);
  const approved=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:outcome.id,expectedHead:outcome.head,reviewDigest:outcome.reviewDigest}));
  const published=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:approved.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest}));
  await catalog.contractCommand('maker',cmd('REVISE',{target:published.id,expectedHead:published.head,definition:{...request.definition,ruleVersion:'RECOVERY_2'},validFrom:request.validFrom,validTo:'2026-07-01T00:00:00.000001'}));
  const observation=await inspect(owned.receipt);
  const saved={receiptPath:owned.receiptPath,postmaster:observation.identity.postmaster,request,outcome,published,
   parameters:hash(await catalog.parameterRead('maker',{scope:'SYNTHETIC',mode:'APPROVED'})),
   baseline:hash(await catalog.contractRead('maker',{scope:'BASELINE',mode:'CURRENT'})),
   current:hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})),
   history:hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:published.id})),
   historical:hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',businessAt:'2026-06-01T00:00:00',asOf:published.recordedAt}))};
  saveExclusiveReceipt(evidence,saved);prepared=true;
  console.log(JSON.stringify({status:'P0_02_RECOVERY_PREPARED',evidence,receiptPath:owned.receiptPath,postmaster:observation.identity.postmaster}));
 }else{
  const saved=JSON.parse(readFileSync(evidence,'utf8'));const receipt=readReceipt(saved.receiptPath);
  assert.equal(receipt.taskId,'P0-02');assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');owned={receipt,receiptPath:saved.receiptPath};
  const observation=await inspect(receipt);assert.notEqual(observation.identity.postmaster,saved.postmaster,'Actual PostgreSQL restart required');
  catalog=await runtime(saved.receiptPath);
  assert.equal(hash(await catalog.contractRead('maker',{scope:'BASELINE',mode:'CURRENT'})),saved.baseline);
  assert.equal(hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})),saved.current);
  assert.equal(hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:saved.published.id})),saved.history);
  assert.equal(hash(await catalog.parameterRead('maker',{scope:'SYNTHETIC',mode:'APPROVED'})),saved.parameters);
  assert.equal(hash(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'EFFECTIVE',businessAt:'2026-06-01T00:00:00',asOf:saved.published.recordedAt})),saved.historical);
  assert.deepEqual(await catalog.contractCommand('maker',saved.request),saved.outcome);
  const result={status:'PASS',gate:'P0-02-REAL_RESTART',postmasterBefore:saved.postmaster,postmasterAfter:observation.identity.postmaster,immutableSchemasAndHistoryPreserved:true,ackLossReplayRecovered:true};
  saveExclusiveReceipt(evidence+'.verified.json',result);console.log(JSON.stringify(result));
 }
}finally{
 await catalog?.close();
 if(owned&&!prepared)dropTemporary(owned.receipt);
}
