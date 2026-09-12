import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,inspect,peer } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';

for(const collision of [false,true]){
 const owned=createTemporary();let catalog;
 try{
  await migrate(owned.receipt,migrationFiles().slice(0,2));await seed(owned.receipt);
  catalog=await openCatalog(resolveTarget(owned.receipt));
  const request={action:'CREATE',scope:'SYNTHETIC',kind:'DATASET',code:'ORG01',values:{name:'合成迁移前结果'},requestId:randomUUID(),reason:'REPLAY_UPGRADE',validFrom:'2026-01-01T00:00:00'};
  const original=await catalog.command('maker',request);
  if(collision)await catalog.command('maker-alias',{...request,code:'ORG02'});
  const before=peer(owned.receipt.name,'SELECT jsonb_agg(to_jsonb(o) ORDER BY actor_code,request_id)::text FROM vnext_control.outcome o;');
  await assert.rejects(migrate(owned.receipt),/CATALOG_RUNTIME_MUST_BE_STOPPED/);
  await catalog.close();catalog=null;
  if(collision){
   await assert.rejects(migrate(owned.receipt),/OUTCOME_IDENTITY_COLLISION/);
   assert.equal((await inspect(owned.receipt)).ledger.length,2);
   assert.equal(peer(owned.receipt.name,"SELECT to_regclass('vnext_control.request_identity') IS NULL;"),'t');
  }else{
   await migrate(owned.receipt);await migrate(owned.receipt);
   catalog=await openCatalog(resolveTarget(owned.receipt));
   assert.deepEqual(await catalog.command('maker-alias',request),original);
   peer(owned.receipt.name,"DELETE FROM vnext_control.actor_grant WHERE actor_code='maker-alias' AND scope='SYNTHETIC' AND permission='WRITE';");
   await assert.rejects(catalog.command('maker-alias',request),/ACCESS_DENIED/);
  }
  assert.equal(peer(owned.receipt.name,'SELECT jsonb_agg(to_jsonb(o) ORDER BY actor_code,request_id)::text FROM vnext_control.outcome o;'),before);
  console.log(JSON.stringify({status:'PASS',scenario:collision?'AMBIGUOUS_LEGACY_OUTCOME_ROLLBACK':'LEGACY_ALIAS_REPLAY_UPGRADE',originalOutcomesUnchanged:true,receipt:owned.receipt}));
 }finally{await catalog?.close();dropTemporary(owned.receipt);}
}
