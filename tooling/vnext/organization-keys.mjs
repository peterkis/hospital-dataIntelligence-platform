import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createSecretKey,randomBytes,createHash,createDecipheriv,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {root,peer,identitySQL,quote} from './lineage.mjs';
import {canonicalPlan} from '../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts';
const path=resolve(root,'.runtime/vnext/p1-01/keys.secret.json');
/** Local synthetic provider. Keys are retained only in the ignored local secret store. */
export function organizationKeys(receipt,{create=false}={}){
 const observed=JSON.parse(peer(receipt.name,identitySQL(receipt)+` SELECT jsonb_build_object('binding',(SELECT to_jsonb(k) FROM vnext_control.organization_key_binding k),'sample',(SELECT jsonb_build_object('digest',digest,'envelope',envelope) FROM organization_master.input ORDER BY id LIMIT 1));`).split(/\r?\n/).at(-1));
 if(!existsSync(path)){
  if(!create||observed.binding||observed.sample)throw new Error('KEY_UNAVAILABLE');
  mkdirSync(resolve(root,'.runtime/vnext/p1-01'),{recursive:true});
  writeFileSync(path,JSON.stringify({databaseOid:receipt.oid,requestId:receipt.requestId,payload:randomBytes(32).toString('hex'),lookup:randomBytes(32).toString('hex')}),{flag:'wx',mode:0o600});
 }
 let key;try{key=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('KEY_UNAVAILABLE');}
 if(!key||key.databaseOid!==receipt.oid||key.requestId!==receipt.requestId||!['payload','lookup'].every(k=>/^[a-f0-9]{64}$/.test(key[k])))throw new Error('KEY_RECEIPT_MISMATCH');
 const payload=createSecretKey(Buffer.from(key.payload,'hex')),lookup=createSecretKey(Buffer.from(key.lookup,'hex'));
 const fingerprint=value=>createHash('sha256').update(Buffer.from(value,'hex')).digest('hex');
 const payloadFingerprint=fingerprint(key.payload),lookupFingerprint=fingerprint(key.lookup);
 if(observed.binding){
  if(observed.binding.payload_fingerprint!==payloadFingerprint||observed.binding.lookup_fingerprint!==lookupFingerprint)throw new Error('KEY_RECEIPT_MISMATCH');
 }else{
  if(!create)throw new Error('KEY_AUTHORITY_NOT_READY');
  // Adopt the already deployed 0054 provider only after proving both encryption
  // and lookup-key continuity against an immutable, authenticated input.
  if(observed.sample){
   let bytes;
   try{const {digest,envelope:e}=observed.sample;const d=createDecipheriv('aes-256-gcm',payload,Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from('ORGANIZATION_INPUT_V1\0'+digest));d.setAuthTag(Buffer.from(e.tag,'hex'));bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);if(createHmac('sha256',lookup).update('ORGANIZATION_INPUT_V1\0').update(canonicalPlan(JSON.parse(bytes.toString()))).digest('hex')!==digest)throw new Error();}
   catch{throw new Error('KEY_RECEIPT_MISMATCH');}finally{bytes?.fill(0);}
  }
  peer(receipt.name,identitySQL(receipt)+` BEGIN; SELECT pg_advisory_xact_lock(901002); INSERT INTO vnext_control.organization_key_binding VALUES(true,${quote(payloadFingerprint)},${quote(lookupFingerprint)}) ON CONFLICT DO NOTHING; DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM vnext_control.organization_key_binding WHERE payload_fingerprint=${quote(payloadFingerprint)} AND lookup_fingerprint=${quote(lookupFingerprint)}) THEN RAISE EXCEPTION 'KEY_RECEIPT_MISMATCH'; END IF; END $$; COMMIT;`);
 }
 return {current:()=>({id:'LOCAL_1',key:payload}),payload:id=>{if(id!=='LOCAL_1')throw new Error('KEY_UNAVAILABLE');return payload;},lookup:()=>lookup};
}
