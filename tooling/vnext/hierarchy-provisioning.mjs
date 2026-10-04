import {peer,identitySQL,quote} from './lineage.mjs';
import {Pool} from 'pg';

const functions=[
 'authorize(text,text,text)',
 'hierarchy_create_view(text,jsonb)',
 'hierarchy_store_candidate(text,jsonb)',
 'hierarchy_approve(text,uuid,text)',
 'hierarchy_publish(text,uuid,text,jsonb)',
 'hierarchy_lifecycle(text,text,jsonb)',
 'hierarchy_authorize(text,uuid,text)',
 'hierarchy_read(text,text,jsonb)',
 'hierarchy_workspace_query(text,text,jsonb)',
];

// Use the same required surface as provisioning, but never repair privileges
// during startup or verification of an existing installation.
export async function assertHierarchyProvisioned(connection){
 const pool=new Pool({connectionString:connection,max:1});
 try{
  const result=(await pool.query("SELECT has_schema_privilege(current_user,'department_master','USAGE') AS schema_ready,coalesce((SELECT bool_and(has_function_privilege(current_user,signature,'EXECUTE')) FROM unnest($1::text[]) required(signature)),false) AS functions_ready",[functions.map(signature=>'department_master.'+signature)])).rows[0];
  if(!result?.schema_ready||!result.functions_ready)throw new Error('HIERARCHY_PROVISIONING_REQUIRED');
 }catch{throw new Error('HIERARCHY_PROVISIONING_REQUIRED');}
 finally{await pool.end();}
}

// Grants only the Owner's required SQL entry points. Actor and per-view permissions remain
// separately administered; the application never gains table access.
export function grantHierarchyFunctions(receipt,ownership){
 if(!/^hdi_(validation|owner)_[a-f0-9]{16}$/.test(ownership.role)||!/^\d+$/.test(String(ownership.roleOid)))throw new Error('OWNER_ROLE_IDENTITY_MISMATCH');
 if(ownership.database!==receipt.name||ownership.databaseOid!==receipt.oid)throw new Error('OWNER_RECEIPT_MISMATCH');
 peer(receipt.name,identitySQL(receipt)+` BEGIN; SELECT pg_advisory_xact_lock(901002);
 DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(ownership.role)}) IS DISTINCT FROM ${quote(String(ownership.roleOid))} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH'; END IF; END $$;
 GRANT USAGE ON SCHEMA department_master TO ${ownership.role};
 GRANT EXECUTE ON FUNCTION ${functions.map(signature=>'department_master.'+signature).join(',')} TO ${ownership.role}; COMMIT;`);
}
