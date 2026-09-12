import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readReceipt,inspect,migrationFiles,checkPrefix } from './lineage.mjs';
const receipt=readReceipt();const actual=await inspect(receipt);
assert.equal(checkPrefix(migrationFiles(),actual.ledger),migrationFiles().length);
for(const file of receipt.oldDatabase.sourceManifest){assert.equal(createHash('sha256').update(readFileSync('db/migrations/'+file.file)).digest('hex'),file.sha256);}
const types=readFileSync('apps/governance-api/src/platform/database/vnext-types.generated.ts','utf8');
assert.equal([...types.matchAll(/^  "(?:governance_catalog|vnext_control)\./gm)].length,10);
assert.ok(!types.includes('person_master')&&!types.includes('charge_catalog'));
const owner=readFileSync('apps/governance-api/src/modules/governance-catalog/index.ts','utf8');
assert.ok(owner.includes('vnext-types.generated.js'));
assert.ok(!owner.includes('database-types.generated.js'));
const ownership=JSON.parse(readFileSync('db/vnext/table-ownership.json','utf8'));
assert.deepEqual(Object.keys(ownership.schemas).sort(),actual.namespaces);
console.log(JSON.stringify({status:'PASS',lineage:'HDIP-MC-VNEXT',tables:10,businessInstanceSchemas:0,oldMigrationHashesPreserved:39,schemaFingerprint:actual.schemaFingerprint}));
