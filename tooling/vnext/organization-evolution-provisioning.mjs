import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';

export const ORGANIZATION_EVOLUTION_FUNCTIONS=Object.freeze([
 'evolution_authorize(text,text,text)','evolution_source_authorize(text,uuid)',
 'evolution_original_context(text,uuid)','evolution_original_authorize(text,uuid,jsonb)',
 'evolution_input_read(text,uuid,text)','evolution_job_read(text,uuid)',
 'evolution_snapshot(text,uuid,text)','evolution_list(text,text,uuid,integer,timestamp)',
 'evolution_history(text,uuid,text,uuid,integer,timestamp)','evolution_mutate(text,text)',
 'replacement_read(text,uuid,timestamp)','mapping_source(text,uuid,timestamp,timestamp,boolean)',
 'snapshot(text,uuid)','code_conflict(text,text,uuid)',
 'evidence(text,uuid,uuid,uuid,text,timestamp,timestamp)',
]);
export const EVOLUTION_CATALOG_FUNCTIONS=Object.freeze([
 'apply_record(text,text,jsonb)','registration_evidence(text,uuid,uuid,text)',
 'registration_evidence_access(text,uuid,uuid,text)','contract_read(text,jsonb)','import_job_read(text,jsonb)',
 'protected_original_context(text,uuid)',
]);
export async function assertOrganizationEvolutionsProvisioned(connection,provider,binding){
 const expected=binding??JSON.parse(readFileSync('.runtime/vnext/p2-05/provisioning.json','utf8'));
 const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect();let transaction=false;
 try{
  const signatures=[...ORGANIZATION_EVOLUTION_FUNCTIONS.map(name=>'department_master.'+name),...EVOLUTION_CATALOG_FUNCTIONS.map(name=>'governance_catalog.'+name)];
  const row=(await client.query("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,current_user AS role,(SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS role_oid,(SELECT bool_and(has_function_privilege(current_user,signature,'EXECUTE')) FROM unnest($1::text[]) fn(signature)) AS functions_ready,(SELECT bool_or(has_table_privilege(current_user,name,'INSERT,UPDATE,DELETE')) FROM unnest(ARRAY['department_master.evolution_input','department_master.evolution_verification','department_master.evolution_event','department_master.evolution_relation','department_master.replacement']) t(name)) AS direct_write,has_table_privilege(current_user,'vnext_control.department_write_authority','SELECT') AS key_read",[signatures])).rows[0];
  if(row.database!==expected.database||row.oid!==expected.databaseOid||row.role!==expected.serviceRole||row.role_oid!==expected.serviceRoleOid||!row.functions_ready||row.direct_write||row.key_read)throw new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');
  const identities=[];
  for(const actor of ['maker','reviewer']){
   for(const permission of actor==='maker'?['READ','READ_RESTRICTED','WRITE']:['READ','READ_RESTRICTED','WRITE','VERIFY','REVIEW']){
    const value=(await client.query('SELECT department_master.evolution_authorize($1,$2,$3) identity',[actor,expected.campus,permission])).rows[0];if(permission==='READ')identities.push(value.identity);
   }
   await client.query('SELECT department_master.evolution_source_authorize($1,$2)',[actor,expected.sourceId]);
  }
  if(identities[0]===identities[1])throw new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');
  await client.query('BEGIN');transaction=true;
  const id=(await client.query('SELECT pg_current_xact_id()::text id')).rows[0].id,ticket=canonicalPlan({actor:'maker',operation:'PROVISIONING_PROBE',transaction:id});
  const key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');let signature;
  try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
  try{await client.query('SELECT department_master.evolution_mutate($1,$2)',[ticket,signature]);throw new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');}
  catch(error){if(!(error instanceof Error&&error.message==='NOT_FOUND'))throw new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');}
  await client.query('ROLLBACK');transaction=false;
 }catch{if(transaction)await client.query('ROLLBACK').catch(()=>{});throw new Error('ORGANIZATION_EVOLUTION_PROVISIONING_REQUIRED');}
 finally{client.release();await pool.end();}
}
