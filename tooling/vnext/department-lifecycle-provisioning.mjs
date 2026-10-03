import {Pool} from 'pg';
export const DEPARTMENT_LIFECYCLE_FUNCTIONS=Object.freeze([
 'department_master.lifecycle_authorize(text,text,text)',
 'department_master.lifecycle_input_read(text,uuid,text)',
 'department_master.lifecycle_snapshot(text,uuid,timestamp)',
 'department_master.lifecycle_admission(text,uuid,timestamp,timestamp,timestamp)',
 'department_master.lifecycle_mutate(text,text)',
 'department_master.lifecycle_result_exists(text,uuid)',
 'department_master.lifecycle_state_admission(text,uuid,timestamp,timestamp)',
 'department_master.lifecycle_relation_snapshot(text,uuid,text,text)',
 'department_master.impact_change_context(text,uuid,text,text)',
 'governance_catalog.department_lifecycle_assessment(text,text)',
]);
export async function assertDepartmentLifecycleProvisioned(connection){
 const pool=new Pool({connectionString:connection,max:1});try{
  const row=(await pool.query("SELECT (SELECT bool_and(has_function_privilege(current_user,f,'EXECUTE')) FROM unnest($1::text[]) f) ready,(SELECT bool_or(has_table_privilege(current_user,t,'SELECT,INSERT,UPDATE,DELETE')) FROM unnest(ARRAY['department_master.lifecycle_input','department_master.lifecycle_verification','department_master.lifecycle_version','department_master.campus_relation','department_master.campus_relation_version','department_master.lifecycle_operation','vnext_control.department_write_authority']) t) exposed",[DEPARTMENT_LIFECYCLE_FUNCTIONS])).rows[0];
  if(!row.ready||row.exposed)throw new Error('DEPARTMENT_LIFECYCLE_PROVISIONING_REQUIRED');
  const internal=(await pool.query("SELECT bool_or(has_function_privilege(current_user,f,'EXECUTE')) exposed FROM unnest(ARRAY['department_master.apply_evolution_campus_changes(text,uuid)','department_master.lifecycle_state_periods(uuid,timestamp)','department_master.lifecycle_active_periods(uuid,timestamp)']) f")).rows[0];if(internal.exposed)throw new Error('DEPARTMENT_LIFECYCLE_PROVISIONING_REQUIRED');
 }catch{throw new Error('DEPARTMENT_LIFECYCLE_PROVISIONING_REQUIRED');}finally{await pool.end();}
}
