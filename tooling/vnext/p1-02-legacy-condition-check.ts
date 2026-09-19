import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const reference=JSON.parse(readFileSync(`.runtime/vnext/fresh/${receipt.name}.legacy-campus.json`,'utf8'));
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,catalog=await openCatalog(connection),pool=new Pool({connectionString:connection});
try{
 const current=(await catalog.contractRead('reviewer',{scope:'SYNTHETIC',target:reference.contractId,mode:'CURRENT'}))[0]!;
 assert.equal(current.versionId,reference.contractVersionId);assert.equal(current.status,'PUBLISHED');assert.equal(current.definition.rules.some(r=>r.id==='SRC-COND-005'),false);
 await assert.rejects(pool.query('SELECT governance_catalog.campus_division($1,$2::jsonb,$3::timestamp,$4::timestamp)',['reviewer',JSON.stringify(reference),'2026-01-01T00:00:00',null]),/BLOCKED_DEPENDENCY/);
 console.log(JSON.stringify({status:'LEGACY_PARTIAL_CONTRACT_REJECTED',historicalPublicationRetained:true}));
}finally{await catalog.close();await pool.end();}
