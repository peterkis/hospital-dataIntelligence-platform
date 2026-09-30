import assert from 'node:assert/strict';
import { randomUUID as id } from 'node:crypto';
import { createTemporary, dropTemporary } from './fresh.mjs';
import { createValidationOwnerSession, dropValidationOwnerSession } from './validation-owner-session.mjs';
import { migrate, migrationFiles, inspect, peer } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { grantDepartment } from './p2-01-validate.mjs';
import { departmentFixture } from './p2-01-fixture.ts';
import { LocalSyntheticKeyProvider, openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import { openDepartment, openHierarchy } from '../../apps/governance-api/src/modules/department-master/index.ts';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P2-02');
let owner,catalog,department,hierarchy;
try{
  await migrate(owned.receipt,migrationFiles().slice(0,108));
  await seed(owned.receipt);
  const prefix=(await inspect(owned.receipt)).ledger;
  owner=await createValidationOwnerSession(owned.receipt);
  grantDepartment(owned.receipt,owner.receipt.role);
  peer(owned.receipt.name,"INSERT INTO department_master.access(actor,scope,permission) VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;");
  const provider=new LocalSyntheticKeyProvider();
  catalog=await openCatalog(owner.connectionString,provider);
  department=openDepartment(owner.connectionString,provider);
  hierarchy=openHierarchy(owner.connectionString,provider);
  const fixture=await departmentFixture(owned.receipt,catalog,provider);
  const staged=await department.stage('maker',await fixture.input());
  await department.verify('reviewer',{requestId:id(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'Source status upgrade fixture',evidenceId:fixture.artifact.artifactId}]});
  const requestId=id(),planned=await department.plan('maker',{inputId:staged.inputId,requestId});
  await department.readApplyCandidate('reviewer',{candidateId:planned.candidateId});
  await department.approveApplyUnit('reviewer',planned);
  const applied=await department.applyUnit('maker',{candidateId:planned.candidateId,requestId});
  assert.equal(applied.status,'COMMITTED');
  const ownerDepartmentId=applied.facts[0].id;
  const publish=async label=>{
    const header={requestId:id(),sourceClientKey:label,viewCode:label,viewName:label,viewType:'ADMINISTRATIVE',purpose:'Source status recovery',aggregationRule:'NONE',ownerDepartmentId,sourceSystemId:fixture.source.id,sourceRecordId:label,sourceVersion:'1',validFrom:'2026-09-01T00:00:00.000000',validTo:null,recordedAt:'2026-09-01T01:00:00.123456',approvalRef:'SYNTHETIC_HISTORY'};
    const view=await hierarchy.createHierarchyView('maker',header);
    peer(owned.receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer','${view.viewId}'::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
    const input={...header,requestId:id(),viewId:view.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'GROUP',groupCode:'ROOT',groupId:null,groupVersionId:null,displayName:'Synthetic root',relationName:'组织',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:label,sourceVersion:'1',sourceSystemId:fixture.source.id,sourceRecordId:label,validFrom:header.validFrom,validTo:null,recordedAt:header.recordedAt,recordStatus:'ACTIVE',approvalRef:'SYNTHETIC_HISTORY'}}]};
    const candidate=await hierarchy.importHierarchyCandidate('maker',input);
    assert.ok(candidate.candidateId);
    await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:candidate.candidateId,digest:candidate.digest});
    const command={candidateId:candidate.candidateId,requestId:input.requestId,digest:candidate.digest};
    const snapshot=await hierarchy.publishHierarchySnapshot('maker',command);
    return {candidateId:candidate.candidateId,snapshot,command};
  };
  const exact=await publish('STATUS_EXACT'),missing=await publish('STATUS_MISSING'),ambiguous=await publish('STATUS_AMBIGUOUS');
  // Only receipt-owned synthetic legacy fixtures are altered. No source DB is touched.
  peer(owned.receipt.name,`UPDATE department_master.hierarchy_candidate SET payload=payload-'recordStatus' WHERE id='${missing.candidateId}'::uuid;
    INSERT INTO department_master.hierarchy_candidate(request_id,view_id,source_client_key,maker,maker_identity,digest,payload_digest,payload,envelope,status,approved_by,approved_identity,applied_at)
    SELECT '${id()}'::uuid,view_id,source_client_key,maker,maker_identity,digest,payload_digest,payload,envelope,status,approved_by,approved_identity,applied_at FROM department_master.hierarchy_candidate WHERE id='${ambiguous.candidateId}'::uuid;`);
  for(const row of [exact,missing,ambiguous])assert.equal(row.snapshot.view.sourceRecordStatus,null);
  await migrate(owned.receipt);
  assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,108),prefix);
  for(const [row,status] of [[exact,'ACTIVE'],[missing,null],[ambiguous,null]]){
    const after=await hierarchy.readHierarchySnapshot('maker',{viewId:row.snapshot.view.id,version:row.snapshot.view.version});
    assert.equal(after.view.sourceRecordStatus,status);
    assert.deepEqual({...after,view:{...after.view,sourceRecordStatus:null}},row.snapshot);
  }
  const replay=await hierarchy.publishHierarchySnapshot('maker',exact.command);
  assert.equal(replay.view.sourceRecordStatus,'ACTIVE');
  assert.throws(()=>peer(owned.receipt.name,`UPDATE department_master.hierarchy_view_version SET source_record_status=NULL WHERE view_id='${exact.snapshot.view.id}'::uuid AND status='PUBLISHED';`),/IMMUTABLE/);
  assert.equal((await publish('STATUS_NEW')).snapshot.view.sourceRecordStatus,'ACTIVE');
  console.log(JSON.stringify({gate:'P2-02-HISTORY',status:'PASS',prefix:108,recovered:1,unknown:2,historyPreserved:true,immutable:true,receipt:owned.receiptPath}));
}catch(error){owner??=error.ownerSession;throw error;}
finally{
  try{await Promise.all([hierarchy?.close(),department?.close(),catalog?.close()]);}
  finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
