import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
export function grantDepartment(receipt,role){
 if(!/^hdi_(validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 peer(receipt.name,`GRANT USAGE ON SCHEMA department_master TO ${role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA department_master TO ${role}; GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb),governance_catalog.registration_evidence(text,uuid,uuid,text) TO ${role};
 DO $$ BEGIN IF to_regprocedure('governance_catalog.registration_evidence_access(text,uuid,uuid,text)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION governance_catalog.registration_evidence_access(text,uuid,uuid,text) TO ${role}';END IF;END $$;
 DO $$ BEGIN IF to_regprocedure('governance_catalog.protected_original_context(text,uuid)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION governance_catalog.protected_original_context(text,uuid) TO ${role}';END IF;END $$;
 DO $$ BEGIN IF to_regprocedure('governance_catalog.department_impact_record(text,text)') IS NOT NULL THEN EXECUTE 'GRANT EXECUTE ON FUNCTION governance_catalog.department_impact_record(text,text) TO ${role}';END IF;END $$;
 INSERT INTO department_master.access SELECT a,'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;
 INSERT INTO department_master.access SELECT a,'HOSPITAL','READ' FROM unnest(ARRAY['maker','maker-alias','reviewer']) a ON CONFLICT DO NOTHING;
 INSERT INTO department_master.access SELECT 'reviewer','HOSPITAL',p FROM unnest(ARRAY['REVIEW','VERIFY']) p ON CONFLICT DO NOTHING;
 DO $$ DECLARE signature text;BEGIN FOREACH signature IN ARRAY ARRAY['department_master.apply_evolution_campus_changes(text,uuid)','department_master.lifecycle_state_periods(uuid,timestamp)','department_master.lifecycle_active_periods(uuid,timestamp)','department_master.workspace_impact_result_access(text,text,uuid,text)','department_master.workspace_hierarchy_group_access(text,jsonb)','department_master.workspace_department_version_access(text,jsonb)','department_master.impact_result_access(text,jsonb,text)'] LOOP IF to_regprocedure(signature) IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM ${role}';END IF;END LOOP;END $$;`);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/p2-01-validate.mjs')){
 const args=process.argv.slice(2);if(args.some(a=>!['--generate','--upgrade'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
 const owned=createTemporary('P2-01');let owner;
 try{
  let before,tables,digest;
  if(args.includes('--upgrade')){await migrate(owned.receipt,migrationFiles().slice(0,83));await seed(owned.receipt);owner=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);const prefix=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p1-02-prefix.ts'],{cwd:root,env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_UPGRADE_PREFIX:'83'},stdio:'inherit',windowsHide:true});assert.equal(prefix.status,0);before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);}
  await migrate(owned.receipt);await seed(owned.receipt);
  if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,83),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({status:'PREFIX_DATA_PRESERVED',prefix:83,digest}));}
  owner??=await createValidationOwnerSession(owned.receipt);grantDepartment(owned.receipt,owner.receipt.role);
  const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs',args.includes('--generate')?'types-generate':'types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p2-01-db.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P2-01'},stdio:'inherit',windowsHide:true});
  process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P2-01',exit:run.status,receipt:owned.receiptPath,mode:args.includes('--upgrade')?'83_TO_CURRENT':'FRESH'}));
 }catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
