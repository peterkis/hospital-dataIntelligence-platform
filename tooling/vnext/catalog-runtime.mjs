import { readReceipt, inspect, resolveTarget, checkPrefix, migrationFiles } from './lineage.mjs';

export async function runtime(receiptPath) {
  const receipt = readReceipt(receiptPath);
  const observation = await inspect(receipt);
  const files=migrationFiles();
  if(checkPrefix(files,observation.ledger)!==files.length) throw new Error('CURRENT_LINEAGE_REQUIRED');
  process.env.VNEXT_DATABASE_URL=resolveTarget(receipt);
  const {openCatalog}=await import('../../apps/governance-api/src/modules/governance-catalog/index.ts');
  return openCatalog(process.env.VNEXT_DATABASE_URL);
}
