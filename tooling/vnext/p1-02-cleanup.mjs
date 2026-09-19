import {existsSync} from 'node:fs';
import {readReceipt} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
for(const path of process.argv.slice(2)){
 const r=readReceipt(path);if(r.taskId!=='P1-02'||r.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 if(!existsSync(path.replace(/\.json$/u,'.disposed.json')))dropTemporary(r);
 console.log(JSON.stringify({status:'OWNED_TEMPORARY_CLEANED',database:r.name,oid:r.oid}));
}
