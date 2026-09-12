import { readFileSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runtime } from './catalog-runtime.mjs';
import { readReceipt,inspect,peer,root } from './lineage.mjs';
import { saveExclusiveReceipt } from './receipt.mjs';

const mode=process.argv[2];
if(!['prepare','recover'].includes(mode))throw new Error('RECOVERY_MODE_REQUIRED');
const receipt=readReceipt();
const evidence=resolve(root,'.runtime/vnext/P0-01-recovery.json');
const before=await inspect(receipt);
const unrelated=peer(receipt.name,"SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() AND datname IS NOT NULL;");
if(unrelated!=='0')throw new Error('UNRELATED_SESSIONS_PRESENT');
const catalog=await runtime();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const command=(action,extra={})=>({action,scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESTART_SYNTHETIC',...extra});
const transition=(action,result)=>command(action,{target:result.id,expectedHead:result.head,...(action==='PUBLISH'?{reviewDigest:result.reviewDigest}:{})});
const publish=async result=>catalog.command('reviewer',transition('PUBLISH',await catalog.command('maker',transition('SUBMIT',result))));
try{
 if(mode==='prepare'){
  const request=command('CREATE',{kind:'DATASET',code:'ORG26',values:{name:'合成重启恢复目录'},validFrom:'2026-01-01T00:00:00.000001',validTo:null});
  const outcome=await catalog.command('maker',request);
  const published=await publish(outcome);
  const source=await publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'RECOVERY_MANUAL',values:{name:'合成重启人工源',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'UNRESOLVED_DECLARATION',businessOwnerRole:'SYNTHETIC_OWNER',technicalRole:'SYNTHETIC_TECH',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00',validTo:null})));
  const owner=await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'RECOVERY_OWNER',values:{dataset:'ORG26',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00',validTo:null})));
  const oldR=owner.recordedAt;
  await publish(await catalog.command('maker',command('REVISE',{target:owner.id,expectedHead:owner.head,values:{},validFrom:'2026-01-01T00:00:00',validTo:'2026-06-01T00:00:00.000001'})));
  await publish(await catalog.command('maker',command('CREATE',{kind:'RESPONSIBILITY',code:'RECOVERY_SUCCESSOR',values:{dataset:'ORG26',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_B'},validFrom:'2026-06-01T00:00:00.000001',validTo:null})));
  saveExclusiveReceipt(evidence,{postmaster:before.identity.postmaster,request,outcome,published,source,owner,oldR,
   baselineHash:hash(await catalog.read('maker',{scope:'BASELINE'})),currentHash:hash(await catalog.read('maker',{scope:'SYNTHETIC'})),
   historicalHash:hash(await catalog.read('maker',{scope:'SYNTHETIC',asOf:oldR})),historyHash:hash(await catalog.history('maker','SYNTHETIC',owner.id))});
  console.log(JSON.stringify({status:'RECOVERY_PREPARED',postmaster:before.identity.postmaster,evidence}));
 }else{
  const saved=JSON.parse(readFileSync(evidence,'utf8'));
  assert.notEqual(before.identity.postmaster,saved.postmaster,'Real PostgreSQL service restart required');
  assert.equal(hash(await catalog.read('maker',{scope:'BASELINE'})),saved.baselineHash);
  assert.equal(hash(await catalog.read('maker',{scope:'SYNTHETIC'})),saved.currentHash);
  assert.equal(hash(await catalog.read('maker',{scope:'SYNTHETIC',asOf:saved.oldR})),saved.historicalHash);
  assert.equal(hash(await catalog.history('maker','SYNTHETIC',saved.owner.id)),saved.historyHash);
  assert.deepEqual(await catalog.command('maker',saved.request),saved.outcome);
  assert.equal((await catalog.resolveSource('maker','SYNTHETIC',saved.source.id,'2026-09-12T00:00:00')).realApply,'NOT_IMPLEMENTED');
  console.log(JSON.stringify({status:'PASS',postmasterBefore:saved.postmaster,postmasterAfter:before.identity.postmaster,baseline53Fields866Preserved:true,oldRAndCurrentHistoryPreserved:true,originalOutcomeRecovered:true,identity:before.identity}));
 }
}finally{await catalog.close();}
