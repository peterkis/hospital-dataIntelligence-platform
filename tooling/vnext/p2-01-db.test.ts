import {test,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {departmentFixture} from './p2-01-fixture.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {ORG04_FIELDS} from '../../apps/governance-api/src/modules/department-master/index.js';
import type {DepartmentStageInput as StageInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createDepartmentClient} from '../../packages/generated-api-client/src/vnext-client.js';
import {peer,quote} from './lineage.mjs';
import {Pool} from 'pg';
import {openDepartment} from '../../apps/governance-api/src/modules/department-master/index.js';
import {assertDepartmentProvisioned} from './department-provisioning.mjs';
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const owner=openDepartment(connection,provider),catalog=await openCatalog(connection,provider);
let f:Awaited<ReturnType<typeof departmentFixture>>;
async function readDepartment(input:Parameters<typeof owner.read>[1]){
 peer(receipt.name,`INSERT INTO department_master.identifier_access(actor,scheme,campus,permission) VALUES('maker','SYNTHETIC_DEPARTMENT_CODE','NORTH','READ') ON CONFLICT DO NOTHING; INSERT INTO department_master.mapping_target_access(actor,target_type,target_id,campus) VALUES('maker','ORG',${quote(input.id)}::uuid,'NORTH') ON CONFLICT DO NOTHING;`);
 return owner.read('maker',{...input,campus:'NORTH'});
}
afterAll(async()=>{await owner.close();await catalog.close();});
test('Department Owner rejects unauthorised reading at its public boundary',async()=>{
 const owner=openDepartment(process.env['VNEXT_VALIDATION_OWNER_URL']!);
 try{await expect(owner.list('outsider',{})).rejects.toThrow('ACCESS_DENIED');}finally{await owner.close();}
});
test('ORG04 policy adoption and independently approved creation return one database identity',async()=>{
 const ids:string[]=[];let sequence=0;
 const nextId=()=>ids[sequence++]??(ids.push(randomUUID()),ids.at(-1)!);
 const commands=new Map<string,Record<string,unknown>>();const freezeCommand=(name:string,input:Record<string,unknown>)=>{if(!commands.has(name))commands.set(name,input);return commands.get(name)!;};
 f=await departmentFixture(receipt,catalog,provider,{requestId:nextId,freezeCommand});
 const adopted=await f.input();sequence=0;
 const recovered=await departmentFixture(receipt,catalog,provider,{persistentSmoke:true,requestId:nextId,freezeCommand});
 expect(recovered.contract).toEqual(f.contract);expect(recovered.artifact).toEqual(f.artifact);
 expect(await recovered.input()).toEqual(adopted);
 await assertDepartmentProvisioned(connection,provider);
 const input=await f.input(),staged=await owner.stage('maker',input);
 expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('BLOCKED');
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO verified',evidenceId:f.artifact.artifactId}]});
 expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 await owner.approveApplyUnit('reviewer',candidate);
 const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});
 expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error();
 const fact=result.facts[0]!;expect(fact.id).not.toBe(input.entries[0]!.row.org_id);expect(fact.version).toBe('1');
 expect((await readDepartment({id:fact.id,businessAt:'2026-03-01T00:00:00'})).version?.facts).toMatchObject({name:'DEMO 同名科室',sourceVersion:'9'});
});

 test('row validation outcomes are independent and a valid row can commit beside a blocked row',async()=>{
  const good=f.entry(),blocked=f.entry();blocked.row.record_status='REVIEW';
  const staged=await owner.stage('maker',await f.input([good,blocked]));
  await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[
   {row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO valid row',evidenceId:f.artifact.artifactId},
   {row:2,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO blocked row',evidenceId:f.artifact.artifactId},
  ]});
  const validation=await owner.validate('maker',{inputId:staged.inputId});
  expect(validation.decision).toBe('BLOCKED');expect(validation.issues).toContainEqual({row:2,field:'record_status',code:'APPROVAL_REQUIRED',status:'BLOCKED'});
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
  expect(review.unit.atomicRule).toBe('ORG04_ROW_INDEPENDENT_V1');expect(review.unit.commands.map(command=>command.row)).toEqual([1]);
  await owner.approveApplyUnit('reviewer',candidate);const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});
  expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error();expect(result.facts).toHaveLength(1);expect(result.facts[0]!.source?.row).toBe(1);
  expect((await owner.list('maker',{limit:100})).some(id=>id===result.facts[0]!.id)).toBe(true);
 });

test('ORG04 XLSX rejects offsets and preserves local source fields through the shared Owner',async()=>{
 const offset=f.entry();for(const key of ['valid_from','recorded_at'] as const)offset.row[key]+='+08:00';
 const offsetResult=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_OFFSET_REJECT',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[{intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId}]},organizationWorkbook({ORG04:[ORG04_FIELDS,ORG04_FIELDS.map(k=>offset.row[k])]}));
 expect(offsetResult.input).toBeNull();expect(offsetResult.issues).toContainEqual(expect.objectContaining({code:'LOCAL_TIME_REQUIRED',row:2}));
 const entry=f.entry(),bytes=organizationWorkbook({ORG04:[ORG04_FIELDS,ORG04_FIELDS.map(k=>entry.row[k])]});
 await expect(owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[{intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId}]},Buffer.from('[]'))).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 const result=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[{intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId}]},bytes);
 expect(result.structuralStatus).toBe('PARSED');expect(result.input).not.toBeNull();
 const read=await owner.readInput('maker',{inputId:result.input!.inputId});expect(read.entries[0]!.row).toEqual(entry.row);expect(read.entries[0]!.sourceRow).toBe(2);
 expect((await owner.validate('maker',{inputId:result.input!.inputId})).validationRunId).toMatch(/^[a-f0-9-]{36}$/);
 const fileVerification=await owner.verify('reviewer',{requestId:randomUUID(),inputId:result.input!.inputId,inputDigest:result.input!.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO physical worksheet row',evidenceId:f.artifact.artifactId}]});expect(fileVerification.verificationId).toMatch(/^[a-f0-9-]{36}$/);
 const fileRequestId=randomUUID(),fileCandidate=await owner.plan('maker',{inputId:result.input!.inputId,requestId:fileRequestId});await owner.readApplyCandidate('reviewer',{candidateId:fileCandidate.candidateId});await owner.approveApplyUnit('reviewer',fileCandidate);const fileApplied=await owner.applyUnit('maker',{candidateId:fileCandidate.candidateId,requestId:fileRequestId});expect(fileApplied.status).toBe('COMMITTED');if(fileApplied.status!=='COMMITTED')throw new Error();
 const fileHistory=await owner.history('maker',fileApplied.facts[0]!.id);expect(fileHistory.versions[0]!.source_row).toBe(2);
 const staged=await owner.stage('maker',{...await f.input(),requestId:randomUUID(),timePolicy:'LOCAL',entries:[{...f.entry(),row:{...entry.row,org_code:entry.row.org_code+'_MANUAL',valid_from:'2026-01-01T00:00:00',recorded_at:'2026-01-02T00:00:00'}}]});
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO local timestamp',evidenceId:f.artifact.artifactId}]});
 const applyRequestId=randomUUID(),normalized=await owner.plan('maker',{inputId:staged.inputId,requestId:applyRequestId});await owner.readApplyCandidate('reviewer',{candidateId:normalized.candidateId});await owner.approveApplyUnit('reviewer',normalized);const applied=await owner.applyUnit('maker',{candidateId:normalized.candidateId,requestId:applyRequestId});expect(applied.status).toBe('COMMITTED');if(applied.status!=='COMMITTED')throw new Error();
 expect((await readDepartment({id:applied.facts[0]!.id,businessAt:'2026-02-01T00:00:00'})).version?.facts.sourceRecordedAt).toBe('2026-01-02T00:00:00.000000');
});

test('ORG04 XLSX keeps valid rows when another physical row is invalid',async()=>{
 const good=f.entry();
 const invalid=structuredClone(good);invalid.row.org_name=' invalid whitespace ';
 const retained=structuredClone(good);retained.row.record_status='REVIEW';
 const result=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_MIXED_ROWS',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[
  {intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId},
  {intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId},
 ]},organizationWorkbook({ORG04:[ORG04_FIELDS,ORG04_FIELDS.map(k=>invalid.row[k]),ORG04_FIELDS.map(k=>retained.row[k])]}));
 expect(result.input).not.toBeNull();expect(result.issues).toContainEqual(expect.objectContaining({code:'WHITESPACE_REJECTED',row:2}));
 const read=await owner.readInput('maker',{inputId:result.input!.inputId});expect(read.entries).toHaveLength(1);expect(read.entries[0]!.sourceRow).toBe(3);expect(read.entries[0]!.row).toEqual(retained.row);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:result.input!.inputId,inputDigest:result.input!.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO retained physical row',evidenceId:f.artifact.artifactId}]});
 expect((await owner.validate('maker',{inputId:result.input!.inputId})).issues).toContainEqual({row:1,field:'record_status',code:'APPROVAL_REQUIRED',status:'BLOCKED'});
});

test('ORG04 XLSX keeps valid entries across an omitted physical worksheet row',async()=>{
 const first=f.entry(),gap=f.entry(),second=f.entry(),third=f.entry();
 const files=Object.fromEntries(unzip(organizationWorkbook({ORG04:[ORG04_FIELDS,ORG04_FIELDS.map(k=>first.row[k]),ORG04_FIELDS.map(k=>gap.row[k]),ORG04_FIELDS.map(k=>second.row[k]),ORG04_FIELDS.map(k=>third.row[k])]}),true));
 files['xl/worksheets/sheet9.xml']=files['xl/worksheets/sheet9.xml']!.replace(/<row r="3">.*?<\/row>/u,'');
 const result=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_ROW_GAP',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[
  {intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId},
  {intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId},
  {intent:'CREATE',target:null,origin:'NEW',evidenceId:f.artifact.artifactId},
 ]},zipText(files));
 expect(result.input).not.toBeNull();expect(result.issues).toContainEqual({code:'ROW_GAP',row:3,column:0});
 const read=await owner.readInput('maker',{inputId:result.input!.inputId});expect(read.entries).toHaveLength(3);expect(read.entries.map(entry=>entry.sourceRow)).toEqual([2,4,5]);
 expect((await owner.validate('maker',{inputId:result.input!.inputId})).issues).toContainEqual({row:3,field:'',code:'ROW_GAP',status:'FAIL'});
});

test('metadata staging derives source rows instead of accepting caller provenance',async()=>{
 const input=await f.input();
 await expect(owner.stage('maker',{...input,entries:[{...f.entry(),sourceRow:999}]} as never)).rejects.toThrow('CLOSED_INPUT_REQUIRED');
});

test('verification skips rows that cannot be normalized and keeps valid rows reviewable',async()=>{
 const good=f.entry(),invalid=f.entry();invalid.row.valid_to=invalid.row.valid_from;
 const staged=await owner.stage('maker',await f.input([good,invalid]));
 const verification=await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO normalize independent',evidenceId:f.artifact.artifactId}]});
 expect(verification.verificationId).toMatch(/^[a-f0-9-]{36}$/);
 const validation=await owner.validate('maker',{inputId:staged.inputId});expect(validation.issues).toContainEqual({row:2,field:'',code:'INVALID_BUSINESS_PERIOD',status:'FAIL'});
 const candidate=await owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});
 expect(review.unit.commands.map(command=>command.row)).toEqual([1]);
});

test('intra-batch duplicate aliases, codes, and targets block every member',async()=>{
 const first=f.entry(),second=f.entry();second.row.org_code=first.row.org_code;second.row.org_name='DEMO conflicting duplicate';
 const staged=await owner.stage('maker',await f.input([first,second]));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[
  {row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO duplicate first',evidenceId:f.artifact.artifactId},
  {row:2,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO duplicate second',evidenceId:f.artifact.artifactId},
 ]});
 const validation=await owner.validate('maker',{inputId:staged.inputId});expect(validation.issues.filter(issue=>issue.code==='BATCH_CONFLICT').map(issue=>issue.row)).toEqual([1,2]);
});

test('intra-batch duplicate org_id rows fail even when exact',async()=>{
 const first=f.entry(),second=structuredClone(first);
 const staged=await owner.stage('maker',await f.input([first,second]));
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[
  {row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO exact duplicate first',evidenceId:f.artifact.artifactId},
  {row:2,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO exact duplicate later',evidenceId:f.artifact.artifactId},
 ]});
 const validation=await owner.validate('maker',{inputId:staged.inputId});expect(validation.decision).toBe('FAIL');expect(validation.issues.filter(issue=>issue.code==='BATCH_CONFLICT').map(issue=>issue.row)).toEqual([1,2]);
});

test('same-job retry omits a row whose matching facts were already committed',async()=>{
 const input=await f.input(),staged=await owner.stage('maker',input);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO retry first commit',evidenceId:f.artifact.artifactId}]});
 const firstRequest=randomUUID(),firstCandidate=await owner.plan('maker',{inputId:staged.inputId,requestId:firstRequest});await owner.readApplyCandidate('reviewer',{candidateId:firstCandidate.candidateId});await owner.approveApplyUnit('reviewer',firstCandidate);const first=await owner.applyUnit('maker',{candidateId:firstCandidate.candidateId,requestId:firstRequest});expect(first.status).toBe('COMMITTED');
 const revision=await catalog.importJobCommand('maker',{scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_RETRY',action:'REVISE',jobId:input.jobId,expectedCurrentRevision:input.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}});
 const retryInput={...input,requestId:randomUUID(),revisionId:revision.revisionId};const retry=await owner.stage('maker',retryInput);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:retry.inputId,inputDigest:retry.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO retry first commit',evidenceId:f.artifact.artifactId}]});
 const retryCandidate=await owner.plan('maker',{inputId:retry.inputId,requestId:randomUUID()}),review=await owner.readApplyCandidate('reviewer',{candidateId:retryCandidate.candidateId});
 expect(review.unit.commands).toHaveLength(0);expect(review.unit.basis['completedRows']).toEqual([1]);
 await expect(owner.approveApplyUnit('reviewer',retryCandidate)).rejects.toThrow('BATCH_REJECTED');
 const correctedRevision=await catalog.importJobCommand('maker',{scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_CORRECTION',action:'REVISE',jobId:input.jobId,expectedCurrentRevision:revision.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'c'.repeat(64)}});
 const correctedInput={...input,requestId:randomUUID(),revisionId:correctedRevision.revisionId,entries:[{...input.entries[0]!,row:{...input.entries[0]!.row,source_record_id:'DEMO_FILE/ORG04/CORRECTED',approval_ref:'DEMO_APPROVAL_CORRECTED'}}]};const corrected=await owner.stage('maker',correctedInput);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:corrected.inputId,inputDigest:corrected.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO retry correction',evidenceId:f.artifact.artifactId}]});
 await expect(owner.plan('maker',{inputId:corrected.inputId,requestId:randomUUID()})).rejects.toThrow('IDENTIFIER_CONFLICT');
});

test('same-job file retry keeps unchanged rows completed when the raw workbook is replaced',async()=>{
 const blocked=f.entry(),first=f.entry();blocked.row.record_status='REVIEW';
 const metadata=()=>({intent:'CREATE' as const,target:null,origin:'NEW' as const,evidenceId:f.artifact.artifactId});
 const workbook=(rows:ReturnType<typeof f.entry>['row'][])=>organizationWorkbook({ORG04:[ORG04_FIELDS,...rows.map(row=>ORG04_FIELDS.map(field=>row[field]))]});
 const initial=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_FILE_RETRY',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[metadata(),metadata()]},workbook([blocked.row,first.row]));
 expect(initial.input).not.toBeNull();const firstInput=await owner.readInput('maker',{inputId:initial.input!.inputId});expect(firstInput.entries).toHaveLength(2);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:initial.input!.inputId,inputDigest:initial.input!.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO file retry row1',evidenceId:f.artifact.artifactId},{row:2,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO file retry row2',evidenceId:f.artifact.artifactId}]});
 const firstRequest=randomUUID(),firstCandidate=await owner.plan('maker',{inputId:initial.input!.inputId,requestId:firstRequest}),firstReview=await owner.readApplyCandidate('reviewer',{candidateId:firstCandidate.candidateId});expect(firstReview.unit.commands.map(command=>command.row)).toEqual([2]);await owner.approveApplyUnit('reviewer',firstCandidate);const firstApplied=await owner.applyUnit('maker',{candidateId:firstCandidate.candidateId,requestId:firstRequest});expect(firstApplied.status).toBe('COMMITTED');
 const retry=await owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',retentionSeconds:3600,job:{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_FILE_RETRY_CORRECTION',jobId:initial.jobId,expectedCurrentRevision:initial.revisionId,input:{kind:'FILE',format:'XLSX',parserPolicy:'STRICT_DEPARTMENT_V1'}},entries:[metadata()]},workbook([first.row]));
 expect(retry.input).not.toBeNull();await owner.verify('reviewer',{requestId:randomUUID(),inputId:retry.input!.inputId,inputDigest:retry.input!.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO file retry row2',evidenceId:f.artifact.artifactId}]});
 const candidate=await owner.plan('maker',{inputId:retry.input!.inputId,requestId:randomUUID()}),review=await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});expect(review.unit.basis['completedRows']).toEqual([1]);expect(review.unit.commands).toHaveLength(0);
});

test('verification reason participates in retry identity',async()=>{
 const input=await f.input(),staged=await owner.stage('maker',input),reason='DEMO retry rationale original';
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason,evidenceId:f.artifact.artifactId}]});
 const firstRequest=randomUUID(),firstCandidate=await owner.plan('maker',{inputId:staged.inputId,requestId:firstRequest});await owner.readApplyCandidate('reviewer',{candidateId:firstCandidate.candidateId});await owner.approveApplyUnit('reviewer',firstCandidate);const first=await owner.applyUnit('maker',{candidateId:firstCandidate.candidateId,requestId:firstRequest});expect(first.status).toBe('COMMITTED');
 const revision=await catalog.importJobCommand('maker',{scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_DEPARTMENT_RETRY_REASON',action:'REVISE',jobId:input.jobId,expectedCurrentRevision:input.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'d'.repeat(64)}});
 const retry=await owner.stage('maker',{...input,requestId:randomUUID(),revisionId:revision.revisionId});
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:retry.inputId,inputDigest:retry.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:reason+' corrected',evidenceId:f.artifact.artifactId}]});
 await expect(owner.plan('maker',{inputId:retry.inputId,requestId:randomUUID()})).rejects.toThrow('IDENTIFIER_CONFLICT');
});

test('AC01/02/05 same-name departments remain distinct and rename preserves identity and microsecond B/R history',async()=>{
 const a=f.entry(),b=f.entry();const [one,two]=await apply([a,b]);expect(one!.id).not.toBe(two!.id);
 const original=await owner.exact('maker',{id:one!.id,version:'1'});
  await expect(owner.history('maker',one!.id,'2020-01-01T00:00:00')).rejects.toThrow('NOT_FOUND');
 const revision={...a,intent:'REVISE' as const,target:{owner:'department-master' as const,id:one!.id,expectedVersion:'1'},row:{...a.row,org_name:'DEMO 更名',valid_from:'2026-07-01T00:00:00.000001'}};
 const [updated]=await apply([revision]);expect(updated!.id).toBe(one!.id);
 expect((await readDepartment({id:one!.id,businessAt:'2026-07-01T00:00:00.000000'})).version?.facts.name).toBe(a.row.org_name);
 expect((await readDepartment({id:one!.id,businessAt:'2026-07-01T00:00:00.000001'})).version?.facts.name).toBe('DEMO 更名');
 expect((await readDepartment({id:one!.id,businessAt:'2026-08-01T00:00:00',recordAsOf:original.recordedAt})).version?.facts.name).toBe(a.row.org_name);
 expect((await owner.coverage('maker',{id:one!.id,validFrom:'2026-01-01T00:00:00',validTo:null})).covered).toBe(true);
 await expect(prepare([{...revision,target:{...revision.target,expectedVersion:'2'},row:{...revision.row,org_code:'DIFFERENT'}}])).rejects.toThrow('BLOCKED_DEPENDENCY');
 await expect(prepare([a])).rejects.toThrow('IDENTIFIER_CONFLICT');
});

async function prepare(entries:StageInput['entries'],exceptions:number[]=[]){
 const input=await f.input(entries),staged=await owner.stage('maker',input);
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:entries.map((_,i)=>({row:i+1,disposition:'DEPARTMENT',historicalException:exceptions.includes(i+1),reason:'DEMO independently verified',evidenceId:f.artifact.artifactId}))});
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 return {candidateId:candidate.candidateId,requestId};
}
async function apply(entries:StageInput['entries'],exceptions:number[]=[]){const r=await owner.applyUnit('maker',await prepare(entries,exceptions));if(r.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return r.facts;}
test('historical missing evidence requires an exact independent exception; a new department cannot use it',async()=>{
 const entry=f.entry();entry.row.established_on='';entry.row.establishment_doc='';
 await expect(prepare([entry],[1])).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 entry.origin='HISTORICAL';await expect(prepare([entry])).rejects.toThrow('LEGAL_REVIEW_REQUIRED');
 const [fact]=await apply([entry],[1]);
 expect((await readDepartment({id:fact!.id,businessAt:'2026-01-01T00:00:00'})).version?.facts).toMatchObject({historicalException:true,establishedOn:null});
});
test('real HTTP exposes the Department Owner and enforces outsider access',async()=>{
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{const url=await app.listen({host:'127.0.0.1',port:0});
  const response=await fetch(url+'/api/vnext/departments/list',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'outsider'},body:'{}'});
  expect(response.status).toBe(403);expect(await response.json()).toMatchObject({code:'ACCESS_DENIED'});
  const maker=createDepartmentClient(url,'maker'),reviewer=createDepartmentClient(url,'reviewer'),input=await f.input();
  const staged=await maker.stage(input);expect(staged.response.status).toBe(200);const s=staged.data!;
  expect((await reviewer.verify({requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO HTTP',evidenceId:f.artifact.artifactId}]})).response.status).toBe(200);
  const requestId=randomUUID(),planned=await maker.plan({inputId:s.inputId,requestId});expect(planned.response.status).toBe(200);
  const c=planned.data!;expect((await reviewer.review({candidateId:c.candidateId})).response.status).toBe(200);
  expect((await reviewer.approve(c)).response.status).toBe(200);
  const applied=await maker.apply({candidateId:c.candidateId,requestId});expect(applied.response.status).toBe(200);const id=applied.data!.facts![0]!.id;
  expect((await maker.history({id})).data!.versions).toHaveLength(1);
  expect((await maker.exact({id,version:'1'})).data!.id).toBe(id);
  expect((await maker.diff({id,fromVersion:'1',toVersion:'1'})).data).toEqual({changes:[]});
  const injected=await fetch(url+'/api/vnext/departments/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...input,parent:'ROOT'})});expect(injected.status).toBe(400);
 }finally{await app.close();}
});
test('current full-hospital review authority cannot be synthesized from a campus grant or an alias identity',async()=>{
 const input=await f.input(),s=await owner.stage('maker',input);
 await expect(owner.verify('maker-alias',{requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO',evidenceId:f.artifact.artifactId}]})).rejects.toThrow('ACCESS_DENIED');
 peer(receipt.name,"INSERT INTO department_master.access VALUES('maker-alias','HOSPITAL','VERIFY');");
 try{await expect(owner.verify('maker-alias',{requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO',evidenceId:f.artifact.artifactId}]})).rejects.toThrow('MAKER_CHECKER_REQUIRED');}finally{peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker-alias' AND permission='VERIFY';");}
 const request=await prepare([f.entry()]);peer(receipt.name,"DELETE FROM department_master.access WHERE actor='reviewer' AND permission='REVIEW'; INSERT INTO department_master.access VALUES('reviewer','NORTH','REVIEW');");
 try{await expect(owner.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"DELETE FROM department_master.access WHERE actor='reviewer' AND permission='REVIEW'; INSERT INTO department_master.access VALUES('reviewer','HOSPITAL','REVIEW');");}
});
test('semantic verification is rejected after the reviewer identity is rebound',async()=>{
 const staged=await owner.stage('maker',await f.input());
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO identity binding',evidenceId:f.artifact.artifactId}]});
 peer(receipt.name,"UPDATE vnext_control.actor SET identity_code='SYNTHETIC_REVIEWER_REBOUND' WHERE code='reviewer';");
 try{await expect(owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,"UPDATE vnext_control.actor SET identity_code='SYNTHETIC_REVIEWER' WHERE code='reviewer';");}
});
test('committed-row matcher treats bigint maximum as a false match without overflow',()=>{
 const result=peer(receipt.name,`SELECT department_master.committed_row('maker',${quote(randomUUID())}::uuid,1,'REVISE',${quote(randomUUID())}::uuid,9223372036854775807,'DEMO_BIGINT_BOUNDARY','2026-01-01T00:00:00'::timestamp,NULL,'{"commandDigest":"${'a'.repeat(64)}"}'::jsonb);`);
 expect(result).toBe('f');
});
test('unknown virtual meaning, view groups, lifecycle inputs and FULL cannot silently become core departments',async()=>{
 for(const disposition of ['UNKNOWN','VIEW_GROUP'] as const){const input=await f.input(),s=await owner.stage('maker',input);await owner.verify('reviewer',{requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition,historicalException:false,reason:'DEMO pending classification',evidenceId:f.artifact.artifactId}]});expect((await owner.validate('maker',{inputId:s.inputId})).issues).toContainEqual({row:1,field:'is_virtual',code:'LEGAL_REVIEW_REQUIRED',status:'BLOCKED'});}
 const lifecycle=f.entry();lifecycle.row.abolished_on='2026-12-01';await expect(prepare([lifecycle])).rejects.toThrow('BLOCKED_DEPENDENCY');
 const input=await f.input();input.profile='FULL';const s=await owner.stage('maker',input);await expect(owner.validate('maker',{inputId:s.inputId})).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await owner.readInput('maker',{inputId:s.inputId})).profile).toBe('FULL');
 const invalid=f.entry();invalid.row.org_type='UNAPPROVED';await expect(prepare([invalid])).rejects.toThrow('BLOCKED_DEPENDENCY');
});
test('whole-revision rollback, SQL bypass denial and lost-response replay preserve the same facts',async()=>{
 const request=await prepare([f.entry(),f.entry()]),before=await owner.list('maker',{limit:100});
 peer(receipt.name,"CREATE FUNCTION department_master.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OWNER_APPLY_COMMIT' THEN RAISE EXCEPTION 'DEMO_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER department_test_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION department_master.test_audit_failure();");
 try{await expect(owner.applyUnit('maker',request)).rejects.toThrow();expect(await owner.list('maker',{limit:100})).toEqual(before);expect(await owner.resumeOutcome('maker',request)).toBeNull();}finally{peer(receipt.name,'DROP TRIGGER department_test_audit ON vnext_control.audit; DROP FUNCTION department_master.test_audit_failure();');}
 const first=await owner.applyUnit('maker',request,async()=>{throw new Error('DEMO_LOST_RESPONSE');});expect(first).toMatchObject({status:'COMMITTED',responseStatus:'POST_COMMIT_FAILED'});
 const replay=await owner.applyUnit('maker',request);expect(replay).toMatchObject({status:'COMMITTED'});if(first.status!=='COMMITTED'||replay.status!=='COMMITTED')throw new Error();expect(replay.facts).toEqual(first.facts);
 const noKey=openDepartment(connection);try{expect((await noKey.resumeOutcome('maker-alias',request))?.facts).toEqual(first.facts);}finally{await noKey.close();}
 expect((await owner.history('maker',first.facts[0]!.id)).versions).toHaveLength(1);
 const pool=new Pool({connectionString:connection});try{await expect(pool.query("INSERT INTO department_master.department(code) VALUES('FORGED')")).rejects.toMatchObject({code:'42501'});await expect(pool.query('SELECT department_master.mutate($1,$2)',[JSON.stringify({actor:'maker',operation:'APPLY',transaction:'1'}),'0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');await expect(pool.query('SELECT key_hex FROM vnext_control.department_write_authority')).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});
test('concurrent same-code creates and stale-version revisions have only one winner',async()=>{
 const entry=f.entry(),a=await prepare([entry]),b=await prepare([{...entry,row:{...entry.row,org_id:randomUUID()}}]);
 const outcomes=await Promise.allSettled([owner.applyUnit('maker',a),owner.applyUnit('maker',b)]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const successful=outcomes.find(r=>r.status==='fulfilled');if(!successful||successful.status!=='fulfilled'||successful.value.status!=='COMMITTED')throw new Error();
 const fact=successful.value.facts[0]!,revision={...entry,intent:'REVISE' as const,target:{owner:'department-master' as const,id:fact.id,expectedVersion:'1'},row:{...entry.row,org_name:'DEMO revision'}};
 const c=await prepare([revision]),d=await prepare([{...revision,row:{...revision.row,org_name:'DEMO competing'}}]);
 const raced=await Promise.allSettled([owner.applyUnit('maker',c),owner.applyUnit('maker',d)]);expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await owner.history('maker',fact.id)).versions).toHaveLength(2);
});
test('AC01 a second authorized campus revises the same logical department without a duplicate identity',async()=>{
 const entry=f.entry(),[fact]=await apply([entry]);
 peer(receipt.name,`INSERT INTO department_master.access SELECT a,'SOUTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p ON CONFLICT DO NOTHING; INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'SOUTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 const proofJob=await f.newJob(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proofJob.id,revisionId:proofJob.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO same hospital department identity'));
 const input=await f.input([{...entry,intent:'REVISE',target:{owner:'department-master',id:fact!.id,expectedVersion:'1'},evidenceId:proof.artifactId}]);input.campus='SOUTH';
 const s=await owner.stage('maker',input);await owner.verify('reviewer',{requestId:randomUUID(),inputId:s.inputId,inputDigest:s.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'DEMO same identity',evidenceId:proof.artifactId}]});
 const requestId=randomUUID(),c=await owner.plan('maker',{inputId:s.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await owner.approveApplyUnit('reviewer',c);const result=await owner.applyUnit('maker',{candidateId:c.candidateId,requestId});
 expect(result).toMatchObject({status:'COMMITTED',facts:[{id:fact!.id,version:'2'}]});
});
test('a later UNKNOWN verification wins even when its generated UUID sorts before the previous approval',async()=>{
 const s=await owner.stage('maker',await f.input()),base={inputId:s.inputId,inputDigest:s.digest};
 const proof={row:1,disposition:'DEPARTMENT' as const,historicalException:false,reason:'DEMO previous classification',evidenceId:f.artifact.artifactId};
 await owner.verify('reviewer',{...base,requestId:randomUUID(),rows:[proof]});
 // Fault injection only in the receipt-owned test DB: UUID order is not stream order.
 peer(receipt.name,"ALTER TABLE department_master.verification ALTER COLUMN id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;");
 try{await owner.verify('reviewer',{...base,requestId:randomUUID(),rows:[{...proof,disposition:'UNKNOWN',reason:'DEMO evidence disputed'}]});}finally{peer(receipt.name,'ALTER TABLE department_master.verification ALTER COLUMN id SET DEFAULT uuidv7();');}
 expect((await owner.validate('maker',{inputId:s.inputId})).decision).toBe('BLOCKED');
});
test('request binding, superseded revisions and current read revocation are enforced during recovery',async()=>{
 const input=await f.input(),staged=await owner.stage('maker',input);expect(await owner.stage('maker',input)).toEqual(staged);
 const changed=structuredClone(input);changed.entries[0]!.row.description='DEMO changed';await expect(owner.stage('maker',changed)).rejects.toThrow('REQUEST_CONFLICT');
 await catalog.importJobCommand('maker',{scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_CORRECTION',action:'REVISE',jobId:input.jobId,expectedCurrentRevision:input.revisionId,input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}});
 await expect(owner.validate('maker',{inputId:staged.inputId})).rejects.toThrow('STALE_REVISION');
 expect((await owner.readInput('maker',{inputId:staged.inputId})).entries[0]!.row.description).toBe('DEMO responsibilities');
 const request=await prepare([f.entry()]);await owner.applyUnit('maker',request);
 peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker' AND permission='READ';");
 try{await expect(owner.resumeOutcome('maker',request)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"INSERT INTO department_master.access SELECT 'maker',s,'READ' FROM unnest(ARRAY['HOSPITAL','NORTH','SOUTH']) s;");}
});
