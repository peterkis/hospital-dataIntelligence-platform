import {createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts';

/**
 * Proves the persistent service can reach the Department Owner's controlled
 * surface without granting it direct table or signing-key access.
 */
export async function assertDepartmentProvisioned(connection,provider){
 const pool=new Pool({connectionString:connection,max:1});
 const client=await pool.connect();let transactionOpen=false;
 try{
  const privilege=(await client.query("SELECT has_schema_privilege(current_user,'department_master','USAGE') AS schema_ready,has_function_privilege(current_user,'department_master.authorize(text,text,text)','EXECUTE') AS authorize_ready,has_function_privilege(current_user,'department_master.mutate(text,text)','EXECUTE') AS mutate_ready,has_function_privilege(current_user,'governance_catalog.apply_record(text,text,jsonb)','EXECUTE') AS apply_ready")).rows[0];
  if(!privilege?.schema_ready||!privilege.authorize_ready||!privilege.mutate_ready||!privilege.apply_ready)throw new Error('DEPARTMENT_PROVISIONING_REQUIRED');
  await client.query("SELECT department_master.authorize('maker','NORTH','READ')");
  await client.query('BEGIN');transactionOpen=true;
  const transaction=(await client.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id;
  const ticket=canonicalPlan({actor:'maker',operation:'PROVISIONING_PROBE',transaction});
  const key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  let signature;
  try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
  try{await client.query('SELECT department_master.mutate($1,$2)',[ticket,signature]);throw new Error('DEPARTMENT_PROVISIONING_REQUIRED');}
  catch(error){if(!(error instanceof Error&&['CLOSED_INPUT_REQUIRED','NOT_FOUND'].includes(error.message)))throw new Error('DEPARTMENT_PROVISIONING_REQUIRED');}
  await client.query('ROLLBACK');transactionOpen=false;
 }catch(error){if(transactionOpen)await client.query('ROLLBACK').catch(()=>{});if(error instanceof Error&&error.message==='DEPARTMENT_PROVISIONING_REQUIRED')throw error;throw new Error('DEPARTMENT_PROVISIONING_REQUIRED');}
 finally{client.release();await pool.end();}
}
