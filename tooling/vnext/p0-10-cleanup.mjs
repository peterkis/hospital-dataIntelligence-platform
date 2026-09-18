import {dropTemporary} from './fresh.mjs';
import {dropValidationOwnerRole} from './validation-owner-session.mjs';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {root,readReceipt,resolveTarget,peer,quote} from './lineage.mjs';
import {saveExclusiveReceipt,localReceiptTime} from './receipt.mjs';

export function reconcileValidationCleanup(receipt,owner) {
  resolveTarget(receipt);
  if(receipt.taskId!=='P0-10'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
  const path=resolve(root,'.runtime/vnext/fresh',receipt.name+'.json');
  const persisted=readReceipt(path),intent=readReceipt(path+'.intent');
  if(JSON.stringify(persisted)!==JSON.stringify(receipt)||intent.requestId!==receipt.requestId||intent.name!==receipt.name||intent.owner!==receipt.owner)throw new Error('DISPOSAL_NOT_AUTHORIZED');
  if(owner&&(owner.receipt.database!==receipt.name||owner.receipt.databaseOid!==receipt.oid||owner.receipt.databaseRequestId!==receipt.requestId))throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
  const safeCode=error=>/^[A-Z][A-Z0-9_]{0,95}$/u.test(error?.message)?error.message:'TEMPORARY_RESOURCE_CLEANUP_FAILED';
  let database,role={status:'NOT_APPLICABLE'};
  try {
    const present=peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(receipt.name)} OR oid::text=${quote(receipt.oid)};`);
    if(present==='0') {
      const markerPath=resolve(root,'.runtime/vnext/fresh',receipt.name+'.disposed.json');
      if(existsSync(markerPath)) {
        const marker=readReceipt(markerPath);
        if(marker.name!==receipt.name||marker.oid!==receipt.oid||marker.disposed!==true)throw new Error('DISPOSAL_MARKER_MISMATCH');
      } else saveExclusiveReceipt(markerPath,{name:receipt.name,oid:receipt.oid,disposed:true,disposition:'ALREADY_ABSENT',time:localReceiptTime()});
      database={status:'PASS',disposition:'ALREADY_ABSENT'};
    } else {dropTemporary(receipt);database={status:'PASS',disposition:'DROPPED'};}
  } catch(error) {database={status:'BLOCKED',errorCode:safeCode(error)};}
  // The role helper independently verifies database disposal and exact role
  // ownership. Always reach it, including after a previous partial cleanup.
  if(owner) {
    try {dropValidationOwnerRole(owner);role={status:'PASS'};}
    catch(error) {role={status:'BLOCKED',errorCode:safeCode(error)};}
  }
  return {status:database.status==='PASS'&&role.status!=='BLOCKED'?'PASS':'BLOCKED',database,owner:role};
}
