import {test,expect,afterAll,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationIdentifiers,openDepartment,ORG23_FIELDS} from '../../apps/governance-api/src/modules/department-master/index.js';
import {organizationIdentifierFixture} from './p2-04-fixture.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOrganizationIdentifierClient} from '../../packages/generated-api-client/src/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {openOrganization,openCampus} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {provisionCampusAuthority} from './campus-authority.mjs';
const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider);
let owner:ReturnType<typeof openOrganizationIdentifiers>,f:Awaited<ReturnType<typeof organizationIdentifierFixture>>;
beforeAll(async()=>{owner=openOrganizationIdentifiers(connection,provider);f=await organizationIdentifierFixture(receipt,catalog,provider,connection);});
afterAll(async()=>{await owner?.close();await catalog.close();});
async function prepare(entries:Parameters<typeof f.input>[0]){
 const staged=await owner.stage('maker',await f.input(entries));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:entries!.map((_,i)=>({row:i+1,reason:'DEMO independent personnel review',evidenceId:f.artifact.artifactId,policyApproved:true}))});
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'PASS',issues:[]});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 return {candidate,requestId,staged};
}
async function apply(entries:Parameters<typeof f.input>[0]){
 const prepared=await prepare(entries),result=await owner.applyUnit('maker',{candidateId:prepared.candidate.candidateId,requestId:prepared.requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return {result,...prepared};
}
test('same Department changes its official code atomically and keeps the original historical ownership',async()=>{
 const original=await owner.forTarget('maker',{type:'ORG',id:f.targetId,campus:'NORTH',businessAt:'2026-02-01T00:00:00'});
 const code=original.items.find(x=>x.kind==='HOSPITAL_CODE')!;expect(code).toBeDefined();
 const e=f.entry();e.action='CHANGE';e.identifier={owner:'department-master/organization-identifier',id:code.id,expectedHead:code.version.number};Object.assign(e.row,{identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'0012',valid_from:'2026-06-01T00:00:00',language:''});
 const changed=await apply([e]);expect(changed.result.facts).toHaveLength(2);
 const resolved=await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:'0012',campus:'NORTH',businessAt:'2026-06-01T00:00:00'});expect(resolved).toMatchObject({status:'RESOLVED',targetId:f.targetId});
 expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:code.value,campus:'NORTH',businessAt:'2026-06-01T00:00:00'})).toEqual({status:'NOT_FOUND'});
 expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:code.value,campus:'NORTH',businessAt:'2026-03-01T00:00:00',recordAsOf:code.version.recorded_at})).toMatchObject({status:'RESOLVED',targetId:f.targetId});
 const department=openDepartment(connection,provider);try{expect(await department.read('maker',{id:f.targetId,businessAt:'2026-07-01T00:00:00'})).toMatchObject({id:f.targetId,initialCode:code.value,effectiveCode:'0012'});}finally{await department.close();}
});
test('duplicate aliases remain independent relations on distinct Department identities',async()=>{
 const other=await f.newDepartment();f.grantTarget(other);const a=f.entry(),b=f.entry();b.row.target_id=other;
 const accepted=await apply([a,b]);expect(accepted.result.facts).toHaveLength(2);
 const first=await owner.history('maker',{id:accepted.result.facts[0]!.id,campus:'NORTH'}),second=await owner.history('maker',{id:accepted.result.facts[1]!.id,campus:'NORTH'});
 expect(first.target_id).toBe(f.targetId);expect(second.target_id).toBe(other);expect(first.versions[0]!.value).toBe(second.versions[0]!.value);
 await expect(owner.resolve('maker',{scheme:'SYNTHETIC_ALIAS',value:a.row.identifier_value,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).rejects.toThrow('IDENTIFIER_RESOLUTION_FORBIDDEN');
});
test('alias correction and retraction preserve the original record-time assertion',async()=>{
 const e=f.entry();e.row.identifier_value='DEMO original';const original=await apply([e]),id=original.result.facts[0]!.id;
 const h=await owner.history('maker',{id,campus:'NORTH'}),at=h.versions[0]!.recorded_at;
 e.action='CORRECT';e.identifier={owner:'department-master/organization-identifier',id,expectedHead:'1'};e.row.identifier_value='DEMO corrected';await apply([e]);
 expect((await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00',recordAsOf:at})).version?.value).toBe('DEMO original');
 e.action='RETRACT';e.identifier.expectedHead='2';await apply([e]);expect((await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).version).toBeNull();
 const history=await owner.history('maker',{id,campus:'NORTH'});expect(history.versions.map(v=>v.action)).toEqual(['REGISTER','CORRECT','RETRACT']);expect(history.versions[0]).toEqual(h.versions[0]);
});
test('preferred alias handover is atomic and independent of input row ordering',async()=>{
 const e=f.entry();e.row.identifier_value='DEMO preferred before';e.row.is_preferred='Y';const first=await apply([e]),id=first.result.facts[0]!.id;
 const end={...e,action:'END' as const,identifier:{owner:'department-master/organization-identifier' as const,id,expectedHead:'1'},row:{...e.row,valid_to:'2026-06-01T00:00:00'}};
 const next=f.entry();Object.assign(next.row,{identifier_value:'DEMO preferred after',is_preferred:'Y',valid_from:'2026-06-01T00:00:00'});
 await apply([next,end]);
 const before=await owner.forTarget('maker',{type:'ORG',id:f.targetId,campus:'NORTH',businessAt:'2026-05-31T23:59:59.999999'}),after=await owner.forTarget('maker',{type:'ORG',id:f.targetId,campus:'NORTH',businessAt:'2026-06-01T00:00:00'});
 expect(before.items.filter(x=>x.preferred).map(x=>x.value)).toEqual(['DEMO preferred before']);expect(after.items.filter(x=>x.preferred).map(x=>x.value)).toEqual(['DEMO preferred after']);
 expect((await owner.preferred('maker',{type:'ORG',id:f.targetId,campus:'NORTH',scheme:'SYNTHETIC_ALIAS',kind:'ALIAS',language:'zh',businessAt:'2026-06-01T00:00:00'})).alias?.value).toBe('DEMO preferred after');
 const conflict=f.entry();conflict.row.is_preferred='Y';const staged=await owner.stage('maker',await f.input([conflict]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:0,field:'is_preferred',code:'IDENTIFIER_CONFLICT',status:'FAIL'});
 const english=f.entry();Object.assign(english.row,{language:'en',identifier_value:'DEMO preferred English',is_preferred:'Y'});await apply([english]);
});
test('typed HTTP freezes full input, independently approves and replays one immutable alias outcome',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),maker=createOrganizationIdentifierClient(url,'maker'),reviewer=createOrganizationIdentifierClient(url,'reviewer'),e=f.entry();e.row.identifier_value='DEMO HTTP alias';
  const staged=await maker.stage(await f.input([e]));expect(staged.response.status).toBe(200);const input=staged.data!;
  expect((await reviewer.verify({requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,rows:[{row:1,reason:'DEMO independent HTTP review',evidenceId:f.artifact.artifactId,policyApproved:true}]})).response.status).toBe(200);
  const requestId=randomUUID(),planned=await maker.plan({inputId:input.inputId,requestId});expect(planned.response.status).toBe(200);const candidate=planned.data!;
  const reviewed=await reviewer.review({candidateId:candidate.candidateId});expect(reviewed.response.status).toBe(200);expect(reviewed.data?.entries[0]?.row).toEqual(e.row);expect(reviewed.data?.inputCoverage).toBe('COMPLETE');
  expect((await reviewer.approve(candidate)).response.status).toBe(200);const accepted=await maker.apply({candidateId:candidate.candidateId,requestId});expect(accepted.response.status).toBe(200);expect(accepted.data?.status).toBe('COMMITTED');
  const replay=await maker.resume({candidateId:candidate.candidateId,requestId});expect(replay.response.status).toBe(200);expect(replay.data?.facts).toEqual(accepted.data?.facts);
  const id=accepted.data!.facts![0]!.id;expect((await maker.history({id,campus:'NORTH'})).data?.versions).toHaveLength(1);
  expect((await createOrganizationIdentifierClient(url,'outsider').history({id,campus:'NORTH'})).response.status).toBe(403);
  const unknown=await fetch(url+'/api/vnext/organization-identifiers/inputs',{method:'POST',headers:{'content-type':'application/json','x-hdi-actor':'maker'},body:JSON.stringify({...await f.input(),platformId:randomUUID()})});expect(unknown.status).toBe(400);
  const numericInput=await f.input(),numeric=await fetch(url+'/api/vnext/organization-identifiers/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...numericInput,entries:numericInput.entries.map(entry=>({...entry,row:{...entry.row,identifier_value:12}}))})});expect(numeric.status).toBe(400);
 }finally{await app.close();}
});
test('ORG23 source codes keep their complete input and freeze a blocked handoff to ORG22',async()=>{
 const e=f.entry();e.row.identifier_kind='SOURCE_CODE';e.row.identifier_value='0007';const staged=await owner.stage('maker',await f.input([e]));
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.row).toEqual(e.row);
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'BLOCKED',commandCount:0,issues:[{row:1,field:'identifier_kind',code:'SOURCE_MAPPING_REQUIRED',status:'BLOCKED',handoff:{dataset:'ORG22',requiredFields:expect.arrayContaining(['source_entity_type','source_context'])}}]});
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),reviewed=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(reviewed.unit.commands).toHaveLength(0);expect(reviewed.unit.basis['entries']).toEqual([{...e,sourceRow:1}]);
 await expect(owner.approveApplyUnit('reviewer',candidate)).rejects.toThrow('SOURCE_MAPPING_REQUIRED');
});
test('ORG23 XLSX uses the same Owner approval and preserves physical source rows and text leading zeros',async()=>{
 const e=f.entry();e.row.identifier_kind='SEARCH_CODE';e.row.identifier_system='SYNTHETIC_SEARCH_CODE';e.row.identifier_value='0012';
 const bytes=organizationWorkbook({ORG23:[ORG23_FIELDS,ORG23_FIELDS.map(field=>e.row[field])]}),{row:_,...metadata}=e;
 const received=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:7200,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DEMO_IDENTIFIER_FILE',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_ORGANIZATION_IDENTIFIER_V1'}},entries:[metadata]},bytes);
 expect(received.structuralStatus).toBe('PARSED');expect(received.issues).toEqual([]);const staged=received.input!;
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]).toMatchObject({sourceRow:2,row:{identifier_value:'0012'}});
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO file review',evidenceId:f.artifact.artifactId,policyApproved:true}]});
 expect(await owner.validate('maker',{inputId:staged.inputId})).toMatchObject({decision:'PASS',issues:[],validationRunId:expect.any(String)});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status==='COMMITTED')expect(result.facts[0]?.source).toMatchObject({row:2,dataset:'ORG23'});
});
test('a second-row database fault rolls back every formal alias and committed outcome',async()=>{
 const a=f.entry(),b=f.entry();a.row.identifier_value='DEMO atomic first';b.row.identifier_value='DEMO atomic second';const prepared=await prepare([a,b]),before=await owner.list('maker',{campus:'NORTH',limit:100});
 peer(receipt.name,"CREATE FUNCTION department_master.demo_identifier_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_row=2 AND NEW.step='REGISTER' THEN RAISE EXCEPTION 'DEMO_SQL_FAULT';END IF;RETURN NEW;END $$; CREATE TRIGGER demo_identifier_fault BEFORE INSERT ON department_master.organization_identifier_version FOR EACH ROW EXECUTE FUNCTION department_master.demo_identifier_fault();");
 try{await expect(owner.applyUnit('maker',{candidateId:prepared.candidate.candidateId,requestId:prepared.requestId})).rejects.toThrow('APPLY_FAILED');expect(await owner.list('maker',{campus:'NORTH',limit:100})).toEqual(before);expect(await owner.resumeOutcome('maker',{candidateId:prepared.candidate.candidateId,requestId:prepared.requestId})).toBeNull();}
 finally{peer(receipt.name,'DROP TRIGGER demo_identifier_fault ON department_master.organization_identifier_version;DROP FUNCTION department_master.demo_identifier_fault();');}
 expect((await owner.readInput('maker',{inputId:prepared.staged.inputId})).entries).toHaveLength(2);
 const accepted=await owner.applyUnit('maker',{candidateId:prepared.candidate.candidateId,requestId:prepared.requestId});expect(accepted.status).toBe('COMMITTED');
});
test('current namespace revocation blocks historical reads and committed result recovery',async()=>{
 const accepted=await apply([f.entry()]),id=accepted.result.facts[0]!.id;
 peer(receipt.name,"DELETE FROM department_master.identifier_access WHERE actor='maker' AND scheme='SYNTHETIC_ALIAS' AND campus='NORTH' AND permission='READ';");
 try{await expect(owner.history('maker',{id,campus:'NORTH'})).rejects.toThrow('ACCESS_DENIED');await expect(owner.resumeOutcome('maker',{candidateId:accepted.candidate.candidateId,requestId:accepted.requestId})).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,"INSERT INTO department_master.identifier_access VALUES('maker','SYNTHETIC_ALIAS','NORTH','READ');");}
 expect((await owner.history('maker',{id,campus:'NORTH'})).versions).toHaveLength(1);
});
test('underlying identity separation prevents an alternate maker account from verifying its own input',async()=>{
 const staged=await owner.stage('maker',await f.input());peer(receipt.name,"INSERT INTO department_master.identifier_access VALUES('maker-alias','SYNTHETIC_ALIAS','NORTH','VERIFY') ON CONFLICT DO NOTHING;");
 try{await expect(owner.verify('maker-alias',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO self review attempt',evidenceId:f.artifact.artifactId,policyApproved:true}]})).rejects.toThrow('MAKER_CHECKER_REQUIRED');}
 finally{peer(receipt.name,"DELETE FROM department_master.identifier_access WHERE actor='maker-alias' AND scheme='SYNTHETIC_ALIAS' AND campus='NORTH' AND permission='VERIFY';");}
});
test('actual application role cannot insert formal identities or overwrite accepted versions',async()=>{
 const pool=new Pool({connectionString:connection});try{await expect(pool.query("INSERT INTO department_master.organization_identifier(target_type,target_id,kind,scheme,reserved_value) VALUES('ORG',$1,'HOSPITAL_CODE','SYNTHETIC_DEPARTMENT_CODE','9999')",[f.targetId])).rejects.toMatchObject({code:'42501'});await expect(pool.query('UPDATE department_master.organization_identifier_version SET value=$1',['DEMO overwrite'])).rejects.toMatchObject({code:'42501'});await expect(pool.query('SELECT key_hex FROM vnext_control.department_write_authority')).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});
test('ORG04 and ORG23 share permanent code conflict checks after recoding',async()=>{
 const e=f.entry();Object.assign(e.row,{identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'0012',language:''});
 const staged=await owner.stage('maker',await f.input([e]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'identifier_value',code:'IDENTIFIER_CONFLICT',status:'FAIL'});
 const department=openDepartment(connection,provider);try{const row=f.department.entry();row.row.org_code='0012';const denied=await department.stage('maker',await f.department.input([row]));expect((await department.validate('maker',{inputId:denied.inputId})).issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'org_code',code:'IDENTIFIER_CONFLICT'})]));}finally{await department.close();}
});
test('retiring a formal code never revives the initial code or releases its permanent ownership',async()=>{
 const h=await owner.forTarget('maker',{type:'ORG',id:f.targetId,campus:'NORTH',businessAt:'2026-07-01T00:00:00'}),code=h.items.find(x=>x.kind==='HOSPITAL_CODE')!;
 const e=f.entry();e.action='END';e.identifier={owner:'department-master/organization-identifier',id:code.id,expectedHead:code.version.number};Object.assign(e.row,{identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:code.value,language:'',valid_from:code.version.valid_from,valid_to:'2026-08-01T00:00:00'});await apply([e]);
 expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:'0012',campus:'NORTH',businessAt:'2026-08-01T00:00:00'})).toEqual({status:'NOT_FOUND'});
 const department=openDepartment(connection,provider);try{expect((await department.read('maker',{id:f.targetId,businessAt:'2026-08-01T00:00:00'})).effectiveCode).toBeNull();}finally{await department.close();}
 const registration=f.entry();Object.assign(registration.row,{identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'0012',language:'',valid_from:'2027-01-01T00:00:00'});const staged=await owner.stage('maker',await f.input([registration]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'identifier_value',code:'IDENTIFIER_CONFLICT',status:'FAIL'});
 e.action='RETRACT';e.identifier.expectedHead=String(BigInt(code.version.number)+1n);await apply([e]);expect((await owner.read('maker',{id:code.id,campus:'NORTH',businessAt:'2026-07-01T00:00:00'})).version).toBeNull();
});
test('FULL and offset-bearing source times cannot silently become CORE facts',async()=>{
 const input=await f.input();input.profile='FULL';const staged=await owner.stage('maker',input);expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toEqual(expect.arrayContaining([expect.objectContaining({row:0,field:'profile',code:'BLOCKED_DEPENDENCY'})]));
 const e=f.entry();e.row.valid_from='2026-01-01T00:00:00+08:00';const offset=await owner.stage('maker',await f.input([e]));expect((await owner.validate('maker',{inputId:offset.inputId})).decision).toBe('FAIL');expect((await owner.readInput('maker',{inputId:offset.inputId})).entries[0]!.row.valid_from).toBe(e.row.valid_from);
});
test('same-person alternate account cannot freeze another persons staged input or self-approve',async()=>{
 const staged=await owner.stage('maker',await f.input());await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO proper independent verification',evidenceId:f.artifact.artifactId,policyApproved:true}]});
 await expect(owner.plan('reviewer',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 const candidate=await owner.plan('maker-alias',{inputId:staged.inputId,requestId:randomUUID()});peer(receipt.name,"INSERT INTO department_master.identifier_access VALUES('maker-alias','SYNTHETIC_ALIAS','NORTH','REVIEW') ON CONFLICT DO NOTHING;");
 try{await expect(owner.approveApplyUnit('maker-alias',candidate)).rejects.toThrow('MAKER_CHECKER_REQUIRED');}finally{peer(receipt.name,"DELETE FROM department_master.identifier_access WHERE actor='maker-alias' AND scheme='SYNTHETIC_ALIAS' AND campus='NORTH' AND permission='REVIEW';");}
});
test('unknown Owner targets and unsupported campuses cannot expand authority',async()=>{
 const e=f.entry();e.row.target_type='UNIT';const staged=await owner.stage('maker',await f.input([e]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'target_type',code:'BLOCKED_DEPENDENCY'})]));
 const accepted=await apply([f.entry()]);await expect(owner.history('maker',{id:accepted.result.facts[0]!.id,campus:'SOUTH'})).rejects.toThrow('ACCESS_DENIED');
});
test('LEGAL and CAMPUS aliases consume real target Owner profiles without granting operating permission',async()=>{
 const organization=openOrganization(connection,provider);provisionCampusAuthority(receipt,provider);const campus=openCampus(connection,provider);
 const common={validFrom:'2026-01-01T00:00:00',validTo:null,source:{systemId:f.source.id,versionId:f.source.versionId,alias:'DEMO_IDENTIFIER_TARGET',versionNo:1,recordLocator:'DEMO_ORGANIZATION_ROW',recordedAt:'2026-01-02T00:00:00',recordStatus:'PUBLISHED' as const,approvalRef:'DEMO_APPROVAL'}};
 try{
  const job=await f.department.newJob(),staged=await organization.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...common,action:'CREATE',facts:{legalName:'DEMO alias legal subject',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:f.department.artifact.artifactId},identifiers:[]}});
  const requestId=randomUUID(),candidate=await organization.plan('maker',{inputId:staged.inputId,requestId});await organization.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await organization.approveApplyUnit('reviewer',candidate);const committed=await organization.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const legalId=committed.facts[0]!.id;
  const campusJob=await f.department.newJob(),campusInput=await campus.stage('maker',{requestId:randomUUID(),jobId:campusJob.id,revisionId:campusJob.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',command:{...common,action:'CREATE',evidence:f.department.artifact.artifactId,sourceOperationStatus:'PLANNING',facts:{campusCode:'DEMO_'+randomUUID(),campusName:'DEMO alias campus',nodeRole:'HEADQUARTERS',nodeKind:'PHYSICAL',campusAddress:null,adminDivision:null,publicPhone:null,openingDate:null}}});
  const campusRequest=randomUUID(),campusCandidate=await campus.plan('maker',{inputId:campusInput.inputId,requestId:campusRequest});await campus.readApplyCandidate('reviewer',{candidateId:campusCandidate.candidateId});await campus.approveApplyUnit('reviewer',campusCandidate);const campusCommitted=await campus.applyUnit('maker',{candidateId:campusCandidate.candidateId,requestId:campusRequest});if(campusCommitted.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const campusId=campusCommitted.facts[0]!.id;
  f.grantTarget(legalId,'LEGAL');f.grantTarget(campusId,'CAMPUS');const legal=f.entry(),node=f.entry();legal.row.target_type='LEGAL';legal.row.target_id=legalId;node.row.target_type='CAMPUS';node.row.target_id=campusId;const accepted=await apply([legal,node]);
  expect((await owner.history('maker',{id:accepted.result.facts[0]!.id,campus:'NORTH'})).versions[0]?.facts.target).toMatchObject({owner:'organization-master',id:legalId});expect((await owner.history('maker',{id:accepted.result.facts[1]!.id,campus:'NORTH'})).versions[0]?.facts.target).toMatchObject({owner:'organization-master/campus',id:campusId});
 }finally{await organization.close();await campus.close();}
});
test('only one concurrent correction of the same approved alias head can commit',async()=>{
 const e=f.entry(),first=await apply([e]),id=first.result.facts[0]!.id;
 const a={...e,action:'CORRECT' as const,identifier:{owner:'department-master/organization-identifier' as const,id,expectedHead:'1'},row:{...e.row,identifier_value:'DEMO correction A'}},b={...a,row:{...a.row,identifier_value:'DEMO correction B'}};
 const one=await prepare([a]),two=await prepare([b]),results=await Promise.allSettled([owner.applyUnit('maker',{candidateId:one.candidate.candidateId,requestId:one.requestId}),owner.applyUnit('maker',{candidateId:two.candidate.candidateId,requestId:two.requestId})]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);const failed=results.find(x=>x.status==='rejected');expect(failed?.status==='rejected'&&failed.reason.message).toBe('STALE_VALIDATION');expect((await owner.history('maker',{id,campus:'NORTH'})).versions).toHaveLength(2);
});

test('expanded recode commands count against the whole revision budget',async()=>{
 const target=await f.newDepartment();f.grantTarget(target);const current=(await owner.forTarget('maker',{type:'ORG',id:target,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).items.find(x=>x.kind==='HOSPITAL_CODE')!;
 const change=f.entry();change.action='CHANGE';change.identifier={owner:'department-master/organization-identifier',id:current.id,expectedHead:current.version.number};Object.assign(change.row,{target_id:target,identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'DEMO_BUDGET_CODE',language:'',valid_from:'2026-06-01T00:00:00'});
 const rows=[change,...Array.from({length:99},()=>f.entry())],staged=await owner.stage('maker',await f.input(rows));
 const result=await owner.validate('maker',{inputId:staged.inputId});expect(result.commandCount).toBe(101);expect(result.issues).toContainEqual({row:0,field:'entries',code:'PLAN_INPUT_LIMIT',status:'FAIL'});
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries).toHaveLength(100);expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:current.value,campus:'NORTH',businessAt:'2026-07-01T00:00:00'})).toMatchObject({status:'RESOLVED',targetId:target});
});

test('concurrent official recodes cannot claim one permanent code for two Departments',async()=>{
 const targets=[await f.newDepartment(),await f.newDepartment()],codes=[],approved=[];
 for(const target of targets){f.grantTarget(target);const code=(await owner.forTarget('maker',{type:'ORG',id:target,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).items.find(x=>x.kind==='HOSPITAL_CODE')!;codes.push(code);const e=f.entry();e.action='CHANGE';e.identifier={owner:'department-master/organization-identifier',id:code.id,expectedHead:code.version.number};Object.assign(e.row,{target_id:target,identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'DEMO_RACE_CODE',language:'',valid_from:'2026-06-01T00:00:00'});approved.push(await prepare([e]));}
 const results=await Promise.allSettled(approved.map(a=>owner.applyUnit('maker',{candidateId:a.candidate.candidateId,requestId:a.requestId})));
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);const loser=results.findIndex(x=>x.status==='rejected');expect(results[loser]?.status==='rejected'&&results[loser].reason.message).toBe('STALE_VALIDATION');
 expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:codes[loser]!.value,campus:'NORTH',businessAt:'2026-07-01T00:00:00'})).toMatchObject({status:'RESOLVED',targetId:targets[loser]});expect((await owner.history('maker',{id:codes[loser]!.id,campus:'NORTH'})).versions).toHaveLength(1);
});

test('replaced verification invalidates an already approved candidate',async()=>{
 const e=f.entry(),approved=await prepare([e]);await owner.verify('reviewer',{requestId:randomUUID(),inputId:approved.staged.inputId,inputDigest:approved.staged.digest,rows:[{row:1,reason:'DEMO replacement personnel verification',evidenceId:f.artifact.artifactId,policyApproved:true}]});
 await expect(owner.applyUnit('maker',{candidateId:approved.candidate.candidateId,requestId:approved.requestId})).rejects.toThrow('STALE_VALIDATION');expect(await owner.resumeOutcome('maker',{candidateId:approved.candidate.candidateId,requestId:approved.requestId})).toBeNull();
});
test('initial official codes preserve finite ORG04 periods and alias admission rejects a middle coverage gap',async()=>{
 const department=openDepartment(connection,provider),row=f.department.entry();row.row.valid_to='2026-02-01T00:00:00';
 const commit=async(entry:typeof row)=>{const staged=await department.stage('maker',await f.department.input([entry]));await department.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO finite identity coverage',evidenceId:f.department.artifact.artifactId}]});const requestId=randomUUID(),candidate=await department.plan('maker',{inputId:staged.inputId,requestId});await department.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await department.approveApplyUnit('reviewer',candidate);const result=await department.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result.facts[0]!.id;};
 try{const id=await commit(row);f.grantTarget(id);row.intent='REVISE';row.target={owner:'department-master',id,expectedVersion:'1'};row.row.valid_from='2026-03-01T00:00:00';row.row.valid_to='';await commit(row);
  expect((await department.coverage('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:'2026-04-01T00:00:00'})).covered).toBe(false);
  const alias=f.entry();alias.row.target_id=id;alias.row.valid_to='2026-04-01T00:00:00';const staged=await owner.stage('maker',await f.input([alias]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'target_id',code:'BLOCKED_DEPENDENCY',status:'BLOCKED'});
  expect(await owner.resolve('maker',{scheme:'SYNTHETIC_DEPARTMENT_CODE',value:row.row.org_code,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).toEqual({status:'NOT_FOUND'});
 }finally{await department.close();}
});

test('ending a finite alias must actually shorten its accepted interval',async()=>{
 const e=f.entry();e.row.valid_to='2026-06-01T00:00:00';const first=await apply([e]);e.action='END';e.identifier={owner:'department-master/organization-identifier',id:first.result.facts[0]!.id,expectedHead:'1'};
 const staged=await owner.stage('maker',await f.input([e]));expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual({row:1,field:'action',code:'CLOSED_INPUT_REQUIRED',status:'FAIL'});expect((await owner.history('maker',{id:e.identifier.id,campus:'NORTH'})).versions).toHaveLength(1);
});

test('a verifier lacking the current target read grant cannot certify its input',async()=>{
 const staged=await owner.stage('maker',await f.input());peer(receipt.name,`DELETE FROM department_master.mapping_target_access WHERE actor='reviewer' AND target_type='ORG' AND target_id=${quote(f.targetId)}::uuid AND campus='NORTH';`);
 try{await expect(owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'DEMO verification without target authority',evidenceId:f.artifact.artifactId,policyApproved:true}]})).rejects.toThrow('ACCESS_DENIED');expect((await owner.preview('maker',{inputId:staged.inputId})).verification).toBeNull();}finally{f.grantTarget(f.targetId);}
});

test('Department reads before its first recorded version do not disclose initial code evidence',async()=>{
 const department=openDepartment(connection,provider);try{const known=await department.history('maker',f.targetId);expect(known.versions).not.toHaveLength(0);await expect(department.read('maker',{id:f.targetId,businessAt:'2026-01-01T00:00:00',recordAsOf:'2000-01-01T00:00:00'})).rejects.toThrow('NOT_FOUND');}finally{await department.close();}
});

test('source retirement still permits explicit end and withdrawal without requalifying expansion',async()=>{
 const source=f.source,e=f.entry();e.row.identifier_value='DEMO retire with upstream';const accepted=await apply([e]),id=accepted.result.facts[0]!.id;
 const impact=await catalog.sourceImpact('reviewer','SYNTHETIC',source.id,'RETIRE');await catalog.command('reviewer',{action:'RETIRE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_UPSTREAM_RETIRE',target:source.id,expectedHead:source.head,...(impact.definitionDigest===null?{}:{reviewDigest:impact.definitionDigest}),impactDigest:impact.impactDigest});
 expect(await owner.resumeOutcome('maker',{candidateId:accepted.candidate.candidateId,requestId:accepted.requestId})).toMatchObject({status:'COMMITTED',facts:accepted.result.facts});
 e.action='END';e.identifier={owner:'department-master/organization-identifier',id,expectedHead:'1'};e.row.valid_to='2026-07-01T00:00:00';await apply([e]);
 e.action='RETRACT';e.identifier.expectedHead='2';await apply([e]);expect((await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-03-01T00:00:00'})).version).toBeNull();
});
