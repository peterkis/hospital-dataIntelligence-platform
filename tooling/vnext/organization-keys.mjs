import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createSecretKey,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {root} from './lineage.mjs';
const path=resolve(root,'.runtime/vnext/p1-01/keys.secret.json');
/** Local synthetic provider. Keys are retained only in the ignored local secret store. */
export function organizationKeys(receipt,{create=false}={}){
 if(!existsSync(path)){
  if(!create)throw new Error('KEY_UNAVAILABLE');
  mkdirSync(resolve(root,'.runtime/vnext/p1-01'),{recursive:true});
  writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,requestId:receipt.requestId,payload:randomBytes(32).toString('hex'),lookup:randomBytes(32).toString('hex')}),{flag:'wx',mode:0o600});
 }
 const key=JSON.parse(readFileSync(path,'utf8'));
 if(key.databaseOid!==receipt.oid||key.requestId!==receipt.requestId||!['payload','lookup'].every(k=>/^[a-f0-9]{64}$/.test(key[k])))throw new Error('KEY_RECEIPT_MISMATCH');
 const payload=createSecretKey(Buffer.from(key.payload,'hex')),lookup=createSecretKey(Buffer.from(key.lookup,'hex'));
 return {current:()=>({id:'LOCAL_1',key:payload}),payload:id=>{if(id!=='LOCAL_1')throw new Error('KEY_UNAVAILABLE');return payload;},lookup:()=>lookup};
}
