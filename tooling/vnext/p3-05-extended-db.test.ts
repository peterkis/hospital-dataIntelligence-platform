import {readFileSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll, afterAll, test, expect} from 'vitest';
import {openCatalog, type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {ORG11_FIELDS, type WardNursingEntry, type WardNursingStage, type WardNursingVerification, type WardNursingScope, type NursingEntry} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {openDepartmentLifecycle, openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.js';
import {withCareOrganizationImpacts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {createWardNursingCoverageClient} from '../../packages/generated-api-client/src/index.js';
import {wardNursingFixture} from './p3-05-fixture.js';
import {validationKeys} from './p3-05-validation-keys.mjs';
import {peer, quote} from './lineage.mjs';
import {coverageFile, coverageFileRequest, workbookBarrier, signedCoverageAttempt, type NursingCoverageFixture} from './p3-05-validation-helpers.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,f:NursingCoverageFixture,app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;

beforeAll(async()=>{
  const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});
  try {
    catalog=await openCatalog(connection,provider);
    const role=(await pool.query('select current_user r')).rows[0]!.r;
    f=await wardNursingFixture(receipt,role,catalog,provider,connection,false);
    const contexts:Parameters<typeof buildCatalogServer>=[catalog,'CONTROL_PLANE'];
    contexts[23]={owner:f.owner,actor:r=>actor(r.headers)};
    app=await buildCatalogServer(...contexts);url=await app.listen({host:'127.0.0.1',port:0});
  } finally {await pool.end();}
});
afterAll(async()=>{await app?.close();await f?.close();await catalog?.close();});

const end=(entry:WardNursingEntry,id:string,head:string,at:string):WardNursingEntry=>({...entry,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:head},endAt:at,row:{...entry.row,record_status:'RETIRED'}});
const coverageInput=(value:WardNursingStage)=>{if(value.kind!=='COVERAGE')throw new Error('TEST_COVERAGE_INPUT_REQUIRED');return value;};
const window=(a:WardNursingScope,mode:'CURRENT_ADMISSION'|'HISTORICAL'='CURRENT_ADMISSION')=>({applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD' as const},validFrom:'2026-01-01T00:00:00',validTo:'2026-04-01T00:00:00',mode});

test.each(['CSV','JSON','XLSX'] as const)('actual generated HTTP %s preserves all 14 fields, raw bytes, null/empty and timestamp lexemes through Apply',async format=>{
  const a=await f.endpoint(),entry=f.entry(a),marker='TEST_PRIVATE_LOCATOR_'+randomUUID();
  entry.row={...entry.row,coverage_scope:'{ "kind" : "WHOLE_WARD" }',handover_rule_ref:format==='JSON'?null:'',source_record_id:marker,valid_from:'2026-01-01T00:00:00.000001',recorded_at:'2026-01-02T00:00:00.120'};
  const fields=[...ORG11_FIELDS].reverse(),bytes=coverageFile([entry.row],format,fields),maker=createWardNursingCoverageClient(url,'maker'),reviewer=createWardNursingCoverageClient(url,'reviewer');
  const received=await maker.file({input:coverageFileRequest(f,[entry],format),contentBase64:bytes.toString('base64')});
  expect(received.response.status,JSON.stringify(received.error)).toBe(200);
  const result=received.data!;expect(result.issues).toEqual([]);expect(result.input).not.toBeNull();
  const raw=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',requestId:randomUUID(),artifactId:result.sourceArtifactId,campus:'NORTH',purpose:'IDENTITY_VERIFY'});
  try {expect(Buffer.from(raw)).toEqual(bytes);} finally {raw.fill(0);}
  const read=await maker.readInput({inputId:result.input!.inputId});expect(read.response.status).toBe(200);
  const stored=coverageInput(read.data!);expect(Object.keys(stored.entries[0]!.row).sort()).toEqual([...ORG11_FIELDS].sort());
  expect(stored.entries[0]!.row).toMatchObject({coverage_scope:entry.row.coverage_scope,handover_rule_ref:entry.row.handover_rule_ref,valid_to:null,source_record_id:marker,valid_from:entry.row.valid_from,recorded_at:entry.row.recorded_at});
  expect((await reviewer.verify(f.verification(stored,result.input!))).response.status).toBe(200);
  const preview=await maker.preview({inputId:result.input!.inputId});expect(preview.data!.decision).toBe('PASS');
  const requestId=randomUUID(),planned=await maker.plan({inputId:result.input!.inputId,requestId});expect(planned.response.status).toBe(200);
  const candidate=await reviewer.review({candidateId:planned.data!.candidateId});expect(candidate.response.status).toBe(200);
  expect(JSON.stringify(candidate.data)).toContain(marker);
  expect((await reviewer.approve(planned.data!)).response.status).toBe(200);
  const applied=await maker.apply({candidateId:planned.data!.candidateId,requestId});expect(applied.response.status,JSON.stringify(applied.error)).toBe(200);
  if(applied.data?.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const exact=await maker.exact({id:applied.data.facts[0]!.id,version:'1'});expect(exact.response.status).toBe(200);
  expect(exact.data).toMatchObject({validFrom:'2026-01-01T00:00:00.000001',validTo:null,facts:{coverageSource:entry.row.coverage_scope,handoverRuleReference:entry.row.handover_rule_ref,source:{sourceVersion:'9',sourceRecordedAt:'2026-01-02T00:00:00.120000'}}});
  const metadata=await catalog.readMasked('maker',{scope:'SYNTHETIC',requestId:randomUUID(),artifactId:result.sourceArtifactId,campus:'NORTH',purpose:'IDENTITY_VERIFY'});expect(metadata.masked).toBe('[REDACTED]');
  for(const response of [preview.data,metadata,applied.data,exact.data])expect(JSON.stringify(response)).not.toContain(marker);
  expect(JSON.stringify(applied.data)).not.toContain(createHash('sha256').update(bytes).digest('hex'));
  expect((await createWardNursingCoverageClient(url,'outsider').readInput({inputId:result.input!.inputId})).response.status).toBe(403);
  await expect(catalog.authorizeSensitiveRead('outsider',{scope:'SYNTHETIC',requestId:randomUUID(),artifactId:result.sourceArtifactId,campus:'NORTH',purpose:'IDENTITY_VERIFY'})).rejects.toThrow('ACCESS_DENIED');
});

test('partition source order and equivalent review time lexemes remain evidence after publication',async()=>{
  const a=await f.endpoint(),set=await f.register(a),coverage=f.partition(set,[1,0]),entry=f.entry(a,coverage);
  if(coverage.kind!=='PARTITIONS')throw new Error('TEST_PARTITION_SCOPE_REQUIRED');
  entry.row.coverage_scope=JSON.stringify(coverage,null,2);entry.row.valid_from='2026-01-01T00:00:00.120';
  const value=await f.input([entry]),staged=await f.owner.stage('maker',value);await f.owner.verify('reviewer',{...f.verification(value,staged),rows:f.verification(value,staged).rows.map(v=>({...v,coverage:{...coverage,partitionIds:[...coverage.partitionIds].reverse()},validFrom:'2026-01-01T00:00:00.120000'}))});
  expect(await f.owner.readInput('maker',{inputId:staged.inputId})).toEqual(value);
  const requestId=randomUUID(),q=await f.owner.plan('maker',{inputId:staged.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});await f.owner.approveApplyUnit('reviewer',q);const out=await f.owner.applyUnit('maker',{candidateId:q.candidateId,requestId});
  if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect((await f.owner.exact('maker',{id:out.facts[0]!.id,version:'1'})).facts.coverageSource).toBe(entry.row.coverage_scope);
});

test('a finite approved scope set preserves covered primary partition prefixes in a longer whole-Ward request',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),scopeInput=await f.scopeInput(a),from='2026-01-01T00:00:00',end='2026-03-01T00:00:00',until='2026-04-01T00:00:00';if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');scopeInput.definition.validTo=end;
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id});expect(set).toMatchObject({validFrom:'2026-01-01T00:00:00.000000',validTo:'2026-03-01T00:00:00.000000'});
  const entries=[f.entry(a,f.partition(set,[0])),f.entry(b,f.partition(set,[1]))].map(entry=>({...entry,row:{...entry.row,valid_to:end}})),published=await f.apply(await f.input(entries));expect(published.facts).toHaveLength(2);
  const response=await createWardNursingCoverageClient(url,'maker').evaluate({...window(a),validFrom:from,validTo:until});expect(response.response.status,JSON.stringify(response.error)).toBe(200);const evaluation=response.data!;
  expect(evaluation).toMatchObject({declaredCovered:false,primaryCovered:false,currentAdmissionCovered:false,status:'NOT_SATISFIED'});
  for(const name of ['declaredGaps','primaryGaps','currentGaps'] as const){expect(evaluation[name].length).toBeGreaterThan(0);for(const gap of evaluation[name])expect(gap).toMatchObject({from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'});}
  for(const [index,fact] of published.facts.entries())expect(evaluation.checks).toContainEqual(expect.objectContaining({partitionId:set.partitions[index]!.id,relationId:fact.id,from:'2026-01-01T00:00:00.000000',to:'2026-03-01T00:00:00.000000',status:'SATISFIED'}));
});

test('R1: explicit PARTITIONS finite scope prefix remains in a longer current window',async()=>{
  const a=await f.endpoint(),scopeInput=await f.scopeInput(a),end='2026-03-01T00:00:00';
  if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');
  scopeInput.definition.validTo=end;
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id});
  const coverage=f.partition(set,[0]),entry=f.entry(a,coverage);entry.row.valid_to=end;
  const published=await f.apply(await f.input([entry]));
  const response=await createWardNursingCoverageClient(url,'maker').evaluate({...window(a),coverage});
  expect(response.response.status,JSON.stringify(response.error)).toBe(200);
  const evaluation=response.data!;
  expect(evaluation).toMatchObject({declaredCovered:false,primaryCovered:false,currentAdmissionCovered:false,status:'NOT_SATISFIED'});
  for(const name of ['declaredGaps','primaryGaps','currentGaps'] as const)expect(evaluation[name]).toEqual([{partitionId:set.partitions[0]!.id,from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);
  expect(evaluation.checks).toContainEqual(expect.objectContaining({partitionId:set.partitions[0]!.id,relationId:published.facts[0]!.id,from:'2026-01-01T00:00:00.000000',to:'2026-03-01T00:00:00.000000',status:'SATISFIED'}));
});

test.each([
  ['CURRENT_ADMISSION','FINITE'],['CURRENT_ADMISSION','UNBOUNDED'],
  ['HISTORICAL','FINITE'],['HISTORICAL','UNBOUNDED'],
] as const)('R1: explicit PARTITIONS %s %s windows retain microsecond prefixes and definition gaps',async(mode,bound)=>{
  const a=await f.endpoint(),scopeInput=await f.scopeInput(a),start='2026-02-01T00:00:00.000001',endAt='2026-03-01T00:00:00.000001';
  if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');
  scopeInput.definition.validFrom=start;scopeInput.definition.validTo=endAt;
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id}),coverage=f.partition(set,[0]),entry=f.entry(a,coverage);
  entry.row.valid_from=start;entry.row.valid_to=endAt;
  const published=await f.apply(await f.input([entry])),relationId=published.facts[0]!.id;
  if(mode==='HISTORICAL')await f.apply(await f.input([end(entry,relationId,'1','2026-02-15T00:00:00')]));
  const client=createWardNursingCoverageClient(url,'maker'),request={...window(a,mode),coverage,validTo:bound==='FINITE'?'2026-04-01T00:00:00.000000':null,...(mode==='HISTORICAL'?{recordAsOf:published.recordedAt}:{})};
  const response=await client.evaluate(request);expect(response.response.status,JSON.stringify(response.error)).toBe(200);
  const evaluation=response.data!;
  expect(evaluation).toMatchObject({declaredCovered:false,primaryCovered:false,currentAdmissionCovered:false,status:'NOT_SATISFIED'});
  for(const name of ['declaredGaps','primaryGaps','currentGaps'] as const)expect(evaluation[name]).toEqual([
    {partitionId:set.partitions[0]!.id,from:'2026-01-01T00:00:00.000000',to:start},
    {partitionId:set.partitions[0]!.id,from:endAt,to:request.validTo},
  ]);
  expect(evaluation.checks).toContainEqual(expect.objectContaining({partitionId:set.partitions[0]!.id,relationId,from:start,to:endAt,status:'SATISFIED'}));
  const lastMicrosecond=await client.evaluate({...request,validFrom:'2026-03-01T00:00:00.000000',validTo:endAt});
  expect(lastMicrosecond.response.status,JSON.stringify(lastMicrosecond.error)).toBe(200);
  expect(lastMicrosecond.data).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true,status:'SATISFIED',declaredGaps:[],primaryGaps:[],currentGaps:[]});
  const outside=await client.evaluate({...request,validFrom:endAt,validTo:'2026-03-01T00:00:00.000002'});
  expect(outside.response.status,JSON.stringify(outside.error)).toBe(200);
  for(const name of ['declaredGaps','primaryGaps','currentGaps'] as const)expect(outside.data![name]).toEqual([{partitionId:set.partitions[0]!.id,from:endAt,to:'2026-03-01T00:00:00.000002'}]);
  expect(outside.data!.checks).toEqual([{partitionId:set.partitions[0]!.id,from:endAt,to:'2026-03-01T00:00:00.000002',status:'NOT_SATISFIED',reason:'SCOPE_BASIS_MISMATCH',relationId:null,acceptedBasis:null,basis:null}]);
});

test('R1: explicit PARTITIONS read identity still rejects wrong Ward, version, members and current access',async()=>{
  const a=await f.endpoint(),other=await f.endpoint(),scopeInput=await f.scopeInput(a);
  if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');
  scopeInput.definition.validTo='2026-03-01T00:00:00';
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id}),coverage=f.partition(set,[0]);
  if(coverage.kind!=='PARTITIONS')throw new Error('TEST_PARTITION_SCOPE_REQUIRED');
  const client=createWardNursingCoverageClient(url,'maker');
  for(const mode of ['CURRENT_ADMISSION','HISTORICAL'] as const){
    const request={...window(a,mode),coverage,...(mode==='HISTORICAL'?{recordAsOf:registered.recordedAt}:{})};
    const wrongWard=await client.evaluate({...request,applicability:window(other).applicability});
    expect(wrongWard.response.status).toBe(400);expect(wrongWard.error?.code).toBe('SCOPE_BASIS_MISMATCH');
    for(const invalid of [{...coverage,version:'2'},{...coverage,partitionIds:[randomUUID()]},{...coverage,scopeSetId:randomUUID()}]){
      const rejected=await client.evaluate({...request,coverage:invalid});
      expect(rejected.response.status).toBe(400);expect(rejected.error?.code).toBe('UNKNOWN_COVERAGE_SCOPE');
    }
    const outsider=await createWardNursingCoverageClient(url,'outsider').evaluate(request);expect(outsider.response.status).toBe(403);
  }
});

test('R1: finite PARTITIONS reads do not relax full-period revision or restricted SQL admission',async()=>{
  const a=await f.endpoint(),scopeInput=await f.scopeInput(a),endAt='2026-03-01T00:00:00';
  if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');scopeInput.definition.validTo=endAt;
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id}),coverage=f.partition(set,[0]),entry=f.entry(a,coverage);
  entry.row.valid_to=endAt;const published=await f.apply(await f.input([entry])),id=published.facts[0]!.id,original=await f.owner.exact('maker',{id,version:'1'});
  const value=await f.input([{...entry,action:'REVISE',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-04-01T00:00:00'}}]),staged=await f.owner.stage('maker',value);
  await f.owner.verify('reviewer',f.verification(value,staged));
  expect((await f.owner.preview('maker',{inputId:staged.inputId})).issues).toContainEqual(expect.objectContaining({code:'SCOPE_BASIS_MISMATCH'}));
  await expect(f.owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('SCOPE_BASIS_MISMATCH');
  const pool=new Pool({connectionString:connection,max:1});
  try {await expect(pool.query('select care_organization.ward_nursing_scope_validate($1,$2::jsonb,$3::jsonb,$4::timestamp,$5::timestamp,$6::timestamp)',['maker',JSON.stringify(a),JSON.stringify(coverage),'2026-01-01T00:00:00','2026-04-01T00:00:00',published.recordedAt])).rejects.toThrow('SCOPE_BASIS_MISMATCH');}
  finally {await pool.end();}
  expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(original);expect((await f.owner.history('maker',{id})).versions).toHaveLength(1);
});

test('R1: whole-Ward coverage cannot extend an explicit partition past its frozen definition',async()=>{
  const a=await f.endpoint(),scopeInput=await f.scopeInput(a);
  if(scopeInput.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_DEFINITION_REQUIRED');scopeInput.definition.validTo='2026-03-01T00:00:00';
  const registered=await f.apply(scopeInput),set=await f.owner.readScopeDefinition('maker',{id:registered.facts[0]!.id});
  await f.apply(await f.input([f.entry(a)]));
  const response=await createWardNursingCoverageClient(url,'maker').evaluate({...window(a),coverage:f.partition(set,[0])});expect(response.response.status,JSON.stringify(response.error)).toBe(200);
  for(const name of ['declaredGaps','primaryGaps','currentGaps'] as const)expect(response.data![name]).toEqual([{partitionId:set.partitions[0]!.id,from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);
  expect(response.data!.checks).toContainEqual(expect.objectContaining({partitionId:set.partitions[0]!.id,from:'2026-01-01T00:00:00.000000',to:'2026-03-01T00:00:00.000000',status:'SATISFIED'}));
});

test.each(['MACRO','FORMULA','HIDDEN','EXTERNAL'] as const)('actual XLSX %s barrier retains rejected evidence and publishes no coverage',async barrier=>{
  const a=await f.endpoint(),entry=f.entry(a),bytes=workbookBarrier(coverageFile([entry.row],'XLSX'),barrier),received=await createWardNursingCoverageClient(url,'maker').file({input:coverageFileRequest(f,[entry],'XLSX'),contentBase64:bytes.toString('base64')});
  expect(received.response.status,JSON.stringify(received.error)).toBe(200);expect(received.data).toMatchObject({structuralStatus:'REJECTED',input:null});
  expect(received.data!.issues).toContainEqual(expect.objectContaining({code:barrier==='HIDDEN'?'HIDDEN_UNDECLARED':'ACTIVE_CONTENT'}));
  const raw=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',requestId:randomUUID(),artifactId:received.data!.sourceArtifactId,campus:'NORTH',purpose:'IDENTITY_VERIFY'});try{expect(Buffer.from(raw)).toEqual(bytes);}finally{raw.fill(0);}
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test('actual JSON duplicate keys, escaped duplicate keys and unknown fields cannot become last-write-wins coverage',async()=>{
  const a=await f.endpoint(),entry=f.entry(a),text=JSON.stringify([entry.row]);
  const cases=[text.replace('"version_no":9','"version_no":8,"version_no":9'),text.replace('"version_no":9','"version_no":8,"version_\\u006eo":9'),text.replace('"version_no":9','"version_no":9,"personalRoster":"TEST forbidden extra field"')];
  for(const [index,source] of cases.entries()){const received=await f.owner.receiveFile('maker',coverageFileRequest(f,[entry],'JSON'),Buffer.from(source));expect(received.input).toBeNull();expect(received.issues).toContainEqual(expect.objectContaining({code:index<2?'DUPLICATE_FIELD':'FIELD_CONTRACT'}));}
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test.each(['TEST unexplained scope text','{"kind":"WHOLE_WARD","kind":"PARTITIONS"}','{"kind":"WHOLE_WARD","bedNumber":1}'])('protected Owner retains unknown raw scope %s for review and refuses publication',async source=>{
  const a=await f.endpoint(),entry=f.entry(a);entry.row.coverage_scope=source;const value=await f.input([entry]),staged=await f.owner.stage('maker',value);
  expect(await f.owner.readInput('maker',{inputId:staged.inputId})).toEqual(value);await f.owner.verify('reviewer',f.verification(value,staged));expect((await f.owner.preview('maker',{inputId:staged.inputId})).issues).toContainEqual(expect.objectContaining({code:'UNKNOWN_COVERAGE_SCOPE'}));await expect(f.owner.plan('maker',{inputId:staged.inputId,requestId:randomUUID()})).rejects.toThrow('UNKNOWN_COVERAGE_SCOPE');expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test.each(['CSV','JSON','XLSX'] as const)('actual %s repeated source aliases block the complete reviewed batch',async format=>{
  const a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),first=f.entry(a,f.partition(set,[0])),second=f.entry(b,f.partition(set,[1]));second.row.ward_nursing_rel_id=first.row.ward_nursing_rel_id;
  const received=await f.owner.receiveFile('maker',coverageFileRequest(f,[first,second],format),coverageFile([first.row,second.row],format));
  expect(received.input).not.toBeNull();const value=await f.owner.readInput('maker',{inputId:received.input!.inputId});await f.owner.verify('reviewer',f.verification(value,received.input!));expect((await f.owner.preview('maker',{inputId:received.input!.inputId})).issues).toContainEqual(expect.objectContaining({code:'BATCH_CONFLICT'}));await expect(f.owner.plan('maker',{inputId:received.input!.inputId,requestId:randomUUID()})).rejects.toThrow('BATCH_CONFLICT');
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

for(const [identity,permission] of [['maker','WRITE'],['maker','READ_RESTRICTED'],['reviewer','REVIEW'],['reviewer','VERIFY'],['reviewer','READ_RESTRICTED']] as const)test(`actual restricted signed SQL rechecks current ${identity} ${permission}`,async()=>{
  const a=await f.endpoint(),q=await f.prepare(await f.input([f.entry(a)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});
  expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');
  peer(receipt.name,`DELETE FROM care_organization.ward_nursing_access WHERE actor=${quote(identity)} AND campus_id=${quote(a.campus.id)}::uuid AND permission=${quote(permission)};`);
  try {expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('ACCESS_DENIED');await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('ACCESS_DENIED');}
  finally {f.grant(a);}
  expect(await f.owner.resumeOutcome('maker',q)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test('a semantically equal new verification invalidates the frozen exact verification pin in Owner and signed SQL',async()=>{
  const a=await f.endpoint(),value=await f.input([f.entry(a)]),q=await f.prepare(value),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId}),staged=await f.owner.stage('maker',value);
  await f.owner.verify('reviewer',f.verification(value,staged));
  await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('STALE_VALIDATION');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();
});

test('equivalent complete Ward revision requires new frozen dependency pins in Owner and signed SQL',async()=>{
  const a=await f.endpoint(),q=await f.prepare(await f.input([f.entry(a)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId}),h=await f.wards.owner.history('maker',{id:a.ward.id}),d=h.versions[0]!,binding=h.bindings[0]!.versions[0]!.binding;
  await f.wards.apply(await f.wards.input([{action:'REVISE',target:{owner:'care-organization/ward',id:a.ward.id,expectedHead:'1'},row:{...f.wards.row(binding),ward_id:d.facts.source.sourceAlias,ward_code:d.facts.wardCode,ward_name:d.facts.wardName,ward_type:d.facts.wardType,admission_rule_ref:d.facts.admissionRuleReference,public_phone:d.facts.publicPhone},reason:'TEST equivalent complete Ward replacement',evidenceId:f.wards.artifact.artifactId}]));
  await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('STALE_VALIDATION');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();
});

test('restricted application role rejects forged SQL authority and direct table mutation',async()=>{
  const pool=new Pool({connectionString:connection,max:1});try{const role=(await pool.query('select current_user r')).rows[0]!.r;expect(role).toMatch(/^hdi_(validation|owner)_[a-f0-9]{16}$/);
    const internalFunctions=['care_organization.ward_nursing_reserved(uuid,timestamp)','care_organization.ward_nursing_state(uuid,timestamp,timestamp)','care_organization.ward_nursing_group_validate(uuid,timestamp)'],privileges=await pool.query('select signature,has_function_privilege(current_user,signature,\'EXECUTE\') allowed from unnest($1::text[]) as guarded(signature)',[internalFunctions]);expect(privileges.rows).toHaveLength(3);for(const row of privileges.rows)expect(row.allowed,row.signature).toBe(false);
    await expect(pool.query('select care_organization.ward_nursing_mutate($1,$2)',['{}','0'.repeat(64)])).rejects.toMatchObject({message:'ACCESS_DENIED'});await expect(pool.query('insert into care_organization.ward_nursing_access values($1,$2,$3,$4)',['outsider',randomUUID(),'NORTH','READ'])).rejects.toMatchObject({code:'42501'});}finally{await pool.end();}
});

test('actual HTTP closed typed anchors reject wrong Owner, unsupported purpose and extraneous fields',async()=>{
  const a=await f.endpoint(),value=coverageInput(await f.input([f.entry(a)])),entry=value.entries[0]!;
  const invalid=[{...entry,applicability:{...a,nursing:{...a.nursing,owner:'care-organization/ward'}}},{...entry,applicability:{...a,purpose:'BED_ASSIGNMENT'}},{...entry,actualPatientCount:1}];
  for(const row of invalid){const response=await fetch(url+'/api/vnext/ward-nursing-coverages/inputs',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({...value,requestId:randomUUID(),entries:[row]})});expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'CLOSED_INPUT_REQUIRED'});}
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test('real concurrent primary candidates cannot both commit for the same logical coverage',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),q1=await f.prepare(await f.input([f.entry(a)])),q2=await f.prepare(await f.input([f.entry(b)]));
  const outcomes=await Promise.allSettled([f.owner.applyUnit('maker',q1),f.owner.applyUnit('maker',q2)]);expect(outcomes.filter(v=>v.status==='fulfilled'&&v.value.status==='COMMITTED')).toHaveLength(1);expect(outcomes.filter(v=>v.status==='rejected')).toHaveLength(1);expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(1);
});

test('real concurrent revisions use expected head and preserve the losing outcome as absent',async()=>{
  const a=await f.endpoint(),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id;
  const revise=(validTo:string):WardNursingEntry=>({...entry,action:'REVISE',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},row:{...entry.row,valid_to:validTo}});
  const q1=await f.prepare(await f.input([revise('2026-03-01T00:00:00')])),q2=await f.prepare(await f.input([revise('2026-04-01T00:00:00')])),results=await Promise.allSettled([f.owner.applyUnit('maker',q1),f.owner.applyUnit('maker',q2)]);
  expect(results.filter(v=>v.status==='fulfilled'&&v.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(v=>v.status==='rejected')).toHaveLength(1);expect((await f.owner.history('maker',{id})).versions).toHaveLength(2);
  const losing=results[0]!.status==='rejected'?q1:q2;expect(await f.owner.resumeOutcome('maker',losing)).toBeNull();
});

test.each(['LATE_ROW','AUDIT'] as const)('%s failure rolls back identities, versions, audit and durable outcome together',async fault=>{
  const a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),q=await f.prepare(await f.input([f.entry(a,f.partition(set,[0])),f.entry(b,f.partition(set,[1]))]));
  const trigger=fault==='AUDIT'?'vnext_control.audit':'care_organization.ward_nursing_version',condition=fault==='AUDIT'?"NEW.action='WARD_NURSING_CREATE' AND ":'',auditBefore=peer(receipt.name,`select count(*) from vnext_control.audit where action='WARD_NURSING_CREATE';`);
  peer(receipt.name,`CREATE FUNCTION vnext_control.test_p3_05_atomic_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN IF ${condition}(SELECT count(*) FROM care_organization.ward_nursing_version v JOIN care_organization.ward_nursing c ON c.id=v.ward_nursing_id WHERE c.ward_id=${quote(a.ward.id)}::uuid)>=${fault==='AUDIT'?2:1} THEN RAISE EXCEPTION 'TEST_P3_05_ATOMIC_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_p3_05_atomic_failure BEFORE INSERT ON ${trigger} FOR EACH ROW EXECUTE FUNCTION vnext_control.test_p3_05_atomic_failure();`);
  try {await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('APPLY_FAILED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);expect(peer(receipt.name,`select count(*) from vnext_control.audit where action='WARD_NURSING_CREATE';`)).toBe(auditBefore);}
  finally {peer(receipt.name,`DROP TRIGGER test_p3_05_atomic_failure ON ${trigger};DROP FUNCTION vnext_control.test_p3_05_atomic_failure();`);}
  const recovered=await f.owner.applyUnit('maker',q);expect(recovered.status).toBe('COMMITTED');expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(2);
});

test('ACK loss recovers exact committed result without a second version and current access still gates recovery',async()=>{
  const a=await f.endpoint(),q=await f.prepare(await f.input([f.entry(a)])),out=await f.owner.applyUnit('maker',q,()=>{throw new Error('TEST_P3_05_ACK_LOSS');});
  if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.responseStatus).toBe('POST_COMMIT_FAILED');const {responseStatus:_responseStatus,...durable}=out;
  const maker=createWardNursingCoverageClient(url,'maker');expect((await maker.resume(q)).data).toEqual(durable);expect((await maker.apply(q)).data).toMatchObject(durable);expect((await maker.reconcile(q)).data).toMatchObject({status:'MATCHED'});expect((await maker.history({id:out.facts[0]!.id})).data!.versions).toHaveLength(1);
  peer(receipt.name,`DELETE FROM care_organization.ward_nursing_access WHERE actor='maker' AND campus_id=${quote(a.campus.id)}::uuid AND permission='READ';`);
  try {for(const read of [()=>maker.resume(q),()=>maker.apply(q),()=>maker.reconcile(q)])expect((await read()).response.status).toBe(403);}
  finally {f.grant(a);}
  expect((await maker.resume(q)).data).toEqual(durable);
});

test('one Nursing identity may cover multiple Wards in its campus but cannot cross campus by assertion',async()=>{
  const a=await f.endpoint(),h=await f.wards.owner.history('maker',{id:a.ward.id}),binding=h.bindings[0]!.versions[0]!.binding,ward=await f.wards.apply(await f.wards.input([f.wards.entry(binding)])),second:WardNursingScope={...a,ward:{owner:'care-organization/ward',id:ward.facts[0]!.id}};
  f.grant(second);const published=await f.apply(await f.input([f.entry(a),f.entry(second)]));expect(published.facts).toHaveLength(2);expect((await f.owner.list('maker',{campus:'NORTH',nursingId:a.nursing.id})).items).toHaveLength(2);
  const foreign=await f.endpoint(),invalid={...foreign,nursing:a.nursing};await expect(f.prepare(await f.input([f.entry(invalid)]))).rejects.toThrow('CROSS_CAMPUS_POLICY_REQUIRED');
});

test('Nursing pause preserves declared primary coverage and history while precise current-admission gaps block expansion and allow END',async()=>{
  const a=await f.endpoint(),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,accepted=await f.owner.history('maker',{id}),h=await f.nursing.owner.history('maker',{id:a.nursing.id}),d=h.versions[0]!,binding=h.bindings[0]!.versions[0]!.binding,at='2026-03-01T00:00:00';
  const impactWindow={kind:'NURSING' as const,id:a.nursing.id,validFrom:'2030-01-01T00:00:00',validTo:'2030-04-01T00:00:00'},before=await f.owner.evaluateEndpointImpacts('maker',impactWindow);
  const pause:NursingEntry={action:'SUSPEND',target:{owner:'care-organization/nursing',id:a.nursing.id,expectedHead:'1'},row:{...f.nursing.row(binding),nursing_unit_id:d.facts.source.sourceAlias,nursing_code:d.facts.nursingCode,nursing_name:d.facts.nursingName,care_level:d.facts.careLevel??'',office_phone:d.facts.officePhone??'',valid_from:at,record_status:'SUSPENDED'},reason:'TEST nursing paused inside request window',evidenceId:f.nursing.artifact.artifactId};
  await f.nursing.apply(await f.nursing.input([pause]));expect((await f.owner.read('maker',{id,businessAt:at})).state).toBe('ACTIVE');expect(await f.owner.history('maker',{id})).toEqual(accepted);
  const impact=await f.owner.evaluateEndpointImpacts('maker',impactWindow);expect(impact).toMatchObject({owner:'WARD_NURSING_COVERAGE',status:'EVALUATED',clinicalReadiness:'NOT_READY'});expect(impact.items).toContainEqual(expect.objectContaining({id,active:true,outstanding:true,constraint:'UNSATISFIED',affectedSpans:[{from:'2030-01-01T00:00:00.000000',to:'2030-04-01T00:00:00.000000'}]}));expect(impact.items[0]!.original).toEqual(before.items[0]!.original);expect(impact.items[0]!.lifecycle).toContainEqual(expect.objectContaining({action:'SUSPEND',from:'2026-03-01T00:00:00.000000'}));
  const current=await f.owner.evaluateWindow('maker',window(a));expect(current).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:false,status:'NOT_SATISFIED'});expect(current.currentGaps).toEqual([{partitionId:null,from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);
  expect((await f.owner.evaluateWindow('maker',{...window(a,'HISTORICAL'),recordAsOf:out.recordedAt})).status).toBe('SATISFIED');
  const b=await f.sameWard(a);await expect(f.prepare(await f.input([f.entry(b)]))).rejects.toThrow('WARD_NURSING_PRIMARY_CONFLICT');await f.apply(await f.input([end(entry,id,'1',at)]));expect((await f.owner.read('maker',{id,businessAt:at})).state).toBe('ENDED');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(accepted.versions[0]);expect((await f.owner.evaluateEndpointImpacts('maker',impactWindow)).items).toContainEqual(expect.objectContaining({id,active:false,outstanding:false,affectedSpans:[],constraint:'SATISFIED'}));
});

test('Ward closure inside a request window retains its admitted prefix and blocks only the uncovered suffix',async()=>{
  const a=await f.endpoint(),entry=f.entry(a),out=await f.apply(await f.input([entry])),h=await f.wards.owner.history('maker',{id:a.ward.id}),d=h.versions[0]!,binding=h.bindings[0]!.versions[0]!.binding,at='2026-03-01T00:00:00';
  await f.wards.apply(await f.wards.input([{action:'CLOSE',target:{owner:'care-organization/ward',id:a.ward.id,expectedHead:'1'},row:{...f.wards.row(binding),ward_id:d.facts.source.sourceAlias,ward_code:d.facts.wardCode,ward_name:d.facts.wardName,ward_type:d.facts.wardType,admission_rule_ref:d.facts.admissionRuleReference,public_phone:d.facts.publicPhone,valid_from:at,record_status:'RETIRED'},reason:'TEST Ward closed inside request window',evidenceId:f.wards.artifact.artifactId}]));
  expect((await f.owner.evaluateWindow('maker',{...window(a,'HISTORICAL'),recordAsOf:out.recordedAt})).status).toBe('SATISFIED');const current=await f.owner.evaluateWindow('maker',window(a));expect(current.currentGaps).toEqual([{partitionId:null,from:'2026-03-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);expect(current.checks).toContainEqual(expect.objectContaining({from:'2026-01-01T00:00:00.000000',to:'2026-03-01T00:00:00.000000',status:'SATISFIED'}));
  const maker=createWardNursingCoverageClient(url,'maker'),impact=await maker.evaluateEndpointImpacts({kind:'WARD',id:a.ward.id,validFrom:'2030-01-01T00:00:00',validTo:'2030-04-01T00:00:00'});expect(impact.response.status).toBe(200);expect(impact.data!.items).toContainEqual(expect.objectContaining({id:out.facts[0]!.id,active:true,outstanding:true,constraint:'UNSATISFIED',affectedSpans:[{from:'2030-01-01T00:00:00.000000',to:'2030-04-01T00:00:00.000000'}],lifecycle:[expect.objectContaining({action:'CLOSE',from:'2026-03-01T00:00:00.000000'})]}));
});

test('future independent confirmed handover is scheduled before cutover and effective at cutover; standalone END stays not completed',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,T='2030-04-01T00:00:00',incoming=f.entry(b);incoming.row={...incoming.row,valid_from:T,handover_rule_ref:'TEST_FUTURE_HANDOVER'};
  const confirm=(v:WardNursingVerification):WardNursingVerification=>({...v,rows:v.rows.map(row=>row.row===2?{...row,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_FUTURE_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true}}:row)});
  const handover=await f.apply(await f.input([end(entry,id,'1',T),incoming]),confirm),successor=handover.facts[1]!.id,maker=createWardNursingCoverageClient(url,'maker');
  expect((await maker.query({id:successor,businessAt:'2030-03-31T23:59:59.999999'})).data).toMatchObject({state:'NOT_EFFECTIVE',handoverStatus:'CONFIRMED_SCHEDULED'});expect((await maker.query({id:successor,businessAt:T})).data).toMatchObject({state:'ACTIVE',handoverStatus:'CONFIRMED_EFFECTIVE'});
  const other=await f.endpoint(),single=f.entry(other),singleOut=await f.apply(await f.input([single])),singleId=singleOut.facts[0]!.id;await f.apply(await f.input([end(single,singleId,'1',T)]));expect((await maker.query({id:singleId,businessAt:T})).data).toMatchObject({state:'ENDED',handoverStatus:'NOT_COMPLETED'});
});

test('non-primary intersecting peers use one complete independently reviewed collaboration and do not require invented primary continuity',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.nursing.id,b.nursing.id]);if(rule.kind!=='SHARED_BOUNDARY')throw new Error('TEST_SHARED_RULE_REQUIRED');
  const entries=[f.entry(a),f.entry(b)].map((e,index)=>({...e,rule:index===0?rule:{...rule,participants:[...rule.participants].reverse(),validFrom:'2026-01-01T00:00:00.000000'},row:{...e.row,is_primary:'N' as const}}));
  const q=await f.prepare(await f.input(entries)),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');const published=await f.owner.applyUnit('maker',q);if(published.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(published.facts).toHaveLength(2);
  const evaluation=await f.owner.evaluateWindow('maker',window(a));expect(evaluation).toMatchObject({declaredCovered:true,currentAdmissionCovered:true,primaryCovered:false,status:'SATISFIED'});expect(evaluation.primaryGaps).toEqual([{partitionId:null,from:'2026-01-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);
});

test('unknown collaboration and incomplete intersecting participants cannot ALLOW a complete revision',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),c=await f.sameWard(a),rule=f.shared([a.nursing.id,b.nursing.id]),first=f.entry(a),second=f.entry(b),third=f.entry(c);
  const unknown={...first,rule:{kind:'UNKNOWN' as const},row:{...first.row,is_primary:'N' as const}};await expect(f.prepare(await f.input([unknown]))).rejects.toThrow('LEGAL_REVIEW_REQUIRED');
  const entries=[first,second,third].map(e=>({...e,rule,row:{...e.row,is_primary:'N' as const}}));await expect(f.prepare(await f.input(entries))).rejects.toThrow('SHARING_PARTICIPANTS_NOT_COVERED');expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test('extra declared collaboration participant requires current full-window admission in Owner and signed SQL',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),extra=await f.sameWard(a),rule=f.shared([a.nursing.id,b.nursing.id,extra.nursing.id]),entries=[f.entry(a),f.entry(b)].map(e=>({...e,rule,row:{...e.row,is_primary:'N' as const}})),q=await f.prepare(await f.input(entries)),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId}),h=await f.nursing.owner.history('maker',{id:extra.nursing.id}),d=h.versions[0]!,binding=h.bindings[0]!.versions[0]!.binding;
  await f.nursing.apply(await f.nursing.input([{action:'SUSPEND',target:{owner:'care-organization/nursing',id:extra.nursing.id,expectedHead:'1'},row:{...f.nursing.row(binding),nursing_unit_id:d.facts.source.sourceAlias,nursing_code:d.facts.nursingCode,nursing_name:d.facts.nursingName,care_level:d.facts.careLevel??'',office_phone:d.facts.officePhone??'',valid_from:'2026-03-01T00:00:00',record_status:'SUSPENDED'},reason:'TEST additional reviewed participant paused',evidenceId:f.nursing.artifact.artifactId}]));
  await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('NURSING_WINDOW_NOT_COVERED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(0);
});

test('same-set scope and period reduction remains possible after Nursing suspension without rewriting the old accepted declaration',async()=>{
  const a=await f.endpoint(),set=await f.register(a),entry=f.entry(a,f.partition(set,[0,1])),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,old=await f.owner.exact('maker',{id,version:'1'}),h=await f.nursing.owner.history('maker',{id:a.nursing.id}),d=h.versions[0]!,binding=h.bindings[0]!.versions[0]!.binding;
  await f.nursing.apply(await f.nursing.input([{action:'SUSPEND',target:{owner:'care-organization/nursing',id:a.nursing.id,expectedHead:'1'},row:{...f.nursing.row(binding),nursing_unit_id:d.facts.source.sourceAlias,nursing_code:d.facts.nursingCode,nursing_name:d.facts.nursingName,care_level:d.facts.careLevel??'',office_phone:d.facts.officePhone??'',valid_from:'2026-03-01T00:00:00',record_status:'SUSPENDED'},reason:'TEST suspended upstream before safe reduction',evidenceId:f.nursing.artifact.artifactId}]));
  const coverage=f.partition(set,[0]),reduction:WardNursingEntry={...entry,action:'REVISE',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},coverage,row:{...entry.row,coverage_scope:JSON.stringify(coverage),valid_to:'2026-06-01T00:00:00'}};
  const q=await f.prepare(await f.input([reduction])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(old);expect((await f.owner.exact('maker',{id,version:'2'})).facts.coverageScope).toEqual(coverage);expect((await f.owner.read('maker',{id,businessAt:'2026-06-01T00:00:00'})).state).toBe('NOT_EFFECTIVE');
});

test('generated endpoint impacts retain original scope and digest while finite reduction, END and cancellation change only current obligations',async()=>{
  const a=await f.endpoint(),set=await f.register(a),entry=f.entry(a,f.partition(set,[0,1])),out=await f.apply(await f.input([entry])),id=out.facts[0]!.id,maker=createWardNursingCoverageClient(url,'maker'),request={kind:'NURSING' as const,id:a.nursing.id,validFrom:'2030-01-01T00:00:00',validTo:'2030-04-01T00:00:00'};
  const first=await maker.evaluateEndpointImpacts(request);expect(first.response.status).toBe(200);const original=first.data!.items[0]!.original;expect(first.data!.items[0]).toMatchObject({id,active:true,outstanding:true,constraint:'SATISFIED',original:{version:'1',period:{from:'2026-01-01T00:00:00.000000',to:null},coverage:entry.coverage},current:{version:'1',action:'CREATE'}});expect(original.digest).toMatch(/^[a-f0-9]{64}$/);
  const coverage=f.partition(set,[0]),reduction:WardNursingEntry={...entry,action:'REVISE',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},coverage,row:{...entry.row,coverage_scope:JSON.stringify(coverage),valid_to:'2030-03-01T00:00:00'}};
  const q=await f.prepare(await f.input([reduction])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');const version=await f.owner.exact('maker',{id,version:'2'}),after=await maker.evaluateEndpointImpacts({...request,kind:'WARD',id:a.ward.id});expect(after.response.status).toBe(200);expect(after.data!.items[0]!.original).toEqual(original);expect(after.data!.items[0]!.current).toMatchObject({versionId:version.id,version:'2',action:'REVISE',period:{from:'2026-01-01T00:00:00.000000',to:'2030-03-01T00:00:00.000000'},coverage});
  const pool=new Pool({connectionString:connection,max:1}),proof={owner:'WARD_NURSING_COVERAGE',id,versionId:version.id,...q};
  try {
    const proved=(await pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify(proof),'NORTH'])).rows[0]!.r;expect(proved).toMatchObject({owner:'WARD_NURSING_COVERAGE',id,versionId:version.id,action:'REVISE',safeShrink:true});
    for(const invalid of [{...proof,requestId:randomUUID()},{...proof,candidateId:randomUUID()},{...proof,versionId:original.versionId}])await expect(pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify(invalid),'NORTH'])).rejects.toThrow();
  } finally {await pool.end();}
  await f.apply(await f.input([end(reduction,id,'2','2030-03-01T00:00:00')]));const ended=await maker.evaluateEndpointImpacts({...request,validFrom:'2030-03-01T00:00:00'});expect(ended.response.status).toBe(200);expect(ended.data!.items[0]).toMatchObject({original,current:{version:'3',action:'END',period:{from:'2026-01-01T00:00:00.000000',to:'2030-03-01T00:00:00.000000'}},active:false,outstanding:false,affectedSpans:[],constraint:'SATISFIED'});
  const historical=await maker.evaluateEndpointImpacts({...request,recordAsOf:out.recordedAt});expect(historical.response.status).toBe(200);expect(historical.data!.items[0]).toMatchObject({original,current:{version:'1',action:'CREATE',coverage:entry.coverage},active:true,outstanding:true});
  await f.apply(await f.input([end(reduction,id,'3','2026-01-01T00:00:00')]));const cancelled=await maker.evaluateEndpointImpacts({...request,validFrom:'2026-01-01T00:00:00'});expect(cancelled.response.status).toBe(200);expect(cancelled.data!.items[0]).toMatchObject({original,current:{version:'4',action:'END',period:{from:'2026-01-01T00:00:00.000000',to:'2026-01-01T00:00:00.000000'}},active:false,outstanding:false,affectedSpans:[],constraint:'SATISFIED'});expect((await createWardNursingCoverageClient(url,'outsider').evaluateEndpointImpacts(request)).response.status).toBe(403);
});

test('exact committed successor CREATE proof may satisfy the old coverage case while wrong case Owner and request remain rejected',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),entry=f.entry(a),first=await f.apply(await f.input([entry])),oldId=first.facts[0]!.id,nursing=await f.nursing.owner.history('maker',{id:a.nursing.id}),departmentId=nursing.departmentId,provider=validationKeys(receipt),ports=withCareOrganizationImpacts(()=>f.base.owner,()=>f.nursing.owner,()=>f.wards.owner,()=>undefined,()=>undefined,()=>f.owner),lifecycle=openDepartmentLifecycle(connection,provider,ports),evolution=openOrganizationEvolutions(connection,provider,ports),T='2030-04-01T00:00:00';
  try {
    const current=await f.nursing.base.department.history('maker',departmentId),life=await lifecycle.history('maker',{id:departmentId}),job=await f.nursing.dep.newJob(),affected=['IDENTIFIER','SOURCE_MAPPING','HIERARCHY','NURSING_UNIT','WARD_NURSING_COVERAGE'];
    const staged=await lifecycle.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:departmentId,expectedVersion:current.versions.at(-1)!.number,expectedLifecycleHead:life.lifecycle.at(-1)?.number??'0'},effectiveAt:T,reason:'TEST independently reviewed nursing-manager change',evidenceId:f.nursing.dep.artifact.artifactId}],impacts:f.nursing.impacts.map(impact=>({...impact,determination:affected.includes(impact.domain)?'AFFECTED' as const:impact.determination}))});
    await lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST complete impact-owner attestation',policyApproved:true,materialsAccepted:true,impactReviews:f.nursing.impactReviews});
    const requestId=randomUUID(),planned=await lifecycle.plan('maker',{inputId:staged.inputId,requestId});await lifecycle.readApplyCandidate('reviewer',{candidateId:planned.candidateId});await lifecycle.approveApplyUnit('reviewer',planned);const changed=await lifecycle.applyUnit('maker',{candidateId:planned.candidateId,requestId});if(changed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
    const parentWindow={...window(a),validTo:'2030-06-01T00:00:00'},currentAdmission=await f.owner.evaluateWindow('maker',parentWindow);
    expect(currentAdmission).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:false,status:'NOT_SATISFIED'});
    expect(currentAdmission.currentGaps).toEqual([{partitionId:null,from:'2030-04-01T00:00:00.000000',to:'2030-06-01T00:00:00.000000'}]);
    expect(currentAdmission.checks).toContainEqual(expect.objectContaining({from:'2026-01-01T00:00:00.000000',to:'2030-04-01T00:00:00.000000',status:'SATISFIED'}));
    const originalAdmission=await f.owner.evaluateWindow('maker',{...parentWindow,mode:'HISTORICAL',recordAsOf:first.recordedAt});expect(originalAdmission.status).toBe('SATISFIED');expect(originalAdmission.currentGaps).toEqual([]);
    const cases=(await evolution.listImpactCases('maker',{eventId:changed.facts[0]!.id,campus:'NORTH'})).items,coverageCase=cases.find(item=>item.obligation.owner==='WARD_NURSING_COVERAGE'),wrongCase=cases.find(item=>item.obligation.owner==='NURSING_UNIT');expect(coverageCase).toMatchObject({obligation:{kind:'REFERENCE',owner:'WARD_NURSING_COVERAGE',reference:{id:oldId}}});expect(wrongCase).toBeDefined();
    const incoming=f.entry(b);incoming.row={...incoming.row,valid_from:T,handover_rule_ref:'TEST_CASE_HANDOVER'};
    const confirm=(v:WardNursingVerification):WardNursingVerification=>({...v,rows:v.rows.map(row=>row.row===2?{...row,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id:oldId,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_CASE_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true}}:row)});
    const q=await f.prepare(await f.input([end(entry,oldId,'1',T),incoming]),confirm),out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const id=out.facts[1]!.id,version=await f.owner.exact('maker',{id,version:'1'});expect(id).not.toBe(oldId);
    const pool=new Pool({connectionString:connection,max:1}),proof={owner:'WARD_NURSING_COVERAGE',id,versionId:version.id,...q,caseId:coverageCase!.id};
    try {
      expect((await pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify(proof),'NORTH'])).rows[0]!.r).toMatchObject({owner:'WARD_NURSING_COVERAGE',id,versionId:version.id,action:'CREATE',safeShrink:false});
      await expect(pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify({...proof,caseId:wrongCase!.id}),'NORTH'])).rejects.toMatchObject({message:'IMPACT_RESULT_MISMATCH'});
      await expect(pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify({...proof,requestId:randomUUID()}),'NORTH'])).rejects.toThrow();
      const unrelated=await f.endpoint();expect(unrelated.ward.id).not.toBe(a.ward.id);const ordinary=f.entry(unrelated);ordinary.row.valid_from=T;const ordinaryOut=await f.apply(await f.input([ordinary])),ordinaryId=ordinaryOut.facts[0]!.id,ordinaryVersion=await f.owner.exact('maker',{id:ordinaryId,version:'1'});expect(ordinaryVersion.facts.handover.kind).toBe('NO_HANDOVER_REQUIRED');
      const ordinaryProof={owner:'WARD_NURSING_COVERAGE',id:ordinaryId,versionId:ordinaryVersion.id,candidateId:ordinaryOut.candidateId,requestId:ordinaryOut.requestId};
      expect((await pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify(ordinaryProof),'NORTH'])).rows[0]!.r).toMatchObject({owner:'WARD_NURSING_COVERAGE',id:ordinaryId,versionId:ordinaryVersion.id,action:'CREATE'});
      await expect(pool.query('select department_master.impact_result($1,$2::jsonb,$3) r',['maker',JSON.stringify({...ordinaryProof,caseId:coverageCase!.id}),'NORTH'])).rejects.toMatchObject({message:'IMPACT_RESULT_MISMATCH'});
    } finally {await pool.end();}
  } finally {await evolution.close();await lifecycle.close();}
});

test('a live non-primary responsibility may add a reviewed collaboration participant without a handover or removal',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.nursing.id,b.nursing.id]),old=f.entry(a);old.rule=rule;old.row.is_primary='N';
  const first=await f.apply(await f.input([old])),id=first.facts[0]!.id,original=await f.owner.history('maker',{id}),incoming=f.entry(b);incoming.rule=rule;incoming.row={...incoming.row,is_primary:'N',valid_from:'2030-06-01T00:00:00'};
  const q=await f.prepare(await f.input([incoming])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');expect((await f.owner.applyUnit('maker',q)).status).toBe('COMMITTED');
  expect(await f.owner.history('maker',{id})).toEqual(original);expect((await f.owner.read('maker',{id,businessAt:'2030-06-01T00:00:00'})).state).toBe('ACTIVE');expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(2);
  expect(await f.owner.evaluateWindow('maker',{...window(a),validFrom:'2030-06-01T00:00:00',validTo:'2030-07-01T00:00:00'})).toMatchObject({declaredCovered:true,primaryCovered:false,currentAdmissionCovered:true,status:'SATISFIED'});
});

test('standalone END of a positive non-primary responsibility cannot authorize an ordinary replacement CREATE',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a),F='2030-01-01T00:00:00',T='2031-01-01T00:00:00';old.row={...old.row,is_primary:'N',valid_from:F};
  const first=await f.apply(await f.input([old])),id=first.facts[0]!.id;await f.apply(await f.input([end(old,id,'1',T)]));const incoming=f.entry(b);incoming.row={...incoming.row,is_primary:'N',valid_from:T};
  expect((await f.owner.read('maker',{id,businessAt:T})).handoverStatus).toBe('NOT_COMPLETED');
  await expect(f.prepare(await f.input([incoming]))).rejects.toThrow('HANDOVER_CONFIRMATION_REQUIRED');
  expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(1);expect((await f.owner.history('maker',{id})).versions).toHaveLength(2);
});

test('signed SQL rejects a frozen additive non-primary CREATE after the live predecessor is independently ended',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),rule=f.shared([a.nursing.id,b.nursing.id]),old=f.entry(a),F='2030-01-01T00:00:00',T='2031-01-01T00:00:00';old.rule=rule;old.row={...old.row,is_primary:'N',valid_from:F};
  const first=await f.apply(await f.input([old])),id=first.facts[0]!.id,incoming=f.entry(b);incoming.rule=rule;incoming.row={...incoming.row,is_primary:'N',valid_from:T};
  const q=await f.prepare(await f.input([incoming])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');
  await f.apply(await f.input([end(old,id,'1',T)]));await expect(f.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');
  expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('HANDOVER_CONFIRMATION_REQUIRED');expect(await f.owner.resumeOutcome('maker',q)).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(1);
});

test('independently confirmed equal-scope non-primary END and CREATE commit as one exact atomic handover',async()=>{
  const a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a),F='2030-01-01T00:00:00',T='2031-01-01T00:00:00';old.row={...old.row,is_primary:'N',valid_from:F};const first=await f.apply(await f.input([old])),id=first.facts[0]!.id,original=await f.owner.exact('maker',{id,version:'1'}),incoming=f.entry(b);incoming.row={...incoming.row,is_primary:'N',valid_from:T,handover_rule_ref:'TEST_NONPRIMARY_HANDOVER'};
  const confirm=(v:WardNursingVerification):WardNursingVerification=>({...v,rows:v.rows.map(row=>row.row===2?{...row,handover:{kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:incoming.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:incoming.coverage,cutover:T,ruleReference:'TEST_NONPRIMARY_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true}}:row)});
  const q=await f.prepare(await f.input([end(old,id,'1',T),incoming]),confirm),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');const out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.facts).toHaveLength(2);const successor=out.facts[1]!.id,ended=await f.owner.exact('maker',{id,version:'2'}),created=await f.owner.exact('maker',{id:successor,version:'1'});
  // The pair shares one publication R and root change. Per0049, the durable
  // outcome records its later bookkeeping clock after all Owner writes.
  expect(ended.changeId).toBe(created.changeId);expect(ended.recordedAt).toBe(created.recordedAt);expect(ended.recordedAt<=out.recordedAt).toBe(true);expect(created.recordedAt<=out.recordedAt).toBe(true);expect(created.facts.isPrimary).toBe(false);expect(created.facts.coverageScope).toEqual(old.coverage);
  expect((await f.owner.history('maker',{id})).versions).toEqual([original,ended]);expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(original);
  expect(await f.owner.read('maker',{id,businessAt:T})).toMatchObject({head:'2',state:'ENDED',version:original,handoverStatus:'CONFIRMED_EFFECTIVE'});expect(await f.owner.read('maker',{id:successor,businessAt:T})).toMatchObject({state:'ACTIVE',handoverStatus:'CONFIRMED_EFFECTIVE'});
  expect(await f.owner.exact('maker',{id,version:'2',recordAsOf:out.recordedAt})).toEqual(ended);expect(await f.owner.exact('maker',{id:successor,version:'1',recordAsOf:out.recordedAt})).toEqual(created);const {responseStatus:_responseStatus,...durable}=out;expect(await f.owner.resumeOutcome('maker',q)).toEqual(durable);expect((await f.owner.reconcileCommittedUnit('maker',q)).status).toBe('MATCHED');
  expect(await f.owner.evaluateWindow('maker',{...window(a),validFrom:F,validTo:'2032-01-01T00:00:00'})).toMatchObject({declaredCovered:true,primaryCovered:false,currentAdmissionCovered:true,status:'SATISFIED'});
});

test.each(['Y','N'] as const)('cancellation at a future %s primary-marker start leaves zero responsibility and permits later ordinary initial coverage',async isPrimary=>{
  const a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a),F='2030-01-01T00:00:00',T='2031-01-01T00:00:00';old.row={...old.row,is_primary:isPrimary,valid_from:F};const first=await f.apply(await f.input([old])),id=first.facts[0]!.id,original=await f.owner.exact('maker',{id,version:'1'});await f.apply(await f.input([end(old,id,'1',F)]));
  const cancelled=await f.owner.evaluateEndpointImpacts('maker',{kind:'NURSING',id:a.nursing.id,validFrom:F,validTo:'2032-01-01T00:00:00'});expect(cancelled.items).toContainEqual(expect.objectContaining({id,current:expect.objectContaining({period:{from:'2030-01-01T00:00:00.000000',to:'2030-01-01T00:00:00.000000'}}),active:false,outstanding:false,affectedSpans:[]}));
  const incoming=f.entry(b);incoming.row={...incoming.row,is_primary:isPrimary,valid_from:T};const q=await f.prepare(await f.input([incoming])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('AUTHORIZED');const out=await f.owner.applyUnit('maker',q);if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  expect(await f.owner.exact('maker',{id,version:'1'})).toEqual(original);expect(await f.owner.read('maker',{id:out.facts[0]!.id,businessAt:T})).toMatchObject({state:'ACTIVE',handoverStatus:'NOT_REQUIRED'});expect((await f.owner.list('maker',{campus:'NORTH',wardId:a.ward.id})).items).toHaveLength(2);
});

// Last: publishing an independent ORG11 contract intentionally changes the shared current contract.
test.each(['LEAF','PARENT'] as const)('full-window %s source gaps use current exact versions without older-open fallback and preserve historical admission',async gap=>{
  const command=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_WARD_NURSING_SOURCE',...extra});
  const publish=async(d:{id:string;head:string})=>{const submitted=await catalog.command('maker',command('SUBMIT',{target:d.id,expectedHead:d.head})),impact=await catalog.sourceImpact('reviewer','SYNTHETIC',d.id,'PUBLISH');return catalog.command('reviewer',command('PUBLISH',{target:d.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest,impactDigest:impact.impactDigest}));};
  const source=async(parent:string)=>publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'TEST_NC_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'TEST independent nursing source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST_OWNER',technicalRole:'TEST',sourceEvidence:parent},validFrom:'2026-01-01T00:00:00',validTo:null})));
  const parent=await source(f.base.dep.source.id),leaf=await source(parent.id),pool=new Pool({connectionString:connection,max:1});let own:NursingCoverageFixture|undefined;
  try {
    const childBefore=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===leaf.id)!;
    expect(childBefore).toMatchObject({versionId:leaf.versionId,payload:{sourceEvidence:parent.id,sourceEvidenceVersion:parent.versionId}});
    const role=(await pool.query('select current_user r')).rows[0]!.r;own=await wardNursingFixture(receipt,role,catalog,validationKeys(receipt),connection,true,f.wards,leaf);
    const a=await own.endpoint(),entry=own.entry(a),accepted=await own.apply(await own.input([entry])),id=accepted.facts[0]!.id,history=await own.owner.history('maker',{id}),q=await own.prepare(await own.input([own.entry(await own.endpoint())])),candidate=await own.owner.readApplyCandidate('reviewer',{candidateId:q.candidateId});
    const changed=gap==='LEAF'?leaf:parent,republished=await publish(await catalog.command('maker',command('REVISE',{target:changed.id,expectedHead:changed.head,values:{name:'TEST finite current nursing source'},validFrom:'2026-01-01T00:00:00',validTo:'2026-03-01T00:00:00'})));
    // ADR0122: a child accepts one exact parent version. Same-start republication
    // masks the old parent's entire definition span (0007); 0009 does not adopt
    // the new parent version implicitly, so this child loses the whole window.
    if(gap==='PARENT'){
      const childAfter=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(item=>item.id===leaf.id)!;
      expect(childAfter.versionId).toBe(childBefore.versionId);expect(childAfter.payload).toEqual(childBefore.payload);
      expect(childAfter.payload).toMatchObject({sourceEvidenceVersion:parent.versionId});expect(childAfter.payload).not.toMatchObject({sourceEvidenceVersion:republished.versionId});
    }
    const current=await own.owner.evaluateWindow('maker',window(a));expect(current).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:false,status:'NOT_SATISFIED'});expect(current.currentGaps).toEqual([{partitionId:null,from:gap==='LEAF'?'2026-03-01T00:00:00.000000':'2026-01-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'}]);
    const historical=await own.owner.evaluateWindow('maker',{...window(a,'HISTORICAL'),recordAsOf:accepted.recordedAt});expect(historical.status).toBe('SATISFIED');expect(historical.currentGaps).toEqual([]);
    await expect(own.owner.applyUnit('maker',q)).rejects.toThrow('STALE_VALIDATION');expect(await signedCoverageAttempt(connection,receipt,candidate,q)).toBe('WARD_NURSING_SOURCE_NOT_ADMITTED');expect(await own.owner.history('maker',{id})).toEqual(history);await own.apply(await own.input([end(entry,id,'1','2026-03-01T00:00:00')]));
  } finally {await own?.close();await pool.end();}
});
