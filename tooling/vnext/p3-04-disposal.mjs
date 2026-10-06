import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {root,readReceipt,resolveTarget,peer,quote} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
import {dropValidationOwnerSession} from './validation-owner-session.mjs';
import {removeValidationKeys} from './p3-04-validation-keys.mjs';

/** Recover only the resources proven to belong to this P3-04 database request. */
export function disposeUnitWardValidation(receipt){
 resolveTarget(receipt);
 if(receipt.taskId!=='P3-04'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const directory=resolve(root,'.runtime/vnext/fresh'),path=resolve(directory,receipt.name+'.json'),persisted=readReceipt(path),intent=readReceipt(path+'.intent'),{oid,...expectedIntent}=receipt;
 if(!isDeepStrictEqual(persisted,receipt)||!isDeepStrictEqual(intent,expectedIntent))throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const roleNames=new Set(readdirSync(directory).filter(name=>/^hdi_validation_[a-f0-9]{16}\.json(?:\.intent)?$/.test(name)).map(name=>name.replace(/\.intent$/,''))),sessions=[];
 for(const name of roleNames){
  const rolePath=resolve(directory,name),intentPath=rolePath+'.intent',roleIntent=existsSync(intentPath)?readReceipt(intentPath):null,roleReceipt=existsSync(rolePath)?readReceipt(rolePath):null;
  if(roleIntent?.database!==receipt.name&&roleReceipt?.database!==receipt.name)continue;
  if(!roleIntent||!roleReceipt||roleIntent.taskId!=='P3-04'||roleIntent.purpose!=='TEMPORARY_VALIDATION_OWNER'||roleIntent.databaseOid!==receipt.oid||roleIntent.databaseRequestId!==receipt.requestId)throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
  if(!isDeepStrictEqual(roleIntent,(({roleOid,...rest})=>rest)(roleReceipt))||roleReceipt.role+'.json'!==name||!/^\d+$/.test(roleReceipt.roleOid))throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
  sessions.push({receipt:roleReceipt,receiptPath:rolePath});
 }
 const keys=resolve(root,'.runtime/vnext/p3-04',receipt.name+'.secret.json');
 if(existsSync(keys)){const keyReceipt=JSON.parse(readFileSync(keys,'utf8'));if(keyReceipt.oid!==receipt.oid||keyReceipt.requestId!==receipt.requestId)throw new Error('KEY_RECEIPT_MISMATCH');}
 const database=peer('postgres',`SELECT oid::text FROM pg_database WHERE datname=${quote(receipt.name)} OR oid::text=${quote(receipt.oid)};`);
 if(database){if(database!==receipt.oid)throw new Error('RECEIPT_IDENTITY_MISMATCH');dropTemporary(receipt);}
 else{const disposed=readReceipt(resolve(directory,receipt.name+'.disposed.json'));if(disposed.name!==receipt.name||disposed.oid!==receipt.oid||disposed.disposed!==true)throw new Error('DISPOSAL_NOT_AUTHORIZED');}
 for(const session of sessions)dropValidationOwnerSession(session);
 removeValidationKeys(receipt);
 return {gate:'P3_04_OWNED_FAILURE_CLEANUP',status:'PASS',name:receipt.name,disposedRoles:sessions.length};
}
