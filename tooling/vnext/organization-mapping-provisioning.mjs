import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';

export const ORGANIZATION_MAPPING_FUNCTIONS=Object.freeze([
 'mapping_list(text,text,uuid,integer,timestamp)','mapping_authorize(text,uuid,text,text,text,text)',
 'mapping_target_authorize(text,text,uuid,text)','mapping_source(text,uuid,timestamp,timestamp,boolean)',
 'mapping_input_read(text,uuid,text)','mapping_job_read(text,uuid)','mapping_snapshot(text,uuid)','mapping_snapshot_optional(text,uuid)',
 'mapping_find(text,uuid,text,text,text,text)','mapping_mutate(text,text)',
 'mapping_resolution_required(text,uuid,text,text,text,text,text,uuid,timestamp,timestamp)',
]);
export async function assertOrganizationMappingsProvisioned(connection,provider,binding){
 const expected=binding??JSON.parse(readFileSync('.runtime/vnext/p2-03/provisioning.json','utf8'));
 const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect();let transaction=false;
 try{
  const r=(await client.query("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,coalesce((SELECT bool_and(has_function_privilege(current_user,signature,'EXECUTE')) FROM unnest($1::text[]) f(signature)),false) AS functions_ready,has_table_privilege(current_user,'department_master.organization_mapping','INSERT') AS direct_write,has_table_privilege(current_user,'vnext_control.department_write_authority','SELECT') AS key_read",[ORGANIZATION_MAPPING_FUNCTIONS.map(f=>'department_master.'+f)])).rows[0];
  if(r.database!==expected.database||r.oid!==expected.databaseOid||!r.functions_ready||r.direct_write||r.key_read)throw new Error('ORGANIZATION_MAPPING_PROVISIONING_REQUIRED');
  const identities=[];
  for(const actor of ['maker','reviewer']){
   for(const permission of actor==='maker'?['READ','WRITE','READ_RESTRICTED']:['READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW']){
    const grant=(await client.query('SELECT department_master.mapping_authorize($1,$2,$3,$4,$5,$6) AS identity',[actor,expected.sourceId,expected.entityType,expected.context,expected.campus,permission])).rows[0];
    if(permission==='READ')identities.push(grant.identity);
   }
   await client.query('SELECT department_master.mapping_target_authorize($1,$2,$3,$4)',[actor,expected.targetType,expected.targetId,expected.campus]);
  }
  if(identities[0]===identities[1])throw new Error('ORGANIZATION_MAPPING_PROVISIONING_REQUIRED');
  await client.query('BEGIN');transaction=true;
  const id=(await client.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id;
  const ticket=canonicalPlan({actor:'maker',operation:'PROVISIONING_PROBE',transaction:id}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');let signature;
  try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
  try{await client.query('SELECT department_master.mapping_mutate($1,$2)',[ticket,signature]);throw new Error('ORGANIZATION_MAPPING_PROVISIONING_REQUIRED');}
  catch(error){if(!(error instanceof Error&&error.message==='NOT_FOUND'))throw new Error('ORGANIZATION_MAPPING_PROVISIONING_REQUIRED');}
  await client.query('ROLLBACK');transaction=false;
 }catch{if(transaction)await client.query('ROLLBACK').catch(()=>{});throw new Error('ORGANIZATION_MAPPING_PROVISIONING_REQUIRED');}
 finally{client.release();await pool.end();}
}
