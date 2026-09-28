import {readReceipt} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
const [path,...extra]=process.argv.slice(2);
if(!path||extra.length)throw new Error('CLOSED_COMMAND_REQUIRED');
const receipt=readReceipt(path);
if(receipt.taskId!=='P1-07'||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
// The shared disposer verifies saved intent, receipt, OID, role and no live sessions.
dropTemporary(receipt);
console.log(JSON.stringify({status:'P1_07_OWNED_TEMPORARY_DISPOSED',name:receipt.name,oid:receipt.oid}));
