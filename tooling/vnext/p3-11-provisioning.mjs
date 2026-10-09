import {Pool} from 'pg';
import {peer,identitySQL} from './lineage.mjs';
export const lifecycleFunctions=['care_organization.lifecycle_record(text,text)','care_organization.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp)','location_master.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp)','care_organization.ward_nursing_scope_reserve(text,text)','care_organization.ward_nursing_scope_proposal_read(text,uuid)','care_organization.ward_nursing_scope_version_read(text,uuid,bigint,timestamp)'];
lifecycleFunctions.push('care_organization.ward_nursing_scope_versions_for_ward(text,uuid,timestamp)');
export function provisionCareLifecycle(receipt,role){
 if(!/^hdi_(?:validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 peer(receipt.name,identitySQL(receipt)+`GRANT USAGE ON SCHEMA care_organization,location_master TO ${role};GRANT EXECUTE ON FUNCTION ${lifecycleFunctions.join(',')} TO ${role};`);
}
export async function assertCareLifecycleProvisioned(connection){const pool=new Pool({connectionString:connection,max:1});try{if(!(await pool.query("select has_schema_privilege(current_user,'care_organization','USAGE') and has_schema_privilege(current_user,'location_master','USAGE') and bool_and(has_function_privilege(current_user,f,'EXECUTE')) allowed from unnest($1::text[]) f",[lifecycleFunctions])).rows[0].allowed)throw new Error('CARE_LIFECYCLE_OWNER_NOT_PROVISIONED');}finally{await pool.end();}}
