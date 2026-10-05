import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {readReceipt,inspect,peer,quote,identitySQL,migrationFiles,checkPrefix} from './lineage.mjs';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const directory='.runtime/vnext/p3-04',receipt=readReceipt(),current=await inspect(receipt);
const currentPrefix=migrationFiles().length;assert.equal(checkPrefix(migrationFiles(),current.ledger),currentPrefix);
const before=readdirSync(directory).filter(n=>/^deployment-[0-9]+\.before\.json$/.test(n)).sort().map(n=>({file:directory+'/'+n,data:JSON.parse(readFileSync(directory+'/'+n,'utf8'))})).find(v=>v.data.identity.oid===receipt.oid&&v.data.ledger.length===185);
if(!before)throw new Error('ORIGINAL_0185_SNAPSHOT_REQUIRED');
assert.deepEqual(current.ledger.slice(0,185),before.data.ledger);
assert.equal(createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),before.data.keyDigest);
const tables=Object.keys(before.data.rowHashes);assert.ok(tables.length>0);
const queries=tables.map(table=>{if(!/^(vnext_control|governance_catalog|organization_master|department_master|location_master|care_organization)\.[a-z_]+$/.test(table))throw new Error('PRESERVATION_TABLE_INVALID');return `SELECT ${quote(table)} name,coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')),'[]') hashes FROM ${table} o`;});
const hashes=JSON.parse(peer(receipt.name,'\\set QUIET on\n'+identitySQL(receipt)+`SELECT jsonb_object_agg(name,hashes)::text FROM (${queries.join(' UNION ALL ')}) original_rows;`));
for(const table of tables){const old=before.data.rowHashes[table];assert.ok(Array.isArray(old)&&old.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)));const retained=new Set(hashes[table]);assert.ok(old.every(h=>retained.has(h)),'Original0185 rows changed: '+table);}
const file=directory+'/original-0185-preservation-'+Date.now()+'.json';
writeFileSync(file,JSON.stringify({gate:'P3_04_ORIGINAL_0185_PRESERVATION',status:'PASS',oid:receipt.oid,currentPrefix,predecessorPrefix:185,originalSnapshot:before.file,originalRowsPreserved:true,oldLedgerPreserved:true,keyBytesPreserved:true,tablesChecked:tables.length,scope:'Synthetic retained development database; formal acceptance NOT_RUN'},null,2),{flag:'wx'});
console.log(JSON.stringify({gate:'P3_04_ORIGINAL_0185_PRESERVATION',status:'PASS',evidence:file}));
