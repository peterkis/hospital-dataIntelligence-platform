import {peer,quote} from './lineage.mjs';
export const predecessorTables=tables=>tables.filter(table=>table!=='vnext_control.migration');
export function predecessorDigest(receipt,tables,addedColumns={}){
 const queries=predecessorTables(tables).map(table=>{
  if(!/^(vnext_control|governance_catalog|organization_master|department_master|location_master)\.[a-z_]+$/u.test(table))throw new Error('PRESERVATION_TABLE_INVALID');
  let row=table==='organization_master.input'?"to_jsonb(o)-'domain'":'to_jsonb(o)';
  for(const column of addedColumns[table]??[]){if(!/^[a-z_][a-z0-9_]*$/u.test(column))throw new Error('PRESERVATION_COLUMN_INVALID');row+='-'+quote(column);}
  return `SELECT ${quote(table)} AS table_name,encode(sha256(convert_to(coalesce(jsonb_agg(${row} ORDER BY to_jsonb(o)::text)::text,'[]'),'UTF8')),'hex') AS digest FROM ${table} o`;
 });
 return peer(receipt.name,`SELECT jsonb_object_agg(table_name,digest ORDER BY table_name)::text FROM (${queries.join(' UNION ALL ')}) preserved;`);
}
