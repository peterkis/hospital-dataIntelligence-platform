import {peer,identitySQL,quote} from './lineage.mjs';
import {planBinding} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts';
/** Receipt-bound administration only; never callable with the service connection. */
export function provisionCampusAuthority(receipt,provider){
 const key=planBinding(provider,'CAMPUS_SQL_AUTHORITY_V1',{});
 peer(receipt.name,identitySQL(receipt)+` BEGIN; SELECT pg_advisory_xact_lock(901002); INSERT INTO vnext_control.campus_write_authority VALUES(true,${quote(key)}) ON CONFLICT DO NOTHING; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.campus_write_authority WHERE key_hex=${quote(key)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH';END IF;END $$; COMMIT;`,{sensitive:true});
}
