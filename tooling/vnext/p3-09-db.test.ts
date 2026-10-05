import {openSubjectPermissions,type SubjectScope,type SubjectStage,type SubjectEntry,type SubjectVerification} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {peer,quote} from './lineage.mjs';
import {provisionSubjects} from './p3-09-provisioning.mjs';
import {openSubjectCodes} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {capabilityFixture} from './p3-08-fixture.js';
import {subjectPermissionContract} from './p3-09-fixture.js';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {openCatalog,canonicalPlan,planBinding,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {businessUnitFixture} from './p3-01-fixture.js';
import {validationKeys} from './p3-09-validation-keys.mjs';
import {createSubjectPermissionClient,createSubjectCodeClient} from '../../packages/generated-api-client/src/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {ORG17_FIELDS} from '../../apps/governance-api/src/modules/care-organization/index.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let codes:ReturnType<typeof openSubjectCodes>,draftId:string,draftVersionId:string,draftDigest:string,role:string;
const provider=validationKeys(receipt);
let capabilities:Awaited<ReturnType<typeof capabilityFixture>>;
let subjectContract:Awaited<ReturnType<typeof subjectPermissionContract>>;
let licensedScope:SubjectScope;
const mappingSamples:Array<{id:string;semantic:string}>=[];
let permissions:ReturnType<typeof openSubjectPermissions>,permissionTemplate:Extract<SubjectEntry,{kind:'PERMISSION';action:'RECORD'}>,firstPermission:{id:string;candidateId:string;requestId:string;recordedAt:string};
let catalog:Catalog,base:Awaited<ReturnType<typeof businessUnitFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,url:string;
let sourceReplay:Parameters<ReturnType<typeof openSubjectCodes>['command']>[1];
beforeAll(async()=>{const pool=new Pool({connectionString:connection,max:1});try{
 role=(await pool.query('select current_user r')).rows[0].r;
 catalog=await openCatalog(connection,provider);base=await businessUnitFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_09_UPGRADED']==='1');
 provisionSubjects(receipt,role,provider);peer(receipt.name,"INSERT INTO governance_catalog.subject_code_access SELECT a,p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;INSERT INTO governance_catalog.subject_code_access SELECT 'reviewer',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;");permissions=openSubjectPermissions(connection,provider,{operatingWindow:base.operating.operating.evaluateOperatingWindowInTransaction});codes=openSubjectCodes(connection,provider);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:codes,actor:r=>actor(r.headers)},{owner:permissions,actor:r=>actor(r.headers)});app.addHook('onClose',async()=>{await permissions.close();await codes.close();});url=await app.listen({host:'127.0.0.1',port:0});
}finally{await pool.end();}});
afterAll(async()=>{await app?.close();await capabilities?.close();await base?.close();await catalog?.close();});
test('an offline diagnostic subject snapshot is a real draft with its protected source evidence',async()=>{
 sourceReplay={action:'CREATE',requestId:randomUUID(),reason:'TEST direct public Owner',systemCode:'TEST_DIRECT',sourceId:base.dep.source.id,sourceVersionId:base.dep.source.versionId,evidenceId:base.artifact.artifactId,reference:{owner:'governance-catalog/subject-code',dataset:'REF01',namespace:'REF01.code_system_id',sourceAlias:'TEST_REF01_DIRECT'},codeSystemName:'TEST diagnostic subjects',namespaceUri:'urn:hdip:test:direct',standardDocument:'TEST DOCUMENT 2022',issuer:'TEST POLICY ONLY',codeSystemVersion:'2022版',sourcePage:'TEST page 1',sourceSummary:'TEST POLICY ONLY',adoptedOn:'2026-10-05',label:'TEST_POLICY_ONLY',validFrom:'2026-01-01T00:00:00',validTo:null,codes:[{code:'TEST_A',name:'TEST subject A',meaning:'TEST_A_MEANING',status:'ACTIVE',replacement:null}]};const draft=await codes.command('maker',sourceReplay);expect(draft.status).toBe('DRAFT');
 const response=await fetch(url+'/api/vnext/subject-codes/command',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({action:'CREATE',requestId:randomUUID(),reason:'TEST POLICY ONLY source',systemCode:'TEST_SUBJECTS',sourceId:base.dep.source.id,sourceVersionId:base.dep.source.versionId,evidenceId:base.artifact.artifactId,reference:{owner:'governance-catalog/subject-code',dataset:'REF01',namespace:'REF01.code_system_id',sourceAlias:'TEST_REF01_DIAGNOSTIC_SUBJECTS'},codeSystemName:'TEST diagnostic subjects',namespaceUri:'urn:hdip:test:diagnostic-subjects',standardDocument:'TEST DOCUMENT 2022',issuer:'TEST POLICY ONLY',codeSystemVersion:'2022版',sourcePage:'TEST page 1',sourceSummary:'TEST POLICY ONLY complete two-code snapshot',adoptedOn:'2026-10-05',label:'TEST_POLICY_ONLY',validFrom:'2026-01-01T00:00:00',validTo:null,codes:[{code:'TEST_A',name:'TEST subject A',meaning:'TEST_A_MEANING',status:'ACTIVE',replacement:null},{code:'TEST_B',name:'TEST subject B',meaning:'TEST_B_MEANING',status:'ACTIVE',replacement:null}]})});
 expect(response.status).toBe(200);const result=await response.json();expect(result.status).toBe('DRAFT');expect(result.evidenceId).toBe(base.artifact.artifactId);expect(result.label).toBe('TEST_POLICY_ONLY');draftId=result.id;draftVersionId=result.versionId;draftDigest=result.reviewDigest;
});
test('an unverified standard source is sent to review and cannot be approved',async()=>{
 const response=await fetch(url+'/api/vnext/subject-codes/command',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'reviewer'},body:JSON.stringify({action:'APPROVE',requestId:randomUUID(),reason:'TEST approve without source verification',target:draftId,versionId:draftVersionId,reviewDigest:draftDigest})});
 expect((await response.json()).code).toBe('LEGAL_REVIEW_REQUIRED');
 expect((await codes.read('maker',{id:draftId}))[0]!.status).toBe('DRAFT');
});
test('independent source verification permits an immutable approved adoption',async()=>{
 const verified=await fetch(url+'/api/vnext/subject-codes/command',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'reviewer'},body:JSON.stringify({action:'VERIFY',requestId:randomUUID(),reason:'TEST source original independently read',target:draftId,versionId:draftVersionId,reviewDigest:draftDigest,evidenceId:base.artifact.artifactId,sourceReviewed:true})});
 expect(verified.status).toBe(200);
 const approved=await fetch(url+'/api/vnext/subject-codes/command',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'reviewer'},body:JSON.stringify({action:'APPROVE',requestId:randomUUID(),reason:'TEST independent adopted snapshot',target:draftId,versionId:draftVersionId,reviewDigest:draftDigest})});
 expect(approved.status).toBe(200);expect((await approved.json()).status).toBe('APPROVED');
 expect((await codes.read('maker',{id:draftId,versionId:draftVersionId}))[0]!.codes[0]!.code).toBe('TEST_A');
});
test('a real REGISTER capability cannot replace a diagnostic subject license',async()=>{
 capabilities=await capabilityFixture(receipt,role,catalog,provider,connection,base);
 const capabilityScope={...await capabilities.endpoint(),capabilityType:'REGISTER' as const};capabilities.grant(capabilityScope);
 await capabilities.apply(await capabilities.input([capabilities.entry(capabilityScope)]));
 expect((await capabilities.owner.evaluateWindow('maker',{applicability:capabilityScope,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('SATISFIED');
 const scope:SubjectScope={target:{type:'UNIT',owner:'care-organization/unit',id:capabilityScope.unit.id},subject:capabilityScope.subject,campus:capabilityScope.campus,services:capabilityScope.services};licensedScope=scope;
 peer(receipt.name,"INSERT INTO care_organization.subject_access SELECT a,"+quote(scope.subject.id)+"::uuid,"+quote(scope.campus.id)+"::uuid,'UNIT',"+quote(scope.target.id)+"::uuid,'PERMISSION',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;" );
 const response=await fetch(url+'/api/vnext/subject-permissions/evaluate',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({scope,adoption:{owner:'governance-catalog/subject-code',systemId:draftId,versionId:draftVersionId,version:'1',code:'TEST_A'},validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})});
 const result=await response.json();expect(result.reason).toBe('SUBJECT_PERMISSION_REQUIRED');expect(result.status).toBe('NOT_SATISFIED');
});
test('the independent CORE contract retains all seventeen ORG17 fields and its source rule',async()=>{
 subjectContract=await subjectPermissionContract(catalog,base.dep.source);
 expect(subjectContract.contract.definition.fields.map(f=>f.code)).toEqual(['subject_license_id','target_type','target_id','code_system_id','code_system_version','subject_code','license_ref','permitted_scope','verifier','version_no','valid_from','valid_to','record_status','source_system_id','source_record_id','approval_ref','recorded_at']);
 expect(subjectContract.contract.definition.rules.some(r=>r.id==='SRC-COND-020')).toBe(true);
 const job=await subjectContract.newJob();expect((await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:job.id})).profile).toBe('CORE');
});
test('a verified diagnostic permission is atomically published and evaluated through real HTTP',async()=>{
 const scope=licensedScope,window=await base.operating.operating.evaluateOperatingWindow('maker',{subject:scope.subject,campus:scope.campus,services:scope.services,validFrom:'2026-01-01T00:00:00',validTo:null});expect(window.status).toBe('SATISFIED');
 const license=window.services[0]!.segments[0]!.license,j=await subjectContract.newJob();
 peer(receipt.name,"INSERT INTO vnext_control.protected_grant SELECT a,"+quote(subjectContract.dataset.id)+"::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;");
 const artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:7200},Buffer.from('TEST POLICY ONLY independently verified diagnostic subject TEST_A under the exact licensed institution and campus'));
 const adoption={owner:'governance-catalog/subject-code',systemId:draftId,versionId:draftVersionId,version:'1',code:'TEST_A'},row={subject_license_id:randomUUID(),target_type:'UNIT',target_id:scope.target.id,code_system_id:'TEST_REF01_DIAGNOSTIC_SUBJECTS',code_system_version:'2022版',subject_code:'TEST_A',license_ref:'TEST_DIAGNOSTIC_LICENSE_DOCUMENT',permitted_scope:null,verifier:'TEST 医务部核验岗',version_no:99,valid_from:'2026-01-01T00:00:00',valid_to:null,record_status:'ACTIVE',source_system_id:base.dep.source.id,source_record_id:'TEST/ORG17/2',approval_ref:'TEST_POLICY_ONLY',recorded_at:'2026-01-02T00:00:00'};
 const stage={requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{kind:'PERMISSION',action:'RECORD',scope,adoption,license,limitations:{kind:'NO_ADDITIONAL_LIMITS'},row,reason:'TEST independent subject permission',evidenceId:artifact.artifactId}]};
 permissionTemplate=stage.entries[0] as typeof permissionTemplate;
 const send=async(path:string,a:string,body:unknown)=>{const response=await fetch(url+'/api/vnext/subject-permissions/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':a},body:JSON.stringify(body)});const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(200);return result;};
 const input=await send('inputs','maker',stage);
 await send('verify','reviewer',{requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,reason:'TEST independent original source and license scope',policyVersion:'ORG17_CORE_V1',rows:[{row:1,evidenceId:artifact.artifactId,classificationAccepted:true,scopeAccepted:true,adoptionConfirmed:true,limitationsConfirmed:true,license,validFrom:row.valid_from,validTo:row.valid_to}]});
 const requestId=randomUUID(),candidate=await send('plan','maker',{inputId:input.inputId,requestId});await send('review','reviewer',{candidateId:candidate.candidateId});await send('approve','reviewer',candidate);
 const out=await send('apply','maker',{candidateId:candidate.candidateId,requestId});expect(out.status).toBe('COMMITTED');expect(out.facts[0].owner).toBe('care-organization/subject-permission');expect(out.facts[0].id).not.toBe(row.subject_license_id);
 firstPermission={id:out.facts[0].id,candidateId:candidate.candidateId,requestId,recordedAt:out.recordedAt};
 const evaluation=await send('evaluate','maker',{scope,adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'});expect(evaluation.status).toBe('SATISFIED');expect(evaluation.clinicalReadiness).toBe('NOT_READY');
});
async function input(entries:SubjectEntry[]):Promise<SubjectStage>{const j=await subjectContract.newJob();return {requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries};}
function verification(value:SubjectStage,i:{inputId:string;digest:string}):SubjectVerification{return {requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST independent full source review',policyVersion:'ORG17_CORE_V1',rows:value.entries.map((e,index)=>({row:index+1,evidenceId:e.evidenceId,classificationAccepted:true,scopeAccepted:true,adoptionConfirmed:true,limitationsConfirmed:true,license:e.kind==='PERMISSION'?e.license:null,...(e.kind==='MAPPING'?{semantic:e.semantic}:{}),validFrom:e.row.valid_from,validTo:e.row.valid_to}))};}
async function prepare(value:SubjectStage){const i=await permissions.stage('maker',value);await permissions.verify('reviewer',verification(value,i));const preview=await permissions.preview('maker',{inputId:i.inputId});expect(preview.issues).toEqual([]);const requestId=randomUUID(),candidate=await permissions.plan('maker',{inputId:i.inputId,requestId});await permissions.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await permissions.approveApplyUnit('reviewer',candidate);return {candidateId:candidate.candidateId,requestId};}
async function apply(value:SubjectStage){const out=await permissions.applyUnit('maker',await prepare(value));if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return out;}
function grant(scope:SubjectScope,kind:'MAPPING'|'PERMISSION') {peer(receipt.name,"INSERT INTO care_organization.subject_access SELECT a,"+quote(scope.subject.id)+"::uuid,"+quote(scope.campus.id)+"::uuid,"+quote(scope.target.type)+","+quote(scope.target.id)+"::uuid,"+quote(kind)+",p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED','VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;");}
test.each(['EQUIVALENT','NARROWER','BROADER','RELATED'] as const)('%s semantic evidence remains separate from a license',async semantic=>{
 grant(licensedScope,'MAPPING');const p=permissionTemplate,entry:SubjectEntry={kind:'MAPPING',action:'RECORD',scope:p.scope,adoption:{...p.adoption,code:'TEST_B'},semantic,row:{...p.row,subject_license_id:randomUUID(),subject_code:'TEST_B'},reason:'TEST independently interpreted '+semantic,evidenceId:p.evidenceId},out=await apply(await input([entry]));
 expect(out.facts[0]!.owner).toBe('care-organization/subject-mapping');expect((await permissions.history('maker',{id:out.facts[0]!.id})).versions[0]!.facts.semantic).toBe(semantic);
 mappingSamples.push({id:out.facts[0]!.id,semantic});
 expect((await permissions.evaluateWindow('maker',{scope:p.scope,adoption:entry.adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('NOT_SATISFIED');
});

test('ORG17 file intake keeps native null and source integers without granting a permission',async()=>{
 const {row,...operation}=permissionTemplate;
 const result=await permissions.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),retentionSeconds:7200,campus:'NORTH',timePolicy:'LOCAL',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_SUBJECT_FILE',profile:'CORE',contractId:subjectContract.contract.id,contractVersionId:subjectContract.contract.versionId,input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_SUBJECT_PERMISSION_V1'}},operations:[operation]},Buffer.from(JSON.stringify([{...row,subject_license_id:randomUUID(),version_no:123,valid_to:null}])));
 expect(result.structuralStatus).toBe('PARSED');expect(result.issues).toEqual([]);expect(result.input).not.toBeNull();
 const original=await permissions.readInput('maker',{inputId:result.input!.inputId});expect(original.entries[0]!.row.version_no).toBe(123);expect(original.entries[0]!.row.valid_to).toBeNull();expect(original.sourceArtifactId).toBe(result.sourceArtifactId);
 expect((await permissions.preview('maker',{inputId:result.input!.inputId})).issues.some(i=>i.code==='LEGAL_REVIEW_REQUIRED')).toBe(true);
});
test('retirement of an adopted target opens review while the original exact mapping remains unchanged',async()=>{
 const original=await permissions.history('maker',{id:mappingSamples[0]!.id}),old=(await codes.read('maker',{id:draftId,versionId:draftVersionId}))[0]!;
 const response=await fetch(url+'/api/vnext/subject-codes/command',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({action:'REVISE',requestId:randomUUID(),reason:'TEST target retirement, no automatic replacement',target:draftId,expectedHead:'1',sourceId:old.sourceId,sourceVersionId:old.sourceVersionId,evidenceId:old.evidenceId,reference:old.reference,codeSystemName:old.codeSystemName,namespaceUri:old.namespaceUri,standardDocument:old.standardDocument,issuer:old.issuer,codeSystemVersion:old.codeSystemVersion,sourcePage:'TEST page 2',sourceSummary:'TEST POLICY ONLY TEST_B retired; TEST_A unchanged; TEST_C added',adoptedOn:'2026-10-05',label:'TEST_POLICY_ONLY',validFrom:old.validFrom,validTo:null,codes:[old.codes[0],{...old.codes[1],status:'RETIRED',replacement:'TEST_C'},{code:'TEST_C',name:'TEST replacement C',meaning:'TEST_C_MEANING',status:'ACTIVE',replacement:null}]})});
 const draft=await response.json();expect(response.status,JSON.stringify(draft)).toBe(200);
 await codes.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST original source retirement read',target:draft.id,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:old.evidenceId,sourceReviewed:true});
 await codes.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST approved retirement snapshot',target:draft.id,versionId:draft.versionId,reviewDigest:draft.reviewDigest});
 const check=await fetch(url+'/api/vnext/subject-permissions/recheck',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify({id:original.id})});const checked=await check.json();expect(check.status,JSON.stringify(checked)).toBe(200);expect(checked.status).toBe('REVIEW_REQUIRED');
 expect((await permissions.exact('maker',{id:original.id,version:'1'}))).toEqual(original.versions[0]);
 expect((await permissions.history('maker',{id:original.id})).versions[0]!.facts.adoption.code).toBe('TEST_B');
 const untouched=await permissions.evaluateWindow('maker',{scope:licensedScope,adoption:permissionTemplate.adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'});expect(untouched.status).toBe('SATISFIED');
});
test('expired diagnostic permission does not cover a future interval and does not fall back to the old open version',async()=>{
 const original=await permissions.history('maker',{id:firstPermission.id}),entry:SubjectEntry={...permissionTemplate,action:'REVISE',target:{owner:'care-organization/subject-permission',id:firstPermission.id,expectedHead:'1'},row:{...permissionTemplate.row,valid_to:'2026-04-01T00:00:00'}};
 await apply(await input([entry]));
 const window={scope:licensedScope,adoption:permissionTemplate.adoption,validFrom:'2026-03-01T00:00:00',validTo:'2026-05-01T00:00:00',mode:'CURRENT_ADMISSION' as const};
 expect((await permissions.evaluateWindow('maker',window)).status).toBe('NOT_SATISFIED');
 expect((await permissions.evaluateWindow('maker',{...window,mode:'HISTORICAL',recordAsOf:original.versions[0]!.recordedAt})).status).toBe('SATISFIED');
 expect((await permissions.exact('maker',{id:firstPermission.id,version:'1'}))).toEqual(original.versions[0]);
});

test('one registered institution governs two distinct campuses without copying the institution identity',async()=>{
 const x=base.operating,subject=await x.createSubject(),license=await x.addLicense(subject),ids:string[]=[];
 const before=await x.org.read('maker',{mode:'LIST'});
 for(let n=0;n<2;n++){
  const campus=await x.createCampus();await x.activateCampus(campus);x.grantPair(subject.id,campus.id);
  const checked=await x.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);
  await x.operatingApply({...x.common,...x.endpoints(subject,campus),action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST same institution distinct campus',primary:'Y',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[checked],licenseScopeText:'TEST POLICY ONLY'}});
  const scope:SubjectScope={target:{type:'LEGAL',owner:'organization-master',id:subject.id},...x.endpoints(subject,campus),services:['DEMO_MEDICAL_A']};grant(scope,'PERMISSION');
  const entry:SubjectEntry={...permissionTemplate,scope,license,row:{...permissionTemplate.row,subject_license_id:randomUUID(),target_type:'LEGAL',target_id:subject.id}};
  const out=await apply(await input([entry]));ids.push(out.facts[0]!.id);
  expect((await permissions.evaluateWindow('maker',{scope,adoption:entry.adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('SATISFIED');
 }
 const after=await x.org.read('maker',{mode:'LIST'});expect(after).toEqual(before);
 const histories=await Promise.all(ids.map(id=>permissions.history('maker',{id})));expect(new Set(histories.map(h=>h.scope.subject.id)).size).toBe(1);expect(new Set(histories.map(h=>h.scope.campus.id)).size).toBe(2);
 // Current revocation changes future admission, while explicit closure remains possible.
 await x.orgApply({...x.common,action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'TEST_LICENSE_REVOKED',validFrom:'2026-04-01T00:00:00'});
 const h=histories[0]!,v=h.versions[0]!;
 expect((await permissions.evaluateWindow('maker',{scope:h.scope,adoption:v.facts.adoption,validFrom:'2026-04-01T00:00:00',validTo:'2026-05-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('NOT_SATISFIED');
 const close:SubjectEntry={...permissionTemplate,scope:h.scope,license,action:'RETIRE',target:{owner:'care-organization/subject-permission',id:h.id,expectedHead:'1'},row:{...permissionTemplate.row,subject_license_id:v.facts.source.sourceAlias,target_type:'LEGAL',target_id:subject.id,valid_from:'2026-04-01T00:00:00',record_status:'RETIRED'}};
 await apply(await input([close]));expect((await permissions.read('maker',{id:h.id,businessAt:'2026-05-01T00:00:00'})).state).toBe('RETIRED');
});

test('Department permission uses an exact public Department-campus relation',async()=>{
 const b=await base.endpoint(await base.newDepartment()),scope:SubjectScope={target:{type:'ORG',owner:'department-master',id:b.department.id},subject:b.subject,campus:b.campus,services:b.services};grant(scope,'PERMISSION');
 const w=await base.operating.operating.evaluateOperatingWindow('maker',{subject:b.subject,campus:b.campus,services:b.services,validFrom:'2026-01-01T00:00:00',validTo:null});
 const entry:SubjectEntry={...permissionTemplate,scope,context:{departmentRelation:b.relation},license:w.services[0]!.segments[0]!.license,row:{...permissionTemplate.row,subject_license_id:randomUUID(),target_type:'ORG',target_id:b.department.id}};
 expect((await apply(await input([entry]))).facts[0]!.owner).toBe('care-organization/subject-permission');
});

test('unresolved limits and FULL retain raw inputs and cannot plan publication',async()=>{
 const value=await input([{...permissionTemplate,limitations:{kind:'UNRESOLVED'},row:{...permissionTemplate.row,subject_license_id:randomUUID(),permitted_scope:'TEST unresolved limit'}}]);value.profile='FULL';
 const i=await permissions.stage('maker',value);await permissions.verify('reviewer',verification(value,i));
 expect((await permissions.readInput('maker',{inputId:i.inputId})).entries[0]!.row.permitted_scope).toBe('TEST unresolved limit');
 expect((await permissions.preview('maker',{inputId:i.inputId})).issues.some(e=>e.code==='BLOCKED_DEPENDENCY')).toBe(true);
 await expect(permissions.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow();
});

test('a bad second row blocks the whole revision and preserves both originals',async()=>{
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}},{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID(),target_type:'UNKNOWN'}}]);
 const i=await permissions.stage('maker',value);await permissions.verify('reviewer',verification(value,i));expect((await permissions.preview('maker',{inputId:i.inputId})).issues.some(e=>e.row===2&&e.code==='SUBJECT_SCOPE_MISMATCH')).toBe(true);
 await expect(permissions.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow();expect((await permissions.readInput('maker',{inputId:i.inputId})).entries).toHaveLength(2);
 expect(peer(receipt.name,"SELECT count(*) FROM care_organization.subject_change WHERE input_id="+quote(i.inputId)+"::uuid;")).toBe('0');
});

test('current scoped rights and human identity prevent maker aliases from verifying and approving themselves',async()=>{
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}]),i=await permissions.stage('maker',value);
 await expect(permissions.verify('maker-alias',verification(value,i))).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 await permissions.verify('reviewer',verification(value,i));const c=await permissions.plan('maker',{inputId:i.inputId,requestId:randomUUID()});await expect(permissions.approveApplyUnit('maker-alias',c)).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 const other={...licensedScope,campus:{...licensedScope.campus,id:randomUUID()}};
 await expect(permissions.stage('maker',{...await input([{...permissionTemplate,scope:other}])})).rejects.toThrow('ACCESS_DENIED');
});

test('idempotent publication resumes and reconciles only while current rights remain',async()=>{
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}]),c=await prepare(value),out=await permissions.applyUnit('maker',c);expect(out.status).toBe('COMMITTED');
 expect(await permissions.applyUnit('maker',c)).toEqual(out);expect((await permissions.resumeOutcome('maker',c))?.status).toBe('COMMITTED');expect((await permissions.reconcileCommittedUnit('maker',c)).status).toBe('MATCHED');
 peer(receipt.name,"DELETE FROM care_organization.subject_access WHERE actor='maker' AND permission='READ_RESTRICTED' AND target_id="+quote(licensedScope.target.id)+"::uuid;");
 try{await expect(permissions.applyUnit('maker',c)).rejects.toThrow('ACCESS_DENIED');await expect(permissions.resumeOutcome('maker',c)).rejects.toThrow('ACCESS_DENIED');}finally{grant(licensedScope,'PERMISSION');}
});

test('generated clients publish and read typed results through real HTTP with current authorization',async()=>{
 const maker=createSubjectPermissionClient(url,'maker'),reviewer=createSubjectPermissionClient(url,'reviewer'),codeClient=createSubjectCodeClient(url,'maker');
 expect((await codeClient.read({id:draftId})).data?.[0]?.status).toBe('APPROVED');
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}]),i=await maker.stage(value);expect(i.response.status).toBe(200);if(!i.data)throw new Error('HTTP_INPUT_FAILED');
 expect((await reviewer.verify(verification(value,i.data))).response.status).toBe(200);
 const requestId=randomUUID(),c=await maker.plan({inputId:i.data.inputId,requestId});expect(c.response.status).toBe(200);if(!c.data)throw new Error('HTTP_PLAN_FAILED');
 await reviewer.review({candidateId:c.data.candidateId});expect((await reviewer.approve(c.data)).response.status).toBe(200);
 const request={candidateId:c.data.candidateId,requestId},out=await maker.apply(request);expect(out.data?.status).toBe('COMMITTED');if(out.data?.status!=='COMMITTED')throw new Error('HTTP_APPLY_FAILED');
 const id=out.data.facts[0]!.id;expect((await maker.history({id})).data?.versions[0]?.facts.source.sourceVersion).toBe('99');expect((await maker.reconcile(request)).response.status).toBe(200);
 expect((await createSubjectPermissionClient(url,'outsider').query({id})).response.status).toBe(403);
});

test.each(['CSV','XLSX'] as const)('%s import records explicit blank-end conversion and preserves source +08 timestamps',async format=>{
 const {row,...operation}=permissionTemplate,original={...row,subject_license_id:randomUUID(),version_no:'123',permitted_scope:'',valid_from:row.valid_from+'+08:00',valid_to:'',recorded_at:row.recorded_at+'+08:00'},fields=ORG17_FIELDS.map(String),values=fields.map(f=>String(original[f as keyof typeof original]??''));
 const bytes=format==='CSV'?Buffer.from([fields.join(','),values.join(',')].join('\n')):organizationWorkbook({ORG17:[fields,values]});
 const result=await permissions.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),retentionSeconds:7200,campus:'NORTH',timePolicy:'SOURCE_PLUS08_TO_LOCAL',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_SUBJECT_FILE',profile:'CORE',contractId:subjectContract.contract.id,contractVersionId:subjectContract.contract.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_SUBJECT_PERMISSION_V1'}},operations:[operation]},bytes);
 expect(result.issues).toEqual([]);if(!result.input)throw new Error('INTAKE_FAILED');const stored=await permissions.readInput('maker',{inputId:result.input.inputId});expect(stored.entries[0]!.row.valid_from).toBe(original.valid_from);expect(stored.entries[0]!.row.valid_to).toBeNull();
 const checked:SubjectVerification={...verification({...stored,entries:stored.entries},result.input),rows:[{...verification(stored,result.input).rows[0]!,validFrom:row.valid_from,validTo:null}]};await permissions.verify('reviewer',checked);expect((await permissions.preview('maker',{inputId:result.input.inputId})).issues).toEqual([]);
});

test('malformed JSON keeps the original file and never creates a publishable input',async()=>{
 const {row,...operation}=permissionTemplate,result=await permissions.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),retentionSeconds:7200,campus:'NORTH',timePolicy:'LOCAL',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_BAD_SUBJECT_FILE',profile:'CORE',contractId:subjectContract.contract.id,contractVersionId:subjectContract.contract.versionId,input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_SUBJECT_PERMISSION_V1'}},operations:[operation]},Buffer.from('[{"subject_license_id":"a","subject_license_id":"b"}]'));
 expect(result.structuralStatus).toBe('REJECTED');expect(result.input).toBeNull();expect(result.sourceArtifactId).toBeTruthy();expect(result.issues.length).toBeGreaterThan(0);
});

test('expired institution license cannot admit a subject permission extending past the license window',async()=>{
 const x=base.operating,subject=await x.createSubject(),campus=await x.createCampus();await x.activateCampus(campus);x.grantPair(subject.id,campus.id);
 const end='2026-04-01T00:00:00',license=await x.addLicense(subject,'2026-01-01T00:00:00',end),checked=await x.verifyScope(subject,campus,license,['DEMO_MEDICAL_A'],'2026-01-01T00:00:00',end);
 await x.operatingApply({...x.common,...x.endpoints(subject,campus),validTo:end,action:'ESTABLISH',evidence:x.artifact.artifactId,facts:{role:'OPERATOR',primary:'Y',relationTypeText:'TEST finite licensed operator',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[checked],licenseScopeText:'TEST POLICY ONLY'}});
 const scope:SubjectScope={target:{type:'LEGAL',owner:'organization-master',id:subject.id},...x.endpoints(subject,campus),services:['DEMO_MEDICAL_A']};grant(scope,'PERMISSION');
 const value=await input([{...permissionTemplate,scope,license,row:{...permissionTemplate.row,subject_license_id:randomUUID(),target_type:'LEGAL',target_id:subject.id}}]),i=await permissions.stage('maker',value);await permissions.verify('reviewer',verification(value,i));expect((await permissions.preview('maker',{inputId:i.inputId})).issues.some(e=>e.code==='LICENSE_PERIOD_NOT_COVERED')).toBe(true);
 await expect(permissions.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
});

test('two approved revisions racing the same expected head produce one new immutable version',async()=>{
 const initial=await apply(await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}]));if(initial.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const h=await permissions.history('maker',{id:initial.facts[0]!.id}),entry:SubjectEntry={...permissionTemplate,action:'REVISE',target:{owner:'care-organization/subject-permission',id:h.id,expectedHead:'1'},row:{...permissionTemplate.row,subject_license_id:h.versions[0]!.facts.source.sourceAlias,valid_to:'2026-05-01T00:00:00'}};
 const one=await prepare(await input([entry])),two=await prepare(await input([entry]));const results=await Promise.allSettled([permissions.applyUnit('maker',one),permissions.applyUnit('maker',two)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await permissions.history('maker',{id:h.id})).versions).toHaveLength(2);
});

test('audit failure rolls the publication back and a lost response recovers from the durable outcome',async()=>{
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}]),c=await prepare(value);
 peer(receipt.name,"CREATE FUNCTION care_organization.subject_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SUBJECT_APPLY' THEN RAISE EXCEPTION 'TEST_AUDIT_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_subject_audit BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION care_organization.subject_test_failure();");
 try{await expect(permissions.applyUnit('maker',c)).rejects.toThrow('APPLY_FAILED');expect(await permissions.resumeOutcome('maker',c)).toBeNull();}finally{peer(receipt.name,'DROP TRIGGER test_subject_audit ON vnext_control.audit;DROP FUNCTION care_organization.subject_test_failure();');}
 const out=await permissions.applyUnit('maker',c,async()=>{throw new Error('TEST_LOST_RESPONSE');});expect(out.status).toBe('COMMITTED');expect(out).toMatchObject({responseStatus:'POST_COMMIT_FAILED'});expect((await permissions.reconcileCommittedUnit('maker',c)).status).toBe('MATCHED');expect((await permissions.resumeOutcome('maker',c))?.status).toBe('COMMITTED');
});

test('withdrawal retries preserve the same durable result and reject a different request',async()=>{
 const i=await permissions.stage('maker',await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID()}}])),request={inputId:i.inputId,requestId:randomUUID()},out=await permissions.withdraw('maker',request);
 expect(await permissions.withdraw('maker',request)).toEqual(out);await expect(permissions.withdraw('maker',{...request,requestId:randomUUID()})).rejects.toThrow('REQUEST_CONFLICT');
});

test('RETIRE verification must bind the exact closing boundary even when current upstream admission is skipped',async()=>{
 const value=await input([{...permissionTemplate,action:'RETIRE',target:{owner:'care-organization/subject-permission',id:firstPermission.id,expectedHead:'2'},row:{...permissionTemplate.row,valid_from:'2026-03-01T00:00:00',valid_to:null,record_status:'RETIRED'}}]),i=await permissions.stage('maker',value),v=verification(value,i);v.rows[0]!.validFrom='2027-01-01T00:00:00';
 await permissions.verify('reviewer',v);expect((await permissions.preview('maker',{inputId:i.inputId})).issues.some(e=>e.code==='SUBJECT_REVIEW_PERIOD_NOT_COVERED')).toBe(true);
});

test('restoring a code meaning cannot auto-close a blocking review; a fresh explicit relation revision resolves it',async()=>{
 async function revise(meaning:string){const old=(await codes.read('maker',{id:draftId}))[0]!,{id,versionId,head,systemCode,status,reviewDigest,recordedAt,approvedAt,sourceVerification,...fields}=old;
  const d=await codes.command('maker',{...fields,action:'REVISE',requestId:randomUUID(),reason:'TEST material code review',target:id,expectedHead:head,codes:old.codes.map(c=>c.code==='TEST_A'?{...c,meaning}:c)});
  await codes.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST material source review',target:d.id,versionId:d.versionId,reviewDigest:d.reviewDigest,evidenceId:d.evidenceId,sourceReviewed:true});await codes.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST checked snapshot',target:d.id,versionId:d.versionId,reviewDigest:d.reviewDigest});
 }
 const old=await permissions.history('maker',{id:firstPermission.id}),candidateBeforeChange=await prepare(await input([{...permissionTemplate,action:'REVISE',target:{owner:'care-organization/subject-permission',id:old.id,expectedHead:'2'},row:{...permissionTemplate.row,valid_to:'2026-04-01T00:00:00'}}]));
 await revise('TEST_A_MATERIAL_CHANGE');await revise('TEST_A_MEANING');
 expect((await permissions.recheck('maker',{id:old.id})).status).toBe('REVIEW_REQUIRED');expect((await permissions.evaluateWindow('maker',{scope:licensedScope,adoption:permissionTemplate.adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('REVIEW_REQUIRED');
 await expect(permissions.applyUnit('maker',candidateBeforeChange)).rejects.toThrow('STALE_VALIDATION');
 await apply(await input([{...permissionTemplate,action:'REVISE',target:{owner:'care-organization/subject-permission',id:old.id,expectedHead:'2'},row:{...permissionTemplate.row,valid_to:'2026-04-01T00:00:00'}}]));expect((await permissions.recheck('maker',{id:old.id})).status).toBe('SATISFIED');
 expect((await permissions.evaluateWindow('maker',{scope:licensedScope,adoption:permissionTemplate.adoption,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00',mode:'CURRENT_ADMISSION'})).status).toBe('SATISFIED');
});

test('adopted code CREATE replay still requires current source-object READ authorization',async()=>{
 const saved=peer(receipt.name,"SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM vnext_control.object_grant g WHERE actor_code='maker' AND object_id="+quote(base.dep.source.id)+"::uuid AND permission='READ';");
 peer(receipt.name,"DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id="+quote(base.dep.source.id)+"::uuid AND permission='READ';");
 try{await expect(codes.command('maker',sourceReplay)).rejects.toThrow('ACCESS_DENIED');
  const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(provider,'SUBJECT_SQL_AUTHORITY_V1',{}),'hex');try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text t')).rows[0].t,ticket=canonicalPlan({actor:'maker',transaction,operation:'CODE_COMMAND',command:sourceReplay,materialDigest:'0'.repeat(64)});await expect(client.query('select governance_catalog.subject_code_command($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toThrow('ACCESS_DENIED');}finally{await client.query('ROLLBACK');key.fill(0);client.release();await pool.end();}
 }finally{peer(receipt.name,"INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,"+quote(saved)+"::jsonb) ON CONFLICT DO NOTHING;");}
});

test('REF01 original code-system alias and text source version are independent of the platform snapshot head',async()=>{
 const value=await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID(),code_system_id:'TEST_REF01_DIAGNOSTIC_SUBJECTS',code_system_version:'2022版'}}]),i=await permissions.stage('maker',value);await permissions.verify('reviewer',verification(value,i));
 expect((await permissions.readInput('maker',{inputId:i.inputId})).entries[0]!.row.code_system_version).toBe('2022版');expect((await permissions.preview('maker',{inputId:i.inputId})).issues).toEqual([]);
});

test('a period-limited blocking case masks only its interval while an independently reviewed permission supplies the gap',async()=>{
 const a=await apply(await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID(),valid_to:'2026-06-01T00:00:00'}}]));
 async function adopt(from:string,to:string|null,meaning:string){const old=(await codes.read('maker',{id:draftId}))[0]!,{id,versionId,head,systemCode,status,reviewDigest,recordedAt,approvedAt,sourceVerification,...fields}=old;
  const d=await codes.command('maker',{...fields,action:'REVISE',requestId:randomUUID(),reason:'TEST bounded case',target:id,expectedHead:head,validFrom:from,validTo:to,codes:old.codes.map(c=>c.code==='TEST_A'?{...c,meaning}:c)});
  await codes.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST bounded source independently read',target:d.id,versionId:d.versionId,reviewDigest:d.reviewDigest,evidenceId:d.evidenceId,sourceReviewed:true});await codes.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST bounded source',target:d.id,versionId:d.versionId,reviewDigest:d.reviewDigest});
 }
 await adopt('2026-03-01T00:00:00','2026-04-01T00:00:00','TEST_BOUNDED_CHANGE');await adopt('2026-03-01T00:00:00','2026-04-01T00:00:00','TEST_A_MEANING');await adopt('2026-04-01T00:00:00',null,'TEST_A_MEANING');
 await apply(await input([{...permissionTemplate,row:{...permissionTemplate.row,subject_license_id:randomUUID(),valid_from:'2026-03-01T00:00:00',valid_to:'2026-04-01T00:00:00'}}]));
 expect((await permissions.recheck('maker',{id:a.facts[0]!.id})).status).toBe('REVIEW_REQUIRED');
 const result=await permissions.evaluateWindow('maker',{scope:licensedScope,adoption:permissionTemplate.adoption,validFrom:'2026-01-01T00:00:00',validTo:'2026-06-01T00:00:00',mode:'CURRENT_ADMISSION'});expect(result.status).toBe('SATISFIED');expect(result.checks.some(c=>c.permissionId===a.facts[0]!.id&&c.from==='2026-01-01T00:00:00.000000'&&c.to==='2026-03-01T00:00:00.000000'&&c.status==='SATISFIED')).toBe(true);
});

test('restricted SQL cannot read raw tables, forge signed commands or bypass current source coverage',async()=>{
 const pool=new Pool({connectionString:connection,max:1});try{
  await expect(pool.query('select * from care_organization.subject_relation_version')).rejects.toThrow(/permission denied/);
  await expect(pool.query("select care_organization.subject_mutate('{}',$1)",['0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
  const original=await permissions.history('maker',{id:firstPermission.id});const v=original.versions[0]!;
  await expect(pool.query('select care_organization.subject_admission($1,$2::jsonb,$3::jsonb,$4::timestamp,$5::timestamp,timezone(\'Asia/Shanghai\',clock_timestamp()))',['maker',JSON.stringify(licensedScope),JSON.stringify({...v.facts,adoption:{...v.facts.adoption,code:'MISSING'}}),'2026-02-01T00:00:00','2026-03-01T00:00:00'])).rejects.toThrow('SUBJECT_CODE_REVIEW_REQUIRED');
 }finally{await pool.end();}
});
