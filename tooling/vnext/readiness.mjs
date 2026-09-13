import { pathToFileURL } from 'node:url';
import { readReceipt, inspect, migrationFiles, checkPrefix } from './lineage.mjs';

// Readiness accepts a verified installed prefix so the managed migrate command
// can bring the retained database up to the current source chain.
export async function probe(receipt = readReceipt()) {
  const observation = await inspect(receipt);
  checkPrefix(migrationFiles(), observation.ledger);
  if (!observation.ledger.length) throw new Error('INSTALLED_LINEAGE_REQUIRED');
  return { databaseConnected: true, ...observation };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await probe()));
  } catch (error) {
    console.error(JSON.stringify({ databaseConnected: false,
      errorCode: /^[A-Z][A-Z0-9_]+$/u.test(error.code ?? error.message)
        ? (error.code ?? error.message) : 'VNEXT_READINESS_FAILED' }));
    process.exitCode = 1;
  }
}
