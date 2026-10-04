import {peer,identitySQL,quote} from './lineage.mjs';
import {planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
export const locationFunctions=['location_master.authorize(text,uuid,text,text)','location_master.input_read(text,uuid,text)','location_master.job_read(text,uuid)','location_master.read(text,uuid)','location_master.snapshot(text,uuid)','location_master.read_change(text,uuid)','location_master.mutate(text,text)','organization_master.location_coverage(text,uuid,timestamp,timestamp)','governance_catalog.location_source(text,uuid,timestamp,timestamp,boolean,uuid)','governance_catalog.registration_evidence(text,uuid,uuid,text)','governance_catalog.registration_evidence_access(text,uuid,uuid,text)'];
export function provisionLocation(receipt,role,provider){
 if(!/^hdi_(?:validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 const key=planBinding(provider,'LOCATION_SQL_AUTHORITY_V1',{});
 peer(receipt.name,identitySQL(receipt)+`BEGIN;SELECT pg_advisory_xact_lock(901002);INSERT INTO vnext_control.location_write_authority VALUES(true,${quote(key)}) ON CONFLICT DO NOTHING;DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.location_write_authority WHERE key_hex=${quote(key)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH';END IF;END $$;COMMIT;`,{sensitive:true});
 peer(receipt.name,identitySQL(receipt)+`GRANT USAGE ON SCHEMA location_master TO ${role};GRANT EXECUTE ON FUNCTION ${locationFunctions.join(',')} TO ${role};`);
}
export async function assertLocationProvisioned(connection,provider){
 const {Pool}=await import('pg');const pool=new Pool({connectionString:connection,max:1});
 try{const {rows}=await pool.query("select has_schema_privilege(current_user,'location_master','USAGE') allowed,has_function_privilege(current_user,'location_master.mutate(text,text)','EXECUTE') write_allowed");if(!rows[0].allowed||!rows[0].write_allowed||!provider)throw new Error('LOCATION_OWNER_NOT_PROVISIONED');}finally{await pool.end();}
}
