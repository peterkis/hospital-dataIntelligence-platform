import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,lstatSync} from 'node:fs';
import {readReceipt,inspect,peer,quote,identitySQL,migrationFiles,checkPrefix} from './lineage.mjs';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const directory='.runtime/vnext/p3-05',receipt=readReceipt();assert.equal(receipt.oid,'206108','P3_05_RETAINED_RECEIPT_REQUIRED');
const current=await inspect(receipt),files=migrationFiles(),currentPrefix=checkPrefix(files,current.ledger);assert.equal(currentPrefix,files.length);
const snapshots=readdirSync(directory).filter(n=>/^deployment-[0-9]+\.before\.json$/.test(n)).sort().map(n=>{
 const file=directory+'/'+n;if(lstatSync(file).isSymbolicLink())throw new Error('PRESERVATION_PATH_INVALID');return {file,data:JSON.parse(readFileSync(file,'utf8'))};
});
const before=snapshots.find(v=>v.data.identity.oid===receipt.oid&&v.data.ledger.length===196);if(!before)throw new Error('ORIGINAL_0196_SNAPSHOT_REQUIRED');
assert.equal(before.data.identity.name,receipt.name);assert.equal(before.data.identity.owner,receipt.owner);assert.equal(before.data.identity.port,receipt.port);
assert.deepEqual(current.ledger.slice(0,196),before.data.ledger);assert.equal(checkPrefix(files,before.data.ledger),196);
assert.equal(createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),before.data.keyDigest);
const tables=Object.keys(before.data.rowHashes);assert.ok(tables.length>0);
const queries=tables.map(table=>{if(!/^(vnext_control|governance_catalog|organization_master|department_master|location_master|care_organization)\.[a-z_]+$/.test(table))throw new Error('PRESERVATION_TABLE_INVALID');return `SELECT ${quote(table)} name,coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')),'[]') hashes FROM ${table} o`;});
const hashes=JSON.parse(peer(receipt.name,'\\set QUIET on\n'+identitySQL(receipt)+`SELECT jsonb_object_agg(name,hashes)::text FROM (${queries.join(' UNION ALL ')}) original_rows;`));
let originalRowsChecked=0;
for(const table of tables){const old=before.data.rowHashes[table];assert.ok(Array.isArray(old)&&old.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)));assert.ok(Array.isArray(hashes[table]));const remaining=new Map();for(const hash of hashes[table])remaining.set(hash,(remaining.get(hash)??0)+1);for(const hash of old){assert.ok((remaining.get(hash)??0)>0,'Original0196 rows changed: '+table);remaining.set(hash,remaining.get(hash)-1);}originalRowsChecked+=old.length;}
const file=directory+'/original-0196-preservation-'+Date.now()+'.json';
writeFileSync(file,JSON.stringify({gate:'P3_05_ORIGINAL_0196_PRESERVATION',status:'PASS',oid:receipt.oid,currentPrefix,predecessorPrefix:196,originalSnapshot:before.file,originalRowsPreserved:true,oldLedgerPreserved:true,keyBytesPreserved:true,tablesChecked:tables.length,originalRowsChecked,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
console.log(JSON.stringify({gate:'P3_05_ORIGINAL_0196_PRESERVATION',status:'PASS',evidence:file}));
