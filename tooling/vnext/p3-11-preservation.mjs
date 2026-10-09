import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {peer,identitySQL,quote} from './lineage.mjs';
import {predecessorTables} from './p1-02-preservation.mjs';

/** Preserve original row multisets, columns, ACL and key bytes without logging values. */
export function captureP311Preservation(receipt,observation,keyPath){
 peer(receipt.name,identitySQL(receipt));const tables=predecessorTables(observation.tables);
 for(const table of tables)assert.match(table,/^(vnext_control|governance_catalog|organization_master|department_master|care_organization|location_master)\.[a-z_]+$/);
 const json=query=>JSON.parse(peer(receipt.name,query));
 const columns=json(`SELECT coalesce(jsonb_object_agg(name,cols),'{}')::text FROM (SELECT n.nspname||'.'||c.relname name,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum) cols FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname||'.'||c.relname IN (${tables.map(quote).join(',')}) GROUP BY n.nspname,c.relname) q;`);
 const rows=Object.fromEntries(tables.map(table=>[table,json(`SELECT coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') ORDER BY to_jsonb(o)::text),'[]')::text FROM ${table} o`)]));
 const acl=json("SELECT coalesce(jsonb_object_agg(key,acl),'{}')::text FROM (SELECT 'TABLE:'||n.nspname||'.'||c.relname key,to_jsonb(c.relacl) acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('vnext_control','governance_catalog','organization_master','department_master','care_organization','location_master') AND c.relkind='r' UNION ALL SELECT 'FUNCTION:'||p.oid::regprocedure::text,to_jsonb(p.proacl) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('vnext_control','governance_catalog','organization_master','department_master','care_organization','location_master') UNION ALL SELECT 'SCHEMA:'||nspname,to_jsonb(nspacl) FROM pg_namespace WHERE nspname IN ('vnext_control','governance_catalog','organization_master','department_master','care_organization','location_master')) q");
 const keyDigest=createHash('sha256').update(readFileSync(keyPath)).digest('hex');
 return {ledger:observation.ledger,tables,columns,rows,acl,keyDigest};
}
export function assertP311Preserved(before,after,{exactRows=false}={}){
 assert.deepEqual(after.ledger.slice(0,before.ledger.length),before.ledger);assert.equal(after.keyDigest,before.keyDigest);
 for(const table of before.tables){assert.deepEqual(after.columns[table],before.columns[table]);const available=new Map();for(const hash of after.rows[table])available.set(hash,(available.get(hash)??0)+1);for(const hash of before.rows[table]){assert.ok((available.get(hash)??0)>0,'ORIGINAL_ROW_MULTISET_CHANGED:'+table);available.set(hash,available.get(hash)-1);}if(exactRows)assert.deepEqual(after.rows[table],before.rows[table]);}
 for(const [name,acl] of Object.entries(before.acl))assert.deepEqual(after.acl[name],acl,'ORIGINAL_ACL_CHANGED:'+name);
 return {ledgerPreserved:true,originalColumnsPreserved:true,originalRowsAndDuplicateCountsPreserved:true,originalAclPreserved:true,keyBytesPreserved:true};
}
