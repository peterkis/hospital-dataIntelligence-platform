import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,resolveTarget,peer,quote } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { validateCheckpoint } from './audit-checkpoint.mjs';

const owned=createTemporary();let catalog;let pool;
try{
 const valid={status:'PASS',databaseName:owned.receipt.name,databaseOid:owned.receipt.oid,auditStreamId:'GOVERNANCE_CATALOG',auditSequence:'1',currentHash:'a'.repeat(64)};
 assert.deepEqual(validateCheckpoint(valid,owned.receipt),valid);
 for(const invalid of [null,[],{}, {...valid,auditSequence:undefined,currentHash:undefined},{...valid,auditSequence:undefined},{...valid,currentHash:undefined},{...valid,auditSequence:'0'},{...valid,auditSequence:'9223372036854775808'},{...valid,currentHash:'invalid'},{...valid,databaseOid:'0'}])assert.throws(()=>validateCheckpoint(invalid,owned.receipt),/AUDIT_CHECKPOINT_INVALID/);
 await migrate(owned.receipt,migrationFiles().slice(0,3));await seed(owned.receipt);
 catalog=await openCatalog(resolveTarget(owned.receipt));
 const command=code=>({action:'CREATE',scope:'SYNTHETIC',kind:'DATASET',code,values:{name:'合成审计验证'},requestId:randomUUID(),reason:'AUDIT_TEST',validFrom:'2026-01-01T00:00:00'});
 await catalog.command('maker',command('ORG01'));
 const original=peer(owned.receipt.name,'SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vnext_control.audit a;');
 await catalog.close();catalog=null;
 await migrate(owned.receipt);
 assert.equal(peer(owned.receipt.name,'SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vnext_control.audit a;'),original);
 catalog=await openCatalog(resolveTarget(owned.receipt));
 const baseline=await catalog.verifyAudit('auditor');assert.equal(baseline.legacyCount,'55');assert.equal(baseline.eventCount,'0');
 await assert.rejects(catalog.verifyAudit('maker'),/ACCESS_DENIED/);
 await assert.rejects(catalog.command('auditor',command('ORG02')),/ACCESS_DENIED/);
 const requests=['ORG02','ORG03','ORG04'].map(command);
 await Promise.all(requests.map(input=>catalog.command('maker',input)));
 const checkpoint=await catalog.verifyAudit('auditor',baseline);assert.equal(checkpoint.eventCount,'3');assert.equal(checkpoint.auditSequence,'4');
 await catalog.command('maker-alias',requests[0]);assert.deepEqual(await catalog.verifyAudit('auditor',checkpoint),checkpoint);
 pool=new pg.Pool({connectionString:resolveTarget(owned.receipt),max:1});
 for(const query of ['select * from vnext_control.audit','select * from vnext_control.audit_chain','delete from vnext_control.audit_chain','truncate vnext_control.audit_chain']) await assert.rejects(pool.query(query),/permission denied/);
 const tamper=(change,expected,cp='NULL,NULL')=>{
  const result=peer(owned.receipt.name,`BEGIN; ${change}
  DO $test$ DECLARE failed boolean:=false; BEGIN
   BEGIN PERFORM vnext_control.verify_audit('auditor',${cp}); EXCEPTION WHEN OTHERS THEN IF SQLERRM ~ ${quote(expected)} THEN failed:=true; ELSE RAISE; END IF; END;
   IF NOT failed THEN RAISE EXCEPTION 'TAMPER_NOT_DETECTED'; END IF;
  END $test$; ROLLBACK;`);
  assert.ok(result.includes('ROLLBACK'));
 };
 tamper("ALTER TABLE vnext_control.audit DISABLE TRIGGER audit_immutable; UPDATE vnext_control.audit SET reason='ALTERED' WHERE id=(SELECT audit_id FROM vnext_control.audit_chain WHERE audit_sequence=2);",'AUDIT_ROW_MISMATCH');
 tamper("ALTER TABLE vnext_control.audit DISABLE TRIGGER audit_immutable; UPDATE vnext_control.audit SET reason='ALTERED' WHERE id NOT IN(SELECT audit_id FROM vnext_control.audit_chain WHERE audit_id IS NOT NULL);",'AUDIT_LEGACY_SET_MISMATCH');
 tamper("ALTER TABLE vnext_control.audit_chain DISABLE TRIGGER audit_chain_immutable; UPDATE vnext_control.audit_chain SET previous_hash=repeat('f',64) WHERE audit_sequence=3;",'AUDIT_CHAIN_INVALID');
 tamper("ALTER TABLE vnext_control.audit_chain DISABLE TRIGGER audit_chain_immutable; DELETE FROM vnext_control.audit_chain WHERE audit_sequence=3;",'AUDIT_CHAIN_INVALID');
 tamper("ALTER TABLE vnext_control.audit_chain DISABLE TRIGGER audit_chain_immutable; DELETE FROM vnext_control.audit_chain WHERE audit_sequence=4;",'AUDIT_LEGACY_SET_MISMATCH');
 tamper("ALTER TABLE vnext_control.audit_chain DISABLE TRIGGER audit_chain_immutable; ALTER TABLE vnext_control.audit DISABLE TRIGGER audit_immutable; CREATE TEMP TABLE tail AS SELECT audit_id FROM vnext_control.audit_chain WHERE audit_sequence=4; DELETE FROM vnext_control.audit_chain WHERE audit_sequence=4; DELETE FROM vnext_control.audit WHERE id IN(SELECT audit_id FROM tail);",'AUDIT_CHECKPOINT_MISMATCH',`${checkpoint.auditSequence},${quote(checkpoint.currentHash)}`);
 peer(owned.receipt.name,"DELETE FROM vnext_control.actor_grant WHERE actor_code='auditor' AND permission='AUDIT';");
 await assert.rejects(catalog.verifyAudit('auditor',checkpoint),/ACCESS_DENIED/);
 peer(owned.receipt.name,"INSERT INTO vnext_control.actor_grant VALUES('auditor','SYNTHETIC','AUDIT');");
 assert.deepEqual(await catalog.verifyAudit('auditor',checkpoint),checkpoint);
 console.log(JSON.stringify({status:'PASS',checks:['LEGACY_ROWS_UNCHANGED','CANONICAL_CONCURRENT_ORDER','ALIAS_REPLAY_NO_EXTRA_AUDIT','SEPARATE_AUDIT_PERMISSION','RAW_AND_CHAIN_DML_DENIED','EVENT_TAMPER','LEGACY_TAMPER','CHAIN_EDIT','MIDDLE_DELETION','TAIL_DELETION','CHECKPOINT_TRUNCATION','REVOKED_AUDITOR'],receipt:owned.receipt,checkpoint}));
}finally{await catalog?.close();await pool?.end();dropTemporary(owned.receipt);}
