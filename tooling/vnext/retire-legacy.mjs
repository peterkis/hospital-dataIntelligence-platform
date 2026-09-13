// One exact database only. Invoke --delete only after the displayed OID plan is confirmed.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {readReceipt,inspect,peer,quote} from './lineage.mjs';
const receipt=readReceipt();
const current=await inspect(receipt);
const inventory=JSON.parse(peer('postgres',`SELECT json_build_object('server',current_setting('data_directory'),'port',current_setting('port'),'databases',(SELECT json_agg(json_build_object('name',datname,'oid',oid::text,'owner',pg_get_userbyid(datdba),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.oid))) FROM pg_database d WHERE datname IN ('hdi_prototype',${quote(receipt.name)})));`));
assert.equal(inventory.port,'55434');
assert.equal(inventory.server,'/var/lib/pgsql/18/data');
console.log(JSON.stringify({current:current.identity,inventory}));
if(process.argv.includes('--delete')){
 const legacy=inventory.databases.find(d=>d.name==='hdi_prototype');
 assert.ok(legacy);assert.equal(legacy.oid,'16389');assert.equal(legacy.owner,'hdi_prototype');assert.equal(legacy.sessions,0);
 assert.notEqual(legacy.oid,receipt.oid);assert.notEqual(receipt.name,legacy.name);
 peer('postgres',`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='hdi_prototype' AND oid=16389 AND pg_get_userbyid(datdba)='hdi_prototype') OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='hdi_prototype') THEN RAISE EXCEPTION 'LEGACY_IDENTITY_OR_SESSION_CHANGED'; END IF; END $$;
DROP DATABASE hdi_prototype;`);
 assert.equal(peer('postgres',"SELECT count(*) FROM pg_database WHERE datname='hdi_prototype';"),'0');
 const after=await inspect(receipt);assert.equal(after.identity.oid,current.identity.oid);
 const result={status:'LEGACY_DATABASE_DELETED',legacy, current:after.identity,at:new Date().toISOString(),exit:0};
 writeFileSync('.runtime/vnext/p0-03/legacy-deleted.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
