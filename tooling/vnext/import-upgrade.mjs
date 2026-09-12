import assert from 'node:assert/strict';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readReceipt,inspect,migrate,peer,quote,root } from './lineage.mjs';

const receipt=readReceipt();const observation=await inspect(receipt);
if(![5,6,7,8,9].includes(observation.ledger.length))throw new Error('IMPORT_UPGRADE_PREFIX_REQUIRED');
const evidence=resolve(root,'.runtime/vnext/pr-2/import-upgrade-before.json');
const tables=['governance_catalog.source_snapshot','governance_catalog.object','governance_catalog.version','governance_catalog.event','vnext_control.outcome'];
const hash=text=>createHash('sha256').update(text).digest('hex');
const tableHashes=()=>Object.fromEntries(tables.map(table=>[table,hash(peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM ${table} t;`))]));
let before;
if(existsSync(evidence))before=JSON.parse(readFileSync(evidence,'utf8'));
else{
 if(observation.ledger.length!==5)throw new Error('UPGRADE_OBSERVATION_MISSING');
 const auditIds=JSON.parse(peer(receipt.name,"SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM vnext_control.audit;"));
 const auditHash=hash(peer(receipt.name,"SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM vnext_control.audit a;"));
 before={name:receipt.name,oid:receipt.oid,tableHashes:tableHashes(),auditIds,auditHash,observedBeforeMigration:6};
 writeFileSync(evidence,JSON.stringify(before,null,2)+'\n',{flag:'wx'});
}
assert.equal(before.name,receipt.name);assert.equal(before.oid,receipt.oid);assert.deepEqual(tableHashes(),before.tableHashes);
await migrate(receipt);
assert.deepEqual(tableHashes(),before.tableHashes);
const originalAudit=peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM vnext_control.audit a WHERE id=ANY(ARRAY[${before.auditIds.map(id=>quote(id)+'::uuid').join(',')}]::uuid[]);`);
assert.equal(hash(originalAudit),before.auditHash);
const imports=JSON.parse(peer(receipt.name,"SELECT jsonb_build_object('datasetCoverage',(SELECT count(*) FROM governance_catalog.object o WHERE o.scope='BASELINE' AND o.kind='DATASET' AND EXISTS(SELECT 1 FROM vnext_control.audit a WHERE a.object_id=o.id AND a.action IN ('BASELINE_IMPORT','BASELINE_IMPORT_OBSERVED'))),'batchCoverage',(SELECT count(*) FROM governance_catalog.source_snapshot s WHERE s.source_key='PACKAGE_V2' AND EXISTS(SELECT 1 FROM vnext_control.audit a WHERE a.object_id=s.id AND a.action IN ('BASELINE_IMPORT_BATCH','BASELINE_IMPORT_BATCH_OBSERVED'))),'observedRows',(SELECT count(*) FROM vnext_control.audit WHERE action IN ('BASELINE_IMPORT_OBSERVED','BASELINE_IMPORT_BATCH_OBSERVED')));"));
assert.equal(imports.datasetCoverage,53);assert.equal(imports.batchCoverage,1);
console.log(JSON.stringify({status:'PASS',identity:{name:receipt.name,oid:receipt.oid},originalMetadataAndOutcomesPreserved:true,originalAuditRowsPreserved:before.auditIds.length,imports,observationMeaning:'UPGRADE_TIME_ONLY_NOT_RETROACTIVE_IMPORT_PROOF',evidence}));
