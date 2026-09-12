import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readReceipt, resolveTarget, inspect, migrate, migrationFiles, checkPrefix, root } from './lineage.mjs';

try {
  const [command, receiptArgument, ...extra] = process.argv.slice(2);
  if (!['verify', 'migrate', 'seed', 'types-generate', 'types-verify'].includes(command) || extra.length) throw new Error('CLOSED_COMMAND_REQUIRED');
  const receipt = readReceipt(receiptArgument);
  const observation = await inspect(receipt);
  let finalObservation = observation;
  const files = migrationFiles();
  checkPrefix(files, observation.ledger);
  if (command === 'migrate') {
    const result = await migrate(receipt);
    finalObservation = result;
    writeFileSync(root + '/.runtime/vnext/install-' + receipt.oid + '.json', JSON.stringify(result, null, 2));
  } else if (command === 'seed') {
    if (observation.ledger.length !== files.length) throw new Error('CURRENT_LINEAGE_REQUIRED');
    const { seed } = await import('./catalog-seed.mjs');
    await seed(receipt);
  } else if (command.startsWith('types-')) {
    if (observation.ledger.length !== files.length) throw new Error('CURRENT_LINEAGE_REQUIRED');
    const result = spawnSync(process.execPath, [root + '/node_modules/kysely-codegen/dist/cli/bin.js', '--config-file', root + '/db/vnext/codegen.json', ...(command === 'types-verify' ? ['--verify'] : [])], {
      cwd: root, env: { ...process.env, DATABASE_URL: resolveTarget(receipt) }, encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) throw new Error('VNEXT_CODEGEN_FAILED');
  }
  console.log(JSON.stringify({ status: 'PASS', command, identity: finalObservation.identity, ledger: finalObservation.ledger, schemaFingerprint:finalObservation.schemaFingerprint }));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'VNEXT_MANAGED_FAILED' }));
  process.exitCode = 1;
}
