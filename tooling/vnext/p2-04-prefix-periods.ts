import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openDepartment} from '../../apps/governance-api/src/modules/department-master/index.js';
import {departmentFixture} from './p2-01-fixture.js';
import {peer,quote} from './lineage.mjs';

export async function createFinitePrefixDepartment(receipt:{name:string},connection:string){
 const provider=new LocalSyntheticKeyProvider(),catalog=await openCatalog(connection,provider),department=openDepartment(connection,provider);
 try{const f=await departmentFixture(receipt,catalog,provider),e=f.entry();e.row.valid_to='2026-02-01T00:00:00';const staged=await department.stage('maker',await f.input([e]));
  await department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO approved finite predecessor',evidenceId:f.artifact.artifactId}]});
  const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:staged.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);const result=await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId});assert.equal(result.status,'COMMITTED');if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const id=result.facts[0]!.id,history=await department.history('maker',id);
  return {id,code:e.row.org_code,recordAsOf:history.versions[0]!.recorded_at,history,provider};
 }finally{await department.close();await catalog.close();}
}
export async function verifyFinitePrefixDepartment(connection:string,state:Awaited<ReturnType<typeof createFinitePrefixDepartment>>,receipt:{name:string}){
 peer(receipt.name,`INSERT INTO department_master.identifier_access(actor,scheme,campus,permission) VALUES('maker','SYNTHETIC_DEPARTMENT_CODE','NORTH','READ') ON CONFLICT DO NOTHING; INSERT INTO department_master.mapping_target_access(actor,target_type,target_id,campus) VALUES('maker','ORG',${quote(state.id)}::uuid,'NORTH') ON CONFLICT DO NOTHING;`);
 const department=openDepartment(connection,state.provider);try{
  assert.deepEqual(await department.history('maker',state.id),state.history);
  for(const recordAsOf of [undefined,state.recordAsOf]){const scope=recordAsOf===undefined?{}:{recordAsOf};
   const inside=await department.read('maker',{id:state.id,campus:'NORTH',businessAt:'2026-01-31T23:59:59.999999',...scope}),outside=await department.read('maker',{id:state.id,campus:'NORTH',businessAt:'2026-02-01T00:00:00',...scope});assert.equal(inside.effectiveCode,state.code);assert.equal(outside.effectiveCode,null);
   if(recordAsOf){assert.equal(inside.codeEvidence,'ORG04_HISTORICAL');assert.equal(inside.codeVersion,null);assert.equal(outside.codeEvidence,'ORG04_HISTORICAL');}
  }
  console.log(JSON.stringify({status:'PASS',gate:'P2-04-FINITE-ORG04-PREFIX',oldRecordTime:true,halfOpenBoundary:true,originalHistoryPreserved:true}));
 }finally{await department.close();}
}
