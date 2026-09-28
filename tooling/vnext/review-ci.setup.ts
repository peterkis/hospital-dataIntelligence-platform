import {vi,afterAll} from 'vitest';
// Only the WSL administrative transport is replaced. Domain Owners, HTTP,
// authorization SQL, migrations, encryption and transactions are all real.
vi.mock('./lineage.mjs',async importOriginal=>{
 const original=await importOriginal<typeof import('./lineage.mjs')>();
 const ci=await import('./review-ci-database.mjs');
 const compat=await import('./review-ci-campus-lifecycle-compat.js');
 const migrationFiles=(directory?:string)=>{
  const files=directory===undefined?original.migrationFiles():original.migrationFiles(directory);
  const boundary=compat.historicalWorkspaceBoundary();
  return boundary===null?files:files.slice(0,boundary);
 };
 return {...original,migrationFiles,peer:ci.peer,inspect:ci.inspect,resolveTarget:ci.resolveTarget};
});
const {provision,peer}=await import('./review-ci-database.mjs');
const database=await provision();
afterAll(async()=>{await database.close();});
const {seed}=await import('./catalog-seed.mjs');
await seed(database.receipt);
peer(database.receipt.name,"INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;");
const {installHistoricalCampusAdmission}=await import('./review-ci-campus-lifecycle-compat.js');
installHistoricalCampusAdmission(peer,database.receipt);
