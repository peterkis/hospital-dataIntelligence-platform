import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative,isAbsolute } from 'node:path';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import { temporalKey } from '../../apps/governance-api/src/modules/person-master/engagement-rule-segments.js';
import { validateTemporaryAssignmentCreate } from '../../apps/governance-api/src/modules/person-master/assignment-temporary-contracts.js';
import { temporaryDatabaseIdentity } from './person-assignment-temporary-fixture-guard.js';
import { temporaryRecoveryFingerprint,type TemporaryRecoveryReceipt } from './person-assignment-temporary-recovery-support.js';

let handle:ReturnType<typeof createDatabase>|undefined;
const runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;await mkdir(directory,{recursive:false});
const result:{task:string;runId:string;status:string;code?:string;[key:string]:unknown}={task:'PV-006-C-04',runId,status:'IN_PROGRESS',
  argv:process.argv.slice(1),cwd:process.cwd(),startedAt:new Date().toISOString()};
try {
  assert.ok(process.argv.length===5&&process.argv[2]==='--recover'&&process.argv[3]&&process.argv[4],'C04_RECOVERY_INPUT_REQUIRED');
  const path=resolve(process.argv[3]),relativePath=relative(process.cwd(),path).replaceAll('\\','/');
  assert.ok(!isAbsolute(relativePath)&&relativePath.startsWith('.runtime/pv006-c04/')&&relativePath.endsWith('.json'),'C04_RECOVERY_RECEIPT_PATH_INVALID');
  const original=await readFile(path,'utf8');
  const receipt:TemporaryRecoveryReceipt=JSON.parse(original);
  assert.ok(receipt&&receipt.task==='PV-006-C-04'&&receipt.mode==='RECOVERY','C04_RECOVERY_MODE_INVALID');
  assert.match(receipt.runId,/^[a-f0-9-]{36}$/u,'C04_RECOVERY_RUN_ID_INVALID');
  assert.equal(receipt.runId,process.argv[4],'C04_RECOVERY_RUN_ID_MISMATCH');
  assert.ok(Array.isArray(receipt.creates)&&receipt.creates.length===6&&Array.isArray(receipt.refusals)&&receipt.refusals.length===1,'C04_RECOVERY_COHORT_INVALID');
  const {contentHash,...body}=receipt;
  assert.equal(canonicalSha256(body).toString('hex'),contentHash,'C04_RECOVERY_CONTENT_HASH_MISMATCH');
  assert.ok(process.env['DATABASE_URL'],'C04_MANAGED_DATABASE_REQUIRED');
  handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:5,application_name:'hdi-pv006-c04-recovery'});
  const identity=await temporaryDatabaseIdentity(handle.database);
  assert.equal(identity.database,'hdi_prototype','C04_RECOVERY_DATABASE_INVALID');assert.equal(identity.oid,'16389');
  assert.deepEqual(identity,receipt.identity,'C04_RECOVERY_IDENTITY_MISMATCH');
  const postmaster=(await sql<{value:string}>`select to_char(pg_postmaster_start_time() at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') as value`.execute(handle.database)).rows[0]!.value;
  assert.notEqual(postmaster,receipt.postmasterStartedAt,'C04_REAL_RESTART_REQUIRED');
  // Validate ALL roots before any replay, so malformed recovery input cannot turn
  // into a new create or a new denial/cohort. Permission is checked again by apps.
  for(const entry of [...receipt.creates,...receipt.refusals]) {
    validateTemporaryAssignmentCreate(entry.command);
    const existing=await handle.database.selectFrom('person_master.assignment_command_outcome').selectAll()
      .where('governance_object_id','=',entry.command.governanceObjectId).where('request_id','=',entry.context.requestId).executeTakeFirst();
    assert.ok(existing,'C04_RECOVERY_EXISTING_ROOT_REQUIRED');
    const hash=canonicalSha256({command:{...entry.command,businessValidFrom:temporalKey(entry.command.businessValidFrom),
      businessValidTo:temporalKey(entry.command.businessValidTo)},operation:'TEMPORARY_CREATE',actor:entry.context.actorPrincipalId});
    assert.ok(existing.operation_hash.equals(hash)&&existing.created_by===entry.context.actorPrincipalId&&existing.operation_type==='TEMPORARY_CREATE','C04_RECOVERY_ROOT_MISMATCH');
    if('value' in entry) assert.equal(existing.assignment_version_id,entry.value.targetAdmissionVersionId,'C04_RECOVERY_TARGET_MISMATCH');
    else assert.equal(existing.rejection_code,entry.code,'C04_RECOVERY_DENIAL_MISMATCH');
  }
  assert.deepEqual(await temporaryRecoveryFingerprint(handle.database,receipt.assignmentIds,receipt.requestIds),receipt.fingerprint,'C04_RECOVERY_FINGERPRINT_MISMATCH');
  for(const entry of receipt.creates) assert.deepEqual(await createTemporaryAssignmentApplication(handle.database,entry.context)
    .createSourceLinkedTemporaryAssignment(entry.command),entry.value,'C04_RECOVERY_CREATE_REPLAY_MISMATCH');
  for(const entry of receipt.refusals) await assert.rejects(createTemporaryAssignmentApplication(handle.database,entry.context)
    .createSourceLinkedTemporaryAssignment(entry.command),{message:entry.code});
  const actor=receipt.creates[0]!.context.actorPrincipalId;
  const reader=()=>{const requestId=randomUUID();return createTemporaryAssignmentApplication(handle!.database,
    {actorPrincipalId:actor,requestId,correlationId:requestId,occurredAt:'2026-09-08T00:00:00'});};
  for(const entry of receipt.creates) assert.deepEqual(await reader().getTemporaryAssignment({governanceObjectId:entry.command.governanceObjectId,
    targetAssignmentId:entry.value.targetAssignmentId}),entry.value);
  for(const entry of receipt.declaredReads) assert.deepEqual(await reader().getTemporaryAssignmentAsOf(entry.query),entry.value,'C04_RECOVERY_DECLARATION_MISMATCH');
  for(const entry of receipt.assessments) assert.deepEqual(await reader().assessTemporaryAssignmentDependencies(entry.query),entry.value,'C04_RECOVERY_ASSESSMENT_MISMATCH');
  assert.deepEqual(await temporaryRecoveryFingerprint(handle.database,receipt.assignmentIds,receipt.requestIds),receipt.fingerprint,'C04_RECOVERY_BUSINESS_MUTATION');
  assert.equal(await readFile(path,'utf8'),original,'C04_RECOVERY_RECEIPT_CHANGED');
  Object.assign(result,{status:'PASS',receiptRunId:receipt.runId,postmasterBefore:receipt.postmasterStartedAt,postmasterAfter:postmaster,
    exactCreates:receipt.creates.length,refusals:receipt.refusals.length,declaredReads:receipt.declaredReads.length,assessments:receipt.assessments.length,
    fingerprint:receipt.fingerprint,originalReceiptSha256:createHash('sha256').update(original).digest('hex'),originalReceiptUnchanged:true});
}catch(error){process.exitCode=1;result.status='FAILED';result.code=error instanceof Error&&/^C04_[A-Z0-9_]+$/u.test(error.message)?error.message:'C04_RECOVERY_VALIDATION_FAILED';}
finally {
  if(handle) await handle.close();result['poolClosed']=true;result['finishedAt']=new Date().toISOString();
  await writeFile(`${directory}/recovery-result.json`,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({...result,fingerprint:undefined,directory}));
}
