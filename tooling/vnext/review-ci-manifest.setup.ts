import {vi,afterAll} from 'vitest';
vi.mock('./lineage.mjs',async importOriginal=>{
 const original=await importOriginal<typeof import('./lineage.mjs')>();
 const ci=await import('./review-ci-manifest-database.mjs');
 return {...original,peer:ci.peer,inspect:ci.inspect,resolveTarget:ci.resolveTarget};
});
const {provisionAt0076,peer}=await import('./review-ci-manifest-database.mjs');
const database=await provisionAt0076();afterAll(async()=>{await database.close();});
const {seed}=await import('./catalog-seed.mjs');await seed(database.receipt);
peer(database.receipt.name,"INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;");
const {installHistoricalCampusAdmission}=await import('./review-ci-campus-lifecycle-compat.js');
installHistoricalCampusAdmission(peer,database.receipt);
