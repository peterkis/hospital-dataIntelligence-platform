import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readReceipt,root } from './lineage.mjs';
import { runtime } from './catalog-runtime.mjs';
import { validateCheckpoint } from './audit-checkpoint.mjs';

const receipt=readReceipt();
const directory=resolve(root,'.runtime/vnext/audit-checkpoints');mkdirSync(directory,{recursive:true});
const priorPath=process.argv[2];
if(process.argv.length>3||priorPath==='')throw new Error('AUDIT_CHECKPOINT_INVALID');
const prior=priorPath?validateCheckpoint(JSON.parse(readFileSync(priorPath,'utf8')),receipt):undefined;
const catalog=await runtime();
try{
 const result=await catalog.verifyAudit('auditor',prior);
 const path=resolve(directory,randomUUID()+'.json');
 writeFileSync(path,JSON.stringify({...result,databaseName:receipt.name,databaseOid:receipt.oid,previousCheckpoint:priorPath??null},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',checkpointPath:path,...result}));
}finally{await catalog.close();}
