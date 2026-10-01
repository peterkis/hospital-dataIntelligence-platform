import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
export const ORGANIZATION_IDENTIFIER_FUNCTIONS=Object.freeze([
 'identifier_authorize(text,text,text,text)','identifier_input_read(text,uuid,text)','identifier_job_read(text,uuid)',
 'identifier_snapshot(text,uuid,text)','identifier_list(text,text,uuid,integer,timestamp,text,uuid)',
 'identifier_code(text,text,uuid)','identifier_peers(text,text,uuid,text,text,text)','identifier_mutate(text,text)',
 'department_code_at(text,uuid,timestamp,timestamp)','department_code_at_authorized(text,uuid,timestamp,timestamp,text)','identifier_selected(text,uuid,text,timestamp)','mapping_target_authorize(text,text,uuid,text)','mapping_source(text,uuid,timestamp,timestamp,boolean)',
]);
export async function assertOrganizationIdentifiersProvisioned(connection,provider,binding){
 const expected=binding??JSON.parse(readFileSync('.runtime/vnext/p2-04/provisioning.json','utf8'));
 const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect();let transaction=false;
 try{
  const r=(await client.query("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT bool_and(has_function_privilege(current_user,signature,'EXECUTE')) FROM unnest($1::text[]) f(signature)) AS functions_ready,(SELECT bool_or(has_table_privilege(current_user,name,'INSERT')) FROM unnest(ARRAY['department_master.organization_identifier','department_master.organization_identifier_version','department_master.identifier_input','department_master.identifier_verification']) t(name)) AS direct_write,has_table_privilege(current_user,'vnext_control.department_write_authority','SELECT') AS key_read",[ORGANIZATION_IDENTIFIER_FUNCTIONS.map(f=>'department_master.'+f)])).rows[0];
  if(r.database!==expected.database||r.oid!==expected.databaseOid||!r.functions_ready||r.direct_write||r.key_read)throw new Error('ORGANIZATION_IDENTIFIER_PROVISIONING_REQUIRED');
  const identities=[];
  for(const actor of ['maker','reviewer']){
   for(const scheme of expected.schemes)for(const permission of actor==='maker'?['READ','WRITE','READ_RESTRICTED']:['READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW']){
    const result=(await client.query('SELECT department_master.identifier_authorize($1,$2,$3,$4) AS identity',[actor,scheme,expected.campus,permission])).rows[0];if(permission==='READ'&&scheme===expected.schemes[0])identities.push(result.identity);
   }
   await client.query('SELECT department_master.mapping_target_authorize($1,$2,$3,$4)',[actor,expected.targetType,expected.targetId,expected.campus]);
  }
  if(identities[0]===identities[1])throw new Error('ORGANIZATION_IDENTIFIER_PROVISIONING_REQUIRED');
  await client.query('BEGIN');transaction=true;const tx=(await client.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id,ticket=canonicalPlan({actor:'maker',operation:'PROVISIONING_PROBE',transaction:tx}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');let signature;
  try{signature=createHmac('sha256',key).update(ticket).digest('hex');}finally{key.fill(0);}
  try{await client.query('SELECT department_master.identifier_mutate($1,$2)',[ticket,signature]);throw new Error('ORGANIZATION_IDENTIFIER_PROVISIONING_REQUIRED');}catch(error){if(!(error instanceof Error&&error.message==='NOT_FOUND'))throw new Error('ORGANIZATION_IDENTIFIER_PROVISIONING_REQUIRED');}
  await client.query('ROLLBACK');transaction=false;
 }catch{if(transaction)await client.query('ROLLBACK').catch(()=>{});throw new Error('ORGANIZATION_IDENTIFIER_PROVISIONING_REQUIRED');}
 finally{client.release();await pool.end();}
}
