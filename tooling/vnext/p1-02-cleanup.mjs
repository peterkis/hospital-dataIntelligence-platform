import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {readReceipt,resolveTarget,root,peer,quote} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
for(const path of process.argv.slice(2)){
 const r=readReceipt(path);if(r.taskId!=='P1-02'||r.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 resolveTarget(r);
 const canonical=resolve(root,'.runtime/vnext/fresh',r.name+'.json');
 if(JSON.stringify(readReceipt(canonical))!==JSON.stringify(r))throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const marker=resolve(root,'.runtime/vnext/fresh',r.name+'.disposed.json');
 if(existsSync(marker)){
  const disposed=readReceipt(marker);
  if(disposed.name!==r.name||disposed.oid!==r.oid||disposed.disposed!==true)throw new Error('DISPOSAL_NOT_AUTHORIZED');
  if(peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(r.name)} AND oid::text=${quote(r.oid)};`)!=='0')throw new Error('DISPOSAL_NOT_CONFIRMED');
 }else dropTemporary(r);
 console.log(JSON.stringify({status:'OWNED_TEMPORARY_CLEANED',database:r.name,oid:r.oid}));
}
