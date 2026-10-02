import {Pool} from 'pg';
export const DEPARTMENT_IMPACT_FUNCTIONS=Object.freeze([
 'department_master.impact_references(text,jsonb,text)',
 'department_master.impact_reference_access(text,jsonb,text)',
 'department_master.impact_result(text,jsonb,text)',
 'department_master.impact_successors(text,uuid,text)',
 'governance_catalog.department_impact_record(text,text)',
]);
export async function assertDepartmentImpactsProvisioned(connection){
 const pool=new Pool({connectionString:connection,max:1});
 try{
  const row=(await pool.query("SELECT (SELECT bool_and(has_function_privilege(current_user,f,'EXECUTE')) FROM unnest($1::text[]) f) ready,(SELECT bool_or(has_table_privilege(current_user,t,'SELECT,INSERT,UPDATE,DELETE')) FROM unnest(ARRAY['governance_catalog.department_impact_assessment','governance_catalog.department_impact_case','governance_catalog.department_impact_case_event','vnext_control.department_write_authority']) t) exposed",[DEPARTMENT_IMPACT_FUNCTIONS])).rows[0];
  if(!row.ready||row.exposed)throw new Error('DEPARTMENT_IMPACT_PROVISIONING_REQUIRED');
 }catch{throw new Error('DEPARTMENT_IMPACT_PROVISIONING_REQUIRED');}finally{await pool.end();}
}
