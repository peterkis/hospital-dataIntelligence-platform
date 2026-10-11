import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {businessUnitFixture} from './p3-01-fixture.js';
import {grantDepartment} from './p2-01-validate.mjs';
import {peer} from './lineage.mjs';
import {assertFrozenUnitProperty,unitExpectedReceivingBasis,type UnitApprovalContext} from '../../apps/admin-web/src/vnext/unit-approval-model.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),provider=new LocalSyntheticKeyProvider();
let catalog:Awaited<ReturnType<typeof openCatalog>>,fixture:Awaited<ReturnType<typeof businessUnitFixture>>;
beforeAll(async()=>{
 const pool=new Pool({connectionString:connection});let role:string;try{role=(await pool.query('select current_user r')).rows[0].r;}finally{await pool.end();}
 grantDepartment(receipt,role);
 peer(receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${role};`);
 catalog=await openCatalog(connection,provider);fixture=await businessUnitFixture(receipt,role,catalog,provider,connection);
});
afterAll(async()=>{await fixture?.close();await catalog?.close();});
test('the approval transaction rejects verification replaced after candidate review',async()=>{
 const f=fixture,d=await f.newDepartment(),binding=await f.endpoint(d),value=await f.input([f.entry(binding)]),input=await f.owner.stage('maker',value);
 await f.owner.verify('reviewer',f.verification(value,input));const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:input.inputId,requestId});
 await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.owner.verify('reviewer',f.verification(value,input));
 await expect(f.owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('STALE_VALIDATION');
 expect((await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId})).approvedBy).toBeNull();
 expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);
});
test('property approval after REBIND keeps the latest concurrency head and original property basis independently',async()=>{
 const f=fixture,d=await f.newDepartment(),first=await f.endpoint(d),created=await f.apply(await f.input([f.entry(first)])),id=created.facts[0]!.id;
 const original=await f.owner.history('maker',{id}),property=original.versions[0]!,destination=await f.endpoint(d),producer=await f.owner.readInput('maker',{inputId:property.facts.source.recordLocatorEvidence.inputId}),row=producer.entries[0]!.row;
 await f.apply(await f.input([{action:'REBIND',target:{owner:'care-organization/unit',id,expectedHead:'1'},row:{...row,campus_id:destination.campus.id,legal_entity_id:destination.subject.id,valid_from:'2026-06-01T00:00:00'},binding:destination,evidenceId:f.artifact.artifactId,reason:'TEST explicit rebind'}]));
 const rebound=await f.owner.history('maker',{id}),head=rebound.versions.at(-1)!;expect(head.action).toBe('REBIND');
 const value=await f.input([{action:'REVISE',target:{owner:'care-organization/unit',id,expectedHead:head.number},row:{...row,service_description:'TEST property change after rebind'},evidenceId:f.artifact.artifactId,reason:'TEST property only'}]),input=await f.owner.stage('maker',value);
 await f.owner.verify('reviewer',f.verification(value,input));const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:input.inputId,requestId}),review=await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 const accepted=await f.owner.read('reviewer',{id,businessAt:row.valid_from,recordAsOf:head.recordedAt});expect(accepted.version!.id).toBe(property.id);expect(accepted.version!.id).not.toBe(head.id);
 const stored=await f.owner.readInput('reviewer',{inputId:input.inputId}),context:UnitApprovalContext={input:stored,expectedHead:head.number,before:accepted.version!,binding:accepted.binding!.binding,producer,inputId:input.inputId};
 const basis=unitExpectedReceivingBasis(await f.owner.readVerification('reviewer',{inputId:input.inputId}),context,input.digest),writes=JSON.parse(review.unit.commands[0]!.value['writes']!);
 expect(()=>assertFrozenUnitProperty(writes[0],context,basis)).not.toThrow();
 await f.owner.approveApplyUnit('reviewer',candidate);expect((await f.owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
 const after=await f.owner.history('maker',{id});expect(after.bindings).toEqual(rebound.bindings);expect(after.versions.at(-1)!.facts.serviceDescription).toBe('TEST property change after rebind');expect(after.versions.at(-1)!.facts.unitCode).toBe(property.facts.unitCode);
});
