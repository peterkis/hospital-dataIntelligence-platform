export function validateCheckpoint(value,receipt){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.status!=='PASS'||
    value.databaseName!==receipt.name||value.databaseOid!==receipt.oid||value.auditStreamId!=='GOVERNANCE_CATALOG'||
    typeof value.auditSequence!=='string'||!/^[1-9][0-9]*$/u.test(value.auditSequence)||BigInt(value.auditSequence)>9223372036854775807n||
    typeof value.currentHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.currentHash))throw new Error('AUDIT_CHECKPOINT_INVALID');
 return value;
}
