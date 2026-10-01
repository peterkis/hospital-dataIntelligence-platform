import {createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts';

// Keep this list identical to the controlled GRANT surface in p2-01-deploy.mjs.
// Startup must prove every Department entry point is executable before routes
// are exposed; checking only mutate/authorize lets a partial provisioning fail
// later, after the server is already listening.
export const DEPARTMENT_FUNCTIONS=Object.freeze([
 'authorize(text,text,text)',
 'input_read(text,uuid,text)',
 'snapshot(text,uuid)',
 'job_read(text,uuid)',
 'list(text,uuid,integer,timestamp)',
 'code_conflict(text,text,uuid)',
 'evidence(text,uuid,uuid,uuid,text,timestamp,timestamp)',
 'mutate(text,text)',
 'committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb)',
 'replacement_read(text,uuid,timestamp)',
]);
export const DEPARTMENT_ACCESS=Object.freeze([
 ['maker','NORTH','READ'],['maker','NORTH','WRITE'],['maker','NORTH','READ_RESTRICTED'],
 ['reviewer','NORTH','READ'],['reviewer','NORTH','WRITE'],['reviewer','NORTH','READ_RESTRICTED'],
 ['maker','HOSPITAL','READ'],['reviewer','HOSPITAL','READ'],
 ['reviewer','HOSPITAL','REVIEW'],['reviewer','HOSPITAL','VERIFY'],
]);

/**
 * Proves the persistent service can reach the Department Owner's controlled
 * surface without granting it direct table or signing-key access.
 */
export async function assertDepartmentProvisioned(connection,provider){
 const pool=new Pool({connectionString:connection,max:1});
 const client=await pool.connect();let transactionOpen=false;
 try{
  const privilege=(await client.query("SELECT has_schema_privilege(current_user,'department_master','USAGE') AS schema_ready,coalesce((SELECT bool_and(has_function_privilege(current_user,signature,'EXECUTE')) FROM unnest($1::text[]) required(signature)),false) AS functions_ready,has_function_privilege(current_user,'governance_catalog.apply_record(text,text,jsonb)','EXECUTE') AS apply_ready,has_function_privilege(current_user,'governance_catalog.registration_evidence(text,uuid,uuid,text)','EXECUTE') AS evidence_ready",[DEPARTMENT_FUNCTIONS.map(signature=>'department_master.'+signature)])).rows[0];
  if(!privilege?.schema_ready||!privilege.functions_ready||!privilege.apply_ready||!privilege.evidence_ready)throw new Error('DEPARTMENT_PROVISIONING_REQUIRED');
  for(const access of DEPARTMENT_ACCESS)await client.query('SELECT department_master.authorize($1,$2,$3)',access);
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
